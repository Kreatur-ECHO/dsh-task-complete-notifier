# dsh-task-complete-notifier 一键安装脚本
# 用法：
#   powershell -ExecutionPolicy Bypass -File install.ps1                 # 默认 profile=desktop，从本脚本所在目录安装
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Profile web     # 指定 profile
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Tarball D:\x.tgz # 从 tarball 安装
#
# 自动完成：
#   1. 把插件文件放到 ~/.dsh/plugins/dsh-task-complete-notifier
#   2. 在 profile 的 package.json 里注册 dependencies(link) + dsh.profile.bundles（幂等）
#   3. 在 profile 的 cordis.patch.yml 里写入挂载行 + 默认 config（幂等）
#   4. 执行 pnpm install
#   5. 提示重启 DSH Desktop
param(
  [string]$Profile = 'desktop',
  [string]$Tarball = ''
)

$ErrorActionPreference = 'Stop'
$pluginName = 'dsh-task-complete-notifier'
$home = $env:USERPROFILE
if (-not $home) { $home = $env:HOMEDRIVE + $env:HOMEPATH }
$pluginsDir = Join-Path $home '.dsh\plugins'
$targetDir = Join-Path $pluginsDir $pluginName
$profileDir = Join-Path $home ".dsh\profiles\$Profile"

Write-Host "== dsh-task-complete-notifier 一键安装 ==" -ForegroundColor Cyan
Write-Host "  Profile : $Profile"
Write-Host "  目标目录: $targetDir"

# ---------------------------------------------------------------- 1. 放置插件
if (-not (Test-Path $profileDir)) {
  Write-Host "[错误] profile 目录不存在: $profileDir" -ForegroundColor Red
  Write-Host "       先确认 DSH 已运行过（或手动创建该 profile）。"
  exit 1
}

New-Item -ItemType Directory -Force -Path $pluginsDir | Out-Null

