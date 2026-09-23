import { Plugin } from "@opencode/plugin/effect"
import { Effect, Stream } from "effect"
import { makeInhibition } from "./lifecycle.js"
import { parseOptions } from "./options.js"
import { holdInhibitor } from "./inhibitor.js"

export type { SleepInhibitMode, SleepInhibitOptions } from "./options.js"

// Local plugin modules can be reevaluated on reload. Retain only session IDs
// observed by this process so a new generation never queries another server.
const key = Symbol.for("opencode-sleep-inhibit.active-sessions")
type SessionID = Parameters<Plugin.Context["session"]["wait"]>[0]["sessionID"]
const registry = globalThis as typeof globalThis & { [key: symbol]: Map<string, Set<SessionID>> | undefined }
const sessions = registry[key] ??= new Map<string, Set<SessionID>>()

export default Plugin.define({
  id: "opencode-sleep-inhibit",
  effect: (ctx) =>
    Effect.gen(function* () {
      const options = yield* Effect.sync(() => parseOptions(ctx.options))
      if (process.platform !== "linux") {
        yield* Effect.logWarning("opencode-sleep-inhibit supports Linux only")
        return
      }
      const track = yield* makeInhibition(options, holdInhibitor(options.mode))
      const locationKey = JSON.stringify([ctx.location.directory, ctx.location.workspaceID])
      const active = new Set(sessions.get(locationKey))
      sessions.set(locationKey, active)
      const observe = (sessionID: SessionID) => Effect.gen(function* () {
        active.add(sessionID)
        yield* track(sessionID, ctx.session.wait({ sessionID }).pipe(
          Effect.catch((error) => Effect.logWarning("sleep inhibition could not await session", { sessionID, error })),
          Effect.tap(Effect.sync(() => {
            active.delete(sessionID)
            if (active.size === 0 && sessions.get(locationKey) === active) sessions.delete(locationKey)
          })),
        ))
      })

      // A location can load after execution.started. The first context hook also
      // observes those executions, including a continuation in a new location.
      yield* ctx.session.hook("context", (input) => observe(input.sessionID))
      yield* ctx.event.subscribe().pipe(
        Stream.runForEach((event) => Effect.gen(function* () {
          if (event.type !== "session.execution.started") return
          const location = event.location ?? (yield* ctx.session.get({ sessionID: event.data.sessionID })).location
          if (location.directory !== ctx.location.directory || location.workspaceID !== ctx.location.workspaceID) return
          yield* observe(event.data.sessionID)
        }).pipe(Effect.catchCause((cause) => Effect.logWarning("sleep inhibition event skipped", cause)))),
        Effect.catch((error) => Effect.logWarning("sleep inhibition event subscription failed", error)),
        Effect.forkScoped({ startImmediately: true }),
      )

      // Reattach waits before the next model hook, including tool/approval waits.
      yield* Effect.forEach([...active], observe, { concurrency: "unbounded" })
    }),
})
