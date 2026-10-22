# Ink — 极简 Markdown 写作软件

> 本地优先的 macOS Markdown 写作工具。Tauri 2 + React 18 + TypeScript 5 + CodeMirror 6 + Zustand + Tailwind。

唯一事实来源是 `ink-writer-prd/Ink_开发规格说明书.md`（下称 **spec**）。本文档说明 **MVP 的实现范围、与 spec 的偏差、以及如何运行**。

---

## 一、快速开始

```bash
pnpm install          # 安装依赖
pnpm tauri dev        # 开发模式（Vite + Rust 同时启动）
pnpm tauri build      # 打包 .app / .dmg
```

开发期还有**视觉预览页**（用于配色 / 排版回归）：

```bash
pnpm dev
open http://localhost:1420/preview.html            # 只挂载编辑器 + 搜索面板
open http://localhost:1420/preview.html?dark=1     # 深色
open http://localhost:1420/preview.html?shell=1    # 整壳（侧边栏/顶栏/正文，预置假数据）
open http://localhost:1420/preview.html?shell=1&dark=1&focus=1   # 深色 + Focus Mode
```

质量门禁：

```bash
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint
pnpm test             # vitest（前端 67 个用例）
cd src-tauri && cargo test   # Rust 13 个单测 + 6 个夹具集成测试
```

首次启动会进入 **空库引导**（spec W7）：选择文档库位置（默认 `~/Documents/Ink`），
确认后立即创建 `Untitled.md` 并进入编辑器。

---

## 二、MVP 覆盖范围

spec §1 裁决 R2：**MVP = Phase 1–3 + HTML 导出 + 系统打印**。

| Milestone | 状态 | 说明 |
|---|---|---|
| **M1 Editor Core** | ✅ | 脚手架、CM6 装配、原子写 + mtime 乐观锁、新建/打开/保存闭环、自动保存状态机、窗口状态记忆、Light/Dark 主题 |
| **M2 Writing Experience** | ✅ | 样式化源码渲染、Focus Mode、Typewriter Mode、Typography 设置、统计与状态栏、图片拖拽/粘贴、GBK 编码处理、大文件降级（>2MB 统计分片 / >5MB Focus 收窄 / >10MB 性能模式） |
| **M3 Document Management** | ✅ | Sidebar 分组/右键菜单/宽度拖拽、标题提取、Quick Open、正文搜索、Command Palette、外部变更 watch + 冲突三选一、全量快捷键 + IME 守卫 |
| **M4 Export** | ✅ | HTML 导出（单文件、内联样式）、系统打印（打印对话框内「存储为 PDF」） |
| **M5 Polish** | 部分 | 错误状态矩阵、动效规范 + reduced-motion 已落地；签名公证 CI 未做（需证书，见 §六） |

明确**不做**（spec R2 / PRD §26）：DOCX、直出 PDF、行内标记折叠、多窗口、自动更新、遥测（无任何网络请求）。

---

## 三、目录结构

```text
ink-writer/
├── ink-writer-prd/            # PRD 与开发规格说明书（SSOT）
├── fixtures/                  # 测试夹具（spec §19.3）
├── src/
│   ├── App.tsx                # 应用外壳（overlay / chrome / base 三层）
│   ├── components/            # spec §4.1 的 11 个组件 + SaveIndicator
│   ├── editor/                # 唯一 import @codemirror/* 的目录
│   │   ├── extensions.ts      #   §8.1 扩展装配顺序
│   │   ├── styledSource.ts    #   §2 样式化源码
│   │   ├── focusMode.ts       #   §9 Focus Mode
│   │   ├── typewriter.ts      #   §10 Typewriter Mode
│   │   ├── statistics.ts      #   §16 统计插件
│   │   ├── imageHandler.ts    #   §15.4 图片拖拽 / 粘贴
│   │   ├── links.ts           #   §2.1 ⌘Click 打开链接 / Reveal
│   │   ├── highlight.ts       #   §17 代码高亮
│   │   ├── theme.ts           #   §8.3 EditorView.theme
│   │   └── bridge.ts          #   让非 EditorHost 也能操作编辑器
│   ├── stores/                # documentStore / editorStore / settingsStore / uiStore
│   ├── lib/                   # 纯函数（标题、统计、模糊评分、命名、导出 HTML）
│   ├── commands/registry.ts   # §11.3 命令注册表
│   └── styles/globals.css     # §17.1 设计令牌 + 样式化源码样式
└── src-tauri/
    ├── src/
    │   ├── lib.rs             # 命令注册 + 插件装配
    │   ├── fs_ops.rs          # 原子写、mtime 乐观锁、创建/重命名/废纸篓、图片
    │   ├── encoding.rs        # UTF-8 / GBK / BOM / 二进制探测
    │   ├── search.rs          # 正文扫描（不建索引）
    │   └── watcher.rs         # 库目录监听 + 自写过滤
    └── capabilities/main.json # 最小权限集合
```

