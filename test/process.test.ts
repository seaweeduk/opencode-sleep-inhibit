import { expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { openInhibitor } from "../src/process.js"

for (const mode of ["sleep", "sleep-and-idle"] as const) {
  test(`${mode}: passes block arguments and releases a pipe-only child by EOF`, async () => {
    const calls: { command: string; args: string[] }[] = []
    const child = openInhibitor(mode, (command, args) => {
      calls.push({ command, args })
      // Never execute command: the only real process is a Bun stdin reader.
      return spawn(process.execPath, ["-e", "await Bun.stdin.text()"], {
        stdio: ["pipe", "ignore", "pipe"],
      })
    })
    try {
      expect(calls).toEqual([{
        command: "systemd-run",
        args: [
          "--user", "--wait", "--pipe", "--collect", "systemd-inhibit",
          `--what=${mode === "sleep" ? "sleep" : "sleep:idle"}`,
          "--mode=block", "--who=OpenCode", "--why=OpenCode has active agent work", "--", "/bin/cat",
        ],
      }])
      const result = await Promise.race([child.closed, Bun.sleep(30).then(() => "open")])
      expect(result).toBe("open")
    } finally {
      child.close()
      expect((await child.closed).message).toContain("code 0")
    }
  })
}

test("spawn failure is observable without an unhandled rejection", async () => {
  const child = openInhibitor("sleep", () => spawn("/nonexistent/sleep-inhibit-test", [], {
    stdio: ["pipe", "ignore", "pipe"],
  }))
  expect(await child.closed).toBeInstanceOf(Error)
  child.close()
})

test("systemd authorization failures include stderr", async () => {
  const child = openInhibitor("sleep", () => spawn(process.execPath, ["-e", "console.error('Access denied'); process.exit(1)"], {
    stdio: ["pipe", "ignore", "pipe"],
  }))
  expect((await child.closed).message).toContain("Access denied")
  child.close()
})
