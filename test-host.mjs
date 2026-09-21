// dsh-task-complete-notifier — host 半逻辑模拟测试（Node，v5）
// 覆盖：agent/status 检测（子代理跳过/误报防护/完成通知）、
//       指令注入路由（followup 调用 + fence 拒绝 + 参数校验）。
import { apply } from './dsh/index.js'

const notifications = []
const routes = []
const injected = []

function makeReq(body, headers = {}) {
  return {
    headers: { host: '127.0.0.1:61997', ...headers },
    method: 'POST',
    [Symbol.asyncIterator]() {
      let done = false
      return {
        next() {
          if (done) return Promise.resolve({ done: true, value: undefined })
          done = true
          return Promise.resolve({ done: false, value: body })
        },
      }
    },
  }
}

function makeRes() {
  const out = { status: 0, body: '' }
  const res = {
    writeHead(status, headers) { out.status = status; out.headers = headers },
    end(text) { out.body = text },
  }
  return { res, out }
}

const ctx = {
  get(name) {
    if (name === 'agents') return ctx.agents
    if (name === 'webServer') return ctx.webServer
    throw new Error(`service "${name}" unavailable in this mock`)
  },
  on(name, fn) {
    ctx.events[name] = fn
  },
  effect(fn) {
    const disposer = fn()
    ctx.disposers.push(typeof disposer === 'function' ? disposer : () => {})
  },
  webServer: {
    port: 61997,
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  agents: {
    get(sessionId) {
      return {
        followup(message) {
          injected.push({ sessionId, text: message.content[0].text })
        },
      }
    },
  },
  events: {},
  disposers: [],
  logger: { info(line) { if (line.includes('Task Completed')) notifications.push(line) } },
}

apply(ctx, { cooldownMs: 200, settleMs: 300 })

const mkAgent = (id, origin, status) => ({
  id,
  status,
  session: { header: origin ? { origin } : {} },
})

const emit = (agent, status) => ctx.events['agent/status']({ agent, status })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const settleMs = 300

// ---- 检测逻辑（同 v3/v4）--------------------------------------------------
// 场景 1：子代理 idle → 跳过
emit(mkAgent('sub1', 'subagent', 'idle'), 'idle')
await sleep(500)
console.log(`场景1 子代理跳过: ${notifications.length === 0 ? 'PASS' : 'FAIL'}`)

// 场景 2：主 agent idle 后很快又 running（goal 回合）→ 不通知
const a2 = mkAgent('main2', undefined, 'idle')
emit(a2, 'idle')
await sleep(100)
a2.status = 'running'
await sleep(settleMs + 300)
console.log(`场景2 goal回合不误报: ${notifications.length === 0 ? 'PASS' : 'FAIL'}`)

// 场景 3：主 agent idle 且保持 → 3 秒后通知
emit(mkAgent('main3', undefined, 'idle'), 'idle')
await sleep(settleMs + 500)
console.log(`场景3 任务完成通知: ${notifications.length >= 1 ? 'PASS' : 'FAIL'}`)

// ---- v5：指令注入路由 -----------------------------------------------------
const inputRoute = routes.find((r) => r.path === '/task-notifier/input')
const toastRoute = routes.find((r) => r.path === '/task-notifier/toast')
console.log(`场景4 路由已注册: ${inputRoute && toastRoute ? 'PASS' : 'FAIL'}`)

// 场景 5：合法提交 → followup 注入正确会话
{
  const { res, out } = makeRes()
  await inputRoute.handler(
    makeReq(JSON.stringify({ sessionId: 'main3', text: '  请继续下一步  ' })),
    res,
  )
  const ok = out.status === 200 && JSON.parse(out.body).ok === true
  const delivered = injected.length === 1 && injected[0].sessionId === 'main3' && injected[0].text === '请继续下一步'
  console.log(`场景5 指令注入 followup: ${ok && delivered ? 'PASS' : 'FAIL'} (status=${out.status}, injected=${JSON.stringify(injected)})`)
}

// 场景 6：fence 拒绝跨站请求
{
  const { res, out } = makeRes()
  await inputRoute.handler(
    makeReq(JSON.stringify({ sessionId: 'main3', text: 'x' }), { host: 'evil.com' }),
    res,
  )
  console.log(`场景6 fence 拒绝: ${out.status === 403 ? 'PASS' : 'FAIL'} (status=${out.status})`)
}

// 场景 7：空文本拒绝
{
  const { res, out } = makeRes()
  await inputRoute.handler(
    makeReq(JSON.stringify({ sessionId: 'main3', text: '   ' })),
    res,
  )
  console.log(`场景7 空文本拒绝: ${out.status === 400 ? 'PASS' : 'FAIL'} (status=${out.status})`)
}

// 场景 8：未知会话拒绝（mock agents.get 恒返回 followup，说明性输出）
{
  const { res, out } = makeRes()
  await inputRoute.handler(
    makeReq(JSON.stringify({ sessionId: 'ghost', text: 'x' })),
    res,
  )
  console.log(`场景8 未知会话(说明性): status=${out.status}`)
}

// ---- v6：对话任务标题 -----------------------------------------------------
// 场景 9：通知降级日志带出会话标题（session/title 事件折叠）
{
  const before = notifications.length
  const agent9 = {
    id: 'main9',
    status: 'idle',
    session: {
      header: {},
      events: [
        { type: 'user/message', seq: 1, time: 1, data: {} },
        { type: 'session/title', seq: 2, time: 2, data: { title: '修复 Windows 图标缓存' } },
      ],
    },
  }
  emit(agent9, 'idle')
  await sleep(settleMs + 500)
  const last = notifications[notifications.length - 1]
  const hasTitle = last && last.includes('[修复 Windows 图标缓存]')
  console.log(`场景9 通知带对话标题: ${hasTitle ? 'PASS' : 'FAIL'} (${last})`)
}

// 场景 10：无标题会话 → 通知不带标题前缀（不报错）
{
  const before = notifications.length
  emit(mkAgent('main10', undefined, 'idle'), 'idle')
  await sleep(settleMs + 500)
  const last = notifications[notifications.length - 1]
  const noCrash = last && last.startsWith('[task-notifier] ✓ Task Completed')
  console.log(`场景10 无标题降级: ${noCrash ? 'PASS' : 'FAIL'} (${last})`)
}

// ---- v8：音效开关 --------------------------------------------------------
// 场景 11：toast 页面含音效按钮与 Web Audio 合成逻辑
{
  const { res, out } = makeRes()
  const getReq = {
    headers: { host: '127.0.0.1:61997' },
    method: 'GET',
    url: '/task-notifier/toast?sessionId=s1',
    [Symbol.asyncIterator]() {
      return { next: () => Promise.resolve({ done: true, value: undefined }) }
    },
  }
  toastRoute.handler(getReq, res)
  const html = out.body
  const hasSound =
    html.includes('soundBtn')
    && html.includes('playDing')
    && html.includes('AudioContext')
    && html.includes('dsh-tcn-sound')
    && html.includes('localStorage')
  console.log(`场景11 音效元素存在: ${hasSound ? 'PASS' : 'FAIL'} (status=${out.status})`)
}

// ---- v10：isolated host 原生通知兜底 -------------------------------------
// 场景 12：DSH Desktop 2.0.11+ 默认把 host 跑在 Electron utility process 里，
// require('electron') 拿不到 BrowserWindow（electron=false）→ 自绘卡片不可用。
// 此时若存在 desktopRuntime 服务，应发系统原生通知（notifyAttention），
// 而不是像旧版那样只写一行日志（用户视角就是「没响应」）。
{
  const nativeNotifications = []
  const logged = []
  const ctx12 = {
    // 模拟 cordis 4 的 inject-free 读法：ctx.reflect.get(name, false)
    reflect: {
      get(name) {
        if (name === 'desktopRuntime') {
          return { notifyAttention(value) { nativeNotifications.push(value) } }
        }
        return undefined
      },
    },
    on(name, fn) { ctx12.events[name] = fn },
    effect(fn) {
      const disposer = fn()
      ctx12.disposers.push(typeof disposer === 'function' ? disposer : () => {})
    },
    webServer: { port: 61997, register() { return () => {} } },
    agents: { get() { return { followup() {} } } },
    events: {},
    disposers: [],
    logger: { info(line) { logged.push(line) } },
  }
  apply(ctx12, { settleMs: 100 })

  const mountLog = logged.find((l) => l.includes('host half mounted')) || ''
  const mountOk =
    mountLog.includes('v10') && mountLog.includes('electron=false') && mountLog.includes('nativeNotify=true')

  ctx12.events['agent/status']({
    agent: { id: 'n1', status: 'idle', session: { header: {} } },
    status: 'idle',
  })
  await sleep(400)

  const sent =
    nativeNotifications.length === 1
    && nativeNotifications[0].title === '✓ Task Completed'
    && typeof nativeNotifications[0].body === 'string'
  const loggedNative = logged.some((l) => l.includes('native notification sent'))
  const noPlainFallback = !logged.some((l) => l.includes('Please proceed to the next step'))
  console.log(
    `场景12 isolated host 原生通知兜底: ${mountOk && sent && loggedNative && noPlainFallback ? 'PASS' : 'FAIL'} `
    + `(mount=${mountLog}, native=${JSON.stringify(nativeNotifications)})`,
  )
}

// 场景 13：既无 Electron 也无 desktopRuntime（纯 dsh web）→ 仍降级为日志，不抛错
{
  const logged = []
  const ctx13 = {
    reflect: { get() { return undefined } },
    on(name, fn) { ctx13.events[name] = fn },
    effect(fn) {
      const disposer = fn()
      ctx13.disposers.push(typeof disposer === 'function' ? disposer : () => {})
    },
    webServer: { port: 61997, register() { return () => {} } },
    agents: { get() { return { followup() {} } } },
    events: {},
    disposers: [],
    logger: { info(line) { logged.push(line) } },
  }
  apply(ctx13, { settleMs: 100 })
  ctx13.events['agent/status']({
    agent: { id: 'n2', status: 'idle', session: { header: {} } },
    status: 'idle',
  })
  await sleep(400)
  const mountLog = logged.find((l) => l.includes('host half mounted')) || ''
  const fallback = logged.some((l) => l.includes('Please proceed to the next step'))
  console.log(
    `场景13 纯 web 环境降级日志: ${mountLog.includes('nativeNotify=false') && fallback ? 'PASS' : 'FAIL'} (mount=${mountLog})`,
  )
}