---

## 四、关键实现说明

### 1. 样式化源码（spec §2 / R1）

- 语法符号**始终可见**，只做视觉弱化（`--secondary`）；标题 / 加粗 / 斜体等做视觉增强。
- 基于 Lezer Markdown 语法树产出 `Decoration.mark` / `Decoration.line`，
  **只计算可见区间 ±200 行**（spec §18.2）。
- 文本与磁盘文件一字不差——没有任何折叠、隐藏或替换。

### 2. 保存链路（spec §12）

```text
用户输入 ──500ms 防抖──► dirty ──► saving ──► saved ──1.5s──► idle
                            │           │失败
                            │           └──► error ──► Toast + 5s 重试 ×3
                            └── mtime 不匹配 ──► conflict ──► 三选一对话框
```

- Rust 侧写入：**临时文件 → fsync → rename**（POSIX 原子），失败不产生半写文件。
- `write_document` 带 `expectedMtime` 乐观锁；冲突抛 `MtimeConflict`，前端弹三选一。
- 写入队列串行化：写入期间继续输入会被合并成一次最终写入（spec §19.2 用例 2、9）。

### 3. 外部变更（spec §12.3）

- Rust 侧 `notify`（macOS 走 FSEvents）+ 500ms 去抖监听库目录。
- **自写过滤**：写入时记录 `(path, mtime)`，3 秒内的同路径事件被忽略。
- 无 pending 输入 → 静默重载并按行列恢复光标；有 pending → 冻结写入队列并弹冲突框。

### 4. 大文件降级（spec §18.2）

| 文档大小 | 行为 |
|---|---|
| >2MB | 统计走 `requestIdleCallback` 分片（512KB/片），分片期间保持上次结果 |
| >5MB | Focus Mode 的 decoration 范围收窄为可见区间 ±50 行 |
| >10MB | 性能模式：关闭语法高亮、禁用 Focus Mode 入口，并 Toast 提示 |

### 5. 界面与效果图对齐（2024-XX 更新）

按 `ink-writer-prd/效果图 1.png`、`效果图 2.png` 重做了界面：

