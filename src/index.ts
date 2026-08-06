import type { Plugin, PluginOptions } from "@opencode-ai/plugin"
import { spawn, type ChildProcessByStdio } from "node:child_process"
import type { Writable } from "node:stream"

export type SleepInhibitMode = "sleep" | "sleep-and-idle"

export type SleepInhibitOptions = {
  /** What to inhibit while OpenCode is working. Defaults to "sleep". */
  mode?: SleepInhibitMode
}

type SessionStatusEvent = {
  type: "session.status"
  properties: {
    sessionID: string
    status: { type: "idle" | "busy" | "retry" }
  }
}

const SleepInhibitPlugin = (async (_input, rawOptions?: PluginOptions) => {
  if (process.platform !== "linux") {
    console.warn("[opencode-sleep-inhibit] This plugin supports Linux only")
    return {}
  }

  const options = parseOptions(rawOptions)
  const activeSessions = new Set<string>()
  let inhibitor: ChildProcessByStdio<Writable, null, null> | undefined

  function startInhibitor() {
    if (inhibitor) return
    const what = options.mode === "sleep-and-idle" ? "sleep:idle" : "sleep"
    const child = spawn(
      "systemd-inhibit",
      [
        `--what=${what}`,
        "--mode=block",
        "--who=OpenCode",
        "--why=OpenCode has active agent work",
        "--",
        "/bin/cat",
      ],
      { stdio: ["pipe", "ignore", "ignore"] },
    )
    inhibitor = child
    child.stdin.on("error", () => {})
    child.once("error", (error) => {
      if (inhibitor !== child) return
      inhibitor = undefined
      console.warn(`[opencode-sleep-inhibit] Failed to start systemd-inhibit: ${error.message}`)
    })
    child.once("exit", (code, signal) => {
      if (inhibitor !== child) return
      inhibitor = undefined
      if (activeSessions.size === 0) return
      const detail = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`
      console.warn(`[opencode-sleep-inhibit] systemd-inhibit exited unexpectedly with ${detail}`)
    })
  }

  function stopInhibitor() {
    const child = inhibitor
    inhibitor = undefined
    child?.stdin.end()
  }

  function applyEvent(event: SessionStatusEvent) {
    if (event.properties.status.type === "idle") activeSessions.delete(event.properties.sessionID)
    else activeSessions.add(event.properties.sessionID)
    if (activeSessions.size > 0) startInhibitor()
    else stopInhibitor()
  }

  return {
    event: async ({ event }) => {
      if (event.type !== "session.status") return
      applyEvent(event as SessionStatusEvent)
    },
    dispose: async () => {
      activeSessions.clear()
      stopInhibitor()
    },
  }
}) satisfies Plugin

function parseOptions(options?: PluginOptions): Required<SleepInhibitOptions> {
  const mode = options?.mode ?? "sleep"
  if (mode === "sleep" || mode === "sleep-and-idle") return { mode }
  throw new Error(
    `[opencode-sleep-inhibit] Invalid mode ${JSON.stringify(mode)}; expected "sleep" or "sleep-and-idle"`,
  )
}

export default SleepInhibitPlugin
