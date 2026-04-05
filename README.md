# Komari-ip-history

`Komari-ip-history` 是一个独立部署的 IP 质量服务，用来把 `IPQuality` 的探测结果接到 `Komari` 节点里。

它的目标不是替代 `Komari`，而是补一条 IP 质量能力：

- 在不修改 `Komari` 官方源码的前提下，通过 `custom_head` 注入入口
- 在 `Komari` 节点详情页里直接打开 IP 质量结果
- 支持多 IP 目标、历史变化、快照对比、收藏快照、历史保留策略

## 这个项目适不适合你

如果你想要的是下面这些能力，这个项目是合适的：

- 在 `Komari` 节点详情页里查看当前 IP 质量
- 给一个节点配置多个目标 IP，分别采集和展示
- 查看某个 IP 的历史变化，而不只是当前一次结果
- 用快照对比页比较两个时间点的完整结果
- 收藏关键快照，避免被历史清理策略删除
- 独立部署 IP 质量服务，不改 `Komari` 官方源码

如果你只想看一次性的 `IPQuality` 结果，不需要：

- `Komari` 集成
- 历史变化
- 多 IP 管理

那这个项目会偏重。

## 当前功能

- `Komari` 节点详情页注入“打开 IP 质量”入口
- 管理员 / 游客分流
- 节点列表行内“上报设置”弹窗
- 多 IP 目标管理
- 可配置 `cron` 周期
- 安装后立即执行一次
- 单条接入命令，重跑即覆盖更新旧配置
- 当前结果展示
- 历史变化列表
- 快照对比页
- 收藏快照
- 全局历史保留策略

## 部署方式

当前只支持 Docker 部署。

镜像地址：

```bash
ghcr.io/qqqasdwx/komari-ip-history:latest
```

### 部署前准备

至少要准备这 3 个环境变量：

- `IPQ_PUBLIC_BASE_URL`
  - 对外访问地址
  - 例：`http://your-server-ip`
  - 用于生成注入脚本地址、接入命令和跳转地址
- `IPQ_DEFAULT_ADMIN_USERNAME`
  - 初始管理员用户名
- `IPQ_DEFAULT_ADMIN_PASSWORD`
  - 初始管理员密码

常用可选项：

- `IPQ_COOKIE_SECURE`
  - HTTP 部署填 `false`
  - HTTPS 部署填 `true`
- `IPQ_DB_PATH`
  - 镜像内默认是 `/data/ipq.db`

### 用 Docker 直接启动

```bash
docker pull ghcr.io/qqqasdwx/komari-ip-history:latest

docker run -d \
  --name komari-ip-history \
  -p 8090:8090 \
  -v "$(pwd)/data:/data" \
  -e IPQ_PUBLIC_BASE_URL=http://your-server-ip:8090 \
  -e IPQ_DEFAULT_ADMIN_USERNAME=admin \
  -e IPQ_DEFAULT_ADMIN_PASSWORD='change-this-password' \
  -e IPQ_COOKIE_SECURE=false \
  ghcr.io/qqqasdwx/komari-ip-history:latest
```

启动后访问：

```text
http://your-server-ip:8090/#/login
```

### 用 Docker Compose 启动

先创建 `compose.yml`：

```yaml
services:
  ipq:
    image: ghcr.io/qqqasdwx/komari-ip-history:latest
    container_name: komari-ip-history
    restart: unless-stopped
    ports:
      - "8090:8090"
    environment:
      IPQ_PUBLIC_BASE_URL: http://your-server-ip:8090
      IPQ_DEFAULT_ADMIN_USERNAME: admin
      IPQ_DEFAULT_ADMIN_PASSWORD: change-this-password
      IPQ_COOKIE_SECURE: "false"
      IPQ_DB_PATH: /data/ipq.db
    volumes:
      - ./data:/data
```

启动命令：

```bash
docker compose up -d
```

更新命令：

```bash
docker compose pull
docker compose up -d
```

### 部署后怎么接 `Komari`

部署完成后，登录 IPQ 后台：

1. 打开 `接入配置`
2. 复制 `Komari custom_head` 用的注入代码
3. 粘贴到 `Komari` 的 `custom_head`
4. 回到 `Komari` 节点页，即可看到“打开 IP 质量”入口

### 说明

- 当前默认按**根路径**部署
- 如果你先用 HTTP 跑通，这是可以的
- 真正上线时建议切 HTTPS，并把：
  - `IPQ_PUBLIC_BASE_URL` 改成 HTTPS 地址
  - `IPQ_COOKIE_SECURE=true`

## 开发指南

开发环境、联调方式、种子数据、排障流程，放在单独文档里：

- [开发环境说明](docs/开发环境.md)

## 参考

- `Komari` 前端技术栈参考：`references/komari-web`
- `IPQuality` 字段和展示逻辑参考：`references/IPQuality`
