#!/bin/sh
# JavBoss 在 Termux + proot / proot-distro 下的启动脚本。
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
cd "$HERE"

# 刻意不设置 JAVBOSS_CONTAINER=1：internal/util 的 ContainerFFBinaryDir 被硬编码为
# /app/internal/bin，一旦设为容器模式就会去那里找 ffmpeg/ffprobe，而本包把它们放在
# ./internal/bin 下。这里逐个打开需要的行为，而不是用容器模式一把梭。
export JAVBOSS_DISABLE_DESKTOP_INTEGRATION=1   # proot 里没有桌面环境/xdg-open
export JAVBOSS_DISABLE_MPV=1                   # proot 里没有显示服务，走浏览器播放
export JAVBOSS_USE_FFMPEG_SCREENSHOTS=1        # 截图改用内置 ffmpeg

exec "$HERE/javboss" "$@"
