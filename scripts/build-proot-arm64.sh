#!/usr/bin/env bash
# 构建可在 Termux + proot / proot-distro 下运行的 linux/arm64 (aarch64) JavBoss 包。
#
# 背景（为什么不能直接用 scripts/cli.sh release）：
#   1. scripts/cli/cli.mjs 的 PLATFORM_CHOICES 只有 windows-x86_64 / linux-x86_64 /
#      macos-x86_64 / macos-arm64，`release linux-arm64` 会直接报 unsupported。
#   2. go.mod 依赖 mattn/go-sqlite3，必须 CGO_ENABLED=1，所以 `GOARCH=arm64 go build`
#      这种纯 Go 交叉编译是不行的，必须有 aarch64 的 C 交叉工具链。
#   3. 用 **musl 静态** 工具链产出全静态 ELF：不依赖目标 rootfs 的 glibc 版本，
#      Ubuntu / Debian / Alpine 的 proot rootfs 都能跑。
#
# 用法：
#   bash scripts/build-proot-arm64.sh [VERSION]
#     不给 VERSION 时读取 scripts/install.sh 里的 VERSION（如 v2.1.2）。
#
# 可覆盖的环境变量：
#   CACHE_DIR          下载与工具链缓存，默认 $HOME/.cache/javboss-proot
#   GO_VERSION         默认 1.25.1（与 .github/workflows 的 golang:1.25 对齐）
#   TOOLCHAIN_KIND     默认 zig；可选 bootlin
#                      - zig：从 PyPI 取 ziglang wheel（约 80MB），`zig cc -target aarch64-linux-musl`
#                      - bootlin：从 toolchains.bootlin.com 取 aarch64--musl--stable（约 70MB，通常很慢）
#   ZIG_VERSION        默认 0.14.1
#   TOOLCHAIN_VERSION  Bootlin 工具链版本，默认 2024.05-1
#   PYPI_INDEX         PyPI simple 索引，默认 https://mirrors.aliyun.com/pypi/web/simple/
#                      （回退 https://pypi.org/simple/）
#   GOPROXY            默认 https://goproxy.cn,https://goproxy.io,direct
#   GH_MIRRORS         GitHub 加速前缀列表（按顺序尝试，最后再直连 github.com），
#                      默认 "https://gh-proxy.com/ https://ghfast.top/ https://ghproxy.net/"
#                      置空则只直连 github.com
#   BUILD_WEB=1        先用 npm 重新构建 web/dist **与** web-mobile/dist
#                      （默认复用仓库里已有的两个 dist）
#   SKIP_MOBILE_WEB=1  不打包 web-mobile/dist（默认打包：这包就跑在手机上，
#                      手机浏览器打开根路径会自动切到移动端界面）
#   SKIP_FFMPEG=1      不下载/不打包 ffmpeg 与 ffprobe
#   SKIP_ZIP=1         不生成 zip（默认同时产出 tar.gz 与 zip）
#
# 产物：
#   release/javboss-<VERSION>-linux-arm64-proot/          可直接解压进 proot 的目录
#   release/javboss-<VERSION>-linux-arm64-proot.tar.gz    发布包
#   release/javboss-<VERSION>-linux-arm64-proot.tar.gz.sha256
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
PROOT_SRC_DIR="$SCRIPT_DIR/proot"

CACHE_DIR="${CACHE_DIR:-$HOME/.cache/javboss-proot}"
GO_VERSION="${GO_VERSION:-1.25.1}"
TOOLCHAIN_KIND="${TOOLCHAIN_KIND:-zig}"
ZIG_VERSION="${ZIG_VERSION:-0.14.1}"
TOOLCHAIN_VERSION="${TOOLCHAIN_VERSION:-2024.05-1}"
PYPI_INDEX="${PYPI_INDEX:-https://mirrors.aliyun.com/pypi/web/simple}"
GOPROXY="${GOPROXY:-https://goproxy.cn,https://goproxy.io,direct}"
GH_MIRRORS="${GH_MIRRORS-https://gh-proxy.com/ https://ghfast.top/ https://ghproxy.net/}"
FFMPEG_RELEASE="${FFMPEG_RELEASE:-n8.1.2-1}"
CROSS_PREFIX="aarch64-linux-musl"

