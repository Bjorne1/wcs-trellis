#!/usr/bin/env bash
#
# 一键同步定制版 Trellis 到 Windows 与 WSL 两个 npm 全局环境。
#
# 分工的由来（不要随意调换）：
#   - 构建/打包走 Windows：仓库在 D: 上，Windows 原生访问快得多
#     （装依赖 44s vs WSL 在 DrvFs 上 3m44s），且 node_modules 里的
#     esbuild 是平台专属二进制，两边不能共用一份。
#   - 测试走 WSL 的 ext4 镜像：Windows 没装 Python，测试套件要
#     shell out 到 python3，直接在 Windows 上跑会有 26 个环境性失败；
#     而 WSL 直接在 /mnt/d 上跑 vitest 会因为 /mnt/d 根目录无法列目录
#     （DrvFs I/O error）让 esbuild 加载 vitest.config.ts 时崩掉。
#     所以镜像到 ext4 才有可信的测试结论。
#   - 校验用 sha256 比对，不用关键字匹配：定制版与上游版本号相同
#     （都是 0.7.0-beta.3），版本号分辨不出来，文件哈希可以。
#
# 用法：
#   tools/sync-trellis.sh                 构建 → 测试 → 打包 → 装两边 → 校验
#   tools/sync-trellis.sh --no-test       跳过测试（只改模板文字时用）
#   tools/sync-trellis.sh --install-deps  依赖变了，先用 Windows pnpm 重装 node_modules
#   tools/sync-trellis.sh --win-only      只装 Windows
#   tools/sync-trellis.sh --wsl-only      只装 WSL
#   tools/sync-trellis.sh --test-only     只跑测试，不打包不安装
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$REPO/packages/cli"
DIST="$(cd "$REPO/.." && pwd)/wcs-trellis-dist"
MIRROR="$HOME/.cache/wcs-trellis-build"

RUN_TEST=1
RUN_BUILD=1
RUN_PACK=1
INSTALL_WIN=1
INSTALL_WSL=1
INSTALL_DEPS=0

for arg in "$@"; do
  case "$arg" in
    --no-test)      RUN_TEST=0 ;;
    --install-deps) INSTALL_DEPS=1 ;;
    --win-only)     INSTALL_WSL=0 ;;
    --wsl-only)     INSTALL_WIN=0 ;;
    --test-only)    RUN_PACK=0; INSTALL_WIN=0; INSTALL_WSL=0 ;;
    --skip-build)   RUN_BUILD=0 ;;
    -h|--help)      awk 'NR>1 && /^#/ {sub(/^# ?/,""); print; next} NR>1 {exit}' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数: $arg（--help 看用法）" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m  ✓ %s\033[0m\n' "$*"; }
die()  { printf '\033[31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# WSL 的 npm 由 nvm 提供，非交互 shell 里可能不在 PATH 上。
if ! command -v npm >/dev/null 2>&1; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
  command -v npm >/dev/null 2>&1 || die "WSL 里找不到 npm，且 $NVM_DIR/nvm.sh 不可用"
fi

# 在仓库目录里执行 Windows 命令。cwd 必须落在 D: 上，否则 cmd.exe 会报
# "UNC paths are not supported" 并把工作目录退回 C:\Windows。
#
# 成功时吞掉输出（一键脚本不该刷屏），失败时把完整日志原样打出来——
# 不做静默降级，报错信息一个字不少。
LOG="$(mktemp -t sync-trellis.XXXXXX.log)"
trap 'rm -f "$LOG"' EXIT

run_quiet() { # run_quiet <cwd> <描述> <命令...>
  local cwd="$1" what="$2"; shift 2
  if ! ( cd "$cwd" && "$@" ) >"$LOG" 2>&1; then
    printf '\033[31m  ✗ %s 失败，完整输出：\033[0m\n' "$what" >&2
    cat "$LOG" >&2
    exit 1
  fi
}
win()     { run_quiet "$REPO" "$1" cmd.exe /c "$2"; }
win_cli() { run_quiet "$CLI"  "$1" cmd.exe /c "$2"; }
# 需要读取 Windows 命令输出时用这个（不静默）。
win_out() { ( cd "$REPO" && cmd.exe /c "$1" 2>/dev/null ) | tr -d '\r'; }

# 跨 WSL/cmd 边界传路径时，引号会被 cmd 与 pnpm 双重解析后变成字面量，
# 所以这里一律传不带引号的路径，代价是路径不能含空格。宁可现在明确失败，
# 也不要等到打包时报一个看不懂的 ENOENT。
case "$REPO$DIST" in
  *" "*) die "仓库或产物目录路径含空格，脚本的跨边界调用不支持：
      REPO=$REPO
      DIST=$DIST" ;;
esac

PKG_VERSION="$(python3 -c "import json;print(json.load(open('$CLI/package.json'))['version'])")"
PKG_NAME="$(python3 -c "import json;print(json.load(open('$CLI/package.json'))['name'])")"
TGZ_NAME="$(printf '%s' "$PKG_NAME" | sed 's|^@||; s|/|-|g')-${PKG_VERSION}.tgz"

