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

**唯一允许触碰用户媒体目录的是「重命名文件」**（`PATCH /videos/:id/locations/:locationId`），它只能在重命名确认页调用，且必须经过 diff 预览 + 显式确认（P1 实现）。

约束由 `tests/api-safety.test.js` 机械保证：它会扫描 `src/api.js` 里所有
`request('<METHOD>', '<path>')` 调用，并断言整个 `src/` 不出现封禁路径、也不绕过
`api.js` 直接 `fetch()`。**新增接口必须走 `request()` / `requestJSON()`，否则测试扫不到。**

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
├── store.js              # zustand 扁平 store
├── App.jsx               # 页面编排（顶栏 / 搜索 / 抽屉 / 播放器）
├── auth.jsx              # cookie 认证 Provider
├── components/
│   ├── TopBar.jsx        # logo + 视频/JAV 分段 + 搜索 + 设置
│   ├── QuickChips.jsx    # 排序 / 随机 / 密度 / 标签 / 筛选
│   ├── VideoCard.jsx     # 三种密度排版（大图 / 标准 / 紧凑）
│   ├── VideoGrid.jsx     # 骨架屏 + 无限滚动哨兵
│   ├── SearchPanel.jsx   # SearchBar（顶栏变形）+ SearchHints
│   ├── FilterSheet.jsx   # 底部筛选抽屉（含实时命中数）
│   ├── DensitySheet.jsx  # 密度切换
│   ├── BottomSheet.jsx   # 抽屉基座
│   ├── PlayerPage.jsx    # 浏览器播放（video.js）+ 续播
│   ├── LoginPage.jsx / Icons.jsx / Toast.jsx / PlaceholderPage.jsx
├── hooks/                # useInfiniteScroll / useLongPress / useOverlayBack
├── utils/                # i18n / errors / display / browserPlayback / density / format / progress
└── constants/video.js    # 排序选项（与 PC 端一致）
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
| P2 | 「我的」+ 14 个设置子页、页面栈与返回手势 | ⏳ |
| P3 | 后端 UA/Cookie 分流、`/m/` 托管、`Preload("Idols")`、`/videos/locations/hide`、构建发布接入 | ⏳ |

### P1 新增组件

| 组件 | 作用 | 安全要点 |
| --- | --- | --- |
| `ActionSheet.jsx` | 长按 / ⋮ 操作菜单 | 无任何删除入口；末尾保留置灰的「删除文件（移动端已禁用）」 |
| `SelectionBar.jsx` | 多选顶栏 + 批量操作栏 | 批量操作只写数据库 |
| `TagEditorSheet.jsx` | 标签编辑（单视频 / 批量） | 批量支持追加 / 移除 / 替换 |
| `ScreenshotsPage.jsx` | 截图查看 / 生成 / 设为封面 / 删除截图 | 只动 `data/` 下的截图 |
| `ScrapeSettingsPage.jsx` | 自动 / 手动 / 不刮削 + 番号提取测试 + 关联已有 | 只写数据库 |
| `RenamePage.jsx` | **唯一会写媒体目录的界面** | diff 预览 + 扩展名锁定 + 二次确认 + 本地重名预检 |
| `JavQuickChips.jsx` / `JavFilterSheet.jsx` / `JavDensitySheet.jsx` | JAV 功能栏：排序 / 随机 / 密度（大图·标准·紧凑）/ 筛选 | 只读 |
| `JavTagSheet.jsx` / `JavFavoriteSheet.jsx` | JAV 标签多选、作品收藏夹单选（功能栏独立入口） | 只读 |
| `IdolCover.jsx` | 女优封面：只显示源图**最右侧 47%**（列表与详情共用） | 改 `maxWidth` 前先读文件里的注释 |
| `JavWorkCard.jsx` | JAV 作品卡（大图 / 标准 / 紧凑），列表与女优详情共用 | 只读 |

