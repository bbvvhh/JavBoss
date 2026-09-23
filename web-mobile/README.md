# JavBoss 移动端

手机端独立工程（Vite + React + Tailwind）。与 PC 端 `web/` 完全解耦，**不修改 `web/` 下任何文件**。

设计与交互规格见 [`design/DESIGN.md`](design/DESIGN.md)，可视化设计稿见
[`design/mobile-ui-mockup.html`](design/mobile-ui-mockup.html)（浏览器直接打开）。

---

## ⚠️ 安全红线（改代码前必读）

> **任何时候不允许删除视频文件。**

`web-mobile` 只允许三类请求：

1. 只读请求（GET）
2. 只写数据库的请求（标签、收藏、刮削元数据、从媒体库移除）
3. 只写 JavBoss 自有 `data/` 目录的请求（缩略图、截图、封面）

**永久封禁**（会让用户丢文件）：

| 接口 | 后果 |
| --- | --- |
| `DELETE /videos/:id/locations/:locationId` | Windows 进回收站，**Linux/macOS 上是 `os.Remove` 永久删除** |
| `POST /directories/:id/process` | 目录整理，内部含 `os.Remove` / `os.Rename` 用户文件 |
| `POST /videos/open`、`POST /videos/reveal` | 桌面端能力，移动端无意义 |
| `POST /downloads/:id/reveal` | 桌面端能力；局域网访问时后端本来就返回 403 |

**唯一允许触碰用户媒体目录的是「重命名文件」**（`PATCH /videos/:id/locations/:locationId`），它只能在重命名确认页调用，且必须经过 diff 预览 + 显式确认（P1 实现）。

约束由 `tests/api-safety.test.js` 机械保证：它会扫描 `src/api.js` 里所有
`request('<METHOD>', '<path>')` 调用，并断言整个 `src/` 不出现封禁路径、也不绕过
`api.js` 直接 `fetch()`。**新增接口必须走 `request()` / `requestJSON()` / `requestOK()`，否则测试扫不到。**

### 容易误判为「删除」的安全接口

| 接口 | 实际行为（已核实 Go 源码） |
| --- | --- |
| `PATCH /directories/:id {is_delete:true}` | **不是 DELETE 路由**，handler 里只有一次 `tx.Save`，不碰文件系统；目录下的视频与 `Video` 记录都保留，重新添加同一路径即可恢复 |
| `POST /videos/locations/hide` | **移动端专用的「从媒体库移除」**：只把 `VideoLocation.IsDelete` 置 true，没有任何文件系统调用；下次扫描发现同一文件会恢复它 |
| `DELETE /downloads/:id` | 只删 `download_job` 一行；已下载到磁盘的视频原样保留。所以文案必须写「删除记录」 |
| `POST /downloads/:id/cancel` | 只改状态 + cancel 内存里的 context；**不会**删除文件，但可能留下未完成的 `.part` |
| `DELETE /videos/:id/screenshots/:name` | 只删 `<dataDir>/video/<id>/screenshot/` 下形如 `mpv_*.<jpg\|png>` 的截图 |
| `DELETE /auth/extension-tokens/:id` | 只删令牌行 |

`POST /downloads` 会往「下载目录」里写文件，但那是用户自己指定的下载动作，不是清理操作。

---

## 开发

> ⚠️ 前端工程在 `web-mobile/`，**不是仓库根目录**。仓库根目录没有 `package.json`，
> 在根目录执行 `npm install` 会报 `ENOENT: open '...\JavBoss-main\package.json'`。

### 方式一：直接用 npm（推荐，跨平台）

```bash
# 1) 安装依赖（只需一次）
cd web-mobile
npm install

# 2) 启动移动端 dev server（保持这个终端不关）
cd web-mobile
npm run dev          # http://localhost:5174/m/   ← base 是 /m/，别漏掉 /m/

# 3) 另开一个终端，启动后端（移动端 dev 通过 vite 代理访问它）
#    本机没有系统 Go、也没有 C 编译器，而 go-sqlite3 需要 CGO，
#    所以用仓库自带的 .tools 环境（已配好 GOROOT / GCC / goproxy.cn）：
& D:\bv\javboss\JavBoss-main\.tools\run-javboss.ps1
```

