// dsh-task-complete-notifier — host half (v4: frosted-glass toast window)
//
// 检测信号（与 v3 相同）：agent/status 事件 running→idle 边沿 + 3 秒确认，
// 任务真正结束时触发。
//
// 通知（v4 变化）：不再用系统通知，改为创建 Electron 置顶窗口
// （BrowserWindow：alwaysOnTop + frameless + 透明边缘），渲染原始规格的
// 深色实心卡片（不透明）：
//   右下角 30px 边距、背景 #181818（实心不透明）、边框 1px solid #333333、
//   圆角 12px、阴影 0 8px 32px rgba(0,0,0,0.6)、
//   标题 ✓ Task Completed（#E5E5E5 加粗 16px）、正文 #AAAAAA 14px/1.6、
//   Got it 按钮（#2A2A2A / hover #3D3D3D、无边框、圆角 6px）、
//   fadeInUp 0.3s 动画。点击 Got it 或卡片外区域关闭，15 秒自动关闭。
//
// 无音频。非 Electron 环境（纯 dsh web）降级为 host 日志。

export const inject = []

import { createRequire } from 'node:module'

// 毛玻璃卡片页面（data URL 加载到置顶透明窗口）
function buildHtml(opts) {
  const title = opts.title
  const body = opts.body
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  .overlay { position: fixed; inset: 0; background: transparent; }
  .popup {
    position: fixed; right: 30px; bottom: 30px;
    box-sizing: border-box;
    width: 340px;
    padding: 20px 22px;
    background: #181818;
    border: 1px solid #333333;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    animation: fadeInUp 0.3s ease;
    cursor: default;
    user-select: none;
  }
  .title {
    margin: 0 0 8px; font-size: 16px; font-weight: 700; color: #E5E5E5;
  }
  .body {
    margin: 0; font-size: 14px; line-height: 1.6; color: #AAAAAA;
  }
  .btn {
    margin-top: 14px; padding: 8px 16px;
    background: #2A2A2A; color: #E5E5E5;
    border: none; border-radius: 6px;
    font-size: 14px; cursor: pointer;
    transition: background 0.15s ease;
  }
  .btn:hover { background: #3D3D3D; }
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0); }
  }
</style>
</head>
<body>
<div class="overlay" onclick="window.close()"></div>
<div class="popup">
  <div class="title">${title}</div>
  <p class="body">${body}</p>
  <button type="button" class="btn" onclick="window.close()">Got it</button>