say() { printf '[proot-arm64] %s\n' "$*"; }
die() { printf '[proot-arm64] 错误：%s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"; }

need curl
need tar
need python3
need xz

# ---------------------------------------------------------------- 版本号
resolve_version() {
  if [[ -n "${1:-}" ]]; then
    printf '%s' "$1"
    return
  fi
  local from_install_sh
  from_install_sh="$(sed -n 's/^VERSION="\(.*\)"$/\1/p' "$SCRIPT_DIR/install.sh" | head -n 1)"
  [[ -n "$from_install_sh" ]] || die "无法从 scripts/install.sh 推断版本号，请显式传入，如 v2.1.2"
  printf '%s' "$from_install_sh"
}

VERSION="$(resolve_version "${1:-}")"
[[ "$VERSION" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+ ]] || die "版本号格式不合法：$VERSION"

# ---------------------------------------------------------------- 下载
sha256_of() { python3 - "$1" <<'PY'
import hashlib, sys
h = hashlib.sha256()
with open(sys.argv[1], 'rb') as fh:
    for chunk in iter(lambda: fh.read(1 << 20), b''):
        h.update(chunk)
print(h.hexdigest())
PY
}

# download <dest> <sha256|-> <url...>
download() {
  local dest="$1" sha="$2"; shift 2
  local urls=("$@")
  if [[ -f "$dest" && "$sha" != "-" ]]; then
    if [[ "$(sha256_of "$dest")" == "$sha" ]]; then
      say "已缓存：$dest"
      return
    fi
    rm -f "$dest"
  elif [[ -f "$dest" ]]; then
    say "已缓存：$dest"
    return
  fi

  mkdir -p "$(dirname "$dest")"
  local url tmp
  tmp="$dest.part"
  for url in "${urls[@]}"; do
    say "下载 $url"
    if curl -fL --retry 3 --retry-all-errors --connect-timeout 15 -m 1800 -o "$tmp" "$url"; then
      if [[ "$sha" == "-" || "$(sha256_of "$tmp")" == "$sha" ]]; then
        mv -f "$tmp" "$dest"
        return
      fi
      say "校验失败，尝试下一个来源：$url"
    else
      say "下载失败，尝试下一个来源：$url"
    fi
    rm -f "$tmp"
  done
  die "无法下载：${urls[0]}"
}

# ---------------------------------------------------------------- Go 工具链
setup_go() {
  local host_arch go_arch tarball go_root
  host_arch="$(uname -m)"
  case "$host_arch" in
    x86_64|amd64) go_arch=amd64 ;;
    aarch64|arm64) go_arch=arm64 ;;
    *) die "不支持的主机架构：$host_arch" ;;
  esac

  go_root="$CACHE_DIR/go"
  if [[ -x "$go_root/bin/go" ]] && "$go_root/bin/go" version 2>/dev/null | grep -q "go${GO_VERSION}"; then
    say "已缓存 Go $GO_VERSION：$go_root"
  else
    tarball="$CACHE_DIR/downloads/go${GO_VERSION}.linux-${go_arch}.tar.gz"
    download "$tarball" "-" \
      "https://go.dev/dl/go${GO_VERSION}.linux-${go_arch}.tar.gz" \
      "https://mirrors.aliyun.com/golang/go${GO_VERSION}.linux-${go_arch}.tar.gz"
    say "解压 Go $GO_VERSION"
    rm -rf "$go_root"
    mkdir -p "$CACHE_DIR"
    tar -xzf "$tarball" -C "$CACHE_DIR"
    [[ -x "$go_root/bin/go" ]] || die "Go 解压结果不符合预期"
  fi

  export GOROOT="$go_root"
  export PATH="$go_root/bin:$PATH"
  export GOCACHE="$CACHE_DIR/gocache"
  export GOMODCACHE="$CACHE_DIR/gomodcache"
  export GOPROXY GOSUMDB="${GOSUMDB:-sum.golang.org}"
  export GOFLAGS="${GOFLAGS:-}"
  mkdir -p "$GOCACHE" "$GOMODCACHE"
  "$go_root/bin/go" version
}