启动后监听 `127.0.0.1:17654`，浏览器打开 `http://localhost:5174/m/`，
默认密码 `admin`（与 PC 端共用同一套 cookie 会话）。

需要跑任意 go 命令时，先 dot-source 环境：

```powershell
. D:\bv\javboss\JavBoss-main\.tools\goenv.ps1
go test ./...
go build ./...
```

> 若 `.tools/` 不存在，说明是干净机器：装好 Go + C 编译器（Windows 用 w64devkit）
> 后直接 `go run ./cmd/server` 即可；国内网络建议设
> `GOPROXY=https://goproxy.cn,direct`，否则 `proxy.golang.org` 会超时。

### 方式二：用仓库 CLI（会顺带装依赖）

```bash
node scripts/cli/cli.mjs dev mobile        # 只启移动端 → 5174/m/
node scripts/cli/cli.mjs dev mobile-both   # 后端 + 移动端一起启（推荐）
node scripts/cli/cli.mjs dev               # 交互式菜单
```

Windows 上请用上面的 `node scripts/cli/cli.mjs` 形式；`scripts/cli.sh` 是 bash 脚本，
需要 Git Bash / WSL 才能跑。

### 命令速查

```bash
cd web-mobile
npm run test          # node --test tests/*.test.js（含安全护栏测试）
npm run lint
npm run format:check
npm run build         # 产物 dist/，由 Go 后端挂在 /m/ 下
```

`vite.config.js` 把 `/videos`、`/auth`、`/tags`、`/config` 等前缀代理到
`http://localhost:17654`（与 PC 端一致的列表）。**不启后端的话，页面会停在登录页并提示连接失败。**

> 生产环境下 `dist/` 由 Go 后端托管在 `/m/`，与 dev 的 base 保持一致。

---

## 目录结构

```
src/
├── api.js                # ⚠️ 白名单：所有网络请求的唯一入口
├── store.js              # zustand 扁平 store（含页面栈 pages）
├── App.jsx               # 页面编排（顶栏 / 搜索 / 抽屉 / 播放器 / 页面栈）
├── auth.jsx              # cookie 认证 Provider
├── components/
│   ├── TopBar.jsx        # logo + 视频/JAV 分段 + 布局（密度）+ 搜索 + 设置
│   ├── QuickChips.jsx    # 视频功能栏：排序 / 随机 / 标签 / 筛选
│   ├── VideoCard.jsx     # 三种密度排版（大图 / 标准 / 紧凑）
│   ├── VideoGrid.jsx     # 骨架屏 + 无限滚动哨兵
│   ├── SearchPanel.jsx   # SearchBar（顶栏变形）+ SearchHints
│   ├── FilterSheet.jsx   # 底部筛选抽屉（含实时命中数）
│   ├── DensitySheet.jsx  # 密度切换
│   ├── BottomSheet.jsx   # 抽屉基座
│   ├── ConfirmDialog.jsx # 破坏性操作确认（危险项需勾选确认）
│   ├── PlayerPage.jsx    # 浏览器播放（video.js）+ 续播
│   ├── form/             # 表单原语：Field / Switch / Stepper / Segmented / TextField / PickerField / PromptSheet
│   ├── settings/         # 「我的」+ 15 个设置子页（registry.jsx 是注册表）
│   └── LoginPage.jsx / Icons.jsx / Toast.jsx
├── hooks/                # useInfiniteScroll / useLongPress / useOverlayBack / useStackBack / useHideOnScroll / useAsyncData
├── utils/                # i18n / errors / display / browserPlayback / density / format / progress / config / javDisplay
└── constants/            # video.js（排序）/ jav.js（排序·密度）/ app.js（版本）
```

`utils/i18n.js`、`errors.js`、`display.js`、`browserPlayback.js` 是从 `web/src/utils/`
**复制**而来的纯函数（决策：移动端工程自包含，避免跨工程耦合）。改动这些文件时请留意与 PC
端的差异。

---

