// dsh-task-complete-notifier — host 半逻辑模拟测试（Node）
// 模拟 cordis ctx + agent/status 事件流，验证 v3 的检测与通知逻辑。
import { apply } from './dsh/index.js'

const notifications = []
const ctx = {
  // 模拟无 desktopRuntime（降级路径）：get 抛错
  get(name) {
    throw new Error(`service "${name}" unavailable in this mock`)
  },
  on(name, fn) {
    ctx.events[name] = fn
  },
  effect(fn) {
    const disposer = fn()
    ctx.disposers.push(typeof disposer === 'function' ? disposer : () => {})
  },
  events: {},
  disposers: [],
  logger: { info(line) { if (line.includes('Task Completed')) notifications.push(line) } },
}

apply(ctx)

const mkAgent = (id, origin, status) => ({
  id,
  status,
  session: { header: origin ? { origin } : {} },
})

const emit = (agent, status) => ctx.events['agent/status']({ agent, status })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const settleMs = 3000

// 场景 1：子代理 idle → 跳过（3 秒后无通知）
emit(mkAgent('sub1', 'subagent', 'idle'), 'idle')
await sleep(500)
console.log(`场景1 子代理跳过: ${notifications.length === 0 ? 'PASS' : 'FAIL(' + notifications.length + ')'}`)

// 场景 2：主 agent idle 后 500ms 又 running（goal 回合）→ 不通知
const a2 = mkAgent('main2', undefined, 'idle')
emit(a2, 'idle')
await sleep(500)
a2.status = 'running'
await sleep(settleMs + 300)
console.log(`场景2 goal回合不误报: ${notifications.length === 0 ? 'PASS' : 'FAIL(' + notifications.length + ')'}`)

// 场景 3：主 agent idle 且保持 → 3 秒后通知
emit(mkAgent('main3', undefined, 'idle'), 'idle')
await sleep(settleMs + 500)
console.log(`场景3 任务完成通知: ${notifications.length >= 1 ? 'PASS' : 'FAIL'}`)
if (notifications.length > 0) console.log(`  通知内容: ${notifications[notifications.length - 1]}`)
