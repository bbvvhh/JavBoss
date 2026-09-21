# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

JavBoss 是本地视频 / JAV 媒体库管理工具：Go 单二进制后端（Gin + GORM + SQLite）+ React SPA 前端，通过内置 mpv 播放。

两条贯穿全局的设计原则，读代码时先记住：

- **零侵入**：只读取用户的视频目录，绝不写入。所有运行数据（`data/javboss.db`、缩略图、封面、缓存、日志）都落在程序自己的目录里。
- **单用户、单实例、本地优先**：非 Docker 模式默认只监听 `127.0.0.1`，release 构建用文件锁防止重复启动。

## 常用命令

```bash
# 后端（开发端口 17654；CLI 会带仓库本地 GOCACHE）
./scripts/cli.sh dev backend
DOCKER_MODE=1 ./scripts/cli.sh dev backend   # 模拟容器行为（设为 JAVBOSS_CONTAINER，禁用 mpv/桌面集成）
go run ./cmd/server                          # 等价于直接启动

# 前端（web/）
npm install
npm run dev          # Vite 5173，代理到 17654
npm run lint         # eslint --max-warnings=0
npm test             # node --test tests/*.test.js
npm run format:check # prettier

# 依赖下载（ffprobe + mpv，macOS 额外下载 ffmpeg）→ 写入 bin/<label>/ 并镜像到 internal/bin/
./scripts/cli.sh download linux-x86_64

# 发布 / 打包
scripts/cli.sh release linux-x86_64 v0.1.0
./scripts/cli.sh release-browser-extension
./scripts/cli.sh docker start|stop
./scripts/cli.sh                     # 交互式菜单
```

Go 测试（`.gocache/` 是仓库本地缓存目录，CLI 也用它）：

```bash
GOCACHE=$(pwd)/.gocache go test ./...
GOCACHE=$(pwd)/.gocache go test ./internal/db -run TestMigratedSchemaGormModels
```

调试单个 JAV provider：`go run ./cmd/javprovider`（交互式 REPL，逐个 provider/方法试查）。

平台标签只有 `windows-x86_64`、`linux-x86_64`、`macos-x86_64`、`macos-arm64`。

## 环境

go环境未配置PATH变量，在当前项目的`.tool` 文件夹下。  

## 架构

### 进程启动顺序（`cmd/server/main.go`）

顺序是有意为之的，改动前先读完整流程：

1. 解析 baseDir（release 用可执行文件目录，开发用 cwd）→ 读 `config.toml` → 初始化 logger（release 下按 lumberjack 轮转到 `logs/`）。
2. **若 `server_url` 非空则进入 Client 模式并直接 return** —— 该分支不打开数据库、不启动任何扫描器。
3. release 下取 `javboss.lock` 单实例锁，并把旧的 `pornboss.db`（含 `-wal`/`-shm`）迁移成 `javboss.db`。
4. `db.Open` → goose 迁移 → 把全局依赖写进 `common.*`（见下）。
5. 启动 managers，**5 秒后**再启动各后台扫描器（`service.Start*Scanner`）。
6. 最后组装 Gin router，可选挂载 `web/dist`。

**依赖注入风格**：没有 DI 框架。`internal/common/global.go` 里的包级变量（`DB`、`ScreenshotManager`、`CoverManager`、`StreamManager`、`FFmpegToolManager`、`AppConfig`）在 main 中赋值，`internal/service`、`internal/server` 直接读取。这是理解跨包耦合的关键；测试里通常给 `common.DB` 塞一个临时库。

### 数据模型（`internal/models`）—— 最核心的抽象

```
Directory 1─N VideoLocation N─1 Video ──JavID──> Jav (按 Code 唯一)
```

- `Video` 代表**内容**，`Fingerprint` 全局唯一，由 `util.VideoMetadata.FingerprintV2()` 生成（`宽x高|总码率|视频码率|音频码率|时长ms|文件大小`）。同一文件被重命名、移动、出现在多个目录，仍然是同一行 `Video`，标签和播放次数跟着它 —— 这就是 README 里「整理目录不会丢标签」的机制。
- `VideoLocation` 代表**某个目录里的一个具体文件**。扫描时未再被发现的 location 会被标记 `IsDelete`（软隐藏），不会删除 `Video` 本身。
- `Jav` 按 `Code` 全局唯一，可以被多个 `Video` 指向；idol 通过 `jav_idol_map`、tag 通过 `jav_tag_map` 多对多关联。
- 大量字段是 `gorm:"-"`，只用于 API 响应组装（`Path`、`Filename`、`Jav`、`Hidden`、`LocationID` 等），**不要以为它们是数据库列**。

