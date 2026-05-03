import { Link } from "react-router-dom";
import { PageHeader } from "../components/layout/page-header";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";

type ParameterDoc = {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  description: string;
};

type EndpointDoc = {
  method: "GET";
  path: string;
  title: string;
  description: string;
  parameters: ParameterDoc[];
  response: string;
  example: string;
};

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const apiBasePath = `${basePath}/api/v1/public-api`;

const sharedHeaders: ParameterDoc[] = [
  {
    name: "Authorization",
    in: "header",
    required: true,
    description: "Bearer API Key。也可以使用 X-API-Key 请求头传递同一个密钥。"
  }
];

const endpoints: EndpointDoc[] = [
  {
    method: "GET",
    path: "/nodes",
    title: "查询节点列表",
    description: "按节点更新时间倒序返回节点概览，可用于外部系统同步节点清单。",
    parameters: [
      ...sharedHeaders,
      { name: "page", in: "query", required: false, description: "页码，从 1 开始。默认 1。" },
      { name: "page_size", in: "query", required: false, description: "每页数量。默认 20，最大 100。" },
      { name: "q", in: "query", required: false, description: "按节点名称、节点标识或 Komari 节点信息搜索。" }
    ],
    response: `{
  "items": [
    {
      "node_uuid": "ipq-node-id",
      "komari_node_uuid": "komari-node-id",
      "komari_node_name": "Komari Node",
      "name": "Node Name",
      "has_data": true,
      "binding_state": "komari_bound",
      "target_count": 2,
      "updated_at": "2026-05-03T00:00:00Z",
      "created_at": "2026-05-01T00:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 20,
  "total_pages": 1
}`,
    example: `curl -H "Authorization: Bearer <API_KEY>" \\
  "<BASE_URL>/nodes?page=1&page_size=20&q=node"`
  },
  {
    method: "GET",
    path: "/nodes/{node_uuid}",
    title: "查询节点详情",
    description: "返回单个节点的基础信息和目标 IP 列表。",
    parameters: [
      ...sharedHeaders,
      { name: "node_uuid", in: "path", required: true, description: "节点列表返回的 node_uuid。" }
    ],
    response: `{
  "node_uuid": "ipq-node-id",
  "komari_node_uuid": "komari-node-id",
  "komari_node_name": "Komari Node",
  "name": "Node Name",
  "has_data": true,
  "binding_state": "komari_bound",
  "updated_at": "2026-05-03T00:00:00Z",
  "created_at": "2026-05-01T00:00:00Z",
  "targets": [
    {
      "id": 123,
      "ip": "203.0.113.10",
      "source": "manual",
      "has_data": true,
      "updated_at": "2026-05-03T00:00:00Z",
      "sort_order": 0
    }
  ]
}`,
    example: `curl -H "Authorization: Bearer <API_KEY>" \\
  "<BASE_URL>/nodes/<NODE_UUID>"`
  },
  {
    method: "GET",
    path: "/nodes/{node_uuid}/targets",
    title: "查询目标 IP 列表",
    description: "返回指定节点下配置或自动发现的目标 IP。",
    parameters: [
      ...sharedHeaders,
      { name: "node_uuid", in: "path", required: true, description: "节点列表返回的 node_uuid。" }
    ],
    response: `{
  "items": [
    {
      "id": 123,
      "ip": "203.0.113.10",
      "source": "manual",
      "has_data": true,
      "updated_at": "2026-05-03T00:00:00Z",
      "sort_order": 0
    }
  ]
}`,
    example: `curl -H "Authorization: Bearer <API_KEY>" \\
  "<BASE_URL>/nodes/<NODE_UUID>/targets"`
  },
  {
    method: "GET",
    path: "/nodes/{node_uuid}/targets/{target_id}/current",
    title: "查询目标 IP 当前详情",
    description: "返回指定目标 IP 最新一次检测结果。",
    parameters: [
      ...sharedHeaders,
      { name: "node_uuid", in: "path", required: true, description: "节点列表返回的 node_uuid。" },
      { name: "target_id", in: "path", required: true, description: "目标 IP 列表返回的 id。" }
    ],
    response: `{
  "id": 123,
  "ip": "203.0.113.10",
  "source": "manual",
  "has_data": true,
  "updated_at": "2026-05-03T00:00:00Z",
  "summary": "检测摘要",
  "current_result": {
    "Head": {},
    "Info": {},
    "Type": {},
    "Score": {}
  }
}`,
    example: `curl -H "Authorization: Bearer <API_KEY>" \\
  "<BASE_URL>/nodes/<NODE_UUID>/targets/<TARGET_ID>/current"`
  },
  {
    method: "GET",
    path: "/nodes/{node_uuid}/history",
    title: "查询历史记录",
    description: "返回指定节点的历史检测记录，可按目标 IP、分页和时间范围筛选。",
    parameters: [
      ...sharedHeaders,
      { name: "node_uuid", in: "path", required: true, description: "节点列表返回的 node_uuid。" },
      { name: "target_id", in: "query", required: false, description: "只查询某个目标 IP 的历史。" },
      { name: "page", in: "query", required: false, description: "页码，从 1 开始。默认 1。" },
      { name: "page_size", in: "query", required: false, description: "每页数量。默认 20，最大 100。" },
      { name: "limit", in: "query", required: false, description: "兼容快速限制条数；传入后 page 固定为 1。" },
      { name: "start_date", in: "query", required: false, description: "开始时间，支持 RFC3339 或 YYYY-MM-DD。" },
      { name: "end_date", in: "query", required: false, description: "结束时间，支持 RFC3339 或 YYYY-MM-DD。日期会包含当天。" }
    ],
    response: `{
  "items": [
    {
      "id": 456,
      "target_id": 123,
      "target_ip": "203.0.113.10",
      "is_favorite": false,
      "recorded_at": "2026-05-03T00:00:00Z",
      "summary": "检测摘要",
      "result": {}
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 20,
  "total_pages": 1
}`,
    example: `curl -H "Authorization: Bearer <API_KEY>" \\
  "<BASE_URL>/nodes/<NODE_UUID>/history?target_id=<TARGET_ID>&start_date=2026-05-01&end_date=2026-05-03"`
  },
  {
    method: "GET",
    path: "/nodes/{node_uuid}/history/events",
    title: "查询历史变化事件",
    description: "返回历史记录中字段值发生变化的事件，可按字段、目标 IP、分页和时间范围筛选。",
    parameters: [
      ...sharedHeaders,
      { name: "node_uuid", in: "path", required: true, description: "节点列表返回的 node_uuid。" },
      { name: "target_id", in: "query", required: false, description: "只查询某个目标 IP 的变化事件。" },
      { name: "field", in: "query", required: false, description: "字段 ID，例如 info.organization。" },
      { name: "page", in: "query", required: false, description: "页码，从 1 开始。默认 1。" },
      { name: "page_size", in: "query", required: false, description: "每页数量。默认 20，最大 100。" },
      { name: "start_date", in: "query", required: false, description: "开始时间，支持 RFC3339 或 YYYY-MM-DD。" },
      { name: "end_date", in: "query", required: false, description: "结束时间，支持 RFC3339 或 YYYY-MM-DD。日期会包含当天。" }
    ],
    response: `{
  "items": [
    {
      "id": "456:info.organization",
      "target_id": 123,
      "target_ip": "203.0.113.10",
      "field_id": "info.organization",
      "field_label": "Organization",
      "field_option_label": "Info / Organization",
      "previous": { "text": "Org A" },
      "current": { "text": "Org B" },
      "previous_recorded_at": "2026-05-02T00:00:00Z",
      "recorded_at": "2026-05-03T00:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 20,
  "total_pages": 1
}`,
    example: `curl -H "Authorization: Bearer <API_KEY>" \\
  "<BASE_URL>/nodes/<NODE_UUID>/history/events?field=info.organization&page=1&page_size=20"`
  }
];

