# JavBoss 开发者说明

## 开发环境依赖

- Go `1.25.1` 或更高版本
- Node.js 和 npm

## 技术栈

- Backend: Go + Gin + GORM + SQLite
- Frontend: React + Vite + Tailwind + Zustand
- 媒体探测: `ffprobe`
- 缩略图截图生成: macOS 使用 `ffmpeg`，其他平台使用 `mpv`
- 播放与手动截图: `mpv`

## 常用命令

下载依赖（`ffprobe` + `mpv`，macOS 额外下载 `ffmpeg`）：

```bash
./scripts/cli.sh download linux-x86_64
```

安装前端依赖：

```bash
cd web
npm install
```

启动后端：

```bash
./scripts/cli.sh dev backend
```

按 Docker 运行时配置启动本地后端（用于调试容器模式行为）：

```bash
DOCKER_MODE=1 ./scripts/cli.sh dev backend
```

启动前端：

```bash
./scripts/cli.sh dev frontend
```

前端检查：

```bash
cd web
npm run lint
npm run build
```

打包发布：

```bash
scripts/cli.sh release linux-x86_64 v0.1.0
```

### 打包前端的两个新约定（v2.1.1 起）

发布包现在同时包含 **两套前端**：`web/dist`（PC 版）与 `web-mobile/dist`（手机版，挂在 `/m/` 下）。
release 流程会自动构建并打包两者，不想带手机版用 `SKIP_MOBILE_WEB_BUILD=1`。
后端按可执行文件所在目录解析这两个路径，缺手机版时只是不提供 `/m/`，不报错。

打包 zip 需要 `zip` 命令；没有时会自动回退到 Python 并**显式写入 unix 权限位**
（发布目录若在 NTFS/DrvFs 上，`chmod` 无效，只靠 `stat` 记权限会让解压出来的
`javboss` / `internal/bin/*` 丢掉执行位）。

### 在 Windows 机器上打 Linux / proot 包

`go-sqlite3` 需要 CGO，所以 Linux 包必须在 Linux 里编译 —— 用 WSL2 即可（本机 `Ubuntu-22.04`）：

- **本机 WSL 里没有 gcc、也没有 libc 头文件**。proot 构建脚本下载的 zig 缓存
  （`~/.cache/javboss-proot/zig/ziglang/zig`）可以直接当 C 编译器用：
  写一个 wrapper 执行 `zig cc -target x86_64-linux-gnu.2.17 "$@"` 并把 `CC` 指向它即可
  （Go 的 `CC` 不支持带参数的多词命令，必须包一层）。
  这样编出来的 `linux-x86_64` 只要求 `GLIBC_2.14`，兼容性比用新版 gcc 编还宽。
- **直连 GitHub 很慢**（本机 WSL 里约 8–95 KB/s，mpv AppImage 要几小时），用镜像
  `https://ghfast.top/` 可以到 ~600 KB/s。mpv 有现成的覆盖开关：
  `MPV_URL_LINUX_X86_64=https://ghfast.top/<github-url> ... download-dependencies linux-x86_64`；
  ffprobe 没有开关，但 `isBundledFfprobeReady()` 是按 SHA-256 校验的，所以经镜像下到
  `bin/linux-x86_64/ffprobe`、校验通过并 `chmod +x` 之后，CLI 会认定它已就绪并跳过下载。
- **Windows 侧用 curl 下这些依赖会失败**：`curl: (35) schannel: next InitializeSecurityContext
  failed: Unknown error (0x80092013)`（证书吊销检查连不上）。这类下载都放到 WSL 里做。

## 通过 CLI 启停 Docker

需要 Node.js/npm、Docker 和 Docker Compose 插件。在仓库根目录执行：

```bash
# 构建镜像并后台启动容器
./scripts/cli.sh docker start

# 停止容器，保留容器和数据
./scripts/cli.sh docker stop
```

也可运行 `./scripts/cli.sh`，在第一层选择 `docker`，再选择 `start` 或 `stop`。

`start` 使用 `compose.local.yaml` 在 Docker 内构建前后端，默认镜像为 `javboss:local`，访问地址为 `http://localhost:5174`。数据保存在仓库根目录的 `docker-data/`，宿主机根目录只读挂载到 `/host`。重复启动会重新构建镜像并按需更新容器，继续使用该数据目录，不会自动迁移其他目录的数据。

更多参数可通过 `./scripts/cli.sh docker --help` 查看。

## 项目结构

```text
cmd/server             Go 服务入口
cmd/javprovider        JAV 元数据 provider 调试入口
internal/common        全局状态与共享配置
internal/db            GORM 模型查询与 SQLite 存储
internal/jav           JAV 元数据与女优资料抓取
internal/manager       封面下载与截图任务
internal/models        数据模型定义
internal/mpv           mpv 播放、快捷键与手动截图配置
internal/server        HTTP API 与静态资源路由
internal/service       目录扫描、JAV 识别、资料补全
internal/util          文件、系统、代理、视频探测等工具
web/                   React + Tailwind 前端
scripts/cli            开发、依赖下载与发布辅助 CLI
data/                  运行期数据库、封面、缩略图与缓存
```
