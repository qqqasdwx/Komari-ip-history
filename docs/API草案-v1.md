# API 草案 v1

本文档只覆盖下一阶段相关的新接口或调整接口，不覆盖现有全部 API。

## 当前实现同步说明（截至 2026-04-17）

本文件原本是“下一阶段草案”，但当前分支中已有相当一部分接口提前落地。为避免继续把“已实现接口”误当成“纯设计稿”，这里补充当前状态说明：

- **已落地**
  - 节点上报配置接口
  - 安装配置接口
  - 自动探查计划接口
  - 目标 IP 启停接口
  - 通知配置接口
  - 对外只读 API
  - API Key 后台管理接口

- **仍属待补齐 / 待稳定**
  - `IPQ Node + Komari Binding` 的底层主实体尚未完全拆表重构（当前已补内部 `node_uuid`，但仍在兼容旧模型）
  - 若 public API 要长期对外稳定开放，仍需继续收口错误语义和兼容承诺

- **阅读方式建议**
  - 本文后面的接口定义继续保留“目标设计”价值
  - 但凡标注“当前实现备注”的地方，都应以当前代码行为为准

---

## 1. 节点上报配置

## 1.1 更新节点上报配置

`PUT /api/v1/nodes/:uuid/report-config`

请求体：

```json
{
  "schedule_cron": "0 12 * * *",
  "timezone": "Asia/Shanghai",
  "run_immediately": true
}
```

返回体：

```json
{
  "endpoint_path": "/api/v1/report/nodes/<uuid>",
  "installer_path": "/api/v1/report/nodes/<uuid>/install.sh",
  "reporter_token": "<token>",
  "install_token": "<token>",
  "target_ips": ["1.1.1.1"],
  "schedule_cron": "0 12 * * *",
  "timezone": "Asia/Shanghai",
  "run_immediately": true,
  "next_runs": [
    "2026-04-14T12:00:00+08:00"
  ]
}
```

## 1.2 预览节点上报配置

`GET /api/v1/nodes/:uuid/report-config/preview`

查询参数：

- `cron`
- `timezone`
- `run_immediately`

返回体：

```json
{
  "schedule_cron": "0 12 * * *",
  "timezone": "Asia/Shanghai",
  "run_immediately": true,
  "next_runs": [
    "2026-04-14T12:00:00+08:00"
  ]
}
```

### 当前实现备注

- 以上两个接口都已经实现
- `preview` 当前使用的查询参数名是：
  - `cron`
  - `timezone`
  - `run_immediately`
- `PUT /api/v1/nodes/:uuid/report-config` 当前也会返回：
  - `endpoint_path`
  - `installer_path`
  - `reporter_token`
  - `install_token`
  - `target_ips`
  因此它不只是“纯配置写回结果”，而是直接返回完整的 `report_config`

---

## 2. 节点安装配置

## 2.1 获取安装配置

`GET /api/v1/report/nodes/:uuid/install-config`

返回体新增：

- `timezone`

```json
{
  "node_uuid": "<uuid>",
  "report_endpoint": "https://example.com/api/v1/report/nodes/<uuid>",
  "reporter_token": "<token>",
  "schedule_cron": "0 12 * * *",
  "timezone": "Asia/Shanghai",
  "run_immediately": true,
  "target_ips": ["1.1.1.1"]
}
```

## 2.2 通过安装令牌获取安装配置

`GET /api/v1/report/install-config/:installToken`

返回体同上。

### 当前实现备注

- 上面两个安装配置接口都已实现
- 当前安装链路实际是：
  1. 前端给用户生成一条指向当前服务端 `install-script` 接口的安装命令
  2. 当前服务端直接生成并返回 install script
  3. script 再通过 install token / reporter token 获取或使用当前服务端配置
- 因此：
  - **节点实际 cron / reporter 配置来自当前服务端**
  - 安装引导脚本本身也已切换为当前服务端直出

---

## 3. 自动探查计划接口

`POST /api/v1/report/nodes/:uuid/plan`

请求体：

```json
{
  "candidate_ips": [
    "10.0.0.2",
    "203.0.113.10",
    "2001:db8::1"
  ],
  "agent_version": "v1",
  "hostname": "node-a",
  "interface_summary": [
    {
      "name": "eth0",
      "ips": ["10.0.0.2", "2001:db8::1"]
    }
  ]
}
```

返回体：

```json
{
  "approved_targets": [
    {
      "target_ip": "10.0.0.2",
      "target_id": 12,
      "enabled": true,
      "source": "discovered"
    }
  ],
  "schedule_cron": "0 12 * * *",
  "timezone": "Asia/Shanghai",
  "run_immediately": true
}
```

### 当前实现备注

- 该接口已实现，并且当前返回体已经包含：
  - `approved_targets`
  - `schedule_cron`
  - `timezone`
  - `run_immediately`
