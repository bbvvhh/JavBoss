# JavBoss — Termux + proot (aarch64 Linux) 包

这个包用于在 Android 手机的 Termux 上，通过 **proot-distro 的 Linux 环境**运行 JavBoss。
主程序是**静态链接的 aarch64 ELF**（musl 工具链构建），不依赖目标 rootfs 的 glibc 版本，
所以 Ubuntu / Debian / Alpine 的 proot rootfs 都能跑。

## 包内容

| 路径 | 说明 |
| --- | --- |
| `javboss` | 主程序（静态链接 aarch64，release 模式） |
| `start.sh` | 启动脚本，已设好本环境需要的开关 |
| `web/dist/` | PC 版前端静态资源（后端直接托管） |
| `web-mobile/dist/` | **手机版前端**，挂在 `/m/` 下；手机浏览器打开根路径会自动切过去 |
| `internal/bin/ffmpeg`、`internal/bin/ffprobe` | arm64 版，用于探测/截图/转码 |
| `modernz/` | mpv 的 OSC 皮肤（本包默认禁用 mpv，备用） |
| `config.toml` | 默认端口 8655 |

## 已验证环境

在真实的 **Debian GNU/Linux 12 (bookworm) aarch64** rootfs 内，通过 proot 运行过本包并通过：

- `uname -m` = `aarch64`，`/bin/sh` → dash，`start.sh` 在 dash 下语法与执行都正常；
- 包内 `ffprobe` / `ffmpeg`（静态 aarch64，FFmpeg n8.1.2）能直接执行；
- release 模式启动成功：`GET /` 返回 200（前端 SPA）、`/config` 返回 401（认证生效）、
  `data/javboss.db` 建库成功（goose 迁移到最新、28 张表、WAL 模式）、单实例 `flock` 锁正常。

Ubuntu / Alpine 等其它 glibc 或 musl rootfs 同理适用（主程序是静态 musl 链接，不看 rootfs 的 libc）。
Android 侧才有的差异（共享存储绑定、Android 的 proot 实现）请按下面步骤操作。

## 前提

1. 手机是 arm64：Termux 里 `uname -m` 应输出 `aarch64`。
2. Termux 里装好 proot-distro 和一个 **aarch64** 发行版（Debian 与 Ubuntu 都可以）：

   ```sh
   pkg update && pkg install proot-distro
   proot-distro install debian     # 或 proot-distro install ubuntu
   ```

3. 允许访问共享存储：`termux-setup-storage`（弹窗点允许）。
4. rootfs 里要有 CA 证书（元数据刮削走 HTTPS）。Debian/Ubuntu 的常规 rootfs 都自带，
   极简 rootfs 里请先确认并补装：

   ```sh
   ls /etc/ssl/certs/ca-certificates.crt || apt update && apt install -y ca-certificates tzdata
   ```

## 安装与启动

把 `javboss-<版本>-linux-arm64-proot.tar.gz`（或 `.zip`）传进手机（`adb push`、浏览器下载或局域网都行），然后：

```sh
# 在 Termux 里：登录 proot，并把 Android 共享存储 bind 进去
proot-distro login debian --bind /sdcard:/sdcard

# 下面在 proot 内执行
cd /root
tar -xzf /sdcard/Download/javboss-<版本>-linux-arm64-proot.tar.gz
cd javboss-<版本>-linux-arm64-proot
./start.sh
```

> `--bind /sdcard:/sdcard` 是必须的：proot 的 rootfs 里默认看不到 Android 的共享存储，
> 而视频库通常就在 `/sdcard` 下。

启动后在**手机浏览器**打开 <http://127.0.0.1:8655>。
proot 不隔离网络命名空间，这个地址就是 Android 自己的 loopback，不需要端口转发。

打开根路径时后端会按 UA 自动把你送到**手机版界面**（`/m/`），这是这一端最常用的界面。
想强制用电脑版：`http://127.0.0.1:8655/?desktop=1`；想改回手机版：`http://127.0.0.1:8655/?mobile=1`
（两个参数都会记住选择，存进 `javboss_ui` Cookie）。手机版的界面说明见仓库里的
`web-mobile/README.md`。

在 JavBoss 里添加媒体目录时，填 **proot 内的路径**，例如 `/sdcard/Movies`。

## 如果你手上是 zip

tar.gz 会保留文件权限，zip **不一定**——Windows 自带的「压缩文件夹 / 发送到压缩文件夹」
（以及 PowerShell 的 `Compress-Archive`）写进去的权限位是 `0`，解压后 `start.sh`、`javboss`、
`internal/bin/*` 都没有执行位，直接 `./start.sh` 会报 `Permission denied`。两种办法：

**推荐**：用构建脚本产出的 `javboss-<版本>-linux-arm64-proot.zip`，它显式写入了 unix 权限位，
在 Termux / proot 里用 `unzip` 解开后可以直接 `./start.sh`。

**如果你手上的 zip 是自己压的**，解压后补一次权限（Termux 里没有 unzip 就先 `pkg install unzip`）：

```sh
# proot 内
apt update && apt install -y unzip ca-certificates        # 缺 unzip 时
unzip -q /sdcard/Download/javboss-<版本>-linux-arm64-proot.zip -d /root
cd /root/javboss-<版本>-linux-arm64-proot
chmod +x javboss start.sh internal/bin/ffmpeg internal/bin/ffprobe
./start.sh
```

