import type { Plugin, PluginOptions } from "@opencode-ai/plugin"
import { spawn, type ChildProcessByStdio } from "node:child_process"
import type { Writable } from "node:stream"

export type SleepInhibitMode = "sleep" | "sleep-and-idle"

export type SleepInhibitOptions = {
  /** What to inhibit while OpenCode is working. Defaults to "sleep". */
  mode?: SleepInhibitMode
  /** Minutes to keep inhibiting sleep after all work becomes idle. Defaults to 0. */
  cooldownMinutes?: number
}

type SessionStatusEvent = {
  type: "session.status"
  properties: {
    sessionID: string
    status: { type: "idle" | "busy" | "retry" }
  }
}

const MAX_TIMER_DELAY_MS = 2_147_483_647
const MAX_COOLDOWN_MINUTES = Math.floor(MAX_TIMER_DELAY_MS / 60_000)

const SleepInhibitPlugin = (async (_input, rawOptions?: PluginOptions) => {
  if (process.platform !== "linux") {
    console.warn("[opencode-sleep-inhibit] This plugin supports Linux only")
    return {}
  }

  const options = parseOptions(rawOptions)
  const activeSessions = new Set<string>()
  let inhibitor: ChildProcessByStdio<Writable, null, null> | undefined
  let cooldown: ReturnType<typeof setTimeout> | undefined

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
    if (cooldown) clearTimeout(cooldown)
    cooldown = undefined
    const child = inhibitor
    inhibitor = undefined
    child?.stdin.end()
  }

  function stopInhibitorAfterCooldown() {
    if (!inhibitor) return
    if (options.cooldownMinutes === 0) {
      stopInhibitor()
      return
    }
    if (cooldown) clearTimeout(cooldown)
    cooldown = setTimeout(stopInhibitor, options.cooldownMinutes * 60_000)
    cooldown.unref()
  }

  function applyEvent(event: SessionStatusEvent) {
    const wasActive = activeSessions.size > 0
    if (event.properties.status.type === "idle") activeSessions.delete(event.properties.sessionID)
    else activeSessions.add(event.properties.sessionID)
    if (activeSessions.size > 0) {
      if (cooldown) clearTimeout(cooldown)
      cooldown = undefined
      startInhibitor()
    } else if (wasActive) {
      stopInhibitorAfterCooldown()
    }
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
  if (mode !== "sleep" && mode !== "sleep-and-idle") {
    throw new Error(
      `[opencode-sleep-inhibit] Invalid mode ${JSON.stringify(mode)}; expected "sleep" or "sleep-and-idle"`,
    )
  }
  const cooldownMinutes = options?.cooldownMinutes ?? 0
  if (
    typeof cooldownMinutes !== "number" ||
    !Number.isFinite(cooldownMinutes) ||
    cooldownMinutes < 0 ||
    cooldownMinutes > MAX_COOLDOWN_MINUTES
  ) {
    throw new Error(
      `[opencode-sleep-inhibit] Invalid cooldownMinutes ${JSON.stringify(cooldownMinutes)}; expected a number between 0 and ${MAX_COOLDOWN_MINUTES}`,
    )
  }
  return { mode, cooldownMinutes }
}

export default SleepInhibitPlugin
