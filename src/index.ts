import { homedir } from "node:os"
import { join } from "node:path"
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
        Stream.runForEach((event) => Effect.gen(function* () {
          if (event.type !== "session.execution.started") return
          const location = event.location ?? (yield* ctx.session.get({ sessionID: event.data.sessionID })).location
          if (location.directory !== ctx.location.directory || location.workspaceID !== ctx.location.workspaceID) return
          yield* observe(event.data.sessionID)
        })),
        Effect.catch((error) => Effect.logWarning("sleep inhibition event subscription failed", error)),
        Effect.forkScoped({ startImmediately: true }),
      )

      // Hot reload can start while an execution is waiting on a tool or form,
      // with no upcoming context hook to reacquire the inhibitor.
      const active = yield* Effect.tryPromise(async () => {
        const { OpenCode } = await import("@opencode/client")
        const { discover, headers } = await import("@opencode/client/service")
        const state = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state")
        const channel = ctx.app.channel
        const file = ["latest", "next", "dev", "beta"].includes(channel)
          ? "service.json"
          : `service-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`
        const endpoint = await discover({ file: join(state, "opencode", file), version: ctx.app.version })
        if (!endpoint) throw new Error("OpenCode service is not discoverable")
        return OpenCode.make({ baseUrl: endpoint.url, headers: headers(endpoint) }).session.active()
      }).pipe(Effect.catchCause((cause) => Effect.logWarning("sleep inhibition active-session recovery failed", cause).pipe(Effect.as({}))))
      yield* Effect.forEach(Object.keys(active), (id) => Effect.gen(function* () {
        const sessionID = id as Parameters<typeof ctx.session.wait>[0]["sessionID"]
        const session = yield* ctx.session.get({ sessionID })
        if (session.location.directory !== ctx.location.directory ||
            session.location.workspaceID !== ctx.location.workspaceID) return
        yield* observe(sessionID)
      }).pipe(Effect.catchCause((cause) => Effect.logWarning("sleep inhibition session recovery failed", { id, cause }))),
      { concurrency: "unbounded" })
    }),
})