# ---------------------------------------------------------------- C 交叉工具链
# zig：PyPI 上的 ziglang wheel 里就带完整的 zig 编译器，`zig cc -target aarch64-linux-musl`
# 自带 musl 与 libc 源码，不需要额外 sysroot，产出的是静态链接的 aarch64 目标文件。
setup_toolchain_zig() {
  local host_arch wheel_tag zig_dir zig_bin wheel index href url sha

  host_arch="$(uname -m)"
  case "$host_arch" in
    x86_64|amd64) wheel_tag="x86_64" ;;
    aarch64|arm64) wheel_tag="aarch64" ;;
    *) die "不支持的主机架构：$host_arch" ;;
  esac

  zig_dir="$CACHE_DIR/zig"
  zig_bin="$zig_dir/ziglang/zig"

  if [[ ! -x "$zig_bin" ]]; then
    wheel="$CACHE_DIR/downloads/ziglang-${ZIG_VERSION}.whl"
    if [[ ! -f "$wheel" ]]; then
      for index in "${PYPI_INDEX%/}" "https://pypi.org/simple"; do
        say "查询 ziglang ${ZIG_VERSION}：${index%/}/ziglang/"
        href="$(curl -fsSL -m 60 "$index/ziglang/" 2>/dev/null \
          | grep -oE "href=\"[^\"]*ziglang-${ZIG_VERSION}-py3-none-manylinux[^\"]*${wheel_tag}[^\"]*\.whl" \
          | head -n 1 | sed 's/^href="//')" || true
        [[ -n "$href" ]] || continue
        sha="$(printf '%s' "$href" | sed -n 's/.*#sha256=\([0-9a-f]\{64\}\).*/\1/p')"
        url="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.urljoin(sys.argv[1] + "/", sys.argv[2].split("#")[0]))' "$index" "$href")"
        say "下载 $url"
        if curl -fL --retry 3 --retry-all-errors --connect-timeout 15 -m 1800 -o "$wheel.part" "$url"; then
          if [[ -z "$sha" || "$(sha256_of "$wheel.part")" == "$sha" ]]; then
            mv -f "$wheel.part" "$wheel"
            break
          fi
          say "校验失败：$url"
          rm -f "$wheel.part"
        fi
      done
      [[ -f "$wheel" ]] || die "无法获取 ziglang ${ZIG_VERSION} wheel，可设置 PYPI_INDEX 或改用 TOOLCHAIN_KIND=bootlin"
    fi
    say "解压 zig wheel"
    rm -rf "$zig_dir"
    mkdir -p "$zig_dir"
    python3 -m zipfile -e "$wheel" "$zig_dir"
  fi

  [[ -x "$zig_bin" ]] || die "zig wheel 解压结果不符合预期：$zig_bin"
  chmod 0755 "$zig_bin"

  export ZIG_GLOBAL_CACHE_DIR="${ZIG_GLOBAL_CACHE_DIR:-$CACHE_DIR/zig-cache}"
  mkdir -p "$ZIG_GLOBAL_CACHE_DIR"
  export CROSS_CC="$zig_bin cc -target aarch64-linux-musl"
  export CROSS_CXX="$zig_bin c++ -target aarch64-linux-musl"
  "$zig_bin" version | sed 's/^/  zig /'
}

# bootlin：toolchains.bootlin.com 的 aarch64--musl--stable 工具链（国内通常只有 ~20-50KB/s）
setup_toolchain_bootlin() {
  local tc_root tc_dir tarball name
  name="aarch64--musl--stable-${TOOLCHAIN_VERSION}"
  tc_root="$CACHE_DIR/toolchain"
  tc_dir="$tc_root/$name"

  if [[ -x "$tc_dir/bin/${CROSS_PREFIX}-gcc" ]]; then
    say "已缓存交叉工具链：$tc_dir"
  else
    tarball="$CACHE_DIR/downloads/${name}.tar.xz"
    download "$tarball" "-" \
      "https://toolchains.bootlin.com/downloads/releases/toolchains/aarch64/tarballs/${name}.tar.xz"
    say "解压交叉工具链 $name"
    mkdir -p "$tc_root"
    rm -rf "$tc_dir"
    tar -xJf "$tarball" -C "$tc_root"
    [[ -x "$tc_dir/bin/${CROSS_PREFIX}-gcc" ]] || die "工具链解压结果不符合预期：$tc_dir"
  fi

  export CROSS_CC="$tc_dir/bin/${CROSS_PREFIX}-gcc"
  export CROSS_CXX="$tc_dir/bin/${CROSS_PREFIX}-g++"
  "$CROSS_CC" --version | head -n 1
}