| 区域 | 实现 |
|---|---|
| 配色 | Accent 改为 Apple 蓝 `#007AFF` / `#0A84FF`（其余令牌同 spec §17.1） |
| 顶栏 | 文档图标 + 文件名（可点击重命名）/ 中间模式胶囊 / 右侧 搜索·Aa·更多 |
| 侧边栏 | App 名 + 折叠按钮；All Documents / Recent / Favorites 导航；条目带文档图标与收藏星标；底部 New Document |
| 收藏 | `AppSettings.favorites`（绝对路径数组）+ 右键/菜单切换 + 侧栏筛选 |
| 主区 | 文档大标题 + 元信息行（时间 · 字数 · 阅读时长） |
| 空文档 | 「Start writing.」+「写下你的第一个想法…」引导 |
| 状态栏 | 改为**常驻**（效果图），点击展开统计卡；新增 **句子数** |
| Focus Mode | 当前块增加 accent 色竖线标识；顶部显示 Focus Mode 胶囊 |
| Quick Open | 列表右侧显示时间（Today / 2024-12-01） |
| 快捷键 | 切换侧边栏改为 `⌥\`（效果图设计系统） |
| 图标 | 新增线性图标体系（file/folder/star/clock/plus/more/feather/panel/target） |

> 与 spec 的三处冲突按**效果图**为准：顶部有轻量工具条（spec §3.1 写的是「无 Toolbar」）；
> 状态栏常驻（spec W5 写的是 hover 才出现）；侧边栏分组保留 spec 的
> Today / Yesterday / This Week / Earlier（效果图是 Today / Yesterday / Archive）。

### 6. 查找面板（⌘F）

CM6 自带的搜索面板是「一排灰按钮」，与 Ink 的极简调性不符，因此重做了视觉层
（**行为仍用 CM6 原生实现**，不重写搜索逻辑）：

- 形态：顶部居中的**浮动卡片**（圆角 12px + 阴影 + 1px 描边），宽度与正文栏一致
- 输入框：带放大镜图标、聚焦时 accent 光晕
- 上一个 / 下一个：SVG 箭头图标（`mask` + `currentColor`，随主题变色）
- 选项：胶囊 + 自绘勾选框（accent 填充）
- 文案：通过 `EditorState.phrases` facet **整体中文化**
- 图标按钮补 `title` tooltip（`src/editor/searchPanel.ts`）

> 实现坑：CM6 的实际 DOM 是 `.cm-panels-top > .cm-search.cm-panel`，
> `.cm-search` 与 `.cm-panel` **是同一个元素**（不是父子）；
> 且 `<br>` 在 flex 容器里会被浏览器忽略，需要插入占位元素才能换行。

### 7. 光标居中（Focus Mode / Typewriter Mode 共用）

两个模式都会让「打字时当前行停在视口**垂直中心**」：

- 精确居中（50%），死区 6px 只为避免逐像素抖动
- **只在真正打字时居中**（`docChanged`）。光标移动（点击、上下箭头）不干预 ——
  否则点哪行都会被立刻拽回屏幕中央、上下箭头也无法逐行浏览
- 打字时瞬时滚动（不做动画，连续输入会漂移）；切换模式的瞬间做一次平滑居中
- 手动滚动后 1.5s 冷却，不跟用户抢滚动条
- 实现抽在 `src/editor/centering.ts`，两个模式共用，避免两套逻辑漂移

> spec §10 原文写的是「视觉中心偏上 42%」，按产品要求改为**精确居中**。

**两个必须记住的坑**（都踩过）：

1. **不能在插件的 `update()` 里调用 `view.dispatch()`** —— CM6 会抛
   `Calls to EditorView.update are not allowed while an update is in progress`，
   并在捕获异常后**直接停用该插件**。表现是「第一次击键后功能彻底失效、且毫无报错」。
   正确做法：把动作推迟到 `requestAnimationFrame` 里执行。
2. **坐标会过期** —— CM6 渲染新内容（measure）发生在插件 `update()` 之后，
   同一帧里拿到的 `coordsAtPos` 还是旧位置。要等两帧，或直接用 CM6 的
   `scrollIntoView`（它在 measure 阶段计算目标，坐标总是最新）。

**另一个必须记住的坑**（点击定位错行的根因）：

> **段落间距不能用 CSS `margin` 实现。**
> CM6 的坐标模型只测量 line 盒的高度，**margin 不会被计入**，
> 于是实际行距（30.6px 行高 + 16.2px margin）与 CM6 认知的行距（30.6px）不一致，
> 每点一行就多偏 16.2px —— 表现为「点第 N 行，光标落到第 N+1 行」，越往下偏得越多。
> 正确做法：用 line decoration 的 `padding`（属于行盒，CM6 会正确测量），
> 且只加在段落的**最后一行**，避免换行段落内部被撑开。

**真机自检**：dev 模式下访问 `http://localhost:1420/?selftest=1`，
App 会在真实 WKWebView 里跑一遍居中验证，结果写到 `/tmp/ink-selftest.txt`：

```
initial:   offset=-152.5px scrollTop=0
focus-on:  offset=-152.5px scrollTop=0
type-A:    offset=-152.5px scrollTop=0      ← 文档第 1 行，上方没有内容，物理上无法居中
type-B:    offset=-152.5px scrollTop=0
type-mid:  offset=0.3px    scrollTop=4760   ← 打字后精确居中，偏差 0.3px ✓
move-only: scrollTopDelta=0                ← 只移动光标，视图不被拽动 ✓
```