## 进度

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| **P0** | 工程骨架、`api.js` 安全白名单 + 安全测试、三档密度列表、无限滚动、搜索、筛选抽屉、浏览器播放、续播 | ✅ 完成 |
| **P1** | 长按菜单、多选批量、标签编辑、截图页、刮削设置页、重命名确认页、JAV 列表与详情 | ✅ 完成 |
| **P2** | 「我的」+ 14 个设置子页、页面栈与逐层返回 | ✅ 完成 |
| **P3** | 后端 UA/Cookie 分流、`/m/` 托管、`Preload("Idols")`、`/videos/locations/hide`、构建发布接入、Go 测试 | ✅ 完成 |

---

## P3：手机上怎么用

后端会在**服务端**判断该给哪套界面，前端零判断，`web/` 一行没改。

### 判定优先级

```
1. Cookie  javboss_ui=desktop   → 永远走 PC（显式选择，1 年有效）
2. Cookie  javboss_ui=mobile    → 永远走 /m/
3. URL     ?desktop=1 / ?mobile=1 → 写入对应 Cookie 并跳转
4. UA      Android|iPhone|iPad|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile|Mobile
                                → 走 /m/     ← iPad 按决策归移动端
5. 其它（桌面浏览器）            → 走 PC
```

UA 正则只用来「猜」，Cookie 才是最终裁决 —— 猜错了两边都能自救：

| 想切换 | 怎么做 |
| --- | --- |
| 手机 → 电脑版 | 「我的 → 账号与安全 → 切换到电脑版」 |
| 电脑 → 手机版 | 访问 `/?mobile=1` |
| 想反悔 | 在浏览器里删掉 `javboss_ui` Cookie，或走另一个方向的入口 |

### 路由与静态托管

| 路径 | 行为 |
| --- | --- |
| `/m/*` | 托管 `web-mobile/dist`，未知路径 SPA 回落到移动端 `index.html` |
| `/m` | 301 → `/m/` |
| `/` 与其它 HTML 导航 | 按上表判定；判定为移动端时 302 → `/m/` |
| 真实静态资源 / API | **不参与判定**，永远原样返回 |

最后一条是硬前置条件：分流只对 `Accept` 含 `text/html` 的导航请求生效。手机请求 PC 的
`assets/*.js` 不该被 302 掉，受保护的 API 也必须是 401 JSON 而不是跳转。

重定向带 `Cache-Control: no-store` 与 `Vary: User-Agent, Cookie` —— 同一个 URL 会按 UA/Cookie
返回不同界面，302 又带 `Set-Cookie`，不加这两项可能被代理缓存后发给别的设备。

**没装移动端时**（`web-mobile/dist` 不存在）永远走 PC，且 `/m/` 明确返回 404，而不是悄悄回落到
PC 的 `index.html` —— 否则用户会在一个假 URL 下看到电脑版界面。

### 发布 / 打包

移动端产物会跟 PC 产物一起进 release 与 Docker 镜像：

| 产物 | 位置 |
| --- | --- |
| release 包 | `release/<name>/web/dist` 与 `release/<name>/web-mobile/dist` |
| Docker 镜像 | `/app/web/dist` 与 `/app/web-mobile/dist` |
| proot 包（Android/Termux + proot） | `web/` 与 `web-mobile/` 两个 dist 都在包内；这一端手机浏览器打开根路径会直接进手机版 |

```bash
node scripts/cli/cli.mjs release linux-x86_64 v0.1.0   # 两端前端都会构建
SKIP_MOBILE_WEB_BUILD=1 node scripts/cli/cli.mjs release ...   # 只发 PC 版
bash scripts/build-proot-arm64.sh v0.1.0                       # proot 包（需在 x86_64 Linux/WSL2 里跑）
```

后端按可执行文件所在目录解析这两个路径，所以移动端不存在时不会报错，只是不提供 `/m/`。

> 打包 zip 需要 `zip` 命令；没有时会自动回退到 Python，并显式写入 unix 权限位
> （发布目录若在 NTFS/DrvFs 上，`chmod` 无效，只有显式权限位才能保证解压后
> `javboss` 与 `internal/bin/*` 仍是可执行的）。

