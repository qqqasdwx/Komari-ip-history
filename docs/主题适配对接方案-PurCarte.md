# 主题适配对接方案：PurCarte

## 验证结论

本地已按用户路径安装并启用 PurCarte 主题：

1. 参考仓库已克隆到 `references/Komari-theme-purcarte`。
2. 按 README 获取发布版 `komari-theme-purcarte.zip`，当前验证版本为 `v1.2.5`。
3. 通过 Komari 后台 UI 进入 `Theme Management`，点击上传主题包并启用。
4. 启用后 `/api/public` 返回 `theme: "PurCarte"`，同时返回 `theme_settings`。
5. PurCarte 页面会正常加载我们的 `custom_head`，`embed/loader.js` 已插入到页面中。

当前实际失配点：

- PurCarte 首页节点卡片里有 `/instance/<uuid>` 链接，但当前 loader 只从路由判断上下文；首页路径是 `/`，所以不会在首页节点卡片上注入按钮。
- PurCarte 节点详情页路径包含 `/instance/<uuid>`，当前 loader 能识别节点并显示入口，但找不到合适的主题内挂载点，只能退化成右下角浮动按钮。
- PurCarte 的视觉风格是磨砂玻璃卡片、背景图、半透明面板；当前注入按钮和弹窗仍是默认主题样式，视觉割裂。

验证截图保存在 `tmp/theme-ui/`，关键文件：

- `purcarte-home.png`
- `purcarte-instance-before-click.png`
- `purcarte-instance.html`

## 目标

注入层需要从“默认主题硬编码”改成“主题感知适配”：

- 自动检测 Komari 当前生效主题。
- 根据主题选择不同的入口挂载逻辑。
- 根据主题选择不同的按钮、弹窗、iframe 内嵌页面样式。
- 未适配主题必须保留可用兜底，不允许因为主题变化完全不可用。

## 主题检测方案

优先使用 Komari 官方公共接口：

```text
GET /api/public
```

该接口当前能稳定返回：

- `theme`
- `theme_settings`
- `sitename`
- `private_site`
- `allow_cors`

PurCarte 当前返回：

```json
{
  "theme": "PurCarte",
  "theme_settings": {
    "enableBlur": true,
    "blurValue": 10,
    "blurBackgroundColor": "rgba(255, 255, 255, 0.5)|rgba(0, 0, 0, 0.5)",
    "backgroundImage": "/assets/Moonlit-Scenery.webp",
    "selectedDefaultAppearance": "system",
    "selectThemeColor": "violet"
  }
}
```

检测优先级：

1. loader 启动后请求 `window.location.origin + "/api/public"`。
2. 如果成功，使用 `data.theme` 作为主题名。
3. 如果失败，退回到 DOM 探测。
4. DOM 探测只做兜底，例如查找 `Theme by PurCarte`、`.purcarte-blur`、`theme-card-style`。
5. 仍然无法判断时使用 `default` 适配器。

不建议让 iframe 内页面自己读取父页面主题，因为独立部署时 iframe 很可能跨域，父页面 DOM 不可读。主题检测应该发生在 loader 所在的 Komari 页面里，再把结果通过 URL 参数传给 iframe。

建议传参：

```text
embed=1
komari_theme=PurCarte
komari_appearance=light
komari_accent=violet
```

## 注入入口适配

### 适配器注册

在 loader 里引入轻量适配器注册表：

```js
const adapters = {
  default: defaultAdapter,
  PurCarte: purCarteAdapter
};
```

每个适配器负责三件事：

- 从当前页面提取节点上下文。
- 找到适合放按钮的位置。
- 给按钮和弹窗补充主题 class。

建议接口：

```js
{
  name: "PurCarte",
  detectPageContext(),
  findMounts(context),
  decorateButton(button, context),
  decorateDialog(dialog)
}
```

这里不需要做成复杂框架，loader 是直接输出的 JS 字符串，保持简单对象和函数即可。

### 默认主题

默认主题沿用现有逻辑，但要拆成 `defaultAdapter`，避免后续继续把默认主题逻辑散落在 loader 主流程里。

默认主题兜底规则：

- 详情页能识别 UUID 时，优先尝试放在头部信息区域。
- 找不到合适挂载点时，退回右下角浮动按钮。
- 首页是否注入按钮暂不扩大，避免默认主题出现重复入口。

### PurCarte 首页

PurCarte 首页节点卡片结构特点：

- 节点卡片内有 `a[href^="/instance/"]`。
- UUID 可从 href 中提取。
- 节点名称在同一个 anchor 内。
- 卡片右侧有一个信息按钮。
- 卡片根节点包含 `purcarte-blur theme-card-style`。

建议行为：

- 扫描 `a[href*="/instance/"]`。
- 对每个节点卡片提取 UUID 和节点名。
- 在卡片头部右侧操作区追加一个小图标按钮。
- 按钮点击后打开对应节点的 IP 质量弹窗。
- 不要在首页使用全局浮动按钮，因为首页可能有多个节点，浮动按钮无法表达属于哪个节点。

按钮样式：

- 使用圆形图标按钮，不使用长文字按钮。
- 视觉上贴近 PurCarte 的 `theme-button-ghost`。
- 鼠标 hover 时显示 title，例如 `查看 IP 质量`。

### PurCarte 详情页

PurCarte 详情页结构特点：

