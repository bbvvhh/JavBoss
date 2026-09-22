# JavBoss — Termux + proot (aarch64 Linux) 包

这个包用于在 Android 手机的 Termux 上，通过 **proot-distro 的 Linux 环境**运行 JavBoss。
主程序是**静态链接的 aarch64 ELF**（musl 工具链构建），不依赖目标 rootfs 的 glibc 版本，
所以 Ubuntu / Debian / Alpine 的 proot rootfs 都能跑。

## 包内容

| 路径 | 说明 |
| --- | --- |
| `javboss` | 主程序（静态链接 aarch64，release 模式） |
| `start.sh` | 启动脚本：设好本环境需要的开关，并自动挑选 CA 证书包（`SSL_CERT_FILE`） |
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

Termux **原生**运行的正确性是通过 syscall 层面验证的，不是靠真机：用 `qemu -strace` 抓启动路径，
修复前的 `exec.LookPath` 会发出 `faccessat2(AT_FDCWD,…,X_OK,AT_EACCESS)`（Termux 上会被 seccomp
以 SIGSYS 杀掉），修复后启动路径的 `faccessat2` 次数为 **0**，ffprobe/ffmpeg 的解析改成
`newfstatat`。真机（Android 上的 seccomp 策略）仍建议你首次运行时确认一下。

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

   **新版本也会自动探测**：启动时若发现 Go 的常规 CA 路径都没有内容，会依次尝试 Termux 的
   `$PREFIX/etc/tls/cert.pem`、`$PREFIX/etc/ssl/certs/ca-certificates.crt` 以及 Android 14+
   的系统 CA 目录 `/apex/com.android.conscrypt/cacerts`，命中就通过 `SSL_CERT_FILE` /
   `SSL_CERT_DIR` 交给 Go（日志里会打印 `tls: system CA bundle is missing; using ...`）。
   想手动指定就用 `JAVBOSS_CA_BUNDLE=/path/to/ca.pem`（或自己 export `SSL_CERT_FILE`，优先级最高）。

