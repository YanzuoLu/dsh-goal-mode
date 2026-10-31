# DSH Goal Mode

Per-session goal controls for DeepSeek Harness 0.2.0-rc.2. The composer’s **Goal** menu appears after MCP (or after permission when MCP is absent).

- **Model can create goals** defaults off. Model `create_goal` calls are denied, while the user’s `/goal` command stays native and unaffected.
- **Continue while background work runs** defaults off. Active, armed goals hold the turn boundary while descendant subagents or owned jobs are busy. Steering, completion notices, Stop, goal changes and settings changes release or re-evaluate the hold. Goal state is never modified.
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

The stable entry owns all subscriptions, storage, waiters and timers. `release.json` selects an immutable hashed host module in `dist/host/`. Published host revisions swap without unloading agents or releasing held turns. The build also shares the interval parser with the classic client module. Local tests and scratch artifacts belong in the gitignored `.cache/` directory.

## HTTP

POST JSON to `/api/goal-mode/get` with `{ "sessionId": "…" }`, or `/api/goal-mode/set` with a session id and any of `modelCreate`, `continueWhileBusy`, `interval`. Responses follow the sibling-plugin envelope `{ ok: true, value }`. The value includes the settings and `waiting: { jobs, subagents } | null`.