- 路径是 `/instance/<uuid>`。
- 页面顶部有一张 `purcarte-blur theme-card-style` 头部卡片。
- 节点名称在头部左侧。
- 当前 loader 能识别 UUID，但找不到该头部卡片，所以退化为浮动按钮。

建议行为：

- 通过路径提取 UUID。
- 从顶部头部卡片提取节点名。
- 在头部卡片右侧创建操作区，把 IP 质量按钮放进去。
- 详情页不再显示右下角浮动按钮，除非头部卡片找不到。

## 弹窗和 iframe 样式

### loader 弹窗

PurCarte 弹窗应贴近主题风格：

- 背景遮罩保留，但使用更轻的透明度。
- 弹窗本体使用半透明背景和 blur。
- 圆角、阴影和边框与 PurCarte 卡片一致。
- 顶部操作按钮使用半透明胶囊按钮。

建议 CSS class：

```text
ipq-loader-theme-purcarte
```

loader 检测到 PurCarte 后，把该 class 加到 portal 或 overlay 上，由 CSS 控制视觉。

### iframe 内页面

React 页面当前已经有 `embed=1` 模式，但样式偏默认主题。需要按 query 参数给 embed shell 加主题 class：

```text
embed-theme-default
embed-theme-purcarte
```

PurCarte 内嵌页建议：

- 背景透明或半透明，不要再铺满默认白底。
- 卡片使用磨砂玻璃面板。
- tab、按钮、历史和快照入口使用 PurCarte 的轻量胶囊风格。
- 文本颜色跟随 `komari_appearance`，避免深色主题下白底黑字刺眼。

## 数据和权限逻辑

主题适配只改展示和挂载，不改鉴权。

继续保留当前规则：

- Komari 管理员：打开 IPQ 管理员详情页，未登录 IPQ 时跳 IPQ 登录。
- Komari 游客：只在 IPQ 全局游客开关打开时展示公开只读数据。
- 游客未开放时提示 `管理员未开放该功能`。

PurCarte 首页多节点按钮要注意：

- 每个按钮必须绑定自己的 UUID。
- 不允许复用全局 `state.contextKey` 导致点 A 节点打开 B 节点。
- 按钮渲染要幂等，避免 React 页面重渲染后重复插入。

## 实施顺序

1. 把 loader 现有上下文识别和挂载逻辑拆成默认适配器。
2. 增加主题检测：优先 `/api/public`，失败再 DOM 兜底。
3. 增加 URL 传参，把主题信息传给 iframe。
4. 实现 PurCarte 首页卡片按钮注入。
5. 实现 PurCarte 详情页头部按钮注入。
6. 增加 PurCarte loader 弹窗 CSS。
7. 增加 React embed shell 的 PurCarte 样式。
8. 用 Playwright 回归默认主题和 PurCarte 主题。

## 验收标准

默认主题：

- 节点详情页入口仍可用。
- 管理员、游客开放、游客未开放三个鉴权路径仍通过。
- 弹窗内详情、历史记录、快照对比入口仍可用。

PurCarte：

- 首页每个节点卡片能看到主题化的 IP 质量入口。
- 详情页入口出现在顶部头部卡片内，不再默认漂浮在右下角。
- 点击入口能打开弹窗。
- 弹窗视觉接近 PurCarte，不再像默认主题白色窗口硬嵌进去。
- iframe 内页面背景、卡片、按钮不和 PurCarte 风格冲突。

## 风险

- 第三方主题 DOM 不稳定，适配器不能假设类名永远不变。PurCarte 可用 `.purcarte-blur`、`theme-card-style`、`/instance/<uuid>` 三类信号组合判断。
- 首页多节点注入比详情页复杂，需要保证按钮与 UUID 一一对应。
- loader 是字符串拼接输出，继续堆复杂逻辑会难维护。建议只做轻量适配器，不引入构建流程。
- 主题设置里背景图、透明度、浅深色都可变，iframe 内页面不要写死纯白背景。

## 当前建议

先做 PurCarte 专项适配，不要一次性抽象成“适配所有主题”的大框架。

原因：

- 当前只验证了默认主题和 PurCarte。
- 不同主题的节点卡片 DOM 差异会很大。
- 先形成一个 `default + PurCarte` 的适配器边界，后面遇到新主题再增加适配器，风险更低。

## 落地状态

已完成：

- loader 会请求 Komari `/api/public` 读取当前主题和主题设置。
- loader 会把 `komari_theme`、`komari_appearance`、`komari_accent` 传给 iframe 内页面。
- PurCarte 首页节点卡片会显示主题化图标入口，每个入口绑定当前卡片 UUID。
- PurCarte 详情页入口会挂到顶部节点卡片右侧，不再默认退化为右下角浮动按钮。
- PurCarte 弹窗外层增加磨砂玻璃风格。
- iframe 内嵌页会根据 `komari_theme=PurCarte` 切换为 PurCarte 风格。
- 默认主题注入鉴权回归通过。

验证记录：

- `go test ./...` 通过。
- `npm --prefix web run build` 通过。
- 本地 reload 后，PurCarte 首页和详情页 Playwright 验证通过。
- `web/playwright/verify-embed-auth-flows.mjs` 在默认主题下通过。
- `web/playwright/verify-react-preview-nodes.mjs` 当前失败在硬编码历史筛选日期 `2026-04-02`，与本次主题适配无关。