</div>
</body>
</html>`
}

export function apply(ctx, config = {}) {
  const settleMs =
    typeof config.settleMs === 'number' && config.settleMs > 0 ? config.settleMs : 3000
  const cooldownMs =
    typeof config.cooldownMs === 'number' && config.cooldownMs > 0 ? config.cooldownMs : 10000
  const autoCloseMs =
    typeof config.autoCloseMs === 'number' && config.autoCloseMs > 0 ? config.autoCloseMs : 15000
  // Win11 acrylic 真·毛玻璃（默认关：与 transparent 组合存在兼容性坑，
  // 见 electron/electron#48031；需要时在 cordis.patch.yml 里开）
  const enableAcrylic = config.enableAcrylic === true
  const title =
    typeof config.title === 'string' && config.title !== '' ? config.title : '✓ Task Completed'
  const body =
    typeof config.body === 'string' && config.body !== ''
      ? config.body
      : 'The current DeepSeek Harness task has finished. Please proceed to the next step.'

  // Electron 内置模块：插件运行在 DSH Desktop 的 Electron 主进程内，
  // require('electron') 返回内置 API；纯 dsh web（无 Electron）抛错 → null。
  let electron = null
  try {
    const nodeRequire = createRequire(import.meta.url)
    electron = nodeRequire('electron')
  } catch {
    electron = null
  }

  // 当前置顶窗口 + 自动关闭定时器（每次通知前先清掉旧的）
  let currentWin = null
  let autoCloseTimer = null

  function closeCurrent() {
    if (autoCloseTimer) {
      clearTimeout(autoCloseTimer)
      autoCloseTimer = null
    }
    if (currentWin) {
      try {
        if (!currentWin.isDestroyed()) currentWin.close()
      } catch {
        // 窗口可能已销毁
      }
      currentWin = null
    }
  }

  async function showFrostedToast() {
    if (electron && typeof electron.BrowserWindow === 'function') {
      try {
        showElectronToast(electron)
        return
      } catch {
        // 窗口创建失败 → 降级日志
      }
    }
    // 降级：无 Electron（纯 dsh web）
    const line = `[task-notifier] ${title} — ${body}`
    try {
      if (ctx.logger && typeof ctx.logger.info === 'function') ctx.logger.info(line)
      else console.log(line)
    } catch {
      console.log(line)
    }
  }

  function showElectronToast(electron) {
    closeCurrent()

    const WINDOW_W = 400
    const WINDOW_H = 230

    // 光标所在的显示器（用户正在操作的屏幕）右下角
    let area = { x: 0, y: 0, width: 1920, height: 1080 }
    try {
      const point = electron.screen.getCursorScreenPoint()
      const display = electron.screen.getDisplayNearestPoint(point)
      area = display.workArea
    } catch {
      // 用默认区域
    }

    const winOptions = {
      width: WINDOW_W,
      height: WINDOW_H,
      x: Math.round(area.x + area.width - WINDOW_W),
      y: Math.round(area.y + area.height - WINDOW_H),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    }
    if (enableAcrylic) winOptions.backgroundMaterial = 'acrylic'

    const win = new electron.BrowserWindow(winOptions)

    currentWin = win
    win.on('closed', () => {
      if (currentWin === win) currentWin = null
    })
    // showInactive：显示但不抢当前应用的焦点
    win.once('ready-to-show', () => {
      try {
        win.showInactive()
      } catch {
        try {
          win.show()
        } catch { /* 忽略 */ }
      }
    })
    void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildHtml({ title, body })))

    // 15 秒未操作自动关闭
    autoCloseTimer = setTimeout(() => {
      autoCloseTimer = null
      try {
        if (!win.isDestroyed()) win.close()
      } catch { /* 忽略 */ }
    }, autoCloseMs)
  }

  // 防抖：多个 agent 同一瞬间结束时只弹一次
  let lastNotifiedAt = 0
  function tryNotify() {
    const now = Date.now()
    if (now - lastNotifiedAt < cooldownMs) return
    lastNotifiedAt = now
    void showFrostedToast()
  }

  // 每个 agent 一个确认定时器（新的 idle 覆盖旧的）
  const settleTimers = new Map()
  function scheduleSettle(agent) {
    const id = agent.id
    const previous = settleTimers.get(id)
    if (previous) clearTimeout(previous)
    const timer = setTimeout(() => {
      settleTimers.delete(id)
      try {
        // goal 回合之间 agent 会很快回到 running → 任务没结束，不发
        if (agent.status === 'running') return
      } catch {
        // agent 已销毁等情况 → 照常通知
      }
      tryNotify()
    }, settleMs)
    settleTimers.set(id, timer)
  }

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return
    // 跳过子代理：只对主任务弹通知
    try {
      if (agent && agent.session && agent.session.header && agent.session.header.origin === 'subagent') return
    } catch {
      // 拿不到 origin 时放行
    }
    scheduleSettle(agent)
  })

  // 插件卸载时清理窗口和定时器
  ctx.effect(() => {
    return () => {
      closeCurrent()
      for (const timer of settleTimers.values()) clearTimeout(timer)
      settleTimers.clear()
    }
  })

  const line = '[task-notifier] host half mounted (v4: agent/status + frosted-glass topmost window)'
  try {
    if (ctx.logger && typeof ctx.logger.info === 'function') ctx.logger.info(line)
    else console.log(line)
  } catch {
    console.log(line)
  }
}