echo "仓库    : $REPO"
echo "包      : $PKG_NAME@$PKG_VERSION"
echo "产物    : $DIST/$TGZ_NAME"

if [ "$INSTALL_DEPS" = 1 ]; then
  step "用 Windows pnpm 重装 node_modules"
  # 先从 WSL 侧删：Windows 删不掉 WSL 创建的文件（EACCES）。
  rm -rf "$REPO/node_modules" "$REPO"/packages/*/node_modules
  # CI=true 是必须的：无 TTY 时 pnpm 拒绝删除 modules 目录。
  win "装依赖" "set CI=true&& pnpm install --frozen-lockfile"
  ok "依赖已按 Windows 平台安装"
fi

if [ ! -d "$REPO/node_modules/.pnpm" ]; then
  die "node_modules 不存在或不完整。先跑一次 tools/sync-trellis.sh --install-deps"
fi

if [ "$RUN_BUILD" = 1 ]; then
  step "Windows 构建 (core → cli → 拷模板)"
  win "构建" "pnpm build"
  [ -f "$CLI/dist/templates/trellis/workflow.md" ] || die "构建产物缺少 dist/templates/"
  ok "dist 已生成"
fi

if [ "$RUN_TEST" = 1 ]; then
  step "WSL ext4 镜像上跑测试（Windows 无 Python，跑不了）"
  mkdir -p "$MIRROR"
  rsync -a --delete \
    --exclude node_modules --exclude .git --exclude dist \
    --exclude docs-site --exclude drafts --exclude .mindfs \
    "$REPO/" "$MIRROR/"
  ok "源码已镜像到 $MIRROR"
  ( cd "$MIRROR" \
      && pnpm install --frozen-lockfile --ignore-scripts >/dev/null \
      && pnpm build >/dev/null ) || die "镜像里构建失败"
  ( cd "$MIRROR" && pnpm test ) || die "测试失败——不打包。修完再跑一次。"
  ok "测试通过"
fi

if [ "$RUN_PACK" = 1 ]; then
  step "Windows 打包"
  mkdir -p "$DIST"
  rm -f "$DIST/$TGZ_NAME" "$CLI/$TGZ_NAME"
  # 不用 --pack-destination：它的值会被 pnpm 当 JSON 解析（`D:\w` 是非法转义），
  # 换成正斜杠后引号又会被 cmd 当字面量塞进路径里。所以让 pnpm 写到 cwd，
  # 再从 WSL 侧把文件移过去——完全避开跨边界的路径引号问题。
  win_cli "打包" "pnpm pack"
  [ -f "$CLI/$TGZ_NAME" ] || die "packages/cli 下没找到 $TGZ_NAME"
  mv "$CLI/$TGZ_NAME" "$DIST/$TGZ_NAME"
  ok "$(du -h "$DIST/$TGZ_NAME" | cut -f1)  $TGZ_NAME"
fi

# 校验用：仓库刚构建出来的 workflow.md 的哈希，就是"正确答案"。
REF_HASH="$(sha256sum "$CLI/dist/templates/trellis/workflow.md" | cut -d' ' -f1)"

check_install() {
  local label="$1" root="$2"
  local f="$root/@mindfoldhq/trellis/dist/templates/trellis/workflow.md"
  [ -f "$f" ] || die "$label: 装完却找不到 $f"
  local h; h="$(sha256sum "$f" | cut -d' ' -f1)"
  if [ "$h" = "$REF_HASH" ]; then
    ok "$label: workflow.md 哈希一致，确认是定制版"
  else
    die "$label: workflow.md 哈希不匹配（装的可能是上游版）
      期望 $REF_HASH
      实际 $h"
  fi
}

if [ "$INSTALL_WIN" = 1 ]; then
  step "安装到 Windows 全局"
  win "Windows npm i -g" "npm i -g $(wslpath -m "$DIST/$TGZ_NAME")"
  WIN_PREFIX="$(win_out "npm prefix -g" | tail -1)"
  check_install "Windows" "$(wslpath -u "$WIN_PREFIX")/node_modules"
fi

if [ "$INSTALL_WSL" = 1 ]; then
  step "安装到 WSL 全局"
  npm i -g "$DIST/$TGZ_NAME" >/dev/null || die "WSL npm i -g 失败"
  check_install "WSL" "$(npm root -g)"
fi

step "完成"
# 版本回报必须在中性目录里执行：在仓库或任何有 .trellis/ 的目录下，
# trellis 会先打印一条 "update available" 横幅，把版本号顶到后面去。
if [ "$INSTALL_WIN" = 1 ]; then
  echo "  Windows : $( ( cd / && cmd.exe /c "trellis -v" 2>/dev/null ) | tr -d '\r' | tail -1)"
fi
if [ "$INSTALL_WSL" = 1 ]; then
  echo "  WSL     : $( cd "$HOME" && trellis -v | tail -1 )"
fi
if [ "$INSTALL_WIN" = 1 ] || [ "$INSTALL_WSL" = 1 ]; then
  echo
  echo "两边版本号都是 $PKG_VERSION，和上游一样——分辨定制版只能靠上面的哈希校验。"
  echo "永远不要跑 trellis upgrade，它会把你换回上游。"
fi