### 从媒体库移除（`POST /videos/locations/hide`）

移动端多选批量走这个接口。**它只把 `VideoLocation.IsDelete` 置为 true，不调用任何文件系统 API**：

```
POST /videos/locations/hide
{ "location_ids": [12, 34, 56] }
→ 200 { "status": "ok", "hidden": 2 }   // 真实改动行数；不存在的 id 不计入
```

因为下一次扫描发现同一个文件时会把 `IsDelete` 重置，所以「移除」是可逆的。这也是它和
`DELETE /videos/:id/locations/:id` 的本质区别 —— 后者在 Linux/macOS 上是 `os.Remove`，会真的删文件。

---

## P2：设置区

首屏**完全不出现设置项**，唯一入口是顶栏右上角的齿轮。齿轮推入「我的」页面
（页面栈的一层，不是独立浮层），四组共 15 个入口：

| 组 | 入口 | 页面 |
| --- | --- | --- |
| 媒体库 | 目录管理 | 增删改、启停、自动扫描间隔、单目录扫描、实时进度、服务端目录浏览器 |
| 媒体库 | 扫描任务 | 全部 / 单个目录扫描、进度与耗时、上次扫描摘要 |
| 媒体库 | 视频标签与分类 | 标签与分类 CRUD、移动分类、上移 / 下移排序、多选批量 |
| 媒体库 | JAV 标签 | 同上；刮削标签只读，另有「整理分类」（读 JavBus） |
| 媒体库 | 收藏夹管理 | 作品 / 女优 / 片商 / 系列四类；分组 CRUD、排序、条目管理与人手排序 |
| 播放与刮削 | 播放设置 | 本机续播开关、清空观看记录；并说明 MPV 相关项为桌面端专属 |
| 播放与刮削 | 刮削设置 | 刮削进度汇总、各目录自动刮削开关、封面缺失自动补下、JAV 标签分类整理 |
| 播放与刮削 | 字幕 | 在线字幕接口地址（默认迅雷）、接口测试、一键下载所有 JAV 视频字幕与进度 |
| 播放与刮削 | 下载器与任务 | 基本设置、CloudDrive2（含连接测试）、任务列表（轮询 / 重试 / 取消 / 删除记录 / 新建） |
| 系统与集成 | 全局设置 | 分页 / 排序 / 初始页面 / JAV 显示 / 网络，并列出桌面端专属项 |
| 系统与集成 | 存储连接 | WebDAV 连接 CRUD + 连接测试（密码不回传，留空保持不变） |
| 系统与集成 | 扩展令牌 | 明文查看 / 复制 / 新建 / 重新生成 / 删除 |
| 系统与集成 | 工具与日志 | FFmpeg 状态与下载进度；说明日志只能在服务端查看 |
| 账号与关于 | 账号与安全 | 修改密码、切换到电脑版、退出登录 |
| 账号与关于 | 关于 JavBoss | 移动端版本、服务端运行环境、安全边界说明 |

### 与 PC 端的差异（都是因为手机没有鼠标 / 键盘）

| PC 端做法 | 移动端做法 | 原因 |
| --- | --- | --- |
| 标签的改名 / 删除按钮只在 `hover` 时出现 | 点标签弹底部抽屉，动作全部显式列出 | 触摸设备没有 hover，PC 的按钮在手机上等于不存在 |
| `SortableList` 拖拽排序 | 「上移 / 下移」按钮（单向箭头图标） | 拖拽手柄在手机上很难精确命中；两者提交的都是**同一种完整有序 id 数组** |
| `window.confirm` / `window.prompt` | `ConfirmDialog` / `PromptSheet` | 部分移动浏览器屏蔽 prompt，且无法做校验提示 |
| 全局设置是一个大弹窗 | 分节的长页面 + 底部保存栏 | 弹窗在 390px 宽度下会变成两层滚动 |
| 目录整理 / 删除文件 / 在文件管理器里定位 / Web 快捷键 / MPV 设置 | **不提供入口**，并在对应页面明确说明 | 危险或桌面端专属 |
| 瀑布流、网格列数、标题 / 标签最多行数 | 列在「桌面端专属」里说明 | 移动端用顶部密度切换表达同一件事，数值搬过来只会互相打架 |