const statusCodes = [
  { code: "200", description: "请求成功。" },
  { code: "400", description: "参数格式错误，例如 target_id 不是有效数字。" },
  { code: "401", description: "未提供 API Key、API Key 无效或已删除。" },
  { code: "403", description: "API Key 已停用。" },
  { code: "404", description: "节点或目标 IP 不存在。" },
  { code: "429", description: "触发限流，默认每个 API Key 每分钟 60 次请求。" }
];

function CodeBlock(props: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-950 px-4 py-3 text-xs leading-6 text-slate-100">
      <code>{props.children}</code>
    </pre>
  );
}

function EndpointCard(props: { endpoint: EndpointDoc }) {
  const endpointURL = `${apiBasePath}${props.endpoint.path}`;
  return (
    <Card className="p-6">
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-emerald-200 bg-emerald-50 font-mono text-emerald-700">
                {props.endpoint.method}
              </Badge>
              <code className="break-all rounded-lg bg-slate-100 px-2 py-1 text-sm text-slate-800">{endpointURL}</code>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{props.endpoint.title}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">{props.endpoint.description}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">参数</h3>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">名称</th>
                    <th className="px-3 py-2 font-medium">位置</th>
                    <th className="px-3 py-2 font-medium">必填</th>
                    <th className="px-3 py-2 font-medium">说明</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {props.endpoint.parameters.map((parameter) => (
                    <tr key={`${parameter.in}-${parameter.name}`}>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-900">{parameter.name}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-slate-500">{parameter.in}</td>
                      <td className="whitespace-nowrap px-3 py-3">{parameter.required ? "是" : "否"}</td>
                      <td className="min-w-[240px] px-3 py-3 leading-6">{parameter.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">调用示例</h3>
            <CodeBlock>{props.endpoint.example.replace("<BASE_URL>", `${window.location.origin}${apiBasePath}`)}</CodeBlock>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">响应示例</h3>
          <CodeBlock>{props.endpoint.response}</CodeBlock>
        </div>
      </div>
    </Card>
  );
}

export function PublicAPIDocsPage() {
  return (
    <section className="space-y-6">
      <PageHeader
        title="开放 API 文档"
        subtitle="这些接口只允许读取节点、目标 IP、当前结果和历史变化，不提供写入能力。"
        backTo="/settings/api-keys"
        actions={
          <Button
            asChild
            className="rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50"
          >
            <Link to="/settings/api-keys">返回开放 API</Link>
          </Button>
        }
      />

      <Card className="p-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">Base URL</p>
            <code className="block break-all rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">
              {window.location.origin}
              {apiBasePath}
            </code>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">认证方式</p>
            <p className="text-sm leading-6 text-slate-500">Authorization: Bearer API Key，或 X-API-Key。</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">限流</p>
            <p className="text-sm leading-6 text-slate-500">默认每个 API Key 每分钟 60 次请求。</p>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        {endpoints.map((endpoint) => (
          <EndpointCard endpoint={endpoint} key={endpoint.path} />
        ))}
      </div>

      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">错误码</h2>
            <p className="mt-1 text-sm text-slate-500">错误响应统一返回 JSON：{"{\"message\":\"错误说明\"}"}。</p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">状态码</th>
                  <th className="px-3 py-2 font-medium">说明</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {statusCodes.map((statusCode) => (
                  <tr key={statusCode.code}>
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-900">{statusCode.code}</td>
                    <td className="px-3 py-3 leading-6">{statusCode.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </section>
  );
}
