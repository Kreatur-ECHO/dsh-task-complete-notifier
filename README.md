# dsh-task-complete-notifier — DSH Task Completion Notifier（DSH任务完成提醒）

English | [中文](./README_ZH.md)

A DeepSeek Harness plugin that pops up a **topmost** dark rounded toast card in the bottom-right corner of the screen when an agent task **truly finishes**. No audio, host-half only, zero dependencies.

> Made for DSH Desktop (Electron). Under plain `dsh web` (browser) it degrades to host logs (see FAQ).

## ✨ Features

- **Precise timing, fires once**: watches the `agent/status` cordis event (`running → idle` edge). Intermediate turns of multi-turn tasks (goal loops) never fire; a task interrupted by a new message doesn't fire either
- **Topmost**: the toast is an independent Electron `alwaysOnTop` window — visible even when DSH is in the background or covered by other apps
- **Solid dark card**: opaque `#181818` background, 12px radius, `#333333` border, drop shadow, 30px margin from the bottom-right corner, 0.3s fadeInUp
- **Three ways to dismiss**: click "稍后/Later", click outside the card, or wait for the auto-close
- **⌨️ Reply without switching (v1.1)**: the toast has an input box at the bottom — type your next instruction, hit Enter, and it's delivered to the session's agent via `agent.followup()` (queued as the next turn even if the agent is busy). No need to bring DSH to the foreground
- **📛 Shows the conversation title (v1.2)**: the toast displays the session's task title (folded from `session/title` events), so you instantly know which task just finished — and which conversation your typed instruction will go to
- **Queue, never overwrite (v1.1)**: toasts show one at a time. A new completion queues behind the current toast, so an instruction you're typing is never wiped by the next toast — when you submit or dismiss, the next one appears
- **Focuses for typing**: the toast focuses its input box on show, so you can start typing immediately
- **Skips subagents**: only notifies when the main task finishes
- **No audio**: visual-only
- **Configurable**: text, settle delay, cooldown, auto-close, placeholder, labels — all via `cordis.patch.yml`

## 🖼️ The toast

```
┌──────────────────────────────────────┐
│ ✓ Task Completed                     │  ← #E5E5E5 bold 16px
│                                      │
│ The current DeepSeek Harness task    │  ← #AAAAAA 14px / 1.6
│ has finished. Please proceed to      │
│ the next step.                       │
│                                      │
│ [ Type your next instruction…  ]     │  ← input box, Enter to send
│ [ 发送 ]  [ 稍后 ]                    │  ← submit / dismiss
└──────────────────────────────────────┘
  bg #181818 (opaque) · radius 12px · border #333 · shadow 0 8px 32px
```

## ⌨️ Reply right in the toast

When a task finishes, the toast's input box is auto-focused — type your next instruction and press **Enter** (or click **发送 / Send**):

- The instruction is delivered to the session that just finished, through `agent.followup()` — the same path DSH's own prompt uses
- If that agent is already running something else, your instruction queues as its next turn
- If the session is gone, the toast shows an inline error and stays open so you don't lose what you typed
- **Multiple tasks finishing at once?** Toasts appear one at a time: while a toast is on screen (you may be typing), later completions wait in a queue (max 5, oldest dropped). Submit or dismiss the current toast and the next appears — your half-typed instruction is never overwritten

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

1. Download `dsh-task-complete-notifier-1.1.0.tgz` from [Releases](https://github.com/Kreatur-ECHO/dsh-task-complete-notifier/releases)

2. Install with the DSH CLI (`<profile>` is your profile name, e.g. `desktop`):

   ```powershell
   dsh plugin --profile desktop add file:D:\Downloads\dsh-task-complete-notifier-1.1.0.tgz
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
[task-notifier] host half mounted (v5: agent/status + input-capable topmost card + queue)
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
    autoCloseMs: 60000                    # auto-close timeout
    placeholder: '输入下一步指令，Enter 发送…'   # input placeholder
    sendLabel: '发送'                      # submit button label
    laterLabel: '稍后'                     # dismiss button label
```

## ❓ FAQ

**Q: Does it work with plain `dsh web` (browser)?**
A: Detection works (the signal lives host-side), but the Electron topmost window is unavailable, so it degrades to host logs (`[task-notifier] ✓ Task Completed — ...`). Use DSH Desktop for the full experience.

**Q: Black edges / blocks around the card?**
A: A few GPU drivers render transparent windows poorly. The card itself is opaque `#181818`; if issues persist, open an issue with your GPU model.

**Q: Does interrupting a task (stop button) notify?**
A: Interrupts go through the `aborted` path, not the normal completion edge. If the agent still settles back to idle after the interrupt, you get one toast (the agent did stop).

**Q: Multiple sessions running tasks at once — multiple toasts?**
A: Toasts show one at a time and queue behind the current one (max 5, oldest dropped). Submit or dismiss the current toast and the next appears — you'll never lose a half-typed instruction.

**Q: Where does my typed instruction go?**
A: To the session whose task just finished (the toast is bound to that session). It's delivered through `agent.followup()` — if the agent is busy it runs as the next turn; if the session is gone the toast shows an inline error.

**Q: Is the input route secure?**
A: Both plugin routes (`/task-notifier/toast`, `/task-notifier/input`) sit behind the same loopback + same-origin trust fence as DSH's own `/api` gateway. Cross-site pages and non-loopback hosts are refused (403).

## 🛠️ Development notes

| Version | Approach | Result |
|---|---|---|
| v0 | Browser Tampermonkey userscript | ❌ Electron desktop never loads it |
| v1 | Client half + `session/event` listening for turn/end | ❌ event exists host-side only; client never receives it |
| v2 | Client half + turnTail slot / running edge | ⚠️ flaky, fired mid-task, re-fired on session switch, not topmost |
| v3 | Host half + `agent/status` + system notification | ✅ precise & topmost, but native styling |
| v4 | Host half + `agent/status` + Electron topmost card window | ✅ precise + custom card + topmost |
| v5 | v4 + reply input box + toast queue | ✅ type the next instruction right in the toast; completions queue instead of overwriting |
| v6 | v5 + conversation title on the toast | ✅ shows which task finished (`session/title` fold) |

## 📄 License

[MIT](./LICENSE) © 2026 YEYU
