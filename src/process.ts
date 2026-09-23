import { spawn, type ChildProcessByStdio } from "node:child_process"
import type { Writable } from "node:stream"
import type { SleepInhibitMode } from "./options.js"

type Launch = (command: string, args: string[]) => ChildProcessByStdio<Writable, null, null>

/** The injected launch boundary lets tests use a pipe-only child, never systemd. */
export function openInhibitor(
  mode: SleepInhibitMode,
  launch: Launch = (command, args) => spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] }),
) {
  const child = launch("systemd-inhibit", [
    `--what=${mode === "sleep-and-idle" ? "sleep:idle" : "sleep"}`,
    "--mode=block",
    "--who=OpenCode",
    "--why=OpenCode has active agent work",
    "--",
    "/bin/cat",
  ])
  // Resolve errors as values so a child failing before the Effect starts awaiting
  // it cannot create an unhandled Promise rejection.
  const closed = new Promise<Error>((resolve) => {
    child.once("error", resolve)
    child.once("close", (code, signal) =>
      resolve(new Error(`systemd-inhibit exited with ${signal ? `signal ${signal}` : `code ${code}`}`)),
    )
    child.stdin.on("error", () => {})
  })
  return {
    closed,
    // EOF releases cat and the inhibitor without process-wide signal handlers.
    close: () => {
      child.stdin.end()
    },
  }
}
