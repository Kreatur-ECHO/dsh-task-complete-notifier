# dsh-task-complete-notifier — DSH任务完成提醒

[English](./README.md) | 中文

DeepSeek Harness 任务完成通知插件：当 agent 一个任务**真正结束**时，在屏幕右下角弹出一张**置顶**的深色圆角卡片。全程无音频，纯 host 半插件，零依赖。

> 适用于 DSH Desktop（Electron 桌面端）。浏览器里用 `dsh web` 的场景会降级为 host 日志（见 FAQ）。

## ✨ 特性

- **只弹一次、时机精确**：监听 DSH 的 `agent/status` 事件（`running → idle` 边沿），多回合任务（goal 循环）的中间回合不会误报；任务被新消息打断也不会误报
- **置顶可见**：通知是独立的 Electron 置顶窗口（`alwaysOnTop`），DSH 窗口在后台、被其他应用挡住时依然可见
- **实心深色卡片**：不透视背景，深色 `#181818` + 圆角 12px + 边框 `#333333` + 阴影，右下角 30px 边距，fadeInUp 0.3s 淡入
- **三种关闭方式**：点「稍后」、点卡片外区域、超时自动关闭
- **⌨️ 卡片内直接下达下一条指令（v1.1）**：卡片底部有输入框，输入下一条指令回车发送，经 `agent.followup()` 直达刚完成任务的那个会话——无需切回 DSH 界面；agent 正在忙时指令自动排到下一个 turn
- **📛 显示对话任务标题（v1.2）**：卡片上显示该会话的任务标题（由 `session/title` 事件折叠），一眼看出是哪个任务完成了、你的指令将发往哪个对话
- **排队不覆盖（v1.1）**：通知一次只显示一个。当前卡片还在（你可能正在输入）时，新完成的任务排队等待，你输到一半的内容绝不会被新通知冲掉；提交或关闭当前卡片后自动弹出下一个
- **输入自动聚焦**：卡片弹出即聚焦输入框，可直接打字
- **跳过子代理**：子代理（subagent）任务结束不通知，只通知主任务
- **🔔 可开关的「叮」声提示（v1.4）**：卡片弹出时播放 Web Audio 合成的"叮"声（无音频文件）；右上角 🔊/🔕 按钮一键开关，选择跨通知持久（localStorage）
- **可配置**：文案、延迟、冷却、自动关闭时间、占位符、按钮文字都可通过 `cordis.patch.yml` 覆盖

## 🖼️ 通知卡片

```
┌──────────────────────────────────────┐
│ ✓ Task Completed              🔊     │  ← 标题 + 音效开关
│                                      │
│ [对话任务标题]                        │  ← #8AB4F8 14px
│ The current DeepSeek Harness task    │  ← #AAAAAA 14px / 1.6
│ has finished. Please proceed to      │
│ the next step.                       │
│                                      │
│ [ 输入下一步指令，Enter 发送…    ]     │  ← 输入框，回车发送
│ [ 发送 ]  [ 稍后 ]                    │  ← 提交 / 关闭
└──────────────────────────────────────┘
  背景 #181818（实心）· 圆角 12px · 边框 #333 · 阴影 0 8px 32px
```

## ⌨️ 在卡片里直接下达下一条指令

任务完成时卡片弹出，输入框自动聚焦——直接输入下一条指令，回车（或点「发送」）：

- 指令通过 `agent.followup()` 送达**刚完成任务的那个会话**（与 DSH 自己的 prompt 同一条注入路径）
- 如果该 agent 已经在跑别的任务，你的指令自动排队为它的下一个 turn
- 如果会话已不存在，卡片内联显示错误并保持打开，你输入的内容不会丢
- **多个任务同时结束？** 通知一次只显示一个：当前卡片在屏（你可能正在输入）时，后续完成的通知进入队列（最多 5 条，超出丢最旧）。提交或关闭当前卡片后才显示下一个——输到一半的指令绝不会被覆盖

