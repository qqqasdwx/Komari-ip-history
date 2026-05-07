# 第六步：只读 Public API 与 API Key

## 目标

提供稳定的只读对外 API，让外部系统可以用 API Key 查询节点、目标 IP、当前结果和历史变化，但不开放写操作。

## 状态

已完成于分支 `feature/6-public-api-api-key` 和 `feature/6-public-api-docs`，并已合并到 `dev`。

## TODO

- [x] 管理员可以创建 API Key。
- [x] API Key 明文只在创建时展示一次。
- [x] 管理员可以查看 API Key 列表。
- [x] 管理员可以启用、停用、删除 API Key。
- [x] API Key 调用公开 API 时需要带认证头。
- [x] 未带 API Key 或 API Key 无效时返回拒绝访问。
- [x] 停用的 API Key 不能继续访问。
- [x] 公开 API 支持查询节点列表。
- [x] 公开 API 支持查询节点详情。
- [x] 公开 API 支持查询某节点的目标 IP 列表。
- [x] 公开 API 支持查询某个目标 IP 当前详情。
- [x] 公开 API 支持查询历史记录。
- [x] 公开 API 支持查询历史变化事件。
- [x] 公开 API 支持基础分页和日期范围筛选。
- [x] 管理员可以查看 API 访问日志。
- [x] API Key 访问有基础限流保护。
- [x] API 页面提供“查看接口文档”入口。
- [x] 接口文档页列出开放接口、认证方式、参数和响应示例。

## 不包含

- 不开放节点创建、修改、删除。
- 不开放目标 IP 写操作。
- 不开放通知配置写操作。
- 不承诺第三方 SDK。

## 验收清单

- [x] 创建 API Key 后，只展示一次明文 key。
- [x] 使用有效 API Key 可以查询节点列表。
- [x] 使用无效 API Key 会被拒绝。
- [x] 停用 API Key 后访问被拒绝。
- [x] 删除 API Key 后访问被拒绝。
- [x] 节点详情、目标 IP、历史记录、历史事件接口都能返回数据。
- [x] 分页、日期范围和字段筛选行为可验证。
- [x] API 访问日志能记录 key、路径、状态码和访问时间。
- [x] 连续高频请求会触发限流。
- [x] 从 API 页面可以进入独立接口文档页。

## 用户体验变更

- 设置中新增开放 API 管理页，管理员可以创建、停用、启用和删除 API Key。
- API Key 明文只在创建后展示一次，页面刷新后不再显示。
- 开放 API 页面展示访问日志，便于管理员排查调用状态、限流和认证失败。
- API 页面提供接口文档入口，打开后可以查看认证方式、接口列表、参数和调用示例。

## 核心逻辑变更

- 新增只读 Public API 命名空间，外部系统只能读取节点、目标 IP、当前结果、历史记录和历史变化事件。
- Public API 使用 API Key 鉴权，未提供、无效、停用或已删除的 key 都会被拒绝。
- API Key 访问会记录日志，并带有基础限流保护。

## 自动验收记录

- `go test ./...`
- `cd web && npx tsc --noEmit`
- `git diff --check`
- `docker compose -f compose.dev.yml exec -T workspace sh -lc 'cd /workspace/web && node playwright/verify-public-api-api-key.mjs'`
- 第 8 步后由 `run-acceptance-e2e.sh` 覆盖默认主题环境下的 Public API 与 API Key 回归。

## 手工验收建议

- 在开放 API 页面创建一个 API Key，确认明文只出现一次。
- 使用页面文档中的示例请求节点列表，确认有效 key 可以访问，无效 key 会被拒绝。
- 停用、启用、删除同一个 key，确认访问状态随设置变化。
- 连续快速调用接口，确认会触发限流，并能在访问日志中看到对应记录。
- 点击“查看接口文档”，确认新页面能完整展示开放接口调用说明。
