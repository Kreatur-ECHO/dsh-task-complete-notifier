## v1.5.3 — 修复「DSH Desktop 2.0.11+ 下卡片不弹」

### 🐞 根因
DSH Desktop 从 **2.0.11** 起把插件 host 移进了 Electron 的 isolated **utility process**
（`DSH_DESKTOP_ISOLATED_HOST`，默认开启，见 `resources/app/lib/main.js`）。
那里 `require('electron')` 拿不到 `BrowserWindow`，插件挂载日志变成：

```
[task-notifier] host half mounted (v9: env webServer=true agents=true electron=false port=61997 ...)
```

`electron=false` → `windowCapable=false` → 旧代码只写一行 host 日志，**不弹任何东西**。
检测本身一直是好的（日志里 `✓ Task Completed` 每次都出现），坏的只是「显示」这一步。

### ✅ 修复
新增兜底链：**自绘卡片 → 系统原生通知 → host 日志**

- 无 Electron 窗口能力时，经 `ctx.reflect.get('desktopRuntime', false)`（cordis 4 的
  inject-free 读法，避免 `cannot get property ... without inject`）取 DSH 原生通知服务
- 有则调用 `desktopRuntime.notifyAttention({ title, body })` 发**系统原生通知**，
  日志记 `— native notification sent`
- 都没有（纯 `dsh web`）才退回一行日志

挂载日志升级为可自检的 v10：

```
[task-notifier] host half mounted (v10: env webServer=true agents=true electron=false nativeNotify=true port=61997 sound=on)
```

### 🔁 想要完整自绘卡片（输入框 + 自定义音效）
把 host 转回 Electron 主进程即可：

```powershell
setx DSH_DESKTOP_ISOLATED_HOST 0     # 然后重启 DSH Desktop
setx DSH_DESKTOP_ISOLATED_HOST ""    # 撤销（同样要重启）
```

### 🧪 测试
`node test-host.mjs` 13/13 PASS，新增：
- 场景 12：isolated host（`electron=false` + `nativeNotify=true`）→ 走原生通知，不再只写日志
- 场景 13：纯 web（两者皆无）→ 仍安全降级为日志，不抛错

### 安装
```powershell
dsh plugin --profile desktop add file:D:\Downloads\dsh-task-complete-notifier-1.5.3.tgz
```
