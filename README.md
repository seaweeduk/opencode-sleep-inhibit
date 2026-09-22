# opencode-sleep-inhibit — OpenCode v2

Prevent Linux suspend and hibernation while OpenCode agents work, with an optional post-work cooldown. This branch is an **unpublished, v2-only Effect plugin** targeting OpenCode 2.0.14 and Effect 4.0.0-rc.112. It does not run in OpenCode v1.

## Setup in a separate v2 environment

Requirements: Linux with systemd/logind, `systemd-inhibit`, `/bin/cat`, and a compatible OpenCode v2 host. No elevated privileges are requested; logind policy must permit inhibition.

Build this package after its dependencies are available and approved under your dependency-age policy. Then add its directory to **the separate v2 environment's** configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/home/anthony/dev/opencode-v2-readiness/sleep-inhibit",
      "options": {
        "mode": "sleep-and-idle",
        "cooldownMinutes": 60
      }
    }
  ]
}
```

The package exposes its built entrypoint at both the package root and `/server`. The example preserves the laptop's intended settings. It does not change the defaults, which remain `mode: "sleep"` and `cooldownMinutes: 0`.

This branch has not been published: installing the unversioned npm package still selects the existing v1 release. Do not point the running v1 installation at this worktree. No live configuration was changed during implementation.

## Options

| Option | Default | Behavior |
| --- | --- | --- |
| `mode` | `"sleep"` | Block suspend/hibernation; allow ordinary screen locking. |
| `mode: "sleep-and-idle"` | Opt-in | Also request idle inhibition (`sleep:idle`). Desktop support varies; this can keep the screen on and unlocked. |
| `cooldownMinutes` | `0` | Keep the inhibitor after all observed work in a location finishes. Accepts fractional minutes, from 0 through 35,791. |

New work cancels a pending cooldown. The full cooldown starts again after the last active session settles. Duplicate observations do not add sessions or restart an idle cooldown. Plugin unload, reload, and orderly server shutdown release the inhibitor immediately, even during cooldown.

## Lifecycle

- Uses `Plugin.define` from `@opencode/plugin/effect`, `ctx.event.subscribe()`, the scoped `ctx.session.hook("context", ...)`, and `ctx.session.wait()`.
- Observes current `session.execution.started` events using `event.data.sessionID`. A context hook also catches executions already underway when a location's plugin loads.
- One controller and at most one inhibitor per plugin/location scope. Concurrent sessions and subagents share that inhibitor. Different locations have independent locks; unloading one does not release another's lock.
- `session.wait()` follows the process-global execution coordinator through retries, tool/permission/question waits, location moves, and success, failure, or interruption. A moved session's original location does not need to receive its terminal event to clean up. Destination context hooks observe continued work there.
- Effect scopes own the event consumer, session waiters, cooldown fibers, and inhibitor resource. Closing stdin sends EOF to the child; no process-wide signal handlers are installed.
- Missing systemd, rejected inhibition, or unexpected child exit logs a warning without failing the agent. A subsequent execution/context observation retries acquisition. There is no background retry loop while otherwise waiting.

### Observation limits

The public event subscription is live-only. There is no public active-session listing in the plugin context used here. If this plugin is loaded while an existing execution is already waiting for permission or a tool, it can only observe that execution at its next context hook (or its next execution start). No private Core services or synthetic v1 events are used to hide this limitation.

Inhibition also depends on logind and desktop policy. An asynchronous observer cannot guarantee acquisition before the first instruction of an execution. Real-host integration and actual sleep/idle inhibition have not been exercised in this preparation worktree.

## Migration from v1

1. Keep the existing `0.2.x` plugin and v1 configuration for the live v1 host.
2. Prepare and verify this branch in a separately configured v2 environment.
3. Change the v1 singular `plugin` tuple entry to the v2 plural `plugins` object shown above in that separate environment. Preserve `mode` and `cooldownMinutes` explicitly.
4. Use this branch's built package instead of the v1 npm release. Activate it only as part of your planned v2 host migration.
5. After local v2 testing and user acceptance, publish the v2 release on the existing npm package's main release line. There is no plan to maintain parallel v1/v2 support. Do not publish before that acceptance.

The v1 Promise factory, `@opencode-ai/plugin` dependency, `session.status` cast, and `dispose` hook have been replaced. There is no runtime version detection or dual-v1/v2 implementation.

## Development and verification

`bunfig.toml` normally enforces a ten-day dependency cooldown. On September 22, 2026 the user explicitly waived that rule for isolated verification. A v2 lockfile was generated with lifecycle scripts disabled. The type check, build/declaration generation, and all 12 tests passed against `@opencode/plugin@2.0.14` in Bubblewrap with no host home, service sockets, or host process access, and with network-isolated tests. Actual OpenCode loading and real logind inhibition remain untested.

For ordinary development after approval/age eligibility, resolve dependencies without lifecycle scripts, then run checks in isolated state. During the active v1 readiness investigation, use the stronger `../sandbox.sh` wrapper instead of this environment-only example:

```sh
mkdir -p .verification/{home,config,data,state,cache,runtime,tmp}
export HOME="$PWD/.verification/home"
export XDG_CONFIG_HOME="$PWD/.verification/config"
export XDG_DATA_HOME="$PWD/.verification/data"
export XDG_STATE_HOME="$PWD/.verification/state"
export XDG_CACHE_HOME="$PWD/.verification/cache"
export XDG_RUNTIME_DIR="$PWD/.verification/runtime"
export TMPDIR="$PWD/.verification/tmp"
bun install --ignore-scripts
bun run check
bun run build
bun test
```

Review dependency release ages for the entire resolved graph, including transitives; the exact Effect prerelease must match the host. Subsequent installs should use the reviewed lockfile with `--frozen-lockfile --ignore-scripts`.

The dependency-free subset is `bun run test:boundary`. It tests option validation and the process boundary, using only a pipe-reading child in place of `systemd-inhibit`. The Effect suite tests concurrent sessions, deduplication, cooldown cancellation, independent locations, scope interruption/finalization, wait errors, and acquisition recovery using controlled Effects. **No test takes a systemd lock or starts OpenCode.**

## License

MIT