### 「跳到对应影片」

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
| `JavListPage.jsx` / `JavDetailPage.jsx` | JAV 作品 / 女优 / 片商 / 系列 + 详情 | 只读 |
| `SubPage.jsx` | 二级页外壳（P2 设置页复用） | — |
| `useHideOnScroll.js` | 滚动方向检测（下滑隐藏 / 上滑显示） | — |

### 外壳结构（视频 / JAV 共用）

两个模式**共用同一套顶栏与功能栏**，所以随时可以互相切换，也随时能进设置：

| 位置 | 视频模式 | JAV 模式 |
| --- | --- | --- |
| 第 1 行 · 常显 | `JB` + `视频\|JAV` 分段 + 🔍 搜索 + ⚙️ 设置 | 同左 |
| 第 2 行 · 常显吸顶 | `QuickChips`：排序 / 随机 / 密度 / 标签 / 筛选 | `JavQuickChips`：排序 / 随机 / 密度 / **标签** / **收藏夹** / 筛选 |
| 第 3 行 · 吸顶但**下滑隐藏** | — | `JavTabs`：作品 / 女优 / 片商 / 系列 + 数量 |
| 内容 | `VideoGrid`（大图 1 列 / 标准 2 列 / 紧凑 3 列） | 作品 1·2·3 列、女优 2·3·4 列、片商·系列列表 |
| 搜索 | 共用顶栏放大镜 → `SearchBar` | 同左（搜索词走同一个 `store.searchTerm`） |

- **两个模式的功能栏都是 6 个左右的独立入口**，标签与收藏夹各自有 chip 和抽屉，不用钻进「筛选」里找。
- **JAV 支持大图模式**：作品单列、标题完整显示、带演员行与标签行，与视频端的大图一致。
- **第 2 行功能栏永远可见**，滚到哪都贴着顶栏。
- **第 3 行 JAV 分类行**用 `useHideOnScroll` 做方向检测：下滑收起、上滑恢复；接近顶部（<48px）永远显示，避免刚进页面就藏起来。
- 滚动的吸顶层级：顶栏 `z-20 / top-0`，功能栏 `z-10 / top-[50px]`，分类行 `z-[9] / top-[96px]`。
- 多选态与搜索态会临时替换第 1 行，退出后恢复。

实测（390×844）：

| 状态 | scrollY | 功能栏 top | 功能栏可见 | 分类行 top | 分类行可见 |
| --- | --- | --- | --- | --- | --- |
| 刚进 JAV | 0 | 58 | ✅ | 105 | ✅ |
| 下滑后 | 900 | 58 | ✅ | 57 | ❌ 收起 |
| 上滑后 | 680 | 58 | ✅ | 104 | ✅ 恢复 |

### P0/P1 已知边界

- **演员行**需要后端在 `internal/db/videos.go` 的 `hydrateLocationJavs` 加
  `Preload("Idols")`（P3）。当前 `/videos` 不返回 `jav.idols`，所以大图模式的演员行会
  自动隐藏，加完后无需改前端。
- **「从媒体库移除」**已封装为 `hideVideoLocations()`，后端接口
  `POST /videos/locations/hide` 在 P3 落地，在那之前调用会返回 404 并如实展示错误。
- 设置入口目前是占位页（P2）。
- 播放器整包引入 video.js，产物约 950 KB（gzip 283 KB）。后续可按需动态加载。
- 长按菜单用的是**底部抽屉**，设计稿里画的是跟随手指的深色浮层菜单 —— 落地时选了底部抽屉，
  理由是拇指可达性更好、长文案不会溢出、和 App 其它抽屉风格一致。

### 对着 mock 调 UI

`vite.config.js` 的代理目标可用环境变量覆盖，方便不起真实后端时调前端：

```powershell
$env:JAVBOSS_PROXY_TARGET = "http://localhost:17655"
cd web-mobile
npx vite --port 5176
```

---

## 测试

```bash
npm test
```

目前覆盖 `tests/api-safety.test.js`：封禁路径扫描、路由提取、`classifyRoute` 判定防回归、
以及「除 `api.js` 外不得直接使用 `fetch()`」。
