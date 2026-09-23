import { Effect } from "effect"
import type { SleepInhibitMode } from "./options.js"
import { openInhibitor } from "./process.js"

export const holdInhibitor = (mode: SleepInhibitMode) =>
  Effect.gen(function* () {
    const child = yield* Effect.acquireRelease(
      Effect.try(() => openInhibitor(mode)),
      (child) => Effect.promise(() => {
        child.close()
        return child.closed
      }),
    )
    const error = yield* Effect.promise(() => child.closed)
    return yield* Effect.fail(error)
  })
