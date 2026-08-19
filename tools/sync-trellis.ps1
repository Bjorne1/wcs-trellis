# Windows 侧入口：转调 WSL 里的 sync-trellis.sh。
#
# 真正的逻辑只有一份（tools/sync-trellis.sh），因为测试必须在 WSL 的 ext4
# 上跑（Windows 没装 Python），而构建必须用 Windows pnpm（esbuild 是平台
# 专属二进制）。这个包装脚本让你不必先手动进 WSL。
#
# 用法（PowerShell，在仓库任意位置）：
#   .\tools\sync-trellis.ps1
#   .\tools\sync-trellis.ps1 --no-test
#   .\tools\sync-trellis.ps1 --install-deps

$ErrorActionPreference = 'Stop'

$scriptWinPath = Join-Path $PSScriptRoot 'sync-trellis.sh'
if (-not (Test-Path $scriptWinPath)) {
    throw "找不到 $scriptWinPath"
}

# 把 Windows 路径换成 WSL 路径
$scriptWslPath = (& wsl.exe wslpath -u "$scriptWinPath").Trim()

# 参数原样透传
$forwarded = if ($args.Count -gt 0) { ' ' + ($args -join ' ') } else { '' }

# -lc 走登录 shell；再显式 source nvm，避免依赖 .bashrc / .zshrc 的差异
# （用户默认 shell 是 zsh，nvm 只在 .zshrc 里加载，bash 非交互时拿不到 npm）。
$cmd = "export NVM_DIR=`"`$HOME/.nvm`"; [ -s `"`$NVM_DIR/nvm.sh`" ] && . `"`$NVM_DIR/nvm.sh`" >/dev/null 2>&1; bash '$scriptWslPath'$forwarded"

& wsl.exe -e bash -lc $cmd
exit $LASTEXITCODE
