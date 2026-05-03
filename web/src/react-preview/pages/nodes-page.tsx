import {
  Plus,
  RotateCcw,
  Server
} from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useState
} from "react";
import {
  useNavigate,
  useSearchParams
} from "react-router-dom";
import { apiRequest, UnauthorizedError } from "../lib/api";
import { buildNodeSettingsPath } from "../lib/embed-navigation";
import { formatDateTime } from "../lib/format";
import type {
  MeResponse,
  NodeDetail,
  NodeListItem
} from "../lib/types";
import { PageHeader } from "../components/layout/page-header";
import { SearchBox } from "../components/common/search-box";
import { StatusPill } from "../components/node/status-pill";
import { pushToast } from "../components/toast";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

function nodeRouteID(item: Pick<NodeListItem, "node_uuid" | "komari_node_uuid">) {
  return item.node_uuid || item.komari_node_uuid;
}

function nodeBindingLabel(item: Pick<NodeListItem, "binding_state" | "komari_node_name">) {
  return item.binding_state === "komari_bound" ? "已绑定 Komari" : "独立节点";
}

function CreateIndependentNodeDialog(props: {
  open: boolean;
  onClose: () => void;
  onCreated: (detail: NodeDetail) => void;
  onUnauthorized: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setName("");
    setError("");
    setSaving(false);
  }, [props.open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请输入节点名称。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const detail = await apiRequest<NodeDetail>("/nodes", {
        method: "POST",
        body: JSON.stringify({ name: trimmedName })
      });
      props.onCreated(detail);
    } catch (createError) {
      if (createError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(createError instanceof Error ? createError.message : "创建节点失败");
    } finally {
      setSaving(false);
    }
  }

  if (!props.open) {
    return null;
  }

  return (
    <div className="field-modal-backdrop" onClick={props.onClose}>
      <section className="field-modal max-w-xl" onClick={(event) => event.stopPropagation()}>
        <div className="field-modal-head">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">新建独立节点</h2>
            <p className="text-sm text-slate-500">先创建 IPQ 节点，再配置目标 IP、上报计划和接入命令。</p>
          </div>
          <Button
            className="rounded-lg border border-[var(--line)] bg-white px-3 text-[13px] text-[var(--ink)] hover:bg-slate-50"
            onClick={props.onClose}
            type="button"
          >
            关闭
          </Button>
        </div>
        <form className="field-modal-body space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label className="text-slate-900" htmlFor="independent-node-name">
              节点名称
            </Label>
            <Input
              autoFocus
              className="h-11 rounded-xl px-3 focus:border-indigo-300 focus:ring-indigo-100"
              id="independent-node-name"
              onChange={(event) => setName(event.target.value)}
              placeholder="例如 香港 01"
              value={name}
            />
          </div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button
              className="rounded-xl border border-slate-200 bg-white px-4 text-slate-700 hover:bg-slate-50"
              disabled={saving}
              onClick={props.onClose}
              type="button"
            >
              取消
            </Button>
            <Button
              className="rounded-xl bg-indigo-500 px-4 text-white hover:bg-indigo-600 disabled:bg-indigo-300"
              disabled={saving || !name.trim()}
              type="submit"
            >
              <Server className="size-4" />
              <span>{saving ? "创建中" : "创建"}</span>
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function NodesPage(props: { me: MeResponse; onUnauthorized: () => void }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nodes, setNodes] = useState<NodeListItem[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [createNodeOpen, setCreateNodeOpen] = useState(false);

  useEffect(() => {
    const requestedUUID = searchParams.get("report_config")?.trim() || "";
    if (!requestedUUID) {
      return;
    }
    navigate(buildNodeSettingsPath(requestedUUID, {
      fromKomari: searchParams.get("from_komari") === "1",
      nodeName: searchParams.get("node_name")?.trim() || undefined
    }), { replace: true });
  }, [navigate, searchParams]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const nodeResponse = await apiRequest<{ items: NodeListItem[] }>(`/nodes${searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : ""}`);

        if (cancelled) {
          return;
        }

        setNodes(nodeResponse.items);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof UnauthorizedError) {
          props.onUnauthorized();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载节点列表失败");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [props.onUnauthorized, reloadToken, searchQuery]);

  const showSearch = nodes.length > 0 || searchInput.trim().length > 0 || searchQuery.trim().length > 0;

  return (
    <section className="space-y-6">
      <CreateIndependentNodeDialog
        onClose={() => setCreateNodeOpen(false)}
        onCreated={(detail) => {
          setCreateNodeOpen(false);
          setReloadToken((value) => value + 1);
          pushToast("节点已创建。");
          navigate(buildNodeSettingsPath(detail.node_uuid));
        }}
        onUnauthorized={props.onUnauthorized}
        open={createNodeOpen}
      />
      <PageHeader
        title="节点列表"
        subtitle={`${nodes.length} 个已接入节点`}
        actions={
          <>
            {showSearch ? (
              <SearchBox value={searchInput} onChange={setSearchInput} onSubmit={() => setSearchQuery(searchInput.trim())} />
            ) : null}
            <Button
              className="rounded-xl bg-indigo-500 text-white hover:bg-indigo-600"
              onClick={() => setCreateNodeOpen(true)}
              type="button"
            >
              <Plus className="size-4" />
              <span>新建节点</span>
            </Button>
          </>
        }
      />

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-2 pb-4">
          <h2 className="text-base font-semibold text-slate-900">IP 质量结果</h2>
          <span className="inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-xs text-slate-500">
            {nodes.length} 个节点
          </span>
        </div>

        {loading ? (
          <div className="grid gap-3 px-2 py-6">
            <div className="h-14 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-14 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-14 animate-pulse rounded-2xl bg-slate-100" />
          </div>
        ) : error ? (
          <div className="grid gap-4 px-2 py-8">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">{error}</div>
            <div>
              <Button
                className="rounded-xl border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-white hover:text-indigo-600"
                onClick={() => setReloadToken((value) => value + 1)}
                type="button"
              >
                <RotateCcw className="size-4" />
                <span>重试</span>
              </Button>
            </div>
          </div>
        ) : nodes.length === 0 ? (
          <div className="px-2 py-6">
            <div className="grid gap-4 rounded-[22px] border border-slate-200 bg-slate-50 p-6">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-slate-900">还没有节点</h3>
                <p className="text-sm leading-6 text-slate-500">
                  先复制 Header 到 Komari，然后在节点详情页点击“添加 IP 质量检测”。
                </p>
              </div>
              <div>
                <Button
                  className="rounded-xl bg-indigo-500 text-white hover:bg-indigo-600"
                  onClick={() => setCreateNodeOpen(true)}
                  type="button"
                >
                  <Plus className="size-4" />
                  <span>新建节点</span>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-[18px] border border-slate-200">
            <div className="react-node-list-head bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              <span>节点</span>
              <span className="text-center">来源</span>
              <span className="text-center">状态</span>
              <span className="text-center">最近更新</span>
            </div>
            <div className="react-node-list-body">
              {nodes.map((item) => {
                const routeID = nodeRouteID(item);
                return (
                <div
                  key={routeID}
                  className="react-node-list-row cursor-pointer border-t border-slate-200 px-4 py-4 text-sm text-slate-700 transition hover:bg-slate-50 first:border-t-0"
                  data-node-row="true"
                  data-node-binding-state={item.binding_state}
                  data-node-uuid={routeID}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(`/nodes/${routeID}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(`/nodes/${routeID}`);
                    }
                  }}
                >
                  <div className="min-w-0">
                    <strong className="block truncate text-sm font-semibold text-slate-900" data-node-name="true">
                      {item.name}
                    </strong>
                  </div>
                  <div className="flex min-w-0 justify-center">
                    <span
                      className={[
                        "inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-xs font-medium",
                        item.binding_state === "komari_bound"
                          ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                      ].join(" ")}
                      data-node-binding-label="true"
                      title={item.binding_state === "komari_bound" && item.komari_node_name ? item.komari_node_name : undefined}
                    >
                      <span className="truncate">{nodeBindingLabel(item)}</span>
                    </span>
                  </div>
                  <div className="flex min-w-0 justify-center">
                    <StatusPill hasData={item.has_data} />
                  </div>
                  <div className="min-w-0 text-center text-sm text-slate-500">{formatDateTime(item.updated_at ?? undefined)}</div>
                </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </section>
  );
}