- 当前请求模型已接受：
  - `candidate_ips`
  - `agent_version`
  - `hostname`
  - `interface_summary`
- 当前 reporter 已会把：
  - `agent_version`
  - `hostname`
  - `interface_summary`
  一起发给服务端
- 当前已支持：
  - 手动目标 IP 与自动发现目标 IP 并存

---

## 4. 目标 IP 启停

## 4.1 启用目标 IP 上报

`POST /api/v1/nodes/:uuid/targets/:targetID/enable`

返回：

```json
{
  "status": "ok"
}
```

## 4.2 停用目标 IP 上报

`POST /api/v1/nodes/:uuid/targets/:targetID/disable`

返回：

```json
{
  "status": "ok"
}
```

### 当前实现备注

- 这两个接口都已实现
- 当前实际返回不是固定 `{ "status": "ok" }`
- 实际返回为更新后的目标 IP 对象，包含：
  - `id`
  - `ip`
  - `source`
  - `enabled`
  - `has_data`
  - `updated_at`
  - `sort_order`

---

## 5. 通知配置

## 5.1 Sender 配置

`GET /api/v1/admin/notification/providers`

`GET /api/v1/admin/notification/channels`

`POST /api/v1/admin/notification/channels`

`PUT /api/v1/admin/notification/channels/:channelID`

`POST /api/v1/admin/notification/channels/:channelID/enable`

`POST /api/v1/admin/notification/channels/:channelID/disable`

`DELETE /api/v1/admin/notification/channels/:channelID`

建议统一结构：

```json
{
  "id": 1,
  "name": "默认 Telegram",
  "type": "telegram",
  "enabled": true,
  "config": {
    "bot_token": "...",
    "chat_id": "..."
  }
}
```

## 5.2 测试发送

`POST /api/v1/admin/notification/test`

请求体：

```json
{
  "channel_id": 1
}
```

## 5.3 订阅规则

`GET /api/v1/admin/notification/rules`

`POST /api/v1/admin/notification/rules`

`PUT /api/v1/admin/notification/rules/:id`

`DELETE /api/v1/admin/notification/rules/:id`

规则结构：

```json
{
  "id": 1,
  "node_id": 10,
  "target_id": 100,
  "field_id": "score.ipqs",
  "channel_id": 1,
  "enabled": true
}
```

## 5.4 投递日志

`GET /api/v1/admin/notification/deliveries`

返回示例：

```json
{
  "items": [
    {
      "id": 1,
      "rule_id": 3,
      "history_entry_id": 42,
      "status": "success",
      "response_summary": "",
      "created_at": "2026-04-15T10:00:00Z"
    }
  ]
}
```

## 5.5 当前实现补充说明

- 通知相关接口已整体落地，包括：
  - providers
  - channels
  - rules
  - test
  - deliveries
- 当前支持的 sender 类型：
  - `telegram`
  - `javascript`
  - `webhook`
- 当前已补齐：
  - 事件模型里的 `previous_recorded_at`
  - 真实 `recorded_at`
  - `detail_url / compare_url` 在配置 public base URL 时可输出绝对地址
  - 通知总开关与标题 / 正文模板
  - Javascript sender 的 `fetch/xhr` 同线程执行模型

---

## 6. 对外只读 API

认证头：

- `X-IPQ-API-Key`

建议资源：

- `GET /api/public/v1/nodes`
- `GET /api/public/v1/nodes/:uuid`
- `GET /api/public/v1/nodes/:uuid/targets`
- `GET /api/public/v1/nodes/:uuid/targets/:targetID`
- `GET /api/public/v1/nodes/:uuid/history`
- `GET /api/public/v1/nodes/:uuid/history/events`

### 当前实现备注

- 上述 6 个 public API 路由都已实现
- 当前 public API 使用：
  - `X-IPQ-API-Key`
- `history/events` 当前支持的查询参数包括：
  - `target_id`
  - `field`
  - `page`
  - `page_size`
  - `start_date`
  - `end_date`
- 当前已补：
  - 访问日志
  - 限流
  - API Key 页面最近访问记录
- 如果后续要作为稳定外部 API 对外承诺，还需要再补错误语义与兼容说明

---

## 7. API Key 后台管理接口（当前已实现）

这部分接口已经进入实现，但原草案里没有单独列出，这里补充记录。

- `GET /api/v1/admin/api-keys`
- `POST /api/v1/admin/api-keys`
- `POST /api/v1/admin/api-keys/:keyID/enable`
- `POST /api/v1/admin/api-keys/:keyID/disable`
- `DELETE /api/v1/admin/api-keys/:keyID`

创建返回示例：

```json
{
  "id": 1,
  "name": "readonly",
  "key": "<plain-text-key-only-once>",
  "enabled": true
}
```

说明：

- 明文 key 只在创建时返回一次
- 服务端持久化保存的是 hash