5. **rootfs 里最好有可用的 DNS**。proot-distro 装出来的 Debian 常常把 `/etc/resolv.conf`
   留在 systemd-resolved 的 stub 上，内容是 `nameserver ::1`，而 proot 里没人监听
   `[::1]:53`，于是会报：

   ```
   dial tcp: lookup api-shoulei-ssl.xunlei.com on [::1]:53: read udp [::1]:38656->[::1]:53: read: connection refused
   ```

   **JavBoss 现在会自动兜底**：启动时检查 `/etc/resolv.conf`，发现没有条目或只有 loopback
   条目，就改用内置公共 DNS（223.5.5.5 / 119.29.29.29 / 1.1.1.1），日志里会打印
   `dns: no usable system resolver (...); falling back to [...]`。所以这条通常不用手动修了。

   想自己修 / 想用内网 DNS，仍然可以改 rootfs 的解析配置（必须 `rm` 再写，符号链接会导致改完又被改回去）：

   ```sh
   ls -l /etc/resolv.conf && cat /etc/resolv.conf
   rm -f /etc/resolv.conf
   printf 'nameserver 223.5.5.5\nnameserver 119.29.29.29\n' > /etc/resolv.conf
   curl -sS -o /dev/null -w '%{http_code}\n' 'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=ABP-001'   # 期望 200
   ```

   也可以用环境变量强制指定（优先级最高，支持 `IP`、`IP:端口`、逗号分隔多个）：

   ```sh
   export JAVBOSS_DNS=223.5.5.5
   ./start.sh
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
- **联网/字幕报错**：先看服务端日志 `logs/javboss.log`。字幕失败会带出底层原因：
  - `x509: certificate signed by unknown authority` → 缺 CA 证书，见「前提 4」；
  - `lookup … on [::1]:53: … connection refused` → 系统 DNS 不可用；新版本会自动兜底到公共 DNS（前提 5），
    日志里能看到 `dns: … falling back to …`，也可以用 `JAVBOSS_DNS` 指定；
  - `proxyconnect tcp` → 容器里的 `HTTP(S)_PROXY` 指向了不可达的代理；
  - 浏览器能上网但这里报错，通常就是上面三条之一（浏览器走 Android 系统网络，容器走 rootfs 自己的配置）。

## 直接在 Termux 原生运行（不用 proot）

本包是**静态链接**的 Linux aarch64 二进制，不依赖 glibc，因此可以直接在 Termux 原生环境跑：

```sh
# Termux 原生环境（不是 proot 内）
mkdir -p ~/software/javboss && cd ~/software/javboss
unzip -q /sdcard/Download/javboss-<版本>-linux-arm64-proot.zip     # 或 tar -xzf ... --strip-components=1
./start.sh
```

**注意 DNS（Termux 原生特有，新版本已自动处理）**：Android 没有 `/etc/resolv.conf`，而 Termux 自带的
Go 是按 Termux 前缀打过补丁的，第三方静态二进制不是。所以老版本在这里会报
`lookup … on [::1]:53: … connection refused`（Go 用了内置默认的 127.0.0.1/[::1]）。新版本启动时会检测到
这种情况并自动改用内置公共 DNS，日志里会打印 `dns: no usable system resolver (...) falling back to [...]`。
要指定自己的 DNS（比如局域网 DNS）用 `export JAVBOSS_DNS=192.168.1.1` 再启动。

**注意 CA 证书（同样是 Termux 原生特有，新版本已自动处理）**：Android 14+ 把系统 CA 挪到了
`/apex/com.android.conscrypt/cacerts`，而 `/system/etc/security/cacerts` 只有**用 `GOOS=android` 编译**
的二进制才会读（我们是 linux 静态二进制，不读）；Termux 自己的证书包又在 `$PREFIX/etc/` 下。于是 Go 的根
证书池是空的，HTTPS 报 `x509: certificate signed by unknown authority`（curl 却是好的，因为 OpenSSL 走的是
另一套路径）。

先装证书包：

```sh
pkg install ca-certificates          # Termux 原生
# 或（rootfs 里）
apt update && apt install -y ca-certificates tzdata
```

**包内的 `start.sh` 已经会自动挑证书**：它按「系统标准路径 → `$PREFIX/etc/tls/cert.pem` → Termux 固定路径」的顺序选第一个**非空**的证书文件并 `export SSL_CERT_FILE`（一个文件都没有时退而指向 `/apex/com.android.conscrypt/cacerts` 或 `/system/etc/security/cacerts`），启动时会打印

```
[javboss] SSL_CERT_FILE=/data/data/com.termux/files/usr/etc/tls/cert.pem
```

新版本二进制自己也会解析证书并计数兜底（日志 `tls: ...`），两者互为保险。手动覆盖用
`JAVBOSS_CA_BUNDLE=/path/to/ca.pem ./start.sh`，或者自己 `export SSL_CERT_FILE=...`（脚本见到已有值就不改）。

> ⚠️ 无论哪种方式，**不要指向不存在的文件** —— 指向空路径会屏蔽系统默认路径，HTTPS 会彻底不通。

**注意 Android 的 seccomp 坑（本包已修复）**：Termux 的 targetSdk 是 28，Android 的 seccomp
过滤器会对 `faccessat2(2)` 直接 `SECCOMP_RET_TRAP`（不是返回 ENOSYS）。而 Go 的
`os/exec.LookPath` 在候选文件存在时会走 `AT_EACCESS → faccessat2`，被 trap 后整个进程以

```
SIGSYS: bad system call
```

崩溃 —— 旧版本会在启动（尝试 `xdg-open` 开浏览器）或扫库（解析 ffprobe）时随机炸掉。修复方式：

- `runtimeconfig` 自动识别 Termux（`TERMUX_VERSION` 或 `PREFIX` 含 `com.termux`），
  自动关闭桌面集成 / mpv / 改用 ffmpeg 截图；
- 解析 ffprobe、ffmpeg、mpv 一律改用 `os.Stat` 判断可执行位（`newfstatat`），不再经过
  `exec.LookPath`；
- `util.OpenFile` / `util.RevealFile` 在禁用桌面集成时直接返回，不再调用 `xdg-open`。

所以现在 `./start.sh`（或直接 `./javboss`）在 Termux 原生命中即可；`start.sh` 里的三个环境变量
只是显式声明，Termux 下就算不设也会被自动识别。

> 未修复的旧包在 Termux 原生环境的表现就是启动后打印 `SIGSYS: bad system call` + 一大串
> goroutine 栈，栈顶是 `Eaccess → os/exec.findExecutable → LookPath`。

## 重新打包

在 x86_64 Linux（WSL2 即可，无需 sudo）里执行：

```sh
bash scripts/build-proot-arm64.sh v2.1.2
```

脚本会把 Go 工具链和 Bootlin 的 `aarch64--musl--stable` 交叉工具链下载到
`$HOME/.cache/javboss-proot`，然后交叉编译 `./cmd/server` 并打包，产物在 `release/` 下。
可用环境变量（`GH_MIRROR`、`GOPROXY`、`BUILD_WEB=1`、`SKIP_FFMPEG=1` 等）见脚本头部注释。
