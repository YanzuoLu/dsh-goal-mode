# DSH Goal Mode

Per-session goal controls for DeepSeek Harness 0.2.0-rc.2. The composer’s **Goal** menu appears after MCP (or after permission when MCP is absent).

- **Model can create goals** defaults on. Turned off, model `create_goal` calls are denied, while the user’s `/goal` command stays native and unaffected.
- **Continue while background work runs** defaults off. Active, armed goals wait at the native driver's idle checkpoint while descendant subagents or owned jobs are busy. Turns end normally. User messages, relays, job notices and check-ins run in their own native turns, while the checkpoint wait survives until work is done and the agent is idle. Goal state is never modified.
- **Check-in interval** defaults off. Choose a preset or an ordered combination of days, hours and minutes, from `1m` through `30d`. `90m` normalizes to `1h30m`. Native notice messages steer the session while its goal is active and armed.

Fresh side chats copy their parent’s settings. Other sessions without a record use the defaults. Settings persist in the native `goal_mode` storage domain.

## Install

```sh
dsh plugin --profile web add github:YanzuoLu/dsh-goal-mode
```

Enable the bundle in the plugin manager. No DSH restart is needed. Refresh the Web GUI to load a newly installed client module.

## Build and updates

```sh
node scripts/build.mjs
```

The stable entry owns storage, waiters, timers and lifecycle subscriptions. `release.json` selects an immutable hashed host module in `dist/host/`. The policy replaces its checkpoint-window hooks on each revision, without unloading agents or releasing a pending checkpoint. It also works with the original live bootstrap, whose turn-stopping hook now always returns immediately. The build shares the interval parser with the classic client module. Local tests and scratch artifacts belong in the gitignored `.cache/` directory.

## HTTP

POST JSON to `/api/goal-mode/get` with `{ "sessionId": "…" }`, or `/api/goal-mode/set` with a session id and any of `modelCreate`, `continueWhileBusy`, `interval`. Responses follow the sibling-plugin envelope `{ ok: true, value }`. The value includes the settings and `waiting: { jobs, subagents } | null`.