### 排序 / 顺序数组的两个坑（已按后端语义实现并验证）

- **标签分类顺序必须包含哨兵 `0`**（后端虚拟出来的「默认分类」，没有数据库行），
  数组长度必须等于「数据库里的分类数 + 1」，否则整单 400。
- **收藏夹顺序相反**：不能带哨兵，且必须穷举该类型的全部收藏夹；`sort_order` 是 1 起。
- 分类顺序数组里的 `sort_order` 取**数组下标**，所以 `[3, 0, 5]` 表示分类 3 → 0、分类 5 → 2。

### 全局设置的字段语义（`PATCH /config`）

- **部分更新**：只写请求体里出现的键，`web-mobile/src/App.jsx` 只提交真正改动过的项。
- **请求体是强类型的**：整数键发 `number`、布尔键发真正的 `boolean`。发字符串会**整单 400**，
  一个键都写不进去。
- **响应永远是 `map[string]string`**：所有值都是字符串（`"true"` / `"25"`），
  而且**服务端不给默认值**。读取一律走 `utils/config.js` 的 `configFlag` / `configInt` /
  `configString`，缺省值由前端自带（与 PC 端一致）。
- 真正接进移动端界面的键：`initial_view_mode`、`video_page_size`、`video_sort`、
  `video_hide_jav`、`jav_page_size`、`jav_sort`、`idol_sort`、`idol/studio/series_page_size`、
  `jav_hide_idols`、`jav_hide_tags`、`jav_hide_series`、`jav_idol_prefer_chinese_name`、
  `jav_tag_show_simplified`、`jav_cover_redownload_on_missing`、`allow_lan_access`、
  `proxy_host`、`proxy_port`。
- `allow_lan_access` **需要重启 JavBoss** 才生效（后端只在启动时读它），界面上有标注。

### 页面栈与返回

页面栈是 store 里的 `pages` 数组，只渲染栈顶。返回键由 `hooks/useStackBack.js` 处理：
它按**栈深度**补压历史记录，并用 `ignoreRef` 吞掉自己为了收缩历史而触发的 `popstate`。

> 这里踩过两个坑，都是「看起来能用其实不能用」，已在代码注释里写明：
> 1. 不能给每个子页单独注册一个 `useOverlayBack` —— 内层关闭时的 `history.back()` 会把外层
>    的记录一起弹掉，表现是「从任意子页返回，设置区直接消失」。
> 2. 不能把栈深度直接丢给 `useOverlayBack` —— 它的 `history.back()` 会在**新**监听器挂上之后
>    才派发 `popstate`，于是刚压入的页面立刻被弹掉，表现是「点子页面的入口没反应」。

### P2 实测结果（52/52 通过）

用 headless Chrome + CDP（`Emulation.setDeviceMetricsOverride` 设 390×844，不用 `--window-size`，
后者有最小宽度会被静默裁切）+ 严格校验类型的 mock 后端逐项断言：

| 验证项 | 结果 |
| --- | --- |
| 「我的」结构 | 4 组、**恰好 14 个入口**；概览卡 7 视频 / 5 JAV / 2 目录（软删除目录被过滤） |
| 14 个入口逐个 | 全部进入正确页面、无错误态、返回后仍在「我的」 |
| 全局设置 | 只提交改动过的 3 个键；`video_page_size` 是 `number`、`video_hide_jav` 是 `boolean`、`initial_view_mode` 是 `string`；服务端已持久化 |
| 分类排序 | 提交完整数组且**包含哨兵 0**：`[0,3,2]` |
| 收藏夹排序 | 提交穷举数组且**不含哨兵**：`{group_ids:[3,2]}` 到 `/jav/idol-favorite-groups/order` |
| 目录管理 | 3 条数据只渲染 2 条（软删除被过滤）；WebDAV 行显示连接名 + 远程路径；开关只提交 `{enabled:false}` |
| 空分类可见 | 新建后没有标签的分类仍然渲染，并给出「用调整分类把标签移进来」的提示 |
| 播放设置 | 续播开关写入 `localStorage`，关掉后读回 `false` |
| 物理返回键 | 收藏夹详情 → 收藏夹管理 → 「我的」→ 视频列表，**逐层退出**（两个坑的回归测试） |
| 配置真的生效 | `initial_view_mode=jav` 重载后直接进 JAV 模式；`video_page_size=30` 后列表按 `limit=30` 请求 |
| 既有流程未回归 | JAV 作品卡 → 详情页 → 物理返回回到列表 |
| 布局 | 首屏与设置页 `scrollWidth === 390`，无横向溢出 |

