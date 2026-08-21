// dsh-task-complete-notifier — host half (v6: toast + next-step input + task title)
//
// 检测信号（与 v4/v5 相同）：agent/status 事件 running→idle 边沿 + 3 秒确认，
// 任务真正结束时触发。
//
// v5 新功能：通知卡片底部带输入框，可直接输入下一条指令——
// 提交后经插件的 HTTP 路由调用 agent.followup() 注入该会话，用户
// 无需打开 DSH 界面即可继续指挥 agent。若 agent 正在运行，指令自动
// 排队到下一个 turn 执行。
//
// 多任务同时结束的覆盖问题：通知窗口改为「一次一个」的队列——
// 当前窗口还在（用户可能正在输入）时，新通知入队等待；用户提交
// 或关闭当前窗口后才显示下一个。输入到一半的内容不会被新通知打断。
//
// v6 新功能：卡片标题下方显示该对话的任务标题（session/title 事件
// 折叠的最新标题），一眼看出是哪个任务完成了。
//
// 通知窗口加载插件自带的 /task-notifier/toast 页面（同源），提交走
// /task-notifier/input 路由（loopback + 同源 fence）。
// 无 Electron（纯 dsh web）降级为 host 日志。

import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

export const inject = ['webServer']

const DEFAULT_TITLE = '✓ Task Completed'
const DEFAULT_BODY = 'The current DeepSeek Harness task has finished. Please proceed to the next step.'
const MAX_QUEUE = 5 // 通知队列上限，超出丢弃最旧的

