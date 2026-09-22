#!/bin/sh
# JavBoss 在 Termux + proot / proot-distro 下的启动脚本。
grep -q "$(printf '\r')" "$0" 2>/dev/null && { printf '\nstart.sh 是 CRLF 行尾（Windows 编辑器保存或复制粘贴导致），修复：sed -i "s/\\r$//" %s\n\n' "$0" >&2; exit 1; } # crlf-guard：整行单行书写并以注释结尾，保证脚本自身在 CRLF 下也能被解析
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
cd "$HERE"

# 刻意不设置 JAVBOSS_CONTAINER=1：internal/util 的 ContainerFFBinaryDir 被硬编码为
# /app/internal/bin，一旦设为容器模式就会去那里找 ffmpeg/ffprobe，而本包把它们放在
# ./internal/bin 下。这里逐个打开需要的行为，而不是用容器模式一把梭。
export JAVBOSS_DISABLE_DESKTOP_INTEGRATION=1   # proot 里没有桌面环境/xdg-open
export JAVBOSS_DISABLE_MPV=1                   # proot 里没有显示服务，走浏览器播放
export JAVBOSS_USE_FFMPEG_SCREENSHOTS=1        # 截图改用内置 ffmpeg

# CA 证书：本包是 linux 静态二进制，Go 的默认路径列表里没有 Android 的
# /system/etc/security/cacerts（那一项只在 GOOS=android 编译时才生效），而 Termux 的证书包
# 放在 $PREFIX/etc/tls/cert.pem 下，于是 Go 的根证书池是空的，HTTPS 会报
# "x509: certificate signed by unknown authority"。新版本二进制自己会解析证书并兜底，
# 这里再显式指一次，保证任何版本都能用；只在文件确实非空时才设置，绝不指向不存在的路径
# （指向空路径会反过来屏蔽系统默认路径）。
if [ -z "${SSL_CERT_FILE:-}" ]; then
  for candidate in \
    /etc/ssl/certs/ca-certificates.crt \
    /etc/pki/tls/certs/ca-bundle.crt \
    /etc/ssl/ca-bundle.pem \
    /etc/ssl/cert.pem \
    "${PREFIX:-/nonexistent}/etc/tls/cert.pem" \
    "${PREFIX:-/nonexistent}/etc/ssl/certs/ca-certificates.crt" \
    /data/data/com.termux/files/usr/etc/tls/cert.pem \
    /data/data/com.termux/files/usr/etc/ssl/certs/ca-certificates.crt
  do
    if [ -s "$candidate" ]; then
      SSL_CERT_FILE=$candidate
      export SSL_CERT_FILE
      break
    fi
  done
fi

# 一个证书文件都找不到时，退而指向系统证书目录（Android 14+ 把根证书挪到了 APEX）。
if [ -z "${SSL_CERT_FILE:-}" ] && [ -z "${SSL_CERT_DIR:-}" ]; then
  for candidate in /apex/com.android.conscrypt/cacerts /system/etc/security/cacerts; do
    if [ -d "$candidate" ]; then
      SSL_CERT_DIR=$candidate
      export SSL_CERT_DIR
      break
    fi
  done
fi

if [ -n "${SSL_CERT_FILE:-}" ]; then
  echo "[javboss] SSL_CERT_FILE=$SSL_CERT_FILE"
elif [ -n "${SSL_CERT_DIR:-}" ]; then
  echo "[javboss] SSL_CERT_DIR=$SSL_CERT_DIR"
else
  echo "[javboss] 未找到 CA 证书包：HTTPS 会失败，请在 rootfs 里安装 ca-certificates" >&2
fi

exec "$HERE/javboss" "$@"