### 产物

设置子页全部走 `lazy()` 动态分包：首屏包 **1000 KB（gzip 295 KB）**，其中绝大部分是 video.js；
15 个设置页各自 0.2–14 KB。若不分包，首屏会多出约 150 KB。

---

## 外壳结构（视频 / JAV 共用）

两个模式**共用同一套顶栏与功能栏**，所以随时可以互相切换，也随时能进设置：

| 位置 | 视频模式 | JAV 模式 |
| --- | --- | --- |
| 第 1 行 · 常显 | `JB` + `视频\|JAV` 分段 + 🧅 布局（密度）+ 🔍 搜索 + ⚙️ 设置 | 同左 |
| 第 2 行 · 常显吸顶 | `QuickChips`：排序 / 随机 / 标签 / 筛选 | **作品页** `JavQuickChips`：**筛选排序** / 随机 / **标签** / **收藏夹**<br>**女优页** `JavIdolQuickChips`：排序 / 资料筛选<br>**片商 / 系列页**：不渲染 |
| 第 3 行 · 吸顶但**下滑隐藏** | — | `JavTabs`：作品 / 女优 / 片商 / 系列 + 数量 |
| 内容 | `VideoGrid`（大图 1 列 / 标准 2 列 / 紧凑 3 列） | 作品 1·2·3 列、女优 2·3·4 列、片商·系列列表 |
| 搜索 | 共用顶栏放大镜 → `SearchBar` | 同左（搜索词走同一个 `store.searchTerm`，提示文案随子分类变化） |

- **布局（密度）按钮在第 1 行**：第 2 行在女优 / 片商 / 系列页不渲染，留在那里会让这几个页面彻底改不了列数。
- **JAV 第 2 行按子分类分流**：作品页的排序 / 随机 / 标签 / 收藏夹 / 筛选只作用于作品（后端 `/jav/idols` 不认这些参数）；女优页改用对齐 PC 端的排序 + 资料范围筛选；片商 / 系列页没有可筛的维度，整行不渲染。
- **两个模式的功能栏都是 5 个左右的独立入口**，标签与收藏夹各自有 chip 和抽屉，不用钻进「筛选」里找。
- **JAV 支持大图模式**：作品单列、标题完整显示、带演员行与标签行，与视频端的大图一致。
- **第 2 行功能栏永远可见**，滚到哪都贴着顶栏。
- **第 3 行 JAV 分类行**用 `useHideOnScroll` 做方向检测：下滑收起、上滑恢复；接近顶部（<48px）永远显示，避免刚进页面就藏起来。
- 滚动的吸顶层级：顶栏 `z-20 / top-0`，功能栏 `z-10 / top-[50px]`，分类行 `z-[9]`。
- **分类行的吸顶偏移跟着第 2 行走**：作品 / 女优页 `top-[96px]`（50 + 46px），片商 / 系列页 `top-[50px]` —— 后者没有第 2 行，仍按 96px 吸顶会在顶上留出一条空档。
- 多选态与搜索态会临时替换第 1 行，退出后恢复。

实测（390×844）：

| 状态 | scrollY | 功能栏 top | 功能栏可见 | 分类行 top | 分类行可见 |
| --- | --- | --- | --- | --- | --- |
| 刚进 JAV | 0 | 58 | ✅ | 105 | ✅ |
| 下滑后 | 900 | 58 | ✅ | 57 | ❌ 收起 |
| 上滑后 | 680 | 58 | ✅ | 104 | ✅ 恢复 |