// ---------------------------------------------------------------- fence ----
function isLoopbackHost(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127'
    && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

/** 与 dsh /api 网关同款信任栅栏：仅同源 loopback 请求可达。 */
function isTrustedRequest(req) {
  const host = req.headers && req.headers.host
  if (typeof host !== 'string' || host === '') return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!isLoopbackHost(hostUrl.hostname)) return false
  if (req.headers && req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers && req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk)
    total += buf.length
    if (total > 256 * 1024) throw new Error('payload too large')
    chunks.push(buf)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// ---------------------------------------------------------- toast page ----
function renderToastPage(opts) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'">
<style>
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  .overlay { position: fixed; inset: 0; background: transparent; }
  .popup {
    position: fixed; right: 30px; bottom: 30px;
    box-sizing: border-box;
    width: 380px;
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
  .title { margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #E5E5E5; }
  .taskTitle {
    margin: 0 0 8px; font-size: 14px; font-weight: 600; color: #8AB4F8;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .body { margin: 0; font-size: 14px; line-height: 1.6; color: #AAAAAA; }
  .row { display: flex; gap: 8px; margin-top: 14px; }
  .prompt {
    flex: 1; min-width: 0;
    padding: 8px 10px;
    background: #1E1E1E; color: #E5E5E5;
    border: 1px solid #333333; border-radius: 6px;
    font-size: 13px; outline: none;
  }
  .prompt::placeholder { color: #666666; }
  .prompt:focus { border-color: #4D6BFE; }
  .btn {
    padding: 8px 14px;
    background: #2A2A2A; color: #E5E5E5;
    border: none; border-radius: 6px;
    font-size: 13px; cursor: pointer;
    transition: background 0.15s ease;
    white-space: nowrap;
  }
  .btn:hover { background: #3D3D3D; }
  .btn.primary { background: #2F5AD0; }
  .btn.primary:hover { background: #3A6AE0; }
  .error { margin-top: 10px; font-size: 12px; color: #F2A1A1; display: none; }
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0); }
  }
</style>
</head>
<body>
<div class="overlay" onclick="window.close()"></div>
<div class="popup">
  <div class="title">${escapeHtml(opts.title)}</div>
  ${opts.taskTitle ? `<div class="taskTitle" title="${escapeHtml(opts.taskTitle)}">${escapeHtml(opts.taskTitle)}</div>` : ''}
  <p class="body">${escapeHtml(opts.body)}</p>
  <div class="row">
    <input id="prompt" class="prompt" type="text" placeholder="${escapeHtml(opts.placeholder)}" autocomplete="off">
    <button id="send" class="btn primary" type="button">${escapeHtml(opts.sendLabel)}</button>
    <button class="btn" type="button" onclick="window.close()">${escapeHtml(opts.laterLabel)}</button>
  </div>
  <div id="error" class="error"></div>
</div>
<script>
(function () {
  var SESSION_ID = ${JSON.stringify(opts.sessionId)};
  var input = document.getElementById('prompt');
  var send = document.getElementById('send');
  var error = document.getElementById('error');
  var submitting = false;

  function showError(msg) {
    error.textContent = msg;
    error.style.display = 'block';
  }

  function submit() {
    var text = input.value.trim();
    if (text === '' || submitting) return;
    submitting = true;
    send.disabled = true;
    fetch('/task-notifier/input', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: SESSION_ID, text: text }),
    }).then(function (res) {
      return res.json().catch(function () { return null; });
    }).then(function (payload) {
      if (payload && payload.ok) {
        window.close();
      } else {
        submitting = false;
        send.disabled = false;
        var msg = payload && payload.error ? payload.error : '提交失败，请重试';
        showError(msg);
      }
    }).catch(function () {
      submitting = false;
      send.disabled = false;
      showError('网络错误，请重试');
    });
  }

  send.addEventListener('click', submit);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  // 提交失败后输入框保持可用；有内容时 Enter 直接提交
  setTimeout(function () { input.focus(); }, 50);
})();
</script>
</body>
</html>`
}

// ------------------------------------------------------------- apply ------
export function apply(ctx, config = {}) {
  const settleMs =
    typeof config.settleMs === 'number' && config.settleMs > 0 ? config.settleMs : 3000
  const cooldownMs =
    typeof config.cooldownMs === 'number' && config.cooldownMs > 0 ? config.cooldownMs : 10000
  const autoCloseMs =
    typeof config.autoCloseMs === 'number' && config.autoCloseMs > 0 ? config.autoCloseMs : 60000
  const title =
    typeof config.title === 'string' && config.title !== '' ? config.title : DEFAULT_TITLE
  const body =
    typeof config.body === 'string' && config.body !== '' ? config.body : DEFAULT_BODY
  const placeholder =
    typeof config.placeholder === 'string' ? config.placeholder : '输入下一步指令，Enter 发送…'
  const sendLabel = typeof config.sendLabel === 'string' ? config.sendLabel : '发送'
  const laterLabel = typeof config.laterLabel === 'string' ? config.laterLabel : '稍后'

  // 可选服务：agents（agent 注册表，用于 followup 注入指令）
  let agents
  try {
    agents = ctx.get('agents')
  } catch {
    agents = undefined
  }

  // Electron 内置模块（Electron 主进程内可用；纯 dsh web 为 null）
  let electron = null
  try {
    const nodeRequire = createRequire(import.meta.url)
    electron = nodeRequire('electron')
  } catch {
    electron = null
  }

  const port = ctx.webServer && typeof ctx.webServer.port === 'number' ? ctx.webServer.port : 0
  const baseUrl = `http://127.0.0.1:${port}`

  function log(line) {
    try {
      if (ctx.logger && typeof ctx.logger.info === 'function') ctx.logger.info(line)
      else console.log(line)
    } catch {
      console.log(line)
    }
  }

  // ------------------------------------------------------------ 路由 ------
  // 通知页面（GET）：Electron 窗口加载它（同源，便于提交走同源 fetch）
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/task-notifier/toast',
    handler: (req, res) => {
      if (!isTrustedRequest(req)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      const url = new URL(req.url ?? '/', baseUrl)
      const page = renderToastPage({
        sessionId: url.searchParams.get('sessionId') ?? '',
        title: url.searchParams.get('title') || title,
        taskTitle: url.searchParams.get('taskTitle') ?? '',
        body: url.searchParams.get('body') || body,
        placeholder,
        sendLabel,
        laterLabel,
      })
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(page)
    },
  }), 'task-notifier: toast page route')

  // 指令提交（POST）：注入对应会话的 agent
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/task-notifier/input',
    handler: async (req, res) => {
      const send = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(payload))
      }
      if (!isTrustedRequest(req)) {
        send(403, { ok: false, error: 'forbidden' })
        return
      }
      if (req.method !== 'POST') {
        send(405, { ok: false, error: 'method not allowed' })
        return
      }
      let payload
      try {
        payload = await readJsonBody(req)
      } catch {
        send(400, { ok: false, error: 'invalid JSON body' })
        return
      }
      const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : ''
      const text = payload && typeof payload.text === 'string' ? payload.text.trim() : ''
      if (sessionId === '' || text === '') {
        send(400, { ok: false, error: 'sessionId and non-empty text are required' })
        return
      }
      if (text.length > 8000) {
        send(400, { ok: false, error: 'text too long (max 8000 chars)' })
        return
      }
      const agent = agents && typeof agents.get === 'function' ? agents.get(sessionId) : undefined
      if (!agent || typeof agent.followup !== 'function') {
        send(404, { ok: false, error: '该会话已不存在或不可用' })
        return
      }
      try {
        const message = {
          role: 'user',
          id: randomUUID(),
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        }
        agent.followup(message)
        log(`[task-notifier] instruction delivered to session ${sessionId}: ${text.slice(0, 80)}`)
        send(200, { ok: true })
      } catch (error) {
        send(500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'task-notifier: instruction input route')

  // ------------------------------------------------- 队列 + 窗口管理 ------
  const queue = []
  let currentWin = null
  let autoCloseTimer = null

  /** 从 session 事件日志读最新对话标题（session/title 事件，零依赖）。 */
  function sessionTitleOf(session) {
    try {
      const events = session && session.events
      if (!Array.isArray(events)) return ''
      const last = events.findLast((e) => e && e.type === 'session/title')
      if (last && last.data && typeof last.data.title === 'string') return last.data.title
    } catch {
      // 读不到标题时留空
    }
    return ''
  }

  function closeCurrent() {
    if (autoCloseTimer) {
      clearTimeout(autoCloseTimer)
      autoCloseTimer = null
    }
    if (currentWin) {
      try {
        if (!currentWin.isDestroyed()) currentWin.close()
      } catch {
        // 可能已销毁
      }
      currentWin = null
    }
  }

  /** 当前窗口关闭后：取出下一条通知显示。 */
  function onWindowClosed() {
    currentWin = null
    if (autoCloseTimer) {
      clearTimeout(autoCloseTimer)
      autoCloseTimer = null
    }
    const next = queue.shift()
    if (next) showWindow(next)
  }

  function showWindow(item) {
    if (!electron || typeof electron.BrowserWindow !== 'function') {
      // 无 Electron（纯 dsh web）：降级日志，不进队列
      log(`[task-notifier] ${item.taskTitle ? `[${item.taskTitle}] ` : ''}${item.title} — ${item.body}`)
      return
    }
    try {
      const WINDOW_W = 440
      const WINDOW_H = 300

      let area = { x: 0, y: 0, width: 1920, height: 1080 }
      try {
        const point = electron.screen.getCursorScreenPoint()
        const display = electron.screen.getDisplayNearestPoint(point)
        area = display.workArea
      } catch {
        // 用默认区域
      }

      const win = new electron.BrowserWindow({
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
      })

      currentWin = win
      win.on('closed', () => {
        // 用户关闭（提交/稍后/遮罩/auto-close）都会走这里
        onWindowClosed()
      })

      const url = `${baseUrl}/task-notifier/toast`
        + `?sessionId=${encodeURIComponent(item.sessionId)}`
        + `&title=${encodeURIComponent(item.title)}`
        + `&taskTitle=${encodeURIComponent(item.taskTitle ?? '')}`
        + `&body=${encodeURIComponent(item.body)}`
      void win.loadURL(url)

      // 输入场景需要焦点：显示并聚焦，输入框自动获得光标
      win.once('ready-to-show', () => {
        try {
          win.show()
          win.focus()
        } catch {
          try {
            win.show()
          } catch { /* 忽略 */ }
        }
      })

      // auto-close：防止用户长时间不理会导致队列卡死
      autoCloseTimer = setTimeout(() => {
        autoCloseTimer = null
        try {
          if (!win.isDestroyed()) win.close()
        } catch { /* 忽略 */ }
      }, autoCloseMs)
    } catch {
      log(`[task-notifier] ${item.taskTitle ? `[${item.taskTitle}] ` : ''}${item.title} — ${item.body}`)
    }
  }

  /** 通知入口：有窗口在显示就入队（不覆盖正在输入的内容），否则直接显示。 */
  function tryNotify(sessionId, taskTitle) {
    const item = { sessionId, taskTitle, title, body }
    if (currentWin) {
      if (queue.length >= MAX_QUEUE) queue.shift()
      queue.push(item)
      return
    }
    showWindow(item)
  }

  // -------------------------------------------------------- 检测逻辑 ------
  let lastNotifiedAt = 0
  function tryNotifyCooldown(sessionId, taskTitle) {
    const now = Date.now()
    if (now - lastNotifiedAt < cooldownMs) return
    lastNotifiedAt = now
    tryNotify(sessionId, taskTitle)
  }

  const settleTimers = new Map()
  function scheduleSettle(agent) {
    const id = agent.id
    const previous = settleTimers.get(id)
    if (previous) clearTimeout(previous)
    const timer = setTimeout(() => {
      settleTimers.delete(id)
      try {
        if (agent.status === 'running') return
      } catch {
        // agent 已销毁等情况 → 照常通知
      }
      // 读该会话的对话标题，显示在卡片上
      let taskTitle = ''
      try {
        taskTitle = sessionTitleOf(agent.session)
      } catch {
        taskTitle = ''
      }
      tryNotifyCooldown(agent.id, taskTitle)
    }, settleMs)
    settleTimers.set(id, timer)
  }

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return
    try {
      if (agent && agent.session && agent.session.header && agent.session.header.origin === 'subagent') return
    } catch {
      // 拿不到 origin 时放行
    }
    scheduleSettle(agent)
  })

  // 插件卸载清理
  ctx.effect(() => {
    return () => {
      closeCurrent()
      queue.length = 0
      for (const timer of settleTimers.values()) clearTimeout(timer)
      settleTimers.clear()
    }
  })

  log('[task-notifier] host half mounted (v6: agent/status + input-capable topmost card + queue + task title)')
}