setup_toolchain() {
  case "$TOOLCHAIN_KIND" in
    zig) setup_toolchain_zig ;;
    bootlin) setup_toolchain_bootlin ;;
    *) die "未知的 TOOLCHAIN_KIND：$TOOLCHAIN_KIND（可选 zig / bootlin）" ;;
  esac
}

# ---------------------------------------------------------------- ffmpeg / ffprobe
# 版本与 sha256 与 Dockerfile 中 arm64 分支保持一致（shaka static-ffmpeg-binaries）。
FFMPEG_SHA256="6e7b1d7d1aa8c35e3fedd78a140aa0968717aeb7386ecfb0ee00773d9f0a4503"
FFPROBE_SHA256="fd2aca1456f0261cabef4514b6d97a70fa342003347f51b39c473dd364328089"

fetch_ff_binary() {
  local asset="$1" dest="$2" sha="$3" url mirror
  local candidates=()
  url="https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/${FFMPEG_RELEASE}/${asset}"
  for mirror in $GH_MIRRORS; do
    candidates+=("${mirror}${url}")
  done
  candidates+=("$url")
  download "$dest" "$sha" "${candidates[@]}"
  chmod 0755 "$dest"
}

# ---------------------------------------------------------------- ELF 校验
verify_elf() {
  local file="$1" expect_arm="${2:-1}"
  python3 - "$file" "$expect_arm" <<'PY'
import struct, sys

path, expect_arm = sys.argv[1], sys.argv[2] == "1"
with open(path, "rb") as fh:
    data = fh.read()
if data[:4] != b"\x7fELF":
    print(f"  !! {path}: 不是 ELF 文件")
    sys.exit(1)
is64 = data[4] == 2
endian = "<" if data[5] == 1 else ">"
if is64:
    e_machine = struct.unpack_from(endian + "H", data, 18)[0]
    e_phoff = struct.unpack_from(endian + "Q", data, 32)[0]
    e_phentsize = struct.unpack_from(endian + "H", data, 54)[0]
    e_phnum = struct.unpack_from(endian + "H", data, 56)[0]
else:
    e_machine = struct.unpack_from(endian + "H", data, 18)[0]
    e_phoff = struct.unpack_from(endian + "I", data, 28)[0]
    e_phentsize = struct.unpack_from(endian + "H", data, 42)[0]
    e_phnum = struct.unpack_from(endian + "H", data, 44)[0]

pt_interp = False
for i in range(e_phnum):
    off = e_phoff + i * e_phentsize
    p_type = struct.unpack_from(endian + "I", data, off)[0]
    if p_type == 3:
        pt_interp = True

arch = {183: "AArch64", 40: "ARM"}.get(e_machine, f"machine={e_machine}")
kind = "动态链接（有 PT_INTERP）" if pt_interp else "静态链接"
print(f"  {path}: {arch}, {kind}")
if expect_arm and e_machine not in (183, 40):
    print("  !! 架构不是 ARM 系，交叉编译有问题")
    sys.exit(1)
PY
}