### 8. 统计口径（spec §16 / R4）

CJK 每字计 1 + 西文按空白分词；阅读时长 = `CJK/400 + 西文/200` 分钟，向上取整，最小 1。
>2MB 文档走 `requestIdleCallback` 按 512KB 分片计算，分片期间保持上次结果。

---

## 五、与 spec 的偏差（及原因）

| # | spec 原文 | 实现 | 原因 |
|---|---|---|---|
| 1 | §8.2 `inkFocusModeField` 为 `StateField<DecorationSet>` | 改为 `ViewPlugin` | 可见区间（`view.visibleRanges`）只在 View 上存在，StateField 无法只算可见区间；行为与 spec §9.2 一致 |
| 2 | §12.3 使用 `tauri-plugin-fs` 的 `watch` | 改为 Rust 侧 `notify` + Tauri 事件 | 库目录可自定义，静态 capability scope 无法覆盖任意路径；`notify` 是 `tauri-plugin-fs` 的同源依赖，不增加新的依赖面 |
| 3 | §7.4 capabilities 含 `fs:allow-read-write-recursive` | 文件 IO 全部走 Rust 命令，capability 只保留 `core/dialog/store/window-state` | 最小权限原则：Rust 侧按命令白名单校验，前端拿不到任意文件读写能力 |
| 4 | §5.1 `DocumentMeta` 无 `displayTitle` | 增加 `displayTitle` 字段（Rust 扫描时提取首个 H1） | Sidebar 需要在不读取全文的前提下显示标题；这是对契约的**增量扩展** |
| 5 | §8.1 `EditorView.scrollIntoView` + smooth | 平滑滚动用 `scrollDOM.scrollTo({behavior:'smooth'})` | CM6 的 `scrollIntoView` 不支持 `behavior` 选项 |
| 6 | §11.3 注册 14 条命令 | 注册 24 条（新增字体族 / 行高 / 栏宽 / 打印） | spec §5.2 的排版设置需要可达的入口；放进 Command Palette 而不是加设置面板，符合 Less UI 原则 |

---

## 六、尚未完成 / 已知限制

- **签名与公证**（spec §20）：`pnpm tauri build` 可产出未签名 `.app`；Developer ID 签名 +
  `xcrun notarytool submit --wait` + `stapler staple` 需要真实证书，未在仓库内实现 CI。
- **性能预算**（spec §18.1）：已实现大文件降级阈值（统计分片、>5MB 收窄 Focus 范围、
  >2MB 跳过正文搜索），但 10MB 文档的端到端手测仍需人工完成。
- **行内标记折叠**（行内链接 / 图片语法在光标离开行后隐藏）：spec R1 明确列入 v1.1 Backlog。
- **HTML 导出的「复制 assets 到导出目录」选项**：已实现为自动行为（导出到其他目录时自动复制 `assets/`），
  但没有做成可勾选的开关。
- **库目录切换**：首次启动向导可选择位置；启动后没有提供切换入口（spec 未定义该 UI）。
- **正则在 >10MB 文档上禁用**：CM6 `search` 扩展的默认行为未做特殊降级。

---

## 七、快捷键（spec §11.2）

| 命令 | 快捷键 |
|---|---|
| 新建文档 | ⌘N |
| 打开文档 | ⌘O |
| 立即保存 | ⌘S |
| Quick Open | ⌘P |
| Command Palette | ⌘K |
| 切换 Sidebar | ⌘\ |
| 查找 | ⌘F |
| Focus Mode | ⌘⇧F / Esc 退出 |
| Typewriter Mode | ⌘⇧T |
| 切换主题 | ⌘⇧D |
| 字号增减 | ⌘= / ⌘- |
| 导出 HTML | ⌘⇧E |
| 撤销 / 重做 | ⌘Z / ⌘⇧Z |

IME 守卫：`event.isComposing === true` 时忽略一切快捷键（spec §11.1）。

---

## 八、隐私

无网络请求、无遥测、无自动更新（spec §25）。所有文档只存在于本机文件系统中。
