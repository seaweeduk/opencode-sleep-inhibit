import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../dist/index.js"

const originalPath = process.env.PATH
let directory
let hooks

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "opencode-sleep-inhibit-"))
  await mkdir(join(directory, "bin"))
  await mkdir(join(directory, "held"))
  await writeFile(
    join(directory, "bin", "systemd-inhibit"),
    `#!/bin/sh
printf '%s\n' "$*" >> "$INHIBIT_LOG"
marker="$INHIBIT_HELD/$$"
touch "$marker"
trap 'rm -f "$marker"' EXIT INT TERM HUP
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done
if [ "$1" = "--" ]; then shift; fi
"$@"
`,
  )
  await chmod(join(directory, "bin", "systemd-inhibit"), 0o755)
  process.env.PATH = `${join(directory, "bin")}:${originalPath}`
  process.env.INHIBIT_LOG = join(directory, "calls.log")
  process.env.INHIBIT_HELD = join(directory, "held")
  hooks = await plugin({})
})

afterEach(async () => {
  await hooks?.dispose?.()
  process.env.PATH = originalPath
  delete process.env.INHIBIT_LOG
  delete process.env.INHIBIT_HELD
  await rm(directory, { recursive: true, force: true })
})

async function held() {
  return (await readdir(join(directory, "held"))).length > 0
}

async function waitFor(expected) {
  const deadline = Date.now() + 2_000
  while ((await held()) !== expected) {
    if (Date.now() >= deadline) throw new Error(`inhibitor did not become ${expected ? "active" : "inactive"}`)
    await Bun.sleep(10)
  }
}

async function status(sessionID, type) {
  await hooks.event({ event: { type: "session.status", properties: { sessionID, status: { type } } } })
}

describe("opencode-sleep-inhibit", () => {
  test("uses sleep-only inhibition by default", async () => {
    await status("session", "busy")
    await waitFor(true)

    expect(await readFile(join(directory, "calls.log"), "utf8")).toContain("--what=sleep ")
    await status("session", "idle")
    await waitFor(false)
  })

  test("can additionally inhibit idle while retrying", async () => {
    await hooks.dispose()
    hooks = await plugin({}, { mode: "sleep-and-idle" })
    await status("session", "retry")
    await waitFor(true)

    expect(await readFile(join(directory, "calls.log"), "utf8")).toContain("--what=sleep:idle ")
  })

  test("keeps the inhibitor while a child session remains busy", async () => {
    await status("parent", "busy")
    await status("child", "busy")
    await waitFor(true)

    await status("parent", "idle")
    expect(await held()).toBe(true)
    await status("child", "idle")
    await waitFor(false)
  })

  test("keeps the inhibitor while a busy session waits for interaction", async () => {
    await status("session", "busy")
    await waitFor(true)

    await hooks.event({ event: { type: "question.asked", properties: { id: "question", sessionID: "session" } } })
    await hooks.event({ event: { type: "permission.asked", properties: { id: "permission", sessionID: "session" } } })
    expect(await held()).toBe(true)

    await status("session", "idle")
    await waitFor(false)
  })
})
