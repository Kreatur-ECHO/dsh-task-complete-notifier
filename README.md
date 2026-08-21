# dsh-task-complete-notifier — DSH任务完成提醒

DeepSeek Harness 任务完成通知插件：当 agent 一个任务**真正结束**时，在屏幕右下角弹出一张**置顶**的深色圆角卡片。全程无音频，纯 host 半插件，零依赖。

> 适用于 DSH Desktop（Electron 桌面端）。浏览器里用 `dsh web` 的场景会降级为 host 日志（见 FAQ）。

## ✨ 特性

- **只弹一次、时机精确**：监听 DSH 的 `agent/status` 事件（`running → idle` 边沿），多回合任务（goal 循环）的中间回合不会误报；任务被新消息打断也不会误报
- **置顶可见**：通知是独立的 Electron 置顶窗口（`alwaysOnTop`），DSH 窗口在后台、被其他应用挡住时依然可见
- **实心深色卡片**：不透视背景，深色 `#181818` + 圆角 12px + 边框 `#333333` + 阴影，右下角 30px 边距，fadeInUp 0.3s 淡入
- **三种关闭方式**：点「Got it」、点卡片外区域、15 秒无操作自动关闭
- **不抢焦点**：弹出时不打断你正在使用的应用
- **跳过子代理**：子代理（subagent）任务结束不通知，只通知主任务
- **无音频**：纯视觉提示
- **可配置**：文案、延迟、冷却、自动关闭时间、acrylic 效果都可通过 `cordis.patch.yml` 覆盖

## 🖼️ 通知卡片

```
┌──────────────────────────────────────┐
│ ✓ Task Completed                     │  ← #E5E5E5 加粗 16px
│                                      │
│ The current DeepSeek Harness task    │  ← #AAAAAA 14px / 1.6
│ has finished. Please proceed to      │
│ the next step.                       │
│                                      │
│ [ Got it ]                           │  ← #2A2A2A，hover #3D3D3D
└──────────────────────────────────────┘
  背景 #181818（实心）· 圆角 12px · 边框 #333 · 阴影 0 8px 32px
```

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

1. 从 [Releases](https://github.com/Kreatur-ECHO/dsh-task-complete-notifier/releases) 下载 `dsh-task-complete-notifier-1.0.0.tgz`

2. 用 DSH CLI 安装（`<profile>` 换成你的 profile 名，如 `desktop`）：

   ```powershell
   dsh plugin --profile desktop add file:D:\Downloads\dsh-task-complete-notifier-1.0.0.tgz
   ```

   该命令会自动协调 `dsh.profile.bundles` 并安装依赖。

3. 重启 DSH Desktop。

### 方式二：手动安装

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
[task-notifier] host half mounted (v4: agent/status + frosted-glass topmost window)
```

跑一个任务到结束，右下角应弹出通知卡片。

## ⚙️ 配置

在 profile 的 `cordis.patch.yml` 里给插件的挂载行加 `config`（id 定向覆盖）：

```yaml
- id: task-complete-notifier
  config:
    title: '✓ Task Completed'            # 标题
    body: 'The current DeepSeek Harness task has finished. Please proceed to the next step.'  # 正文
    settleMs: 3000                        # idle 后确认延迟（防 goal 回合误报）
    cooldownMs: 10000                     # 两次通知的最小间隔
    autoCloseMs: 15000                    # 卡片自动关闭时间
    enableAcrylic: false                  # Windows 11 acrylic 真·模糊背景（与透明窗口组合有兼容坑，慎开）
```

## ❓ FAQ

**Q：纯 `dsh web`（浏览器）能用吗？**
A：插件核心信号在 host 侧，web 环境也能检测；但 Electron 置顶窗口不可用，会降级为 host 日志（`[task-notifier] ✓ Task Completed — ...`）。要完整效果请用 DSH Desktop。

**Q：卡片出现黑边/黑块？**
A：个别显卡驱动对透明窗口渲染有问题。当前卡片默认实心 `#181818`；若仍有问题，在 issue 里贴出你的显卡型号。

**Q：任务被用户打断（点停止）会通知吗？**
A：打断走 `aborted` 路径，不产生正常完成边沿；若打断后 agent 仍回到 idle，会有一次通知（agent 确实停止了）。

**Q：多个会话同时跑任务，会弹多次吗？**
A：每个主 agent 任务结束都会触发，但 10 秒内的连续结束只弹一次（cooldown）。

## 🛠️ 开发笔记

| 版本 | 方案 | 结果 |
|---|---|---|
| v0 | 浏览器 Tampermonkey 脚本 | ❌ Electron 桌面端不加载浏览器脚本 |
| v1 | client 半 + `session/event` 监听 turn/end | ❌ 该事件只在 host 侧存在，client 收不到 |
| v2 | client 半 + turnTail 槽位 / running 边沿 | ⚠️ 时灵时不灵、任务没跑完就弹、切会话重复弹、不置顶 |
| v3 | host 半 + `agent/status` + 系统通知 | ✅ 时机精确、置顶；但样式是系统原生 |
| v4 | host 半 + `agent/status` + Electron 置顶卡片窗口 | ✅ 时机精确 + 自定义卡片 + 置顶 |

## 📄 License

[MIT](./LICENSE) © 2026 YEYU