---

## 组件索引

### P0 / P1

| 组件 | 作用 | 安全要点 |
| --- | --- | --- |
| `ActionSheet.jsx` | 长按 / ⋮ 操作菜单 | 无任何删除入口；末尾保留置灰的「删除文件（移动端已禁用）」 |
| `SelectionBar.jsx` | 多选顶栏 + 批量操作栏 | 批量操作只写数据库 |
| `TagEditorSheet.jsx` | 标签编辑（单视频 / 批量） | 批量支持追加 / 移除 / 替换 |
| `ScreenshotsPage.jsx` | 截图查看 / 生成 / 设为封面 / 删除截图 | 只动 `data/` 下的截图 |
| `VideoPreviewGrid.jsx` | 视频预览图（播放页详情区 / JAV 作品详情页共用）：展示、放大翻页、删除 | 只动 `data/` 下的截图；`allowSetCover` 只在视频模块打开，JAV 侧与 PC 的 `JavScreenshotGrid` 一致只看 / 删 |
| `ScrapeSettingsPage.jsx` | 单视频：自动 / 手动 / 不刮削 + 番号提取测试 + 关联已有 | 只写数据库 |
| `RenamePage.jsx` | **唯一会写媒体目录的界面** | diff 预览 + 扩展名锁定 + 二次确认 + 本地重名预检 |
| `JavQuickChips.jsx` / `JavFilterSheet.jsx` / `JavDensitySheet.jsx` | JAV **作品页**功能栏：**筛选排序** / 随机 / 标签 / 收藏夹（密度在顶栏第 1 行，抽屉是 `JavDensitySheet`） | 只读 |
| `JavIdolQuickChips.jsx` / `JavIdolFilterSheet.jsx` | JAV **女优页**功能栏：排序（作品数量 / 加入时间 / 年龄 / 身高 / 胸围 / 臀围 / 腰围 / 罩杯，可切方向）+ 资料范围筛选（对齐 PC 端女优页） | 只读 |
| `JavTagSheet.jsx` / `JavFavoriteSheet.jsx` | JAV 标签多选、作品收藏夹单选（功能栏独立入口） | 只读 |
| `IdolCover.jsx` | 女优封面：只显示源图**最右侧 47%**（列表与详情共用） | 改 `maxWidth` 前先读文件里的注释 |
| `JavWorkCard.jsx` | JAV 作品卡（大图 / 标准 / 紧凑），列表与女优详情共用 | 只读；显示哪些行由全局设置决定 |
| `JavListPage.jsx` / `JavDetailPage.jsx` | JAV 作品 / 女优 / 片商 / 系列 + 详情 | 只读 |
| `SubPage.jsx` | 二级页外壳 | — |

### P2

| 组件 | 作用 |
| --- | --- |
| `settings/registry.jsx` | 设置子页注册表（全部 `lazy()`），新增设置页只需加一行 |
| `settings/MePage.jsx` | 「我的」：概览卡 + 4 组 15 入口 |
| `settings/SettingsPage.jsx` | 设置子页外壳：加载中 / 出错可重试 / 正常内容三态 |
| `settings/TagManagerPage.jsx` | 视频标签与 JAV 标签共用的管理器（点标签弹抽屉、分类上移下移、多选批量） |
| `settings/FavoriteGroupPage.jsx` | 收藏夹管理 + 收藏夹详情（两个独立的页面栈类型） |
| `settings/DirectoryPicker.jsx` | 服务端目录选择器（本地 / WebDAV 共用一套 UI） |
| `form/*` | `Switch` / `Stepper`（长按连续步进）/ `Segmented` / `TextField` / `PickerField` / `PromptSheet` / `Field`（卡片与行） |
| `ConfirmDialog.jsx` | 破坏性操作确认；危险项需先勾选「不可撤销」 |
| `useStackBack.js` | 页面栈的物理返回键支持（见上文两个坑） |
| `useAsyncData.js` | 设置页统一的加载 / 重试 / 卸载取消封装 |

---

## 「跳到对应影片」

