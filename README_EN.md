# dsh-task-complete-notifier — DSH Task Completion Notifier（DSH任务完成提醒）

A DeepSeek Harness plugin that pops up a **topmost** dark rounded toast card in the bottom-right corner of the screen when an agent task **truly finishes**. No audio, host-half only, zero dependencies.

> Made for DSH Desktop (Electron). Under plain `dsh web` (browser) it degrades to host logs (see FAQ).

## ✨ Features

- **Precise timing, fires once**: watches the `agent/status` cordis event (`running → idle` edge). Intermediate turns of multi-turn tasks (goal loops) never fire; a task interrupted by a new message doesn't fire either
- **Topmost**: the toast is an independent Electron `alwaysOnTop` window — visible even when DSH is in the background or covered by other apps
- **Solid dark card**: opaque `#181818` background, 12px radius, `#333333` border, drop shadow, 30px margin from the bottom-right corner, 0.3s fadeInUp
- **Three ways to dismiss**: click "Got it", click outside the card, or wait for the 15s auto-close
- **No focus stealing**: shows without interrupting the app you're using
- **Skips subagents**: only notifies when the main task finishes
- **No audio**: visual-only
- **Configurable**: text, settle delay, cooldown, auto-close, acrylic — all via `cordis.patch.yml`

## 🖼️ The toast

```
┌──────────────────────────────────────┐
│ ✓ Task Completed                     │  ← #E5E5E5 bold 16px
│                                      │
│ The current DeepSeek Harness task    │  ← #AAAAAA 14px / 1.6
│ has finished. Please proceed to      │
│ the next step.                       │
│                                      │
│ [ Got it ]                           │  ← #2A2A2A, hover #3D3D3D
└──────────────────────────────────────┘
  bg #181818 (opaque) · radius 12px · border #333 · shadow 0 8px 32px
```

## 🔍 How it works

DSH's agent state machine: `running` (task executing, including every turn of a multi-turn goal loop) → `idle` (the whole task is done).

The plugin subscribes to the `agent/status` cordis event (a reliable host-side signal). On the `running → idle` edge it **waits 3 seconds** to confirm the agent doesn't jump straight back to running (goal-round-driver injects the next round quickly between goal turns), then opens an Electron topmost window rendering the card.

Pitfalls we hit along the way (see [Development notes](#-development-notes)):

- ❌ Browser Tampermonkey script — Electron desktop never loads browser scripts
- ❌ `session/event` — exists only on the host side, client plugins never receive it
- ❌ Turn-end signals — tasks often span multiple turns; turn end ≠ task done
- ✅ The `agent/status` idle edge — the precise "task truly finished" signal

## 📦 Installation

### Option 1: tarball (recommended)

1. Download `dsh-task-complete-notifier-1.0.0.tgz` from [Releases](https://github.com/Kreatur-ECHO/dsh-task-complete-notifier/releases)

2. Install with the DSH CLI (`<profile>` is your profile name, e.g. `desktop`):

   ```powershell
   dsh plugin --profile desktop add file:D:\Downloads\dsh-task-complete-notifier-1.0.0.tgz
   ```

   The command reconciles `dsh.profile.bundles` and installs dependencies for you.

3. Restart DSH Desktop.

### Option 2: manual install

1. Extract the tarball anywhere (e.g. `C:\Users\<you>\.dsh\plugins\dsh-task-complete-notifier`)

2. Edit `~/.dsh/profiles/desktop/package.json`:

   ```jsonc
   {
     "dependencies": {
       // ...existing deps...
       "dsh-task-complete-notifier": "link:C:/Users/<you>/.dsh/plugins/dsh-task-complete-notifier"
     },
     "dsh": {
       "profile": {
         "bundles": [
           // ...existing bundles...
           "dsh-task-complete-notifier"
         ]
       }
     }
   }
   ```

3. Run `pnpm install` inside the profile directory, then restart DSH Desktop.

### Verify

After restart, the log shows:

```
[task-notifier] host half mounted (v4: agent/status + frosted-glass topmost window)
```

Run a task to completion — the toast card should appear in the bottom-right corner.

## ⚙️ Configuration

Add `config` to the plugin's mount row in your profile's `cordis.patch.yml` (id-targeted override):

```yaml
- id: task-complete-notifier
  config:
    title: '✓ Task Completed'            # title text
    body: 'The current DeepSeek Harness task has finished. Please proceed to the next step.'  # body text
    settleMs: 3000                        # confirm delay after idle (guards against goal-round false positives)
    cooldownMs: 10000                     # minimum gap between toasts
    autoCloseMs: 15000                    # auto-close timeout
    enableAcrylic: false                  # Windows 11 acrylic blur (known quirks with transparent windows — use with care)
```

## ❓ FAQ

**Q: Does it work with plain `dsh web` (browser)?**
A: Detection works (the signal lives host-side), but the Electron topmost window is unavailable, so it degrades to host logs (`[task-notifier] ✓ Task Completed — ...`). Use DSH Desktop for the full experience.

**Q: Black edges / blocks around the card?**
A: A few GPU drivers render transparent windows poorly. The card itself is opaque `#181818`; if issues persist, open an issue with your GPU model.

**Q: Does interrupting a task (stop button) notify?**
A: Interrupts go through the `aborted` path, not the normal completion edge. If the agent still settles back to idle after the interrupt, you get one toast (the agent did stop).

**Q: Multiple sessions running tasks at once — multiple toasts?**
A: Each main agent completion triggers, but completions within 10s of each other collapse to one toast (cooldown).

## 🛠️ Development notes

| Version | Approach | Result |
|---|---|---|
| v0 | Browser Tampermonkey userscript | ❌ Electron desktop never loads it |
| v1 | Client half + `session/event` listening for turn/end | ❌ event exists host-side only; client never receives it |
| v2 | Client half + turnTail slot / running edge | ⚠️ flaky, fired mid-task, re-fired on session switch, not topmost |
| v3 | Host half + `agent/status` + system notification | ✅ precise & topmost, but native styling |
| v4 | Host half + `agent/status` + Electron topmost card window | ✅ precise + custom card + topmost |

## 📄 License

[MIT](./LICENSE) © 2026 YEYU
