# opencode-sleep-inhibit

Prevent suspend and hibernation while OpenCode agents are working on Linux.

Long-running agents should not be interrupted because your laptop suspends. This plugin prevents sleep while OpenCode is busy, then restores normal power management when the work finishes.

It also covers subagents, retries, tool approvals, permissions, and questions waiting for your response.

## Install

You need Linux with systemd and a recent version of OpenCode.

```sh
git clone https://github.com/seaweeduk/opencode-sleep-inhibit.git
cd opencode-sleep-inhibit
bun install
bun run build
```

Add the plugin to `~/.config/opencode/opencode.json` using its absolute path:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "file:///home/you/dev/opencode-sleep-inhibit/dist/index.js",
      { "mode": "sleep" }
    ]
  ]
}
```

Replace `/home/you/dev` with the directory where you cloned the repository, then restart OpenCode.

## Choose a Mode

### Allow locking (recommended)

`"sleep"` prevents suspend and hibernation while still allowing your screen to turn off and lock normally.

```json
{ "mode": "sleep" }
```

### Keep the screen awake

`"sleep-and-idle"` also asks your desktop to keep the screen on and unlocked. Only use this when leaving the computer unlocked is acceptable.

```json
{ "mode": "sleep-and-idle" }
```

Support for idle inhibition depends on your desktop environment.

## Check It

While OpenCode is working, run:

```sh
systemd-inhibit --list
```

An `OpenCode` entry should appear while work is active and disappear when it finishes.

## License

MIT
