# JavBoss 移动端设计方案

> 状态：**设计已确认，待开工**
> 目标：手机访问自动进入移动端页面；PC 端工程 `web/` 不做任何改动。

## 已确认的决策

| # | 决策 | 结论 |
| --- | --- | --- |
| 1 | 后端加 `Preload("Idols")` 让 `/videos` 返回演员 | ✅ 接受 |
| 2 | 演员只在哪种密度显示 | ✅ 仅大图模式 |
| 3 | 默认网格密度 | ✅ 大图 1 列 |
| 4 | iPad 归属 | ✅ 归移动端 |
| 5 | `web/src/utils` 复用方式 | ✅ 复制一份到 `web-mobile/src/utils/` |
| 6 | 模块范围 | ✅ 视频 + JAV 都做 |
| 7 | PC 端是否加「手机版」入口 | ✅ 不加，`web/` 保持零改动 |
| 8 | **视频文件安全** | 🚫 **任何时候不允许删除视频文件** |
| 9 | 重命名文件 | ✅ 保留，做成带完整预览的独立确认页（设计稿 11） |

---

## 0. 安全红线（最高优先级）

### 0.1 已核实的风险点

| 接口 | 实际行为 | 证据 |
| --- | --- | --- |
| `DELETE /videos/{id}/locations/{locationId}` | **物理删除视频文件**：`util.MoveFileToTrash(fullPath)`；Windows 走回收站，**Linux / macOS 上是 `os.Remove` 即永久删除** | `internal/server/video_api.go:1275`；`internal/util/trash_nonwindows.go:8` |
| `PATCH /videos/{id}/locations/{locationId}` | 重命名真实文件：`os.Rename(oldFullPath, newFullPath)` | `internal/server/video_api.go:780` |
| `POST /directories/{id}/process` | 目录整理，内部含 `os.Remove` / `os.Rename` | `internal/service/directory_processor.go:538, 774` |
| `POST /videos/open`、`POST /videos/reveal` | 调起桌面程序，移动端无意义 | — |

### 0.2 移动端铁律

> **移动端只允许「读」+「写数据库 / JavBoss 自有 `data/` 目录」+「重命名视频文件」，绝不允许删除或覆盖任何视频文件。**

| 类别 | 是否允许 | 例子 |
| --- | --- | --- |
| 只读 | ✅ | 列表、详情、搜索、播放流、扫描状态 |
| 写数据库 | ✅ | 标签、收藏夹、刮削元数据、播放次数、从媒体库移除 |
| 写 `data/` 目录 | ✅ | 缩略图、截图、封面、缓存（都在 JavBoss 自己目录下） |
| **重命名视频文件** | ⚠️ **允许，带防护** | 只改名、不删除（见 §0.4 / §0.5） |
| **删除 / 覆盖视频文件** | 🚫 **永久禁止** | 删除、目录整理、批量移动 |
| 其它写媒体目录 | 🚫 **永久禁止** | 移动、新建、写入 |

### 0.3 封禁清单（`web-mobile/src/api.js` 不得出现）

```
DELETE /videos/:id/locations/:locationId     ← 删除文件（Linux/macOS 上是 os.Remove）
POST   /directories/:id/process              ← 目录整理，内部含 os.Remove / os.Rename
POST   /videos/open
POST   /videos/reveal
```

**强制手段**：`api.js` 只导出白名单函数，并配一个单元测试断言源码中不出现上述路径 / 方法组合（`web-mobile/tests/api-safety.test.js`）。这是回归护栏，防止后续误加。

### 0.4 受控允许清单（重命名）

```
PATCH /videos/:id/locations/:locationId   body: { filename }
```

这是**唯一**会写用户媒体目录的接口。移动端刻意把它做成最重的交互路径：

- 只能从长按菜单 / ⋮ 进入，进入的是独立的**重命名确认页**（设计稿 11）
- 页面必须完整展示「旧名 → 新名」diff
- 扩展名独立成块并锁定，用户改不到
- 必须显式点「确认重命名」，**没有任何一键生效路径**
- **只支持单文件，不提供批量重命名**
- 后端拒绝时把原因原样展示（已存在 / 大小写冲突 / 远程目录不支持），不报「未知错误」

### 0.5 重命名为什么是安全的（后端已有三重防护）

已核实 `internal/server/video_api.go:676-800`：

