# Komari-ip-history

本仓库用于开发一个与 Komari 集成的节点 IP 质量展示服务。项目形态是“独立服务 + 注入到 Komari 的轻量前端桥接”，目标是在不修改 Komari 官方源码的前提下，把节点 IP 质量信息挂到 Komari 节点详情页里。

当前实现约定：

- `docs/`：需求、项目理解、已确认事项、待确认事项。
- `references/`：上游参考源码与 IPQuality 参考库。
- `cmd/ipq/`：Go 服务入口。
- `internal/`：后端基础结构、模型、认证、路由、服务层。
- `web/`：独立前端源码，使用 npm + Vite。
- `public/`：前端构建产物目录，由 Go 服务统一提供。
- `compose.dev.yml`：开发环境编排，当前按“单开发工作容器 + Komari + 统一反代”组织。
- `deploy/dev/workspace/Dockerfile`：开发工作容器镜像定义，内置 Go 和 Node.js 工具链。
- `Dockerfile`：生产镜像定义，构建前端产物并打包 Go 服务。

当前阶段已经落下的骨架包括：

- Go + Gin + Gorm + SQLite 的基础后端结构。
- 单管理员登录、Session Cookie、节点接入记录的基础模型。
- 独立前端当前以 React 作为主线，已具备最小后台页面骨架：登录、节点列表、节点详情、系统配置。
- 节点列表行内提供“上报设置”按钮，点击后以弹窗集中管理目标 IP、可配置 cron 计划、是否安装后立即执行一次，以及会随配置动态变化的单条接入命令。
- 接入命令改为从 GitHub Raw 获取仓库内固定 `deploy/install.sh`，业务参数通过命令行传给安装脚本。
- 当前默认按根路径独立部署，本服务可直接挂在 `/`。
- 开发环境反代骨架仍保留子路径兼容能力，但不再代表默认产品部署形态。
- 容器化开发工作流：默认通过 `docker compose exec workspace ...` 在容器内执行依赖安装、构建与测试。
- GitHub Actions 已拆成轻量 CI、独立 E2E 和 Docker 发布三条线。

进一步设计边界见：

- `docs/已确认事项.md`
- `docs/待确认事项.md`

## 本地常用验收命令

开发容器启动后，推荐使用以下命令完成阶段 1 主链路验收：

```powershell
docker exec -it ipq-workspace-dev sh /workspace/deploy/dev/workspace/bootstrap.sh
docker exec -it ipq-workspace-dev sh -lc "cd /workspace && go build ./cmd/ipq"
docker exec -it ipq-workspace-dev sh -lc "cd /workspace/web && npm run build"
docker exec -it ipq-workspace-dev sh /workspace/deploy/dev/workspace/start-backend.sh
docker exec -it ipq-workspace-dev sh /workspace/deploy/dev/workspace/start-frontend.sh
docker exec -it ipq-workspace-dev sh /workspace/deploy/dev/workspace/run-e2e.sh
```

如果改了前端或前后端联动页面，不要先猜浏览器缓存。先执行：

```bash
docker compose -f compose.dev.yml exec -T workspace sh /workspace/deploy/dev/workspace/reload-ipq.sh
```

这条命令会：

- 重新执行前端构建到 `public/`
- 重启当前运行中的 Go 后端
- 等待 `http://127.0.0.1:8090/api/v1/health` 恢复

这个问题已经在联调里反复出现过。以后默认先跑这条命令，再判断是不是缓存。

其中：

- `run-e2e.sh` 会顺序执行：
- `web/playwright/verify-react-preview-nodes.mjs`
- `web/playwright/verify-embed-auth-flows.mjs`
- 新的鉴权脚本会自动清理自身创建的测试节点，并把游客只读开关恢复成默认关闭
- Playwright 产物输出到 `web/playwright-output/`

## 开发种子节点

联调时如果需要一组固定场景节点，可以执行：

```bash
docker compose -f compose.dev.yml exec -T workspace sh /workspace/deploy/dev/workspace/seed-dev-nodes.sh
```

脚本会先清理旧的 `开发种子-*` 节点，再重建这 3 个固定场景：

- `开发种子-空节点`
  - 无目标 IP，用于验证空状态和游客弹窗空页
- `开发种子-单IP历史`
  - 1 个目标 IP，带 3 条历史，用于当前结果和历史对比
- `开发种子-多IP历史`
  - 2 个目标 IP，分别带历史，用于标签切换、排序和分 IP 历史

## 页面没变时的排障顺序

如果出现“源码已经改了，但浏览器里还是旧页面”，按这个顺序处理：

1. 执行 `reload-ipq.sh`
2. 确认健康检查恢复：
   - `http://127.0.0.1:8090/api/v1/health`
3. 再刷新浏览器
4. 如果页面仍不对，再看具体页面 DOM、截图、接口返回

不要第一反应就归因到浏览器缓存。

## Docker 部署

仓库现在有正式生产镜像：

- `Dockerfile`
- GitHub Actions 会把镜像发布到：
  - `ghcr.io/<owner>/<repo>`

当前 workflow：

- `.github/workflows/ci.yml`
  - push 到 `main/master`
  - `pull_request`
  - 只跑：
    - `go test`
    - `go build`
    - `npm run build`
- `.github/workflows/e2e.yml`
  - push 到 `main/master`
  - `workflow_dispatch`
  - 跑基于开发容器环境的 Playwright 主流程验证
- `.github/workflows/docker.yml`
- 触发条件：
  - push 到 `main/master`
  - `v*` tag
  - `workflow_dispatch`
- PR 只做 build，不 push

### 运行时必须确认的环境变量

- `IPQ_PUBLIC_BASE_URL`
  - 必填
  - 用于生成 Komari header、跳转地址、接入命令
  - 例：`https://ipq.example.com`
- `IPQ_DEFAULT_ADMIN_USERNAME`
  - 首次启动默认管理员用户名
- `IPQ_DEFAULT_ADMIN_PASSWORD`
  - 首次启动默认管理员密码

### 常用运行时环境变量

- `IPQ_LISTEN`
  - 默认 `:8090`
- `IPQ_DB_PATH`
  - 默认 `/data/ipq.db`
- `IPQ_SESSION_COOKIE`
  - 默认 `ipq_session`
- `IPQ_COOKIE_SECURE`
  - HTTPS 部署时应设为 `true`
- `IPQ_BASE_PATH`
  - 默认空，表示根路径部署

### 部署约束

- 生产镜像默认按**根路径**构建前端：
  - `VITE_BASE_PATH=/`
- 所以最稳的部署方式是：
  - 直接挂在独立域名根路径

如果以后要走子路径，例如 `/ipq/`，不能只改运行时环境变量，还需要在构建镜像时同步传：

```bash
docker build --build-arg VITE_BASE_PATH=/ipq/ -t ghcr.io/<owner>/<repo>:custom .
```

并且运行时同时设置：

```bash
IPQ_BASE_PATH=/ipq
```

### 最小运行示例

```bash
docker run -d \
  --name komari-ip-history \
  -p 8090:8090 \
  -v "$(pwd)/data:/data" \
  -e IPQ_PUBLIC_BASE_URL=https://ipq.example.com \
  -e IPQ_DEFAULT_ADMIN_USERNAME=admin \
  -e IPQ_DEFAULT_ADMIN_PASSWORD=change-me \
  -e IPQ_COOKIE_SECURE=true \
  ghcr.io/<owner>/<repo>:latest
```
