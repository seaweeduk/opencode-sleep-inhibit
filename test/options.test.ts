import { expect, test } from "bun:test"
import { parseOptions } from "../src/options.js"

test("preserves defaults and the laptop's explicit settings", () => {
  expect(parseOptions()).toEqual({ mode: "sleep", cooldownMinutes: 0 })
  expect(parseOptions({ mode: "sleep-and-idle", cooldownMinutes: 60 })).toEqual({
    mode: "sleep-and-idle", cooldownMinutes: 60,
  })
  expect(parseOptions({ cooldownMinutes: 0.001 }).cooldownMinutes).toBe(0.001)
  expect(parseOptions({ cooldownMinutes: 35_791 }).cooldownMinutes).toBe(35_791)
})

test("rejects invalid options before resource acquisition", () => {
  expect(() => parseOptions({ mode: "idle" })).toThrow("Invalid mode")
  for (const cooldownMinutes of [-1, 35_792, NaN, Infinity, "60", true]) {
    expect(() => parseOptions({ cooldownMinutes })).toThrow("Invalid cooldownMinutes")
  }
})
