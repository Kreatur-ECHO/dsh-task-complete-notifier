// dsh-task-complete-notifier — host half (v8: toast + input + task title + sound toggle)
//
// 检测信号：agent/status 事件 running→idle 边沿 + 3 秒确认，任务真正结束时触发。
//
// 功能：右下角置顶卡片显示对话任务标题（session/title 折叠）+ 底部输入框
// 直接下达下一条指令（agent.followup 注入）。多任务同时结束走「一次一个」
// 队列，输入内容不会被新通知覆盖。
//
// v8：卡片右上角音效开关（🔊/🔕），Web Audio 合成"叮"声（无音频文件）；
// 开关状态存 localStorage 跨通知持久，config.soundEnabled 控制缺省值。
//
// 兼容性：所有服务可选——webServer / agents / Electron 任一缺失都
// 优雅降级（无路由、隐藏输入框、日志通知），插件在最小部署也能激活；
// 挂载日志自带环境自检报告。零运行时依赖，Node 20+。
//
// 通知窗口加载插件自带的 /task-notifier/toast 页面（同源），提交走
// /task-notifier/input 路由（loopback + 同源 fence）。

import * as nodeCrypto from 'node:crypto'
import { createRequire } from 'node:module'

export const inject = ['webServer', 'agents']

/** 生成消息 id：Node 20+ 有 randomUUID；极端环境回退到时间戳+随机串。 */
function newMessageId() {
  try {
    if (typeof nodeCrypto.randomUUID === 'function') return nodeCrypto.randomUUID()
  } catch {
    // 回退
  }
  return `dsh-tcn-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** 反向找最新 session/title 事件（findLast 的零依赖替代，兼容旧 Node）。 */
function latestSessionTitleEvent(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i]
    if (e && e.type === 'session/title') return e
  }
  return undefined
}

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
  .headRow { display: flex; align-items: center; justify-content: space-between; margin: 0 0 4px; }
  .title { margin: 0; font-size: 16px; font-weight: 700; color: #E5E5E5; }
  .soundBtn {
    flex: none; margin: 0; padding: 2px 4px;
    background: transparent; color: #AAAAAA;
    border: none; border-radius: 4px;
    font-size: 15px; line-height: 1; cursor: pointer;
    transition: color 0.15s ease;
  }
  .soundBtn:hover { color: #E5E5E5; }
  .soundBtn.off { color: #555555; }
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
  <div class="headRow">
    <div class="title">${escapeHtml(opts.title)}</div>
    <button id="soundBtn" class="soundBtn" type="button" title="${escapeHtml(opts.soundToggleTitle)}">🔊</button>
  </div>
  ${opts.taskTitle ? `<div class="taskTitle" title="${escapeHtml(opts.taskTitle)}">${escapeHtml(opts.taskTitle)}</div>` : ''}
  <p class="body">${escapeHtml(opts.body)}</p>
  ${opts.inputAvailable
    ? `<div class="row">
    <input id="prompt" class="prompt" type="text" placeholder="${escapeHtml(opts.placeholder)}" autocomplete="off">
    <button id="send" class="btn primary" type="button">${escapeHtml(opts.sendLabel)}</button>
    <button class="btn" type="button" onclick="window.close()">${escapeHtml(opts.laterLabel)}</button>
  </div>`
    : `<div class="row">
    <button class="btn" type="button" onclick="window.close()">${escapeHtml(opts.laterLabel)}</button>
  </div>`}
  <div id="error" class="error"></div>
</div>
<script>
(function () {
  var input = document.getElementById('prompt');
  var send = document.getElementById('send');
  var error = document.getElementById('error');
  var submitting = false;

  // ---- 音效（独立于输入框可用性）：开关状态持久化到 localStorage ----
  var SOUND_KEY = 'dsh-tcn-sound';
  var DEFAULT_SOUND = ${opts.soundDefault ? 'true' : 'false'};
  var soundBtn = document.getElementById('soundBtn');
  var soundOn = (function () {
    var stored = null;
    try { stored = localStorage.getItem(SOUND_KEY); } catch (e) { /* 不可用 */ }
    if (stored === '1') return true;
    if (stored === '0') return false;
    return DEFAULT_SOUND;
  })();

  // 合成柔和的"叮"声：660Hz 三角波（圆润）+ 1320Hz 轻谐波（通透），
  // 12ms 淡入避免爆音，指数自然衰减（无音频文件，零体积）
  function playDing() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var now = ctx.currentTime;

      // 主音：三角波温暖圆润，低于原 880Hz 的尖锐感
      var osc1 = ctx.createOscillator();
      var gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.value = 660;
      gain1.gain.setValueAtTime(0.0001, now);
      gain1.gain.linearRampToValueAtTime(0.22, now + 0.012); // 淡入消 click
      gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.8); // 自然衰减
      osc1.connect(gain1).connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.82);

      // 轻谐波：低音量，增加通透感，先于主音衰减
      var osc2 = ctx.createOscillator();
      var gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.value = 1320;
      gain2.gain.setValueAtTime(0.0001, now);
      gain2.gain.linearRampToValueAtTime(0.07, now + 0.012);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
      osc2.connect(gain2).connect(ctx.destination);
      osc2.start(now);
      osc2.stop(now + 0.47);
    } catch (e) { /* 音频不可用则静默 */ }
  }

  function updateSoundBtn() {
    if (!soundBtn) return;
    soundBtn.textContent = soundOn ? '🔊' : '🔕';
    if (soundOn) soundBtn.classList.remove('off');
    else soundBtn.classList.add('off');
  }

  if (soundBtn) {
    soundBtn.addEventListener('click', function () {
      soundOn = !soundOn;
      try { localStorage.setItem(SOUND_KEY, soundOn ? '1' : '0'); } catch (e) { /* 不可用 */ }
      updateSoundBtn();
      if (soundOn) playDing(); // 开启时预览一声
    });
  }
  updateSoundBtn();
  if (soundOn) setTimeout(playDing, 250); // 卡片弹出后轻响一声

  // 输入框不可用（该部署缺 agents 服务）时，脚本只保留关闭逻辑
  if (!input || !send) return;
  var SESSION_ID = ${JSON.stringify(opts.sessionId)};

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
  // 音效：默认开启；卡片按钮的切换结果持久化到 localStorage（跨通知生效）
  const soundEnabled = config.soundEnabled !== false
  const soundToggleTitle =
    typeof config.soundToggleTitle === 'string' ? config.soundToggleTitle : '音效开关'

  // 服务通过 inject 声明（ctx.webServer / ctx.agents 直接可用）。
  // 注意：不要用 ctx.get('xxx') 在这里取服务——DSH 的 isolate 语义下未 inject
  // 的服务 get 不到（v1.3 的教训，导致 webServer/agents 全 false）。
  // inject 声明的核心服务缺失时插件 PENDING（不激活），而非静默失效。
  const webServer = ctx.webServer
  const agents = ctx.agents

  // Electron 内置模块（Electron 主进程内可用；纯 dsh web 为 null）
  let electron = null
  try {
    const nodeRequire = createRequire(import.meta.url)
    electron = nodeRequire('electron')
  } catch {
    electron = null
  }

  const port =
    webServer && typeof webServer.port === 'number' && webServer.port > 0 ? webServer.port : 0
  const baseUrl = `http://127.0.0.1:${port}`
  const inputAvailable = !!(agents && typeof agents.get === 'function')
  const windowCapable = !!(electron && typeof electron.BrowserWindow === 'function') && port > 0

  function log(line) {
    try {
      if (ctx.logger && typeof ctx.logger.info === 'function') ctx.logger.info(line)
      else console.log(line)
    } catch {
      console.log(line)
    }
  }

  // ------------------------------------------------------------ 路由 ------
  // 仅当 webServer 服务存在时注册（缺失时通知降级为 host 日志）
  if (webServer && typeof webServer.register === 'function') {
    // 通知页面（GET）：Electron 窗口加载它（同源，便于提交走同源 fetch）
    ctx.effect(() => webServer.register({
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
          inputAvailable,
          soundDefault: soundEnabled,
          soundToggleTitle,
        })
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(page)
      },
    }), 'task-notifier: toast page route')

  // 指令提交（POST）：注入对应会话的 agent
    ctx.effect(() => webServer.register({
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
        if (!agents || typeof agents.get !== 'function') {
          send(503, { ok: false, error: '该部署没有 agents 服务，无法注入指令' })
          return
        }
        const agent = agents.get(sessionId)
        if (!agent) {
          send(404, { ok: false, error: '该会话已不存在或不可用' })
          return
        }
        if (typeof agent.followup !== 'function') {
          send(501, { ok: false, error: '该 DSH 版本的 agent 不支持 followup 注入' })
          return
        }
        try {
          const message = {
            role: 'user',
            id: newMessageId(),
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
  } else {
    log('[task-notifier] webServer service unavailable — routes skipped, toast degrades to host logs')
  }

  // ------------------------------------------------- 队列 + 窗口管理 ------
  const queue = []
  let currentWin = null
  let autoCloseTimer = null

  /** 从 session 事件日志读最新对话标题（session/title 事件，零依赖）。 */
  function sessionTitleOf(session) {
    try {
      const events = session && session.events
      if (!Array.isArray(events)) return ''
      const last = latestSessionTitleEvent(events)
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
    if (!windowCapable) {
      // 无 Electron 或端口无效（纯 dsh web / 特殊部署）：降级日志，不进队列
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

  log(`[task-notifier] host half mounted (v8: env webServer=${!!webServer} agents=${inputAvailable} electron=${!!(electron && typeof electron.BrowserWindow === 'function')} port=${port} sound=${soundEnabled ? 'on' : 'off'})`)
}
