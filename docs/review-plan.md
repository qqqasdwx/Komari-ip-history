# 未提交代码 Review 执行清单

更新时间：2026-04-17

## 背景

本清单基于当前仓库中**所有未提交改动**的 code review 结果整理，参考文档主要包括：

- `docs/API草案-v1.md`
- `docs/下一步正式方案-v1.md`
- `docs/下一步详细设计-v1.md`
- `docs/第一阶段实施任务单-v1.md`
- `docs/集成与行为说明.md`
- `docs/开发环境.md`
- `docs/用户操作手册.md`

## 验证结果

已完成基础验证：

- `go test ./...` ✅
- `npm --prefix web run build` ✅

## 总体结论

当前未提交改动已经实现了大量能力，整体方向正确，测试也通过；但仍不建议直接按“全部收口完成”合并，主要原因是：

1. **文档与代码状态明显不一致**
2. **通知链接基址解析仍需收口**
3. **`node_uuid` 对外契约仍未完全统一**

---

## P0：必须先做

### 1. 同步文档到当前真实实现

当前多份文档仍把以下能力描述为“未完成 / 有缺口”，但代码实际上已经实现：

- 时区手动编辑
- “配置完成，请返回 Komari 重新查看”提示
- 手动目标 IP 与自动发现目标 IP 并存
- public API 的访问日志与限流
- 页面安装命令改为当前服务端直出 install script

#### 需要修正的文档

- `docs/开发环境.md`
- `docs/用户操作手册.md`
- `docs/集成与行为说明.md`
- `docs/下一步正式方案-v1.md`
- `docs/第一阶段实施任务单-v1.md`

#### 对应代码依据

- 时区输入框：`web/src/react-preview/App.tsx`
- 配置完成提示：`web/src/react-preview/App.tsx`
- 手动/自动并存：`internal/service/nodes.go`
- API 限流与访问日志：
  - `internal/httpx/middleware/api_key.go`
  - `internal/service/api_access.go`
- 服务端 install script：`web/src/react-preview/App.tsx`

#### 验收标准

- 文档不再把已落地能力写成“未完成”
- 文档中保留的“限制”只剩真实仍未收口的项目

---

## P1：高优先级实现修正

### 2. 修通知 detail / compare URL 的 public base URL 解析

#### 问题

通知中的详情链接和对比链接，当前可能拿不到仅通过配置文件提供的 `IPQ_PUBLIC_BASE_URL`。

#### 影响位置

- `internal/service/notification_send.go`

#### 风险

- 通知消息中的链接可能退化为相对路径
- 真实部署下通知跳转可能不可直接使用

#### 建议

- 让通知 URL 生成逻辑与现有 public base URL 推导逻辑保持一致
- 增加“仅配置 `IPQ_PUBLIC_BASE_URL`”场景的测试

#### 验收标准

- 未设置后台 integration setting 时，只要配置了 `IPQ_PUBLIC_BASE_URL`，通知中也能生成绝对地址

---

### 3. 收口 `node_uuid` 的外部契约

#### 问题

虽然当前已经补入内部稳定 `node_uuid`，但多个外部返回和链接仍在继续使用 `KomariNodeUUID`。

#### 影响点

- install config 的 `node_uuid`
- report config 返回的路径字段
- 通知 detail / compare URL

#### 风险

- 独立节点与绑定节点的标识语义不统一
- `node_uuid` 只完成了“内部补字段”，还没有真正完成“外部收口”

#### 建议

- 对外响应优先统一到 `node_uuid`
- 路由层继续兼容旧 `komari_node_uuid`
- 文档明确兼容策略

#### 验收标准

- public / install / notification 等外部链路对节点标识的语义一致

---

## P2：后续继续推进

### 4. 完成节点主实体重构

当前虽已有：

- `node_uuid`
- `komari_bindings`
- 独立节点
- 手动绑定 / 解绑

但底层仍未真正拆成：

- `ipq_nodes`
- `komari_bindings`

`Node` 目前仍同时承担主实体和兼容层职责。

---

### 5. 收口 public API 的长期兼容语义

当前已具备：

- API Key
- 访问日志
- 限流
- 只读 public API

但若要长期对外稳定开放，仍需继续补：

- 错误语义统一
- 字段兼容策略
- 版本承诺边界

---

### 6. 加固 Javascript sender

当前基础能力已经具备，但仍建议继续做工程性加固：

- 更稳的异步执行行为
- 更清晰的失败语义
- 边界测试补全

---

## 当前状态归类

### 已实现，可保留

- 独立节点创建
- `Komari` 绑定 / 解绑
- 单目标 IP 启停
- 自动探查计划接口
- 手动 + 自动目标并存
- 时区输入与 `CRON_TZ`
- 配置完成提示
- 通知系统基本链路
- API Key 管理
- public API
- API 限流与访问日志
- install script 改为当前服务端直出

### 还没完全收口

- 文档同步
- 通知 URL 基址
- `node_uuid` 外部契约统一
- 节点主实体最终拆表
- public API 长期兼容语义
- Javascript sender 工程性加固

---

## 建议执行顺序

1. 先修 docs
2. 再修通知 URL 基址
3. 再统一 `node_uuid` 对外契约
4. 最后做结构性后续工作
   - 主实体拆表
   - API 兼容承诺
   - JS sender 加固

---

## 最简合并门槛

如果希望尽快把这批未提交代码合并，建议最低先完成：

- [ ] docs 全量同步到当前实现
- [ ] 通知 URL public base URL 修正
- [ ] `node_uuid` 对外语义至少不再混乱
