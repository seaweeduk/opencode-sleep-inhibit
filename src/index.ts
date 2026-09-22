import { Plugin } from "@opencode/plugin/effect"
import { Effect, Stream } from "effect"
import { makeInhibition } from "./lifecycle.js"
import { parseOptions } from "./options.js"
import { holdInhibitor } from "./inhibitor.js"

export type { SleepInhibitMode, SleepInhibitOptions } from "./options.js"

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
      const observe = (sessionID: Parameters<typeof ctx.session.wait>[0]["sessionID"]) =>
        track(sessionID, ctx.session.wait({ sessionID }))

      // A location can load after execution.started. The first context hook also
      // observes those executions, including a continuation in a new location.
      yield* ctx.session.hook("context", (input) => observe(input.sessionID))
      yield* ctx.event.subscribe().pipe(
        Stream.runForEach((event) =>
          event.type === "session.execution.started" ? observe(event.data.sessionID) : Effect.void,
        ),
        Effect.catch((error) => Effect.logWarning("sleep inhibition event subscription failed", error)),
        Effect.forkScoped({ startImmediately: true }),
      )
    }),
})