### 目录扫描 + JAV 刮削流水线（`internal/service`）

- `ScanDirectory`：先按目录取互斥会话（`acquireDirectoryScanSession`，并发扫描同一目录会返回 `ErrDirectoryScanInProgress`）→ walk → 对每个视频 `ffprobe` → 算指纹 → upsert `Video`/`VideoLocation`。
- 文件 size+mtime 未变时跳过 probe，但**仍会入队**做 JAV 关联。
- `javLinkBatch`（`video_location_jav_linker.go`）：4 worker / 4096 队列的批次。`Enqueue` 同时更新 context 里的扫描进度；扫描结束前必须 `finishJavLinkBatch` 等待本批次跑完 —— 代码注释明确写了「JAV 关联属于本次目录扫描的一部分」。Worker 数刻意压低，调大会阻塞首扫期间的 JAV 查询接口。
- 扫描尾部：`hideUnprocessedVideoLocations` 隐藏陈旧 location → 写 `Directory.LastScanSummary` → 手动扫描还会补跑封面。
- 自动扫描由 `StartAutomaticDirectoryScanScheduler` 驱动（每目录有 `AutoScanEnabled` / `AutoScanIntervalMinutes`）。
- **元数据补全是另一套独立周期扫描器**，各自扫「缺对应字段的 Jav」并随机打散顺序：`StartJavMetadataScanner`、`StartJavSeriesMetadataScanner`（Avmoo 连续两轮无更新后切 JavMenu）、`StartUncensoredJavMetadataScanner`、`StartIdolProfileScanner`。注意**每个视频每轮只尝试一次刮削**，网络抖动导致的失败要等下一轮（README 提到约 1% 失败率属正常）。

### JAV provider 抽象（`internal/jav`）

- `Provider` 是 int 枚举。新增 provider 必须同步改四处：枚举常量、`String()`、`ParseProvider()` 白名单、`lookupProvidersByProvider` 映射，否则 `lookupProviderFor` 直接返回 `errUnsupportedProvider`。
- 所有 provider 实现同一个 `lookupProvider` 接口，统一入口是 `jav.LookupJavByCode` / `LookupActressByCode` 等函数，它们负责查缓存、并在 provider 未实现某方法时用 `recover` 兜底。
- **错误语义必须保持**：`ResourceNotFonud` 表示「代码无效或确实不存在」（不重试），其它 error 表示可重试失败。调用方（如 `jav_scanner.go`）据此决定是否打错误日志。
- 缓存是 SQLite KV（`internal/cache`），key 含 provider + 方法 + 参数；**每个 provider 有独立的 key version**（`lookupJavCacheKeyVersionByProvider`）。改了某个 provider 的解析逻辑，必须 bump 对应 version，否则旧缓存不会失效。成功缓存 90 天，not_found 缓存 7 天。
- 站点解析分散在 `javbus.go` / `javdatabase.go` / `javdb.go` / `avmoo.go` / `avsox.go` / `javmenu.go` / `javmodel.go` / `minnanoav.go` / `theporndb.go`，共用 `html_query.go` 的 goquery 辅助。

### HTTP 层（`internal/server`）

- `router.go` 组装中间件链，`api.go` 的 `RegisterRoutes` 是路由总表。
- 静态资源在 `NoRoute` 里处理：API 前缀返回本地化 404；其它路径先找静态文件，再按 `Accept` 回落 `index.html`（SPA fallback）。
- **错误响应约定**：一律用 `respondLocalizedError(c, status, zh, en)`，响应体是两个字段 `{error_zh, error_en}`，由前端按语言挑选。新增 API 错误要同时给中英文。
- 认证：单用户，bcrypt 口令 + 内存 session（cookie `javboss_session`，14 天 TTL）。cookie 名按安装目录做了 namespace（`NewAuthServiceForInstance`），所以同一浏览器可以同时登录多个实例。5 次失败锁 30 秒。
- **浏览器扩展走的是 token 而非 cookie**（`Authorization: Bearer`）。`extension_api_access.go` 里的 `extensionTokenAPIs` 是一张「允许 token 访问的路由 + 方法」白名单，**其它接口即使 token 有效也会被拒绝**。给扩展新增接口必须同时登记进这张表和 `extension_routes.go`。