| 防护 | 位置 | 效果 |
| --- | --- | --- |
| 文件名合法性 | `isSafeVideoFilename` (`:1303`) | 拒绝空名、`.`、`..` 与任何含 `/` `\` 的输入 |
| 目标路径已在库 → 409 | `VideoLocationPathExists` (`:734-743`) | 不允许改成一个已被记录的名字 |
| 目标文件已存在 → 409 | `os.Stat` + `os.SameFile` (`:769-778`) | **绝不覆盖已有文件**（这是关键：`os.Rename` 本身会静默覆盖） |
| DB 写入失败 → 回滚文件名 | `os.Rename(new, old)` (`:789-792`) | 文件系统与数据库不会不一致 |

另有一个已知行为：`video_location.relative_path` 是 `collate:NOCASE`，所以**只改大小写的重命名会被判为「目标文件已存在」而拒绝**。移动端会把这个 409 翻译成人话提示，而不是弹未知错误。

### 0.6 安全替代：「从媒体库移除（文件保留）」

需要「清理列表」时用这个，它**只改数据库**：

- 复用现成的 `dbpkg.HideVideoLocationsByIDs()`（注释即「marks file locations as deleted without deleting video metadata」，`internal/db/video_locations.go:84`）
- 需新增一个 DB-only 接口（见 §3.6）
- **天然可逆**：文件还在，下次扫描时会自动恢复 —— `internal/service/directory_scan.go:268` 检测到路径存在且 size/mtime 未变就 `IsDelete = false`

也就是说移动端**不可能造成不可逆的数据丢失**，这是刻意的设计。

UI 上保留一条置灰的「删除文件（移动端已禁用）」，明确告知能力边界（设计稿屏幕 04）。

---

## 1. 设计原则

| 优先级 | 原则 | 落地方式 |
| --- | --- | --- |
| P0 | **视频列表是主角** | 顶部仅 84px 控制栏；默认大图 1 列，可切标准 2 列 / 紧凑 3 列 |
| P1 | **设置只留入口，功能不缩水** | 首屏无设置项；齿轮 →「我的」四组 15 个入口，覆盖 PC 端全部设置能力（实际分组 5 / 4 / 4 / 2，见 §8） |
| P2 | 搜索按需展开 | 默认只是放大镜图标，点开顶栏原地变形为输入框 |
| P3 | 复杂筛选下沉 | 排序 / 标签 / 刮削状态 / 时长收进底部抽屉 |
| P4 | **文件零风险** | 见 §0，封禁一切写媒体目录的接口 |

---

## 2. 目录规划

**不修改 `web/` 下任何文件。** 新建并列工程：

```
web-mobile/
├── design/
│   ├── DESIGN.md                # 本文件
│   └── mobile-ui-mockup.html    # 高保真设计稿（浏览器直接打开）
├── index.html
├── package.json
├── vite.config.js               # 端口 5174，代理列表与 web/ 一致
├── tailwind.config.js
├── postcss.config.js
├── src/
│   ├── main.jsx
│   ├── App.jsx                  # 页面栈 + 手势编排
│   ├── api.js                   # ⚠️ 白名单：只导出安全接口
│   ├── store.js                 # zustand 扁平 store
│   ├── index.css
│   ├── nav/PageStack.jsx        # 推入式导航：左滑入 / 右滑返回 / 物理返回键
│   ├── components/
│   │   ├── TopBar.jsx           # logo + 视频/JAV 分段 + 搜索 + 设置
│   │   ├── SubBar.jsx           # 二级页顶栏（返回 + 标题 + 保存）
│   │   ├── QuickChips.jsx
│   │   ├── DensityChip.jsx      # 大图 / 标准 / 紧凑
│   │   ├── VideoCard.jsx        # 三种排版
│   │   ├── VideoGrid.jsx        # 骨架屏 + 无限滚动哨兵
│   │   ├── VideoListPage.jsx
│   │   ├── SearchPanel.jsx
│   │   ├── FilterSheet.jsx
│   │   ├── BottomSheet.jsx
│   │   ├── ActionSheet.jsx      # 长按 / ⋮ 菜单（无删除文件项）
│   │   ├── RenamePage.jsx       # ⚠️ 重命名确认页：diff 预览 + 扩展名锁定
│   │   ├── SelectionBar.jsx
│   │   ├── ConfirmDialog.jsx
│   │   ├── Toast.jsx
│   │   ├── JavListPage.jsx      # 作品 / 女优 / 片商 / 系列
│   │   ├── PlayerPage.jsx       # 浏览器播放 + 续播 + 接下来播放
│   │   ├── ConfirmDialog.jsx    # 破坏性操作确认（危险项需勾选）
│   │   ├── form/                # Field / Switch / Stepper / Segmented / TextField / PickerField / PromptSheet
│   │   └── settings/            # 见 §2.1
│   ├── hooks/                   # useInfiniteScroll / useLongPress / useOverlayBack / useStackBack / useHideOnScroll / useAsyncData
│   └── utils/                   # 从 web/src/utils 复制（见 §6）+ config.js / javDisplay.js
├── tests/
│   ├── api-safety.test.js       # ⚠️ 断言 api.js 不含封禁接口
│   └── progress.test.js         # 播放进度与本机偏好
└── dist/
```

### 2.1 设置区文件（P2 落地）

```
components/settings/
├── registry.jsx                # 页面类型 → 组件，全部 lazy() 分包
├── MePage.jsx                  # 「我的」：概览卡 + 4 组 15 入口
├── SettingsPage.jsx            # 子页外壳（加载 / 出错可重试 / 内容 三态）
├── SettingsList.jsx            # SettingsGroup / SettingsRow / MeHeader
├── DirectoryManagerPage.jsx    # ⚠️ 无「整理」入口
├── DirectoryPicker.jsx         # 服务端目录选择器（本地 / WebDAV 共用）
├── ScanTaskPage.jsx
├── TagManagerPage.jsx          # 视频标签与 JAV 标签共用
├── VideoTagPage.jsx / JavTagPage.jsx
├── FavoriteGroupPage.jsx       # 列表 + 详情两个页面类型
├── PlayerSettingsPage.jsx
├── ScrapeOverviewPage.jsx      # 全局刮削视角（单视频的刮削页仍是 components/ScrapeSettingsPage.jsx）
├── DownloaderPage.jsx
├── GlobalSettingsPage.jsx
├── StorageConnectionPage.jsx
├── ExtensionTokenPage.jsx
├── ToolsPage.jsx
├── AccountPage.jsx
└── AboutPage.jsx
```

> 命名注意：全局刮削页叫 `ScrapeOverviewPage.jsx`，单视频刮削页叫
> `components/ScrapeSettingsPage.jsx`。两者同名会让人在 import 时选错，所以刻意区分。

---

## 3. 手机端自动切换方案

识别在 **Go 后端** 完成，前端零判断 —— PC 端 `web/` 完全不用改。

### 3.1 路由与静态托管

| 路径 | 行为 |
| --- | --- |
| `/m/*` | 托管 `web-mobile/dist`，SPA fallback 到移动端 `index.html` |
| `/m` | 301 → `/m/` |
| `/` 与其它 HTML 导航 | 按「Cookie → UA」顺序判定，命中则 302 → `/m/`，否则返回 PC `index.html` |
| 静态资源 / API | 判定逻辑不介入（只对 `Accept: text/html` 的导航请求生效） |

### 3.2 判定优先级

```
1. Cookie  javboss_ui=desktop   → 永远走 PC（显式选择，1 年有效）
2. Cookie  javboss_ui=mobile    → 永远走 /m/
3. URL     ?desktop=1 / ?mobile=1 → 写入对应 Cookie 并跳转
4. UA      Android|iPhone|iPad|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile|Mobile
                                → 走 /m/     ← iPad 已按决策归移动端
5. 其它（桌面浏览器）            → 走 PC
```

UA 正则只用来「猜」，Cookie 才是最终裁决 —— 判断错了用户永远能自救。

### 3.3 手动互切入口

- 移动端「我的 → 账号与安全 → 切换到电脑版」：写 `javboss_ui=desktop`（1 年）后跳 `/`
- 回手机版：访问 `/?mobile=1`（PC 页面无需改代码即可支持）

两条路径都已实现并实测：Cookie 是显式选择，永远优先于 UA —— UA 猜错了用户一定能自救。

### 3.4 后端改动清单（不碰 `web/`）

全部完成：

| 文件 | 改动 | 实际 |
| --- | --- | --- |
| `internal/server/router.go` | `NewRouter` 增加 `mobileStaticDir`；注册 `/m/`；`NoRoute` 加 UA/Cookie 分流 | ✅ 新增 `uiStatic` 类型承载两套前端的根目录与 index，判定顺序按 §3.2 实现 |
| `internal/server/router_ui_test.go` | — | ✅ 新增（UA 表驱动、Cookie 覆盖、iPad、`?mobile=1`、`/m/` SPA 回落、逃逸、API 不受影响） |
| `cmd/server/main.go` | 新增 `defaultMobileStaticDir = "web-mobile/dist"` | ✅ |
| `internal/db/videos.go` | `hydrateLocationJavs` 加 `Preload("Idols")` | ✅ 并用 `internal/db/videos_idols_test.go` 锁定（去掉 Preload 该测试会失败） |
| `internal/server/video_api.go` + `api.go` | 新增「从媒体库移除」DB-only 接口 | ✅ `POST /videos/locations/hide`；`HideVideoLocationsByIDs` 改为返回真实改动行数 |
| `scripts/cli/cli.mjs` | release 流程增加移动端构建并拷贝 `web-mobile/dist` | ✅ 新增 `buildMobileWeb()`，可用 `SKIP_MOBILE_WEB_BUILD=1` 跳过 |
| `scripts/build-proot-arm64.sh` | — | ✅ proot 包也带上 `web-mobile/dist`（这包就跑在手机上），`BUILD_WEB=1` 现在同时构建两套前端 |
| `Dockerfile` | 增加移动端构建阶段并 `COPY` | ✅ 新增 `mobile-web-build` 阶段 |
| `.gitignore` / `.dockerignore` | 增加 `web-mobile/dist/`、`web-mobile/node_modules/` | ✅ 只有 `.dockerignore` 需要加 —— `web-mobile/.gitignore` 本来就忽略 `dist/` 与 `node_modules/` |

打包环节顺带修掉的两个问题（都会让发布包直接不可用）：

- **`createZip` 只认 `zip` 命令**：精简 Linux（本机 WSL 就没有）和 Windows 都常常没有它，
  发布流程会直接失败。现在没有 `zip` 时回退到 Python 打包，并**显式写入 unix 权限位** ——
  发布目录常落在 NTFS/DrvFs 上，那里 `chmod` 是空操作，只按 `stat` 记录会让解压出来的
  `javboss` / `internal/bin/*` 丢掉执行位。权限策略按文件名判定（顶层 `javboss`/`javboss.exe`/
  `javboss.command`/`start.sh` 与 `internal/bin/**` 为 0755，其余 0644），由
  `scripts/cli/tests/release.test.mjs` 断言。
- **`where python3` 在 Windows 上会命中 Microsoft Store 的占位程序**（不执行 Python、直接退 9009），
  所以回退路径要真的跑一次 `-V` 探针再决定用 `python3` 还是 `python`。

补充实现细节（设计稿没写、落地时必须定的）：

- **分流只对 HTML 导航请求生效**（`Accept` 含 `text/html`）。真实静态文件与所有 API 路径不受影响 ——
  否则手机会拿不到 PC 的 js/css，或者把接口 404 变成 302。
- **重定向带 `Cache-Control: no-store` 与 `Vary: User-Agent, Cookie`**。同一个 URL 会按 UA/Cookie
  返回不同界面，302 又带 `Set-Cookie`，不加这两项可能被代理缓存后发给别的设备。
- **`?mobile=1` 一次 302 到位**，不会「写 Cookie → 再判一次」来回跳两轮。
- **移动端目录不存在时永远走 PC**，且 `/m/` 明确返回 404 而不是悄悄回落到 PC 的 index ——
  否则用户会在一个假 URL 下看到电脑版界面，完全摸不着头脑。
- **`/m` 301 到 `/m/`**，与静态服务器的常规行为一致。
- **`hidden` 返回真实改动行数**而不是请求的 id 数：请求里可能带着早就删掉的 id，把没发生的事
  算进去就是在虚报。

### 3.5 演员数据（决策 1）

`Video.Jav` 是 `gorm:"-"`，由 `hydrateLocationJavs()` 手工组装，而它只做了 `Find(&javs)`，**没有** `Preload("Idols")`，所以列表里 `video.jav.idols` 始终缺失。

```go
// internal/db/videos.go, hydrateLocationJavs()
common.DB.WithContext(ctx).Preload("Idols").Where("id IN ?", javIDs).Find(&javs)
```

影响：仅新增字段；PC 端只是多收到一个已忽略的字段；每页 25 部 × 约 2 位演员 ≈ 10–15 KB。

### 3.6 新增「从媒体库移除」接口

```
POST /videos/locations/hide
body: { "location_ids": [12, 34, 56] }
→ dbpkg.HideVideoLocationsByIDs(ctx, ids)   // 纯 DB 操作，不碰文件
→ 200 { "status": "ok", "hidden": 3 }
```

要点：

- **只设置 `VideoLocation.IsDelete = true`**，不调用任何文件系统 API
- 单条与批量共用（移动端多选批量走同一个接口）
- 错误响应遵循既有约定 `respondLocalizedError(c, status, zh, en)`
- 因为是新增路由而非扩展令牌接口，**不需要**登记进 `extensionTokenAPIs`
- 建议配 Go 测试：断言调用后文件仍存在于磁盘（`os.Stat` 成功）且 location 变为隐藏

---

## 4. 视觉规范

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `--bg` | `#eff1f4` | 页面底色 |
| `--card` | `#ffffff` | 卡片 |
| `--line` | `#e6e8ec` | 分隔线 / 卡片描边 |
| `--text` | `#18181b` | 主文字 |
| `--muted` | `#71717a` | 次要文字 |
| `--muted-2` | `#a1a1aa` | 元信息 |
| `--brand` | `#2563eb` | 主色（沿用 PC 的 blue-600） |
| `--tag` | `#fdba74` | 标签底色（沿用 PC 的 orange-300） |
| 圆角 | 卡片 12 / chips 999 / 抽屉 20 | |
| 字体 | `-apple-system, PingFang SC, Noto Sans SC, system-ui` | |

---

## 5. 交互规格

### 5.1 列表与手势

| 交互 | 行为 |
| --- | --- |
| 点卡片 | 直接播放（最高频动作，不额外加一次跳转） |
| 长按卡片（450ms） | 操作菜单：播放 / 截图 / 标签 / 收藏 / 多选 / 刮削 / 重命名文件 / 从媒体库移除 |
| 重命名文件 | 进入独立确认页（diff 预览 + 扩展名锁定 + 显式确认），仅单文件、无批量 |
| 下拉刷新 | 回到第 1 页并重新拉取 |
| 滚动到底 | 自动加载下一页（`IntersectionObserver`，提前 400px 触发） |
| 多选 | 底部升起批量操作栏（打标签 / 收藏 / 批量刮削 / 生成封面 / 移出媒体库） |
| 返回 | Android 物理返回键 = 关抽屉 → 退搜索 → 退多选 → 返回列表 |

### 5.2 三种卡片密度（默认大图）

| 密度 | 列数 | 标题 | 演员 | 标签 | 元信息 | 一屏 |
| --- | --- | --- | --- | --- | --- | --- |
| **大图（默认）** | 1 列 | **完整，不限行数** | **单行，超出淡出** | **单行，超出淡出** | 分辨率 · 体积 · 加入日期 · 播放次数 | 约 2 部 |
| 标准 | 2 列 | 最多 2 行 | — | 最多 2 个 | 分辨率 · 体积 | 约 7 部 |
| 紧凑 | 3 列 | 最多 2 行 | — | — | 分辨率 · 体积 | 约 12 部 |

- 演员行 / 标签行用 `mask-image: linear-gradient(to right, #000 84%, transparent)` 做右侧淡出，暗示还有内容但不换行
- 卡片高度稳定 → 滚动无跳动
- 三档共用同一次数据请求，切换密度零额外开销
- 密度记忆到 localStorage；横屏 / 折叠屏 ≥ 480px 自动升一档

### 5.3 状态持久化

- **URL**：`view` / `search` / `tags` / `sort` / `seed`（复用 PC 的 `urlState` 语义）
- **localStorage**：网格密度、搜索历史（最近 10 条）、上次播放位置

---

## 6. 接口复用

**允许的接口**（只读，或只写 DB / `data/`，或唯一的重命名）：

```
/auth/status, /auth/login, /auth/logout, /auth/password
/videos, /videos/{id}, /videos/{id}/thumbnail, /videos/{id}/streams, /videos/{id}/play(stats)
/videos/{id}/screenshots, /videos/tags/*, /videos/{id}/cover, /videos/{id}/jav-scrape/*
/videos/locations/hide                      ← 新增，DB-only
PATCH /videos/{id}/locations/{locationId}   ← 重命名，仅重命名确认页可调用（见 §0.4）
/tags, /tags/categories, /tags/category
/jav, /jav/filter-options, /jav/items/*, /jav/idols/*, /jav/studios/*, /jav/series/*
/jav/*-favorite-groups, /jav/tags/*
/directories, /directories/browse, /directories/{id}/scan
/storage/connections/*, /storage/browse
/downloader/settings, /downloader/clouddrive2/*, /downloads/*
/auth/extension-tokens/*, /config, /tools, /tools/ffmpeg/download
```

**封禁接口**见 §0.3。安全测试除了断言封禁路径不出现，还要断言 `renameVideoLocation` 只被 `RenamePage.jsx` 引用（避免将来在列表批量操作里误接）。

`web/src/utils/` 复制进 `web-mobile/src/utils/`（决策 5）：`i18n.js`、`errors.js`、`display.js`、`browserPlayback.js`、`playbackCapabilities.js`、`jav.js`。这几个文件都很小且稳定，复制后移动端工程完全自包含，可独立构建发布，也不会被 PC 端重构带崩。

---

## 7. 功能取舍

| 功能 | 手机端 | 说明 |
| --- | --- | --- |
| 视频列表 / 三档密度 / 无限滚动 | 完整 | 核心页面，默认大图 |
| 搜索（历史、高亮、防抖） | 完整 | 顶栏展开式 |
| 标签筛选 / 排序 | 完整 | chips + 底部抽屉 |
| 浏览器播放 / 续播 / 连播 | 完整 | 复用 `selectPlaybackSource`，direct→HLS 回退 |
| 标签 / 截图 / 封面 / 刮削 | 完整 | 只写数据库与 `data/` |
| 多选批量操作 | 完整 | 含「移出媒体库」（DB-only） |
| JAV 作品 / 女优 / 片商 / 系列 | 完整 | 浏览、详情、编辑、收藏夹、合并 |
| 目录管理 / 扫描 | 完整 | 增删改、启停、单目录扫描、自动扫描间隔、进度 |
| 标签 / JAV 标签 / 收藏夹管理 | 完整 | 增删改、分类、排序、合并 |
| 全局设置 | 完整 | 分页、排序、网格列数、标题行数、隐藏已刮削… |
| 下载器 / 存储连接 / 扩展令牌 / 工具 | 完整 | 纵向单列表单 |
| **删除视频文件** | 🚫 **永久禁止** | 见 §0 |
| **重命名视频文件** | ⚠️ 完整（带防护） | 独立确认页 + diff 预览 + 扩展名锁定；仅单文件、无批量（见设计稿 11） |
| **目录整理** | 🚫 **永久禁止** | 内部含 `os.Remove` / `os.Rename` 用户文件 |
| 从媒体库移除（文件保留） | 新增接口 | DB-only，且下次扫描会自动恢复 |
| **移除目录** | 完整（安全） | 后端没有 DELETE 路由；`PATCH {is_delete:true}` 只写数据库，视频文件与 `Video` 记录都保留 |
| **删除下载任务** | 完整（安全） | 只删任务记录，已下载到磁盘的视频原样保留；文案写「删除记录」而不是「删除文件」 |
| 瀑布流 / 网格列数 / 标题与标签行数 | 不提供，改为说明 | 移动端用顶部密度切换表达同一件事 |
| MPV 播放 | 移除 | 移动浏览器无法驱动桌面 mpv |
| Web 快捷键 / 播放器快捷键 | 移除 | 手机无物理键盘 |

> §7 里标注「完整」的项在 P2 全部落地，详见 §8 的实测结果表。

---

## 8. 实施顺序

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| **P0** | 工程骨架、`api.js` 安全白名单 + `api-safety.test.js`、顶栏 / chips / 三档密度卡片、无限滚动、搜索、筛选抽屉、浏览器播放 + 续播 | ✅ 已完成并端到端验证 |
| **P1** | 长按菜单、多选批量、标签编辑、截图页、刮削设置页、重命名确认页、JAV 列表与详情 | ✅ 已完成并端到端验证 |
| **P2** | 「我的」+ 14 个设置子页、页面栈与返回手势 | ✅ 已完成并端到端验证 |
| **P3** | 后端 UA/Cookie 分流、`/m/` 托管、`Preload("Idols")`、`/videos/locations/hide`、构建发布接入、Go 测试 | ✅ 已完成并端到端验证 |

> P0 第一步就是写 `api.js` 白名单和 `api-safety.test.js`，确保封禁接口从第一天起就不可能被引入。

### P3 实测结果

分三层验证，一共 63 项断言全绿（21 项真后端 HTTP + 21 项真后端浏览器 + 21 项 Go 单测新增断言）。

**Go 测试（`go test ./...`）**

| 验证项 | 结果 |
| --- | --- |
| 从媒体库移除 | 文件仍在磁盘上、内容未变、媒体目录里没有多出/少掉文件；`VideoLocation.IsDelete` 变 true；`Video` 行保留；列表里消失 |
| 批量与未知 id | 重复 id 去重、不存在的 id **不计入** `hidden` |
| 非法入参 | 空数组 / 缺字段 / 0 / 负数 / 非法 JSON 一律 400，且文件仍然完好 |
| UA 分流 | iPhone / iPad / Android / Windows Phone / BlackBerry / Opera Mini / IEMobile / Mobile 全部 302 → `/m/`；桌面 UA、空 UA、curl 走 PC |
| Cookie 覆盖 | 手机 + `desktop` cookie 留在 PC；桌面 + `mobile` cookie 跳 `/m/`；PC 的 SPA 回落路径也会按手机 UA 跳 |
| 手动互切 | `?desktop=1` 直接给 PC 并写 cookie；`?mobile=1` 一次 302 到 `/m/` 并写 cookie；切换参数被剥掉而其余 query 保留 |
| `/m/` 托管 | `/m` 301；`/m/` 返回**移动端** index（不是 PC 的）；`/m/assets` 真实资源；未知路径回落移动端 index；未知资源 JSON 404 |
| 没装移动端 | 永远走 PC，且 `/m/` 返回 404 而不是偷偷给 PC 的 index |
| 分流不越界 | 手机请求 PC 真实静态资源仍拿到文件；受保护 API 返回 401 JSON 而不是跳转；`/healthz` 不受影响 |
| 路径逃逸 | `..` 穿越在任意平台都必须挡住（符号链接逃逸在无权限的 Windows 上会明确 skip 而不是误报失败） |
| 演员数据 | `jav.idols` 被正确 preload；**把 `Preload("Idols")` 去掉，这条测试立刻失败**（做过证伪） |

**真后端 HTTP（新代码编译出的独立实例，`--port 17661`，全新数据库）**

21/21：UA 分流 3 项、Cookie 覆盖 2 项、手动互切 3 项、`/m/` 托管 5 项、不越界 3 项、
「从媒体库移除」5 项（登录 / 未知 id / 空数组 / 负数 / 未登录）。

**真后端 + 真浏览器（iPhone UA 打开 `/`）**

| 验证项 | 结果 |
| --- | --- |
| 自动切换 | 打开根路径 `/`，最终落在 `/m/` 的移动端登录页 |
| 登录 | 默认口令 `admin` 登录成功 |
| 空库真实响应 | 真实 `GET /config` 只有 8 个派生键 + 扫描器标记键，**没有任何用户设置项**；全局设置页仍正确回落到前端默认值 25 |
| 14 个设置页 | 全部在真实接口下正常渲染，无错误态 |
| 写入往返 | 真实 `PATCH /config` 接受了 number 类型并持久化（+5） |
| 运行时 | 整轮没有未捕获异常 |

这一层专门用来推翻「mock 与真实响应形状不一致」的风险 —— 前面 P2 的 mock 是我按 Go 源码手写的，
只有打真接口才能确认空 `config`、空目录列表这些边界不会让页面炸掉。

### P3 落地时对设计稿的偏离

1. **分流只对 HTML 导航请求生效**（设计稿只写了「只对 `Accept: text/html` 的导航请求生效」，
   落地时把它实现成了硬前置条件）。真实静态文件在所有情况下都优先返回 —— 手机请求 PC 的
   `assets/*.js` 不该被 302 掉。
2. **`NewRouter` 的签名变了**：`NewRouter(staticDir, mobileStaticDir, auth)`。14 个测试调用点
   一并更新；两个目录都可以为空，为空时对应界面不提供。
3. **`HideVideoLocationsByIDs` 改为返回 `(int64, error)`** 以便如实报告 `hidden`，6 个调用点随之更新。
4. **全局刮削页改名 `ScrapeOverviewPage.jsx`**（P2 遗留的同名冲突）。

### P3 期间修掉的问题

- **`TestFrontendStaticFileCannotEscapeStaticDirectory` 在 Windows 上必失败**：它用 `os.Symlink`
   造逃逸场景，而 Windows 普通用户没有 `SeCreateSymbolicLinkPrivilege`，拿到的是
   `ERROR_PRIVILEGE_NOT_HELD`（**不等于** `os.ErrPermission`，所以按 errno 判断也挡不住）。
   已拆成两个子测试：`..` 穿越在任何平台都跑；符号链接逃逸在 Windows 明确 `t.Skip` 并说明原因，
   而不是留一个永远红的测试。
- **15 个 Go 文件被写成了 CRLF**：仓库里的 Go 文件是 LF，`gofmt -l` 会把 CRLF 文件整份报成
  「未格式化」（它统一输出 LF）。已把改动过的文件全部恢复为 LF，`gofmt -l` 重新为 0 项。
- **验证脚本踩到 Windows PowerShell 5.1 的两个坑**：没有 `-SkipHttpErrorCheck`（无法拿到 302 而
  不跟随），而且会把 UTF-8 中文按 ANSI 代码页解码 —— 一个中文 3 字节序列解码后可能留下一个
  悬空的字节，把紧跟其后的引号「吃掉」，于是整个脚本语法崩掉。改成用 Node 的 `fetch`
  （`redirect: 'manual'`）后一次通过。
- **`hidden` 一开始返回的是请求的 id 数**：请求里带一个早就删掉的 id 也会被算成「已移除」。
  已改为返回数据库真实改动的行数。

### P2 实测结果

用 headless Chrome + CDP（`Emulation.setDeviceMetricsOverride` 设 390×844，不用
`--window-size` —— 后者有最小宽度会被静默裁切）+ **严格校验 JSON 类型**的 mock 后端逐项断言，
52/52 通过：

| 验证项 | 结果 |
| --- | --- |
| 「我的」结构 | 4 组、恰好 14 个入口；概览卡 7 视频 / 5 JAV / 2 目录（软删除目录被过滤掉） |
| 14 个入口逐个 | 全部进入正确页面、无错误态、返回后仍在「我的」 |
| 全局设置 payload | 只提交改动过的 3 个键；`video_page_size` 是 `number`、`video_hide_jav` 是 `boolean`、`initial_view_mode` 是 `string` |
| 分类排序 | 提交完整数组且**包含哨兵 0**：`[0,3,2]` |
| 收藏夹排序 | 提交穷举数组且**不含哨兵**：`{group_ids:[3,2]}` |
| 目录管理 | 3 条数据只渲染 2 条（软删除被过滤）；WebDAV 行显示连接名 + 远程路径；开关只提交 `{enabled:false}` |
| 空分类可见 | 新建后没有标签的分类仍然渲染，并提示「用调整分类把标签移进来」 |
| 播放设置 | 续播开关写入 `localStorage`，关掉后读回 `false` |
| 物理返回键 | 收藏夹详情 → 收藏夹管理 → 「我的」→ 视频列表，**逐层退出** |
| 配置真的生效 | `initial_view_mode=jav` 重载后直接进 JAV 模式；`video_page_size=30` 后列表按 `limit=30` 请求 |
| 既有流程未回归 | JAV 作品卡 → 详情页 → 物理返回回到列表 |
| 布局 | 首屏与设置页 `scrollWidth === 390`，无横向溢出 |
| 安全测试 | 16/16 通过（新增 `progress.test.js` 6 项） |

### P2 落地时对设计稿的偏离

1. **入口分组改成 5 / 3 / 4 / 2**。设计稿是 4 / 3 / 3 / 4。把「扫描任务」从目录管理里拆成独立入口、
   把「关于」从「工具与日志」里拆出来，凑成设计文档 §2 里的 14 个子页；「修改密码 / 切换到电脑版 /
   退出登录」收进「账号与安全」一个入口，因为它们都是账号操作，分散在三行反而不好找。
2. **设置区是页面栈的一层，不是独立浮层**。设计稿写的是浮层 + 子页推入。落地改成「「我的」本身也是
   `pages` 里的一层」，全栈只有一个返回键处理器。原因是内外两层浮层各自压一条历史记录时，
   内层关闭的 `history.back()` 会把外层一起弹掉（详见 §8 回归记录）。
3. **设置子页全部 `lazy()` 分包**。设计稿没写。不分包首屏会多出约 150 KB，而首屏是视频列表。
4. **排序从拖拽改成上移 / 下移按钮**，且图标用单向箭头 —— 双向的「sort」图标旋转 180° 后外形几乎
   一样，用户分不出哪个是上移。

### P2 期间修掉的问题

- **从任意子页返回，整个设置区直接消失**（验证脚本发现）：App 同时注册了「页面栈」和「设置区」
  两个 `useOverlayBack`。内层页面关闭时的 `history.back()` 落在外层的记录上，于是外层浮层的
  `popstate` 处理器也被触发。已改为把设置区并入页面栈，全栈只用一个返回键处理器。
- **修正过程中引入的新 bug：点子页面的入口没反应**。把栈深度直接交给 `useOverlayBack` 后，
  它的清理逻辑在新监听器挂上**之后**才派发 `popstate`，刚压入的页面立刻被弹掉。
  已新增 `hooks/useStackBack.js`：自己记「压了几条历史记录」，并用 `ignoreRef` 吞掉自己触发的
  `popstate`。两个坑都写进了代码注释，并有专门的回归断言。
- **没有标签的分类会整个消失**（验证脚本发现）：标签页按「只渲染有标签的分类」过滤，
  于是刚建好的空分类既看不见、也没法改名 / 排序 / 删除。已改成不搜索时保留空分类并给出提示；
  搜索时才隐藏空分类。
- **上移 / 下移图标分不出来**（截图发现）：原来是把双向的 `sort` 图标旋转 180° 当上移，
  两者外形几乎一致。已新增单向的 `arrowUp` / `arrowDown`。
- **「我的」概览卡的版本号永远是空的**：读的是 `config.version`，但后端 `GET /config` 里
  根本没有 version 字段（「关于」页研究时已确认）。已改为显示移动端包版本
  （从 `package.json` 读），并且不在「关于」页编造服务端版本号。
- **设置子页文件名冲突**：全局刮削页与单视频刮削页同名 `ScrapeSettingsPage.jsx`，
  已在 import 前就改名成 `ScrapeOverviewPage.jsx`。

### P1 实测结果

| 验证项 | 结果 |
| --- | --- |
| 长按菜单 | 播放 / 截图 / 标签 / 多选 / 刮削 / 重命名 + 置灰的「删除文件（移动端已禁用）」 |
| 多选 | 顶栏「已选 N 项 / 全选」，卡片打勾，底部批量栏 |
| 标签编辑 | 单视频预勾选现有标签；批量支持追加 / 移除 / 替换 |
| 重命名确认页 | 未改动时按钮禁用；改动后启用；扩展名锁定；重名本地拦截 |
| 截图页 | 时间轴 + 生成；封面徽标；设为封面 / 删除 |
| 刮削设置 | 自动（按文件名 / 指定番号）/ 手动 / 不刮削；番号提取测试 |
| JAV | 作品 2 列、女优 3 列（右侧 47% 竖版裁切，与 PC 一致）、片商 / 系列列表、详情页含库内文件 |
| JAV 功能栏 | 排序 / 随机 / 密度（大图·标准·紧凑）/ 标签 / 收藏夹 / 筛选，吸顶常显（与视频模式同位置） |
| JAV 大图模式 | 作品单列，标题完整 + 元信息 chips + 演员行 + 标签行；女优 2 列（实测单列宽 370px） |
| JAV 分类行 | 吸顶但下滑隐藏、上滑恢复（实测：scrollY 900 时收起，回到 680 时恢复；功能栏始终在 top 58） |
| 跳转到对应影片 | 片商 / 系列行、作品详情的演员与片商系列、女优详情的「查看影片」→ 均切到作品 tab 并套用筛选（实测：点 BRAVO → 只剩 4 部 BR-*；点女优 1 → 只剩 3 部） |
| 安全测试 | 10/10 通过（新增：受控重命名唯一性、`renameVideoLocation` 仅被 RenamePage 引用、`requestOK` 也必须被扫描） |

### P1 落地时对设计稿的偏离

1. **长按菜单改成底部抽屉**。设计稿画的是跟随手指的深色浮层菜单。落地选底部抽屉：拇指可达性更好、长文案不会溢出屏幕、与 App 其它抽屉风格统一。菜单**内容**与安全标记完全按设计稿实现。
2. **女优封面裁切**。PC 的 `JavIdolGrid` 只显示封面右侧 47%（`IDOL_COVER_VISIBLE_RATIO = 0.47`，纵横比 376:538），移动端对齐了这个行为，而不是简单居中裁成 3:4。

### P1 期间修掉的问题

- **JAV 缺少功能栏 / 分类行不可收起**（用户反馈）：JAV 初版只有一条分类行，没有排序·随机·密度·筛选，
  现在补齐了 `JavQuickChips`（吸顶常显），并把分类行改成 `useHideOnScroll` 驱动的下滑隐藏 / 上滑恢复。
- **JAV 排序方向文案错误**：初版把方向按钮文案做了「通用化」改写，导致「加入时间」的降序显示成
  毫无意义的「大→小」。已改为直接用每个排序项自己的 `asc` / `desc` 描述（近→远 / 远→近）。
- **JAV 模式是个死胡同**（用户反馈）：初版把整个外壳交给了 `JavListPage`，它自带搜索框和子分类，
  结果顶栏（含 视频/JAV 分段、设置入口）被整个替换掉，进 JAV 后既回不去视频、也进不了设置。
  已改为**两个模式共用同一套外壳**：顶栏常驻，第二行在视频模式是快捷 chips、在 JAV 模式是功能栏，
  第三行（仅 JAV）是可收起的分类行，搜索统一走顶栏的放大镜。
- **女优封面裁切根本没生效**（用户反馈）：代码写的是「只显示源图最右侧 47%」，
  但 Tailwind preflight 给所有 `img` 设了 `max-width: 100%`，把 `width: 213%` 静默压回 100%，
  实际退化成**居中裁切**。已在该 img 上显式 `maxWidth: 'none'`，并用左右分色的对照封面实测确认
  （img/容器宽度比 2.128、右对齐；画面只剩源图右侧那一段）。
  女优**详情页**此前用的是整张横版封面，现在与列表共用 `IdolCover.jsx`，裁切方式不会再跑偏。
- **卡片点击只绑了 pointer 事件**：程序化点击 / 读屏激活不会触发。已补 `onClick`（`event.detail === 0` 时兜底），避免同一次触摸被处理两次。
- **JAV 女优封面裁切错误**：初版用 3:4 居中裁切，会把 800×538 的横版封面裁掉大半；已改为与 PC 一致的右侧 47%（详见上方 regression 记录）。

### P0 实测结果（用 mock API 端到端验证）

| 验证项 | 结果 |
| --- | --- |
| 三档密度 | 大图 1 列（默认，标题完整 + 演员行 + 标签行）、标准 2 列、紧凑 3 列均正常 |
| 卡片角标 | 番号 / 播放次数 / 时长三处角标位置正确（实测 368×207，标准 16:9） |
| 无限滚动 | 16 条 fixture 全部加载，底部显示「已到底部 · 共 N 部」 |
| 搜索 | 顶栏原地变形为输入框，300ms 防抖实时生效，结果就在下方同一个列表里 |
| 筛选抽屉 | 排序 / 方向 / 标签多选 / 隐藏已刮削；「共 16 部」与「查看 16 个结果」实时回显 |
| 布局 | `document.scrollWidth === 390`，无横向溢出 |
| 安全测试 | 8/8 通过 |

### P0 遗留（已全部收口）

- 演员行需要后端 `Preload("Idols")` 才能显示。✅ P3 已加，并有 Go 测试锁定。
- ~~JAV 页签与设置入口是占位页。~~ → JAV 在 P1 落地，设置在 P2 落地。
- `hideVideoLocations()` 已封装。✅ 后端接口在 P3 落地（`POST /videos/locations/hide`）。
- 播放器整包引入 video.js，产物约 900 KB（gzip 269 KB），后续可动态加载。
  → P2 把 15 个设置页拆成分包后，首屏 1000 KB（gzip 295 KB），video.js 仍是主要部分。


---

## 9. 待确认

1. **「从媒体库移除」的接口命名与形态**：当前设计是 `POST /videos/locations/hide` + `{location_ids: []}`。✅ 已按此形态在 P3 落地。
2. **P0 是否先不接后端切换**：P0 期间可以先用 `web-mobile` 的 dev server（5174 端口）独立调试，等 P3 再接 UA 分流。✅ 已按此执行，P3 完成。
3. **重命名是否要支持批量**：当前设计**刻意不支持** —— 批量重命名是要改一堆真实文件的危险操作，一端出错影响面大。如果你确实需要，我建议放到 PC 端。
4. **「桌面端专属」项是否接受只做说明**：移动端把瀑布流、网格列数、标题 / 标签最多行数、MPV 窗口与快捷键等列在「全局设置 → 桌面端专属」里说明并指向电脑网页版，而不是硬塞一组在手机上无效的开关。如果你希望其中某几项也真的生效（例如标题行数），可以单独提出来调整。
5. **发布包是否要带移动端**：P3 已把 `web-mobile/dist` 一起打进 release 与 Docker 镜像。如果你希望移动端作为可选的独立产物（比如只发布 PC 版），可以用 `SKIP_MOBILE_WEB_BUILD=1` 跳过构建 —— 此时后端会自动只提供 PC 界面。

> 已确认项见文首表格。重命名文件按你的要求保留，并做成带完整预览的独立确认页。