## 🔍 工作原理

DSH 的 agent 状态机：`running`（任务执行中，包括 goal 多轮任务的每一个 turn）→ `idle`（整个任务结束）。

插件订阅 cordis 的 `agent/status` 事件（host 侧可靠信号），在 `running → idle` 边沿**延迟 3 秒**确认 agent 没有立刻回到 running（goal 任务的回合之间 goal-round-driver 会快速注入下一轮），确认后创建 Electron 置顶窗口渲染卡片。

开发过程中踩过的坑（详见[开发笔记](#-开发笔记)）：

- ❌ 浏览器 Tampermonkey 脚本 —— Electron 桌面端根本不加载
- ❌ `session/event` 事件 —— 只在 host 侧存在，client 侧收不到
- ❌ 回合（turn）结束信号 —— 任务常是多回合连续执行，回合结束 ≠ 任务完成
- ✅ `agent/status` 的 idle 边沿 —— 「任务真正完成」的精确信号

## 📦 安装

### 方式一：下载 tarball 安装（推荐）

1. 从 [Releases](https://github.com/Kreatur-ECHO/dsh-task-complete-notifier/releases) 下载 `dsh-task-complete-notifier-1.3.0.tgz`

2. 用 DSH CLI 安装（`<profile>` 换成你的 profile 名，如 `desktop`）：

   ```powershell
   dsh plugin --profile desktop add file:D:\Downloads\dsh-task-complete-notifier-1.3.0.tgz
   ```

   该命令会自动协调 `dsh.profile.bundles` 并安装依赖。

3. 重启 DSH Desktop。

### 方式二：一键安装脚本（自动配置环境）

随包附带的 `install.ps1` 自动完成手动安装的全部步骤——把插件放进 `~/.dsh/plugins/`、在 profile 的 `package.json` 注册依赖和 bundle（幂等）、往 `cordis.patch.yml` 写入挂载行和默认 config、执行 `pnpm install`、最后打印重启提示：

```powershell
# 解压 tarball 后，在解压目录里运行：
powershell -ExecutionPolicy Bypass -File install.ps1
# 或直接从 tarball 安装 / 指定 profile：
powershell -ExecutionPolicy Bypass -File install.ps1 -Profile web -Tarball D:\dsh-task-complete-notifier-1.3.0.tgz
```

### 方式三：手动安装

1. 解压 tarball 到任意目录（如 `C:\Users\<你>\.dsh\plugins\dsh-task-complete-notifier`）

2. 编辑 `~/.dsh/profiles/desktop/package.json`：

   ```jsonc
   {
     "dependencies": {
       // ...已有依赖...
       "dsh-task-complete-notifier": "link:C:/Users/<你>/.dsh/plugins/dsh-task-complete-notifier"
     },
     "dsh": {
       "profile": {
         "bundles": [
           // ...已有 bundles...
           "dsh-task-complete-notifier"
         ]
       }
     }
   }
   ```

3. 在 profile 目录执行 `pnpm install`，然后重启 DSH Desktop。

### 验证

重启后日志出现：

```
[task-notifier] host half mounted (v7: env webServer=true agents=true electron=true port=61997)
```

跑一个任务到结束，右下角应弹出通知卡片。

## 🧩 环境与兼容性

所有依赖都是**可选的**——最小部署下插件也能激活并优雅降级。挂载日志就是内置的环境自检：

```
[task-notifier] host half mounted (v7: env webServer=true agents=true electron=true port=61997)
```

| 能力 | 用途 | 缺失时 |
|---|---|---|
| `agent/status` 事件（host 侧） | 任务完成检测 | DSH 必有，实际必需 |
| `webServer` 服务 | `/task-notifier/*` 路由 | 跳过路由，通知降级为 host 日志 |
| `agents` 服务 + `agent.followup` | 卡片内输入指令 | 卡片隐藏输入框，检测照常 |
| Electron（`desktopRuntime`） | 置顶卡片窗口 | 通知降级为 host 日志（纯 `dsh web`） |
| `session/title` 事件 | 卡片显示任务标题 | 标题行隐藏 |

运行要求：**Node ≥ 20**、带 agent loop 的 DSH（`agent.followup` 建议 rc.6+）。零运行时 npm 依赖。

## ⚙️ 配置

在 profile 的 `cordis.patch.yml` 里给插件的挂载行加 `config`（id 定向覆盖）：

```yaml
- id: task-complete-notifier
  config:
    title: '✓ Task Completed'            # 标题
    body: 'The current DeepSeek Harness task has finished. Please proceed to the next step.'  # 正文
    settleMs: 3000                        # idle 后确认延迟（防 goal 回合误报）
    cooldownMs: 10000                     # 两次通知的最小间隔
    autoCloseMs: 60000                    # 卡片自动关闭时间
    placeholder: '输入下一步指令，Enter 发送…'   # 输入框占位符
    sendLabel: '发送'                      # 发送按钮文字
    laterLabel: '稍后'                     # 关闭按钮文字
    soundEnabled: true                    # 音效缺省状态（卡片按钮可覆盖并持久化）
    soundToggleTitle: '音效开关'           # 音效按钮提示
```

## ❓ FAQ

**Q：纯 `dsh web`（浏览器）能用吗？**
A：插件核心信号在 host 侧，web 环境也能检测；但 Electron 置顶窗口不可用，会降级为 host 日志（`[task-notifier] ✓ Task Completed — ...`）。要完整效果请用 DSH Desktop。

**Q：卡片出现黑边/黑块？**
A：个别显卡驱动对透明窗口渲染有问题。当前卡片默认实心 `#181818`；若仍有问题，在 issue 里贴出你的显卡型号。

**Q：任务被用户打断（点停止）会通知吗？**
A：打断走 `aborted` 路径，不产生正常完成边沿；若打断后 agent 仍回到 idle，会有一次通知（agent 确实停止了）。

**Q：多个会话同时跑任务，会弹多次吗？**
A：通知一次只显示一个，其余排队（最多 5 条，超出丢最旧）。提交或关闭当前卡片后自动弹出下一个——你输到一半的指令绝不会被覆盖。

**Q：我在卡片里输入的指令发到哪里？**
A：发给刚完成任务的那个会话（卡片与该会话绑定），经 `agent.followup()` 注入——agent 正在忙时作为下一个 turn 执行；会话已不存在时卡片内联显示错误。

**Q：输入路由安全吗？**
A：两条插件路由（`/task-notifier/toast`、`/task-notifier/input`）都在与 DSH `/api` 网关相同的 loopback + 同源信任栅栏之后，跨站页面与非 loopback 主机一律 403 拒绝。

## 🛠️ 开发笔记

| 版本 | 方案 | 结果 |
|---|---|---|
| v0 | 浏览器 Tampermonkey 脚本 | ❌ Electron 桌面端不加载浏览器脚本 |
| v1 | client 半 + `session/event` 监听 turn/end | ❌ 该事件只在 host 侧存在，client 收不到 |
| v2 | client 半 + turnTail 槽位 / running 边沿 | ⚠️ 时灵时不灵、任务没跑完就弹、切会话重复弹、不置顶 |
| v3 | host 半 + `agent/status` + 系统通知 | ✅ 时机精确、置顶；但样式是系统原生 |
| v4 | host 半 + `agent/status` + Electron 置顶卡片窗口 | ✅ 时机精确 + 自定义卡片 + 置顶 |
| v5 | v4 + 输入框 + 通知队列 | ✅ 卡片内直接下达下一条指令；多任务结束排队不覆盖 |
| v6 | v5 + 卡片显示对话任务标题 | ✅ 一眼看出哪个任务完成（`session/title` 折叠） |

## 📄 License

[MIT](./LICENSE) © 2026 YEYU