### 播放与 Client 模式

- `internal/mpv`：通过 IPC（unix socket / Windows 命名管道）驱动 mpv，支持复用窗口、播放列表事件、快捷键与截图。`modernz/`（OSC 皮肤、thumbfast、playlist sidebar 的 lua/conf）和 `internal/bin/`（ffprobe/mpv/ffmpeg）是随发布包一起分发的运行期资源。
- **Client 模式**（`--server-url` 或 `config.toml` 的 `server_url`）：本机 JavBoss 不启用数据库与扫描器，只做远程 Server 的反向代理，并用本机 mpv 播放远程媒体。见 `internal/client/client.go` 包注释与 `runClientMode`。

### 在线字幕（`internal/subtitle` + `internal/service/subtitle_service.go` / `subtitle_batch.go`）

- 搜索接口可配置：配置键 `subtitle_api_url`，默认迅雷 `https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name={keyword}`，`{keyword}` 会替换成视频番号（`jav.code`，取不到时回退文件名）。
- 解析、SRT/ASS→WebVTT 转换、GBK/Big5 解码、文件名+时长匹配、落盘命名规则都在 `internal/subtitle`，与网络无关的部分都有表驱动测试。
- 字幕文件落在 `<dataDir>/subtitle/<video_id>/`（只写程序自己的目录），数据库记录是 `video_subtitle`：一个视频可以有多条，`auto` 标记批量下载。
- 网页播放时先由前端取回 `/videos/:id/subtitles/:subtitle_id/file`（后端转成 WebVTT）再做成 blob URL 挂到 video.js —— 这样 `<track>` 即使不带 Cookie 也不会静默 401；`/raw` 返回原始文件。
- 选片规则（`subtitle.PickBest`）：文件名完全匹配 > 文件名包含 > 无名称匹配；同档内取 |字幕时长 − 视频时长| 最小的，时长为 0 的排最后。设置里的「一键下载所有 JAV 视频字幕」对每个已关联番号的视频跑这套规则，进度是内存状态，前端轮询 `GET /subtitles/batch-download`。
- PC（`PlayerSubtitlePanel.jsx` + `SubtitleSettingsPanel.jsx`）与移动端（`SubtitleSheet.jsx` + `settings/SubtitlePage.jsx`）各有一套 UI，两端共用同一批后端接口；`utils/subtitle.js` 是两端各自拷贝的纯函数。
- **MPV 播放同样带字幕**（`internal/mpv/subtitles.go`）：
  - 独立进程启动用重复的 `--sub-file=`；注意 mpv 的 `--sub-files=` 重复出现是**覆盖**、且不按逗号拆分，只有单数别名 `--sub-file` 会追加（0.41 实测）。
  - 复用窗口的 IPC 路径把最新一条放进 `loadfile` 的 `sub-files` 选项（该 options map 只吃单文件，传数组会让整条 loadfile 失败），其余用 `sub-add <file> auto`，并带重试（刚 loadfile 完 mpv 可能拒绝该命令）。
  - 正在播放时下载字幕会自动挂上去：`service.AttachSubtitleToPlayerIfPlaying` 先用 `mpv.IsPlayingMedia` 比对 mpv 的 `path`，只在播的就是这个视频时才挂；视频卡片上的「字幕」入口走 `POST /videos/:id/subtitles/mpv`（`subtitle_id<=0` 表示关闭字幕）。

### 前端（`web/`）

