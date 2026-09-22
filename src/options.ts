export type SleepInhibitMode = "sleep" | "sleep-and-idle"

export type SleepInhibitOptions = {
  mode?: SleepInhibitMode
  cooldownMinutes?: number
}

// Effect's live clock ultimately uses the platform timer.
const MAX_COOLDOWN_MINUTES = Math.floor(2_147_483_647 / 60_000)

export function parseOptions(options: Readonly<Record<string, unknown>> = {}): Required<SleepInhibitOptions> {
  const mode = options.mode ?? "sleep"
  if (mode !== "sleep" && mode !== "sleep-and-idle") {
    throw new Error('Invalid mode; expected "sleep" or "sleep-and-idle"')
  }
  const cooldownMinutes = options.cooldownMinutes ?? 0
  if (
    typeof cooldownMinutes !== "number" ||
    !Number.isFinite(cooldownMinutes) ||
    cooldownMinutes < 0 ||
    cooldownMinutes > MAX_COOLDOWN_MINUTES
  ) {
    throw new Error(`Invalid cooldownMinutes; expected a number between 0 and ${MAX_COOLDOWN_MINUTES}`)
  }
  return { mode, cooldownMinutes }
}