if ($Tarball -ne '') {
  # 从 tarball 解压（Windows 内置 tar）
  if (-not (Test-Path $Tarball)) { Write-Host "[错误] tarball 不存在: $Tarball" -ForegroundColor Red; exit 1 }
  $extractRoot = Join-Path $pluginsDir "$pluginName-extract"
  if (Test-Path $extractRoot) { Remove-Item $extractRoot -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
  Write-Host "[1/5] 解压 tarball ..."
  tar -xzf $Tarball -C $extractRoot
  $extracted = Join-Path $extractRoot 'package'
  if (-not (Test-Path $extracted)) {
    Write-Host "[错误] tarball 内没有 package 目录，内容异常。" -ForegroundColor Red
    exit 1
  }
  if (Test-Path $targetDir) { Remove-Item $targetDir -Recurse -Force }
  Copy-Item $extracted $targetDir -Recurse
  Remove-Item $extractRoot -Recurse -Force
} else {
  # 从脚本所在目录复制（随仓库分发）
  $srcDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  Write-Host "[1/5] 复制插件文件 ..."
  if (Test-Path $targetDir) { Remove-Item $targetDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  foreach ($item in @('package.json', 'cordis.patch.yml', 'README.md', 'README_ZH.md', 'LICENSE')) {
    if (Test-Path (Join-Path $srcDir $item)) { Copy-Item (Join-Path $srcDir $item) $targetDir }
  }
  $dshSrc = Join-Path $srcDir 'dsh'
  if (Test-Path $dshSrc) { Copy-Item $dshSrc (Join-Path $targetDir 'dsh') -Recurse }
}
Write-Host "        完成: $targetDir" -ForegroundColor Green

# ----------------------------------------------- 2. 更新 profile 的 package.json
$pkgPath = Join-Path $profileDir 'package.json'
Write-Host "[2/5] 注册到 profile 的 package.json ..."
if (-not (Test-Path $pkgPath)) {
  Write-Host "[错误] 找不到 $pkgPath" -ForegroundColor Red
  exit 1
}
$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json

# dependencies：添加 link 条目（幂等）
$depValue = "link:$($targetDir -replace '\\','/')"
if (-not ($pkg.PSObject.Properties.Name -contains 'dependencies')) {
  $pkg | Add-Member -NotePropertyName 'dependencies' -NotePropertyValue (@{} | Select-Object -Property * -ErrorAction SilentlyContinue)
}
if (-not $pkg.dependencies) { $pkg.dependencies = @{} }
$depChanged = $false
if (-not ($pkg.dependencies.PSObject.Properties.Name -contains $pluginName)) {
  $pkg.dependencies | Add-Member -NotePropertyName $pluginName -NotePropertyValue $depValue -Force
  $depChanged = $true
} elseif ($pkg.dependencies.$pluginName -ne $depValue) {
  $pkg.dependencies.$pluginName = $depValue
  $depChanged = $true
}

# bundles：追加插件名（幂等）
$bundleChanged = $false
if (-not $pkg.dsh) { $pkg | Add-Member -NotePropertyName 'dsh' -NotePropertyValue (@{}) }
if (-not $pkg.dsh.profile) { $pkg.dsh | Add-Member -NotePropertyName 'profile' -NotePropertyValue (@{}) }
if (-not $pkg.dsh.profile.bundles) { $pkg.dsh.profile | Add-Member -NotePropertyName 'bundles' -NotePropertyValue (@()) }
$bundles = @($pkg.dsh.profile.bundles)
if (-not ($bundles -contains $pluginName)) {
  $pkg.dsh.profile.bundles = @($bundles) + @($pluginName)
  $bundleChanged = $true
}
if ($depChanged -or $bundleChanged) {
  $pkg | ConvertTo-Json -Depth 20 | Out-File $pkgPath -Encoding UTF8
  Write-Host "        dependencies/bundles 已更新" -ForegroundColor Green
} else {
  Write-Host "        已注册（跳过）"
}

# ----------------------------------------------- 3. 写 cordis.patch.yml 挂载+配置
$patchPath = Join-Path $profileDir 'cordis.patch.yml'
Write-Host "[3/5] 写入 cordis.patch.yml 挂载与默认配置 ..."
if (-not (Test-Path $patchPath)) {
  @("# dsh profile patch (由 dsh-task-complete-notifier 创建)") | Out-File $patchPath -Encoding UTF8
}
$patch = Get-Content $patchPath -Raw -Encoding UTF8
if ($patch -notmatch 'id:\s*task-complete-notifier') {
  $block = @"

# --- dsh-task-complete-notifier（自动添加，可改 config）---
- insert:
    - id: task-complete-notifier
      name: 'dsh-task-complete-notifier'
- id: task-complete-notifier
  config:
    title: '✓ Task Completed'
    body: 'The current DeepSeek Harness task has finished. Please proceed to the next step.'
    settleMs: 3000
    cooldownMs: 10000
    autoCloseMs: 60000
    placeholder: '输入下一步指令，Enter 发送…'
    sendLabel: '发送'
    laterLabel: '稍后'
    soundEnabled: true
    soundToggleTitle: '音效开关'
    soundFile: ''
    soundVolume: 1.0
"@
  Add-Content -Path $patchPath -Value $block -Encoding UTF8
  Write-Host "        挂载行 + 默认 config 已写入" -ForegroundColor Green
} else {
  Write-Host "        已存在（跳过）"
}

# ------------------------------------------------------------- 4. pnpm install
Write-Host "[4/5] pnpm install ..."
$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) {
  Write-Host "        [警告] PATH 上没有 pnpm，跳过 install。" -ForegroundColor Yellow
  Write-Host "        请手动在 $profileDir 执行 pnpm install（或用 DSH 自带的 pnpm）。"
} else {
  Push-Location $profileDir
  try { & pnpm install --prefer-offline 2>&1 | Select-Object -Last 5 } finally { Pop-Location }
  Write-Host "        完成" -ForegroundColor Green
}

# ------------------------------------------------------------- 5. 完成提示
Write-Host "[5/5] 安装完成！" -ForegroundColor Cyan
Write-Host ""
Write-Host "  下一步：重启 DSH Desktop。"
Write-Host "  验证：日志出现 '[task-notifier] host half mounted (v9: env ...)'"
Write-Host "       跑一个任务到结束，右下角应弹出带标题+输入框的置顶卡片。"
Write-Host ""
Write-Host "  卸载：删除 $targetDir，并从 profile 的 package.json（dependencies/bundles）"
Write-Host "        和 cordis.patch.yml（task-complete-notifier 两块）移除对应内容。"