# ---------------------------------------------------------------- zip 打包
# 用 python3 打 zip 并显式写入 unix 权限位（create_system=3）。
# 注意：
#   1. Windows 自带“压缩文件夹”/Compress-Archive 生成的 zip 里权限位是 0，
#      解压后 start.sh、javboss、internal/bin/* 都没有执行位，必须 chmod +x。
#   2. 权限不取 stat：发布目录常落在 NTFS/DrvFs 上，那里 chmod 无效、一律显示 0777。
#      这里按文件名给固定策略：可执行文件 0755，其余 0644。
create_zip() {
  local src="$1" out="$2"
  python3 - "$src" "$out" <<'PY'
import os, sys, zipfile

src, out = sys.argv[1], sys.argv[2]
base = os.path.dirname(src)
top = os.path.basename(src.rstrip("/"))
executables = {f"{top}/javboss", f"{top}/start.sh"}

def mode_for(rel, is_dir):
    if is_dir:
        return 0o755
    if rel in executables or rel.startswith(f"{top}/internal/bin/"):
        return 0o755
    return 0o644

if os.path.exists(out):
    os.remove(out)
count = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(src):
        dirs.sort()
        files.sort()
        for name in dirs + files:
            path = os.path.join(root, name)
            if os.path.islink(path):
                continue
            arc = os.path.relpath(path, base).replace(os.sep, "/")
            is_dir = os.path.isdir(path)
            if is_dir:
                arc += "/"
            info = zipfile.ZipInfo(arc, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3  # unix，unzip 才会认 external_attr 里的权限位
            info.external_attr = (mode_for(arc.rstrip("/"), is_dir) << 16) | (0x10 if is_dir else 0)
            info.compress_type = zipfile.ZIP_DEFLATED
            if is_dir:
                zf.writestr(info, b"")
            else:
                with open(path, "rb") as fh:
                    zf.writestr(info, fh.read())
                count += 1
print(f"  写入 {count} 个文件，{os.path.getsize(out) / 1048576:.1f} MB")
PY
}

# 归档前把产物复制到本地 ext4 暂存目录并按策略修好权限：
# release/ 常常在 NTFS/DrvFs 上，那里 chmod 是空操作，tar 会记录出 0777。
stage_package() {
  local src="$1" stage="$CACHE_DIR/stage/$(basename "$1")"
  rm -rf "$stage"
  mkdir -p "$(dirname "$stage")"
  cp -a "$src" "$stage"
  find "$stage" -type d -exec chmod 0755 {} +
  find "$stage" -type f -exec chmod 0644 {} +
  chmod 0755 "$stage/javboss" "$stage/start.sh"
  if [[ -d "$stage/internal/bin" ]]; then
    chmod 0755 "$stage"/internal/bin/* 2>/dev/null || true
  fi
  printf '%s' "$stage"
}

# ---------------------------------------------------------------- 主流程
say "版本：$VERSION"
say "仓库：$ROOT_DIR"
say "缓存：$CACHE_DIR"
mkdir -p "$CACHE_DIR/downloads"

setup_go
setup_toolchain

OUT_DIR="$ROOT_DIR/release/javboss-${VERSION}-linux-arm64-proot"
WEB_DIST="$ROOT_DIR/web/dist"
MOBILE_WEB_DIST="$ROOT_DIR/web-mobile/dist"

if [[ "${BUILD_WEB:-0}" == "1" ]]; then
  need npm
  say "构建前端（web 与 web-mobile 的 npm run build）"
  ( cd "$ROOT_DIR/web" && { [[ -d node_modules ]] || npm install; } && npm run build )
  ( cd "$ROOT_DIR/web-mobile" && { [[ -d node_modules ]] || npm install; } && npm run build )
fi

[[ -f "$WEB_DIST/index.html" ]] || die "缺少 web/dist，请先执行：cd web && npm install && npm run build"
if [[ "${SKIP_MOBILE_WEB:-0}" != "1" ]]; then
  [[ -f "$MOBILE_WEB_DIST/index.html" ]] || die "缺少 web-mobile/dist，请先执行：cd web-mobile && npm install && npm run build（或用 SKIP_MOBILE_WEB=1 明确跳过移动端界面）"
fi

say "准备输出目录 $OUT_DIR"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/internal/bin"

say "交叉编译 javboss（CGO_ENABLED=1, GOOS=linux, GOARCH=arm64, musl 静态）"
(
  cd "$ROOT_DIR"
  CGO_ENABLED=1 \
  GOOS=linux \
  GOARCH=arm64 \
  CC="$CROSS_CC" \
  CXX="$CROSS_CXX" \
  GOPROXY="$GOPROXY" \
  "$GOROOT/bin/go" build \
    -trimpath \
    -tags "netgo osusergo" \
    -ldflags '-s -w -linkmode external -extldflags "-static" -X main.buildMode=release' \
    -o "$OUT_DIR/javboss" \
    ./cmd/server
)
chmod 0755 "$OUT_DIR/javboss"

if [[ "${SKIP_FFMPEG:-0}" != "1" ]]; then
  say "下载 arm64 版 ffmpeg / ffprobe"
  fetch_ff_binary ffmpeg-linux-arm64 "$OUT_DIR/internal/bin/ffmpeg" "$FFMPEG_SHA256"
  fetch_ff_binary ffprobe-linux-arm64 "$OUT_DIR/internal/bin/ffprobe" "$FFPROBE_SHA256"
fi

say "复制前端资源、ModernZ 与启动脚本"
mkdir -p "$OUT_DIR/web"
cp -a "$WEB_DIST" "$OUT_DIR/web/dist"
# 移动端界面：本包就跑在手机上，手机浏览器打开根路径会自动 302 到 /m/。
if [[ "${SKIP_MOBILE_WEB:-0}" != "1" ]]; then
  mkdir -p "$OUT_DIR/web-mobile"
  cp -a "$MOBILE_WEB_DIST" "$OUT_DIR/web-mobile/dist"
fi
if [[ -d "$ROOT_DIR/modernz" ]]; then
  cp -a "$ROOT_DIR/modernz" "$OUT_DIR/modernz"
fi
cp -a "$PROOT_SRC_DIR/start.sh" "$OUT_DIR/start.sh"
cp -a "$PROOT_SRC_DIR/README.md" "$OUT_DIR/README.md"
chmod 0755 "$OUT_DIR/start.sh"

cat >"$OUT_DIR/config.toml" <<'TOML'
# JavBoss release config
# This file uses TOML format.
# The default browser URL is http://localhost:8655.
# Set server_url to run as a client connected to another JavBoss server.
# You can override server_url at startup with --server-url <URL>.
# Leave server_url empty to run in server mode.
# You can override port at startup with --port <PORT>.
server_url = ""
port = 8655
TOML

say "校验产物架构"
verify_elf "$OUT_DIR/javboss" 1
if [[ "${SKIP_FFMPEG:-0}" != "1" ]]; then
  verify_elf "$OUT_DIR/internal/bin/ffmpeg" 1
  verify_elf "$OUT_DIR/internal/bin/ffprobe" 1
fi
"$GOROOT/bin/go" version -m "$OUT_DIR/javboss" | sed -n '1,4p' | sed 's/^/  /'

say "打包 tar.gz"
ARCHIVE="$ROOT_DIR/release/javboss-${VERSION}-linux-arm64-proot.tar.gz"
rm -f "$ARCHIVE"
STAGE_DIR="$(stage_package "$OUT_DIR")"
say "暂存目录（用于正确记录权限）：$STAGE_DIR"
tar -czf "$ARCHIVE" -C "$(dirname "$STAGE_DIR")" "$(basename "$STAGE_DIR")"
sha256_of "$ARCHIVE" >"$ARCHIVE.sha256"

ZIP_ARCHIVE="$ROOT_DIR/release/javboss-${VERSION}-linux-arm64-proot.zip"
if [[ "${SKIP_ZIP:-0}" != "1" ]]; then
  say "打包 zip（显式写入 unix 权限位，解压后可直接 ./start.sh）"
  create_zip "$STAGE_DIR" "$ZIP_ARCHIVE"
  sha256_of "$ZIP_ARCHIVE" >"$ZIP_ARCHIVE.sha256"
fi
rm -rf "$STAGE_DIR"

say "完成："
say "  目录：$OUT_DIR"
say "  包体：$ARCHIVE"
say "  校验：$ARCHIVE.sha256"
if [[ "${SKIP_ZIP:-0}" != "1" ]]; then
  say "  包体：$ZIP_ARCHIVE（Windows 解压工具可能会丢执行位，见包内 README 的 zip 说明）"
  say "  校验：$ZIP_ARCHIVE.sha256"
fi
say "包内用法见 $OUT_DIR/README.md（解压后 ./start.sh，浏览器打开 http://127.0.0.1:8655）"
if [[ "${SKIP_MOBILE_WEB:-0}" != "1" ]]; then
  say "手机浏览器打开同一个地址会自动进入移动端界面（/m/）；想用电脑版访问 /?desktop=1"
fi
