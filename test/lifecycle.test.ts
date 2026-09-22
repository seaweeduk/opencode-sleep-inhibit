import { expect, test } from "bun:test"
import { Deferred, Effect, Fiber, Scope } from "effect"
import { makeInhibition } from "../src/lifecycle.js"

const eventually = (check: () => boolean) => Effect.promise(async () => {
  const deadline = Date.now() + 2_000
  while (!check()) {
    if (Date.now() > deadline) throw new Error("lifecycle did not settle")
    await Bun.sleep(2)
  }
})

function fixture(cooldownMinutes = 0) {
  return Effect.gen(function* () {
    const state = { acquired: 0, released: 0, held: 0 }
    const hold = Effect.acquireRelease(
      Effect.sync(() => { state.acquired++; state.held++ }),
      () => Effect.sync(() => { state.released++; state.held-- }),
    ).pipe(Effect.andThen(Effect.never))
    const track = yield* makeInhibition({ mode: "sleep", cooldownMinutes }, hold)
    const session = (id: string) => Effect.gen(function* () {
      const done = yield* Deferred.make<void>()
      yield* track(id, Deferred.await(done))
      return done
    })
    return { state, track, session }
  })
}

test("concurrent parent/child sessions and repeated context hooks share one inhibitor", () =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const f = yield* fixture()
    const parent = yield* f.session("parent")
    const child = yield* f.session("child")
    yield* f.track("parent", Effect.die("duplicate observer must not run"))
    yield* eventually(() => f.state.held === 1)
    yield* Deferred.succeed(parent, undefined)
    yield* Effect.sleep(10)
    expect(f.state.held).toBe(1)
    yield* Deferred.succeed(child, undefined)
    yield* eventually(() => f.state.released === 1)
    expect(f.state.acquired).toBe(1)
  }))),
)

test("new work cancels cooldown and the next idle gets a full new window", () =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const f = yield* fixture(0.002)
    const first = yield* f.session("one")
    yield* eventually(() => f.state.held === 1)
    yield* Deferred.succeed(first, undefined)
    yield* Effect.sleep(30)
    expect(f.state.held).toBe(1)
    const next = yield* f.session("two")
    yield* Effect.sleep(150)
    expect(f.state.held).toBe(1)
    expect(f.state.acquired).toBe(1)
    yield* Deferred.succeed(next, undefined)
    yield* Effect.sleep(30)
    expect(f.state.held).toBe(1)
    yield* eventually(() => f.state.held === 0)
  }))),
)

test("location unload releases its own resources without releasing another location", () =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const other = yield* fixture()
    yield* other.session("same-session-moved")
    const closed = yield* Effect.scoped(Effect.gen(function* () {
      const original = yield* fixture(60)
      const done = yield* original.session("same-session-moved")
      yield* eventually(() => original.state.held === 1 && other.state.held === 1)
      yield* Deferred.succeed(done, undefined)
      yield* Effect.sleep(10)
      return original.state
    }))
    expect(closed).toEqual({ acquired: 1, released: 1, held: 0 })
    expect(other.state.held).toBe(1)
  }))),
)

test("a shared execution wait settles both locations after a move without a terminal event", () =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const origin = yield* fixture()
    const destination = yield* fixture()
    const done = yield* Deferred.make<void>()
    yield* origin.track("moving-session", Deferred.await(done))
    yield* destination.track("moving-session", Deferred.await(done))
    yield* eventually(() => origin.state.held === 1 && destination.state.held === 1)
    yield* Deferred.succeed(done, undefined)
    yield* eventually(() => origin.state.held === 0 && destination.state.held === 0)
    expect(origin.state.released).toBe(1)
    expect(destination.state.released).toBe(1)
  }))),
)

test("scope interruption cleans up active work and a 60-minute cooldown immediately", async () => {
  for (const idle of [false, true]) {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const started = yield* Deferred.make<{ acquired: number; released: number; held: number }>()
      const worker = yield* Effect.scoped(Effect.gen(function* () {
        const f = yield* fixture(60)
        const done = yield* f.session("session")
        yield* eventually(() => f.state.held === 1)
        if (idle) {
          yield* Deferred.succeed(done, undefined)
          yield* Effect.sleep(10)
        }
        yield* Deferred.succeed(started, f.state)
        yield* Effect.never
      })).pipe(Effect.forkScoped)
      const state = yield* Deferred.await(started)
      yield* Fiber.interrupt(worker)
      expect(state).toEqual({ acquired: 1, released: 1, held: 0 })
    })))
  }
})

test("all acquired resources are finalized when the controller scope closes", () =>
  Effect.runPromise(Effect.gen(function* () {
    const result = yield* Effect.scoped(Effect.gen(function* () {
      const f = yield* fixture(60)
      yield* f.session("active")
      yield* eventually(() => f.state.held === 1)
      return f.state
    }))
    expect(result).toEqual({ acquired: 1, released: 1, held: 0 })
  })),
)

test("wait errors fail open and failed inhibitor acquisition can recover on later activity", () =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const state = { attempts: 0, released: 0 }
    const hold: Effect.Effect<void, Error, Scope.Scope> = Effect.suspend(() => {
      state.attempts++
      if (state.attempts === 1) return Effect.fail(new Error("controlled acquisition failure"))
      return Effect.acquireRelease(Effect.void, () => Effect.sync(() => { state.released++ }))
        .pipe(Effect.andThen(Effect.never))
    })
    const track = yield* makeInhibition({ mode: "sleep", cooldownMinutes: 0 }, hold)
    const done = yield* Deferred.make<void>()
    yield* track("session", Deferred.await(done))
    yield* Effect.sleep(10)
    yield* track("session", Deferred.await(done))
    yield* eventually(() => state.attempts === 2)
    yield* Deferred.succeed(done, undefined)
    yield* eventually(() => state.released === 1)
    yield* track("deleted-session", Effect.fail(new Error("session not found")))
    yield* eventually(() => state.released === 2)
  }))),
)