排错对照：

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `Permission denied` | zip 丢了执行位 | 上面的 `chmod +x` |
| `bad interpreter: ...^M` / `\r: not found` | 脚本被存成了 CRLF | `sed -i 's/\r$//' start.sh`（或 `apt install dos2unix && dos2unix start.sh`） |
| `not found` 但文件明明在 | 少了执行位或库路径 | 用 `sh start.sh` 直接跑，并确认 `uname -m` 是 `aarch64` |

## 使用自己的 data 目录

把原来的 `data/` 整个放到包目录里（与 `javboss` 同级）即可，程序启动时会直接用：

```
javboss-<版本>-linux-arm64-proot/
├── javboss
├── data/            ← 你的 javboss.db、thumbnails、cover、cache
├── web/dist/
└── internal/bin/
```

几点要知道的：

- **数据库可以直接用**：SQLite 文件与 CPU 架构无关，从 Windows/macOS 带过来都能打开；
  版本更老也行，启动时会自动跑 goose 迁移升级到最新（升级前建议先备份 `data/javboss.db`）。
- **媒体路径要重新添加一次**：如果旧库里记的是 Windows 路径（`D:\...`），在 Linux 下这些
  location 会被判为失效并隐藏。在 proot 里重新添加 `/sdcard/...` 目录并扫描即可：
  JavBoss 按**文件指纹**（宽x高|码率|时长|大小）识别内容，同一个文件换个路径还是同一条
  `Video` 记录，原来的标签、收藏、播放次数都会自动跟过来。
- **不要同时跑两份**：同一份 `data/` 不能被两个实例同时使用（release 模式有单实例 `flock` 锁，
  数据库本身也会冲突）。要对比 Windows 版就先停掉一个。
- **data 别放 `/sdcard`**：SQLite 走 WAL，需要 mmap 共享内存，Android 的 FUSE 存储上不可靠；放 rootfs 内（如 `/root`）。

## 注意事项

- **播放走浏览器**：proot 里没有显示服务，本包禁用了 mpv。后端会提供
  `/videos/:id/stream`（直连）和 `/videos/:id/stream.m3u8`（HLS 转码）两条路：
  H.264/AAC 的片子直连播放；其它编码会实时转码，手机 CPU 上很慢，属正常现象。
- **不要设置 `JAVBOSS_CONTAINER=1`**：`internal/util` 把容器模式下的内置工具目录硬编码为
  `/app/internal/bin`，本包不放在那里，一设就找不到 ffmpeg/ffprobe。
  `start.sh` 只打开了真正需要的三个开关
  （`JAVBOSS_DISABLE_DESKTOP_INTEGRATION` / `JAVBOSS_DISABLE_MPV` / `JAVBOSS_USE_FFMPEG_SCREENSHOTS`）。
- **数据目录（重要）**：数据库 `data/javboss.db`、缩略图、封面、日志都在本包目录内，不写你的视频目录。
  请把包放在 proot rootfs 内部（如 `/root`）而**不要放在 `/sdcard`**：SQLite 默认用 WAL 模式，
  需要 mmap 共享内存（会生成 `javboss.db-wal` / `javboss.db-shm`），在 Android 的 FUSE 共享存储上不可靠；
  而且 FUSE 读写慢，不适合放数据库。
- **视频目录只读**：JavBoss 只扫描不修改，正好绕开 Android 分区存储的写限制；
  但 `/sdcard` 的读取本身经过 FUSE，大库首次扫描会比较慢。
- **单实例锁**：release 模式会锁 `data/javboss.lock`（`flock`）。proot 下该 syscall 会透传给
  内核，正常可用；万一报锁失败，删掉该文件重试。
- **端口**：改 `config.toml` 里的 `port`，或 `./start.sh --port 9000`。
- **刮削慢**：扫描要逐个文件跑 ffprobe，元数据刮削要联网；建议 Wi-Fi + 充电时做首次全库扫描。

## 可选：不装 proot 直接试

本包是**静态链接**的 Linux aarch64 二进制，理论上可以直接在 Termux 原生环境里跑
（Termux 是 bionic 而非 glibc，动态链接的程序因此跑不了，静态的不受影响）：

```sh
# 在 Termux 原生环境（不是 proot 内）
mkdir -p ~/javboss && cd ~/javboss
tar -xzf /sdcard/Download/javboss-<版本>-linux-arm64-proot.tar.gz --strip-components=1
./start.sh
```

若 Android 拦住了 exec（部分机型/系统版本会），就回到上面的 proot 方案。

## 重新打包

在 x86_64 Linux（WSL2 即可，无需 sudo）里执行：

```sh
bash scripts/build-proot-arm64.sh v2.1.2
```

脚本会把 Go 工具链和 Bootlin 的 `aarch64--musl--stable` 交叉工具链下载到
`$HOME/.cache/javboss-proot`，然后交叉编译 `./cmd/server` 并打包，产物在 `release/` 下。
可用环境变量（`GH_MIRROR`、`GOPROXY`、`BUILD_WEB=1`、`SKIP_FFMPEG=1` 等）见脚本头部注释。