女优 / 片商 / 系列都能一键跳到它们的作品列表，统一走 store 的
`jumpToJavWorks(patch)`：

| 入口 | 行为 |
| --- | --- |
| 片商 / 系列 tab 的每一行 | 点整行 → 切到「作品」tab 并套用该片商 / 系列 |
| 作品详情页的「片商」「系列」行 | 同上 |
| 作品详情页的演员名 | 跳到该女优的作品 |
| 女优详情页右上角「查看影片」/「查看全部」 | 跳到该女优的作品 |
| 女优详情页的「参与作品」区块 | 直接列出她最近的 6 部，可点进各自详情 |

`jumpToJavWorks` 的行为刻意做成可预测的：**切到作品 tab、用传入条件替换整套筛选、退出随机、
关闭所有二级页并回到顶部**。跳转后的条件会出现在「筛选」chip 的计数里，抽屉的「已选条件」
会把它显示出来，可以单独清掉。

---

## 已知边界

- **演员行**依赖后端在 `internal/db/videos.go` 的 `hydrateLocationJavs` 里 `Preload("Idols")`。
  P3 已加上，并由 `internal/db/videos_idols_test.go` 锁定（把 `Preload` 去掉这条测试立刻失败）。
- **「从媒体库移除」**已可用：`POST /videos/locations/hide`，只写数据库，文件原封不动。
- **`/m/` 已由后端托管**：打开 `http://<主机>:17654/`，手机 UA 会自动跳到 `/m/`。
- **本次为局域网访问时后端会强制浏览器播放**（`browser_playback_only`），与分流无关。
- 「关于」页**不显示服务端版本号** —— 后端没有任何版本接口（`buildMode` 只在链接期存在，
  从不序列化）。编造一个比不显示更糟。
- 播放器整包引入 video.js，首屏包 1000 KB（gzip 295 KB）。后续可把 video.js 也改成动态加载。
- 长按菜单用的是**底部抽屉**，设计稿里画的是跟随手指的深色浮层菜单 —— 落地时选了底部抽屉，
  理由是拇指可达性更好、长文案不会溢出、和 App 其它抽屉风格一致。

### 对着 mock 调 UI

`vite.config.js` 的代理目标可用环境变量覆盖，方便不起真实后端时调前端：

```powershell
$env:JAVBOSS_PROXY_TARGET = "http://localhost:17655"
cd web-mobile
npx vite --port 5176
```

P2 / P3 的验收脚本是临时产物（headless Chrome + mock 后端 / 真实后端），验证完即删除，
没有留在仓库里。要重跑请按 DESIGN.md §8 的实测结果表逐项重建，或直接对着真实后端手测。

---

## 测试

```bash
# 前端
cd web-mobile && npm test

# 后端（仓库根目录，先 dot-source 环境）
. .\.tools\goenv.ps1
go test ./...
```

| 文件 | 覆盖内容 |
| --- | --- |
| `tests/api-safety.test.js` | 封禁路径扫描、路由提取（含 `requestOK`）、`classifyRoute` 判定防回归、「除 `api.js` 外不得直接使用 `fetch()`」、`renameVideoLocation` 只能被 `RenamePage.jsx` 引用 |
| `tests/progress.test.js` | 播放进度阈值、续播开关关掉后不读也不写、`clearAllProgress` 只删自己的前缀、`localStorage` 不可用时全部退化为默认值 |
| `internal/server/router_ui_test.go` | UA 分流表、Cookie 覆盖、iPad、`?mobile=1`、`/m/` 托管与 SPA 回落、路径逃逸、分流不影响静态资源与 API |
| `internal/server/video_hide_api_test.go` | 从媒体库移除后**文件仍在磁盘上且内容未变**、批量去重、非法入参 |
| `internal/db/videos_idols_test.go` | `jav.idols` 被 preload（演员行有数据） |

> Windows 上 `internal/manager` 与 `internal/util` 有 4 个与 FFmpeg 下载/执行相关的测试会失败
> （测试取的是 Linux 二进制，无法在本机执行）。这是环境限制，与本工程无关，改动前就已存在。
