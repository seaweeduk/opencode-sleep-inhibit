import { Effect, Fiber, Scope, Semaphore } from "effect"
import type { SleepInhibitOptions } from "./options.js"

/** One scoped controller per location; systemd combines independent location locks. */
export const makeInhibition = (
  options: Required<SleepInhibitOptions>,
  hold: Effect.Effect<void, unknown, Scope.Scope>,
) =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const lock = yield* Semaphore.make(1)
    const active = new Set<string>()
    const state: {
      holder?: { running: boolean; fiber: Fiber.Fiber<void> }
      cooldown?: Fiber.Fiber<void>
    } = {}

    const release = Effect.gen(function* () {
      if (state.holder) yield* Fiber.interrupt(state.holder.fiber)
      state.holder = undefined
    })

    const idle = (sessionID: string) =>
      lock.withPermit(
        Effect.gen(function* () {
          active.delete(sessionID)
          if (active.size > 0) return
          if (options.cooldownMinutes === 0) return yield* release
          state.cooldown = yield* Effect.sleep(options.cooldownMinutes * 60_000).pipe(
            Effect.andThen(lock.withPermit(release)),
            Effect.forkIn(scope),
          )
        }),
      )

    return (sessionID: string, wait: Effect.Effect<void, unknown>) =>
      lock.withPermit(
        Effect.gen(function* () {
          if (state.cooldown) yield* Fiber.interrupt(state.cooldown)
          state.cooldown = undefined
          if (!state.holder?.running) {
            const lifetime = { running: true }
            const fiber = yield* hold.pipe(
              Effect.scoped,
              Effect.catch((error) => Effect.logWarning("sleep inhibitor unavailable", error)),
              Effect.ensuring(Effect.sync(() => {
                lifetime.running = false
              })),
              Effect.forkIn(scope, { startImmediately: true }),
            )
            state.holder = Object.assign(lifetime, { fiber })
          }
          if (active.has(sessionID)) return
          active.add(sessionID)
          // Session.wait follows the process-global coordinator, including moves,
          // retries, permission waits, failure and interruption. No location-local
          // terminal event is required to release the original location's lock.
          yield* wait.pipe(
            Effect.catch((error) => Effect.logWarning("sleep inhibition could not await session", { sessionID, error })),
            Effect.andThen(idle(sessionID)),
            Effect.forkIn(scope),
          )
        }),
      )
  })