- 单 SPA 承载两种模式：`viewMode: 'video' | 'jav'`，JAV 下再分 `javTab: list | idol | studio | series`。状态是 `store.js` 里**一个扁平的 Zustand store**，video/jav 是两套平行的分页与筛选字段。
- `App.jsx`（约 5k 行）持有几乎所有页面状态、弹窗与 URL 拼装；`routes/*.jsx` 只是很薄的转发壳。改 UI 大概率要动 `App.jsx` 和 `components/`。
- **URL 是状态的第二来源**：`utils/urlState.js` 负责 parse/serialize（含随机模式的 `randomSeed`），`hooks/useUrlStateSync.js` 负责 store ↔ URL 双向同步。**新增任何筛选条件都要同时改 `store.js`、`urlState.js`、`useUrlStateSync.js` 三处**，否则刷新/分享链接会丢状态。
- `api.js` 全部使用同源相对路径（没有 base URL），开发环境由 `vite.config.js` 的 `backendProxy()` 转发到 `17654`。**新增后端路由前缀必须加进该列表**，否则 dev 下 404。
- 认证：`auth.jsx` 的 `AuthProvider` 包裹 App，基于 cookie（`credentials: 'include'`）；`apiFetch` 收到 401 会派发 `'javboss:auth-expired'` 事件，Provider 监听后切回登录页。
- i18n 没有库：字符串内联 `zh('中文', 'English')`，常量里是 `[cn, en]` 元组，按浏览器语言在模块加载时定一次。
- 轮询是**局部**的：`DirectoryManager` 约 1s 轮询扫描状态，`DownloadsView` 约 3s 轮询任务；没有全局轮询或 WebSocket。
- MUI 与 Tailwind 并存。

## 约定与注意事项

### 数据库迁移（最容易踩的地方）

- **不要修改已有的 `internal/db/migrations/*.go`**，任何 schema 或数据变更都新增一个带时间戳前缀的迁移。
- 迁移后的实际 schema 必须与 `internal/models` 的 GORM tag **完全一致**（表名、列名、类型、可空、默认值、索引、唯一约束、外键、join 表）。`internal/db/schema_compare_test.go` 的 `TestMigratedSchemaGormModels` 会用 `AutoMigrate` 建一个参考库逐表比对，任何漂移都会让它失败。**改 model 就必须补迁移**，反之亦然。
- 迁移由 goose 在 `db.Open` 中执行，执行期间 `foreign_keys=OFF`，完成后打开；GORM 使用 `SingularTable`（表名是单数）。
- `internal/db/sqlite_functions.go` 注册了两个自定义 SQLite 函数 `splitmix64` / `stable_random_rank`，用于「随机排序但分页稳定」（前端的 `randomSeed` 就是传进来的 seed）。改动随机排序时要连 `internal/db` 查询和前端 store 一起看。

### 代码风格

- 日志统一走 `internal/common/logging` 的 `Info` / `Error`，不要直接用 `log` 或 `fmt` 打印；main 在 release 下会把它接到轮转文件。
- Go：`gofmt`；context 作为第一个参数；错误用 `%w` 包装、消息小写；包名小写。
- `internal/service` 里的注释多为中文，跟随现有风格。
- 生成物 / 运行期目录不要提交：`data/`、`docker-data/`、`bin/`、`internal/bin/`、`web/dist/`、`release/`、`.gocache/`、`scripts/cli/build/`。

## 测试

- **Go**：表驱动测试与源文件同目录（`*_test.go`）。改动迁移或模型后**必跑** `internal/db`，它同时覆盖迁移正确性与 schema 一致性。注意 `AGENTS.md` 中「no Go tests yet」的说法已经过时，仓库现有大量测试。
- **前端**：全部放在 `web/tests/`（扁平），用 `node:test` + `node:assert/strict`，没有 jsdom/RTL，因此只能测纯逻辑模块。文件名对应 `src/utils` 下的模块（`src/utils/javEdit.js` → `tests/javEdit.test.js`）。提交前跑 `npm test && npm run lint && npm run format:check && npm run build`。
- **浏览器扩展**：`browser-extension/tests/*.test.js`，直接 `node --test browser-extension/tests/*.test.js`；未接入 npm script 或 CI。
- **CI 现状**：`.github/workflows/` 全部是 `workflow_dispatch` 手动触发，没有 PR/push 触发的构建、lint 或测试。**测试必须本地跑**，别指望 PR 上有反馈。

## 相关文档

- `AGENTS.md`：仓库通用规范（部分内容已过时，测试相关请以上一节为准）。
- `DEVELOPMENT.md`：中文开发环境说明与项目结构表。
- `browser-extension/README.md`：扩展自身说明。
