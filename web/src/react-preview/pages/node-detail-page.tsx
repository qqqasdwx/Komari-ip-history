import { type FormEvent, useEffect, useState } from "react";
import {
  Pencil,
  Plug,
  Unlink
} from "lucide-react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import {
  buildReportConfigListPath,
  toStandaloneAppURL
} from "../lib/embed-navigation";
import { apiRequest, RequestError, UnauthorizedError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { CurrentReportView } from "../lib/report";
import { useNodePageData } from "../hooks/node-data";
import type { KomariBindingCandidate, MeResponse, NodeDetail } from "../lib/types";
import { PageHeader } from "../components/layout/page-header";
import { NodeDetailLoading } from "../components/node/node-detail-loading";
import { NodePageError } from "../components/node/node-page-error";
import { TargetTabs } from "../components/node/target-tabs";
import { Button } from "../components/ui/button";
import { EmbedBridgePage } from "./embed-bridge-page";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

function RenameNodeDialog(props: {
  node: NodeDetail;
  open: boolean;
  onClose: () => void;
  onSaved: (detail: NodeDetail) => void;
  onUnauthorized: () => void;
}) {
  const [name, setName] = useState(props.node.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setName(props.node.name);
    setError("");
    setSaving(false);
  }, [props.node.name, props.open]);

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
      const detail = await apiRequest<NodeDetail>(`/nodes/${props.node.node_uuid}`, {
        method: "PATCH",
        body: JSON.stringify({ name: trimmedName })
      });
      props.onSaved(detail);
    } catch (renameError) {
      if (renameError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(renameError instanceof Error ? renameError.message : "保存失败");
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
            <h2 className="text-base font-semibold text-slate-900">重命名节点</h2>
            <p className="text-sm text-slate-500">这里只修改 IPQ 节点名称，不会改动 Komari 节点名称。</p>
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
            <Label className="text-slate-900" htmlFor="node-rename-name">
              节点名称
            </Label>
            <Input
              autoFocus
              className="h-11 rounded-xl px-3 focus:border-indigo-300 focus:ring-indigo-100"
              id="node-rename-name"
              onChange={(event) => setName(event.target.value)}
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
              保存
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function KomariBindingDialog(props: {
  node: NodeDetail;
  open: boolean;
  onClose: () => void;
  onBound: (detail: NodeDetail) => void;
  onUnauthorized: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [bindingUUID, setBindingUUID] = useState("");
  const [items, setItems] = useState<KomariBindingCandidate[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!props.open) {
      return undefined;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await apiRequest<{ items: KomariBindingCandidate[] }>(
          `/nodes/${props.node.node_uuid}/komari-binding/candidates`
        );
        if (!cancelled) {
          setItems(response.items ?? []);
        }
      } catch (loadError) {
        if (loadError instanceof UnauthorizedError) {
          props.onUnauthorized();
          return;
        }
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载候选列表失败");
        }
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
  }, [props.node.node_uuid, props.onUnauthorized, props.open]);

  async function bindCandidate(candidate: KomariBindingCandidate) {
    if (!candidate.available || bindingUUID) {
      return;
    }
    setBindingUUID(candidate.komari_node_uuid);
    setError("");
    try {
      const detail = await apiRequest<NodeDetail>(`/nodes/${props.node.node_uuid}/komari-binding`, {
        method: "POST",
        body: JSON.stringify({ komari_node_uuid: candidate.komari_node_uuid })
      });
      props.onBound(detail);
    } catch (bindError) {
      if (bindError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      if (bindError instanceof RequestError && bindError.status === 409) {
        setError("这个 Komari 节点已经被其它 IPQ 节点绑定。");
      } else {
        setError(bindError instanceof Error ? bindError.message : "绑定失败");
      }
    } finally {
      setBindingUUID("");
    }
  }

  if (!props.open) {
    return null;
  }

  return (
    <div className="field-modal-backdrop" onClick={props.onClose}>
      <section className="field-modal max-w-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="field-modal-head">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">绑定 Komari 节点</h2>
            <p className="text-sm text-slate-500">选择从 Komari 入口发现、尚未配置目标 IP 的节点。</p>
          </div>
          <Button
            className="rounded-lg border border-[var(--line)] bg-white px-3 text-[13px] text-[var(--ink)] hover:bg-slate-50"
            onClick={props.onClose}
            type="button"
          >
            关闭
          </Button>
        </div>
        <div className="field-modal-body space-y-3" data-komari-binding-candidates="true">
          {loading ? (
            <div className="grid gap-2">
              <div className="h-14 animate-pulse rounded-2xl bg-slate-100" />
              <div className="h-14 animate-pulse rounded-2xl bg-slate-100" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              暂无可选择的 Komari 节点。先在 Komari 节点页点击“去接入”，这里会出现待绑定候选。
            </div>
          ) : (
            items.map((item) => (
              <div
                className="grid gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto]"
                data-komari-binding-candidate="true"
                data-komari-binding-candidate-available={item.available ? "true" : "false"}
                key={item.komari_node_uuid}
              >
                <div className="min-w-0 space-y-1">
                  <strong className="block truncate text-slate-900">{item.komari_node_name || item.komari_node_uuid}</strong>
                  <p className="truncate text-xs text-slate-400">{item.komari_node_uuid}</p>
                  <p className="text-xs text-slate-500">
                    {item.current
                      ? "当前绑定"
                      : item.available
                        ? "可绑定"
                        : `已被 ${item.bound_node_name || item.bound_node_uuid} 使用`}
                  </p>
                </div>
                <Button
                  className={[
                    "h-10 rounded-xl px-4 text-sm",
                    item.available
                      ? "bg-indigo-500 text-white hover:bg-indigo-600"
                      : "border border-slate-200 bg-slate-50 text-slate-400"
                  ].join(" ")}
                  disabled={!item.available || bindingUUID !== ""}
                  onClick={() => void bindCandidate(item)}
                  type="button"
                >
                  {bindingUUID === item.komari_node_uuid ? "绑定中" : item.available ? "绑定" : "不可绑定"}
                </Button>
              </div>
            ))
          )}
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        </div>
      </section>
    </div>
  );
}

export function NodeDetailPage(props: { me: MeResponse; onUnauthorized: () => void }) {
  const { uuid = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const komariReturn = searchParams.get("komari_return")?.trim() || "";
  const nodeName = searchParams.get("node_name")?.trim() || "未命名节点";
  const selectedTargetID = Number(searchParams.get("target_id") || "") || null;
  const { loading, refreshing, error, errorStatus, detail, reload } = useNodePageData(uuid, selectedTargetID, props.onUnauthorized);
  const [showDelayedRefreshing, setShowDelayedRefreshing] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [bindingOpen, setBindingOpen] = useState(false);
  const [bindingBusy, setBindingBusy] = useState(false);
  const [bindingError, setBindingError] = useState("");

  useEffect(() => {
    if (!refreshing) {
      setShowDelayedRefreshing(false);
      return undefined;
    }
    const timeoutID = window.setTimeout(() => setShowDelayedRefreshing(true), 180);
    return () => window.clearTimeout(timeoutID);
  }, [refreshing]);

  useEffect(() => {
    setRenameOpen(false);
    setBindingOpen(false);
    setBindingError("");
  }, [uuid]);

  function replaceTargetSelection(targetID: number | null) {
    const params = new URLSearchParams(searchParams);
    if (targetID) {
      params.set("target_id", String(targetID));
    } else {
      params.delete("target_id");
    }
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: true });
  }

  const currentTargetID = detail?.selected_target_id ?? detail?.current_target?.id ?? selectedTargetID ?? null;
  const activeNodeUUID = detail?.node_uuid || uuid;
  const targetQuery = currentTargetID ? `?target_id=${currentTargetID}` : "";
  const historyPath = `/nodes/${activeNodeUUID}/history${targetQuery}`;

  function goToReportConfig() {
    const path = buildReportConfigListPath(activeNodeUUID);
    if (isEmbed) {
      window.location.assign(toStandaloneAppURL(path));
      return;
    }
    navigate(path);
  }

  async function unbindKomari() {
    if (!detail || bindingBusy) {
      return;
    }
    setBindingBusy(true);
    setBindingError("");
    try {
      const updated = await apiRequest<NodeDetail>(`/nodes/${detail.node_uuid}/komari-binding`, { method: "DELETE" });
      navigate(`/nodes/${updated.node_uuid}`, { replace: true });
      reload();
    } catch (unbindError) {
      if (unbindError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setBindingError(unbindError instanceof Error ? unbindError.message : "解绑失败");
    } finally {
      setBindingBusy(false);
    }
  }

  if (loading && !detail) {
    return <NodeDetailLoading />;
  }

  if (isEmbed && errorStatus === 404 && komariReturn) {
    return (
      <EmbedBridgePage
        title="接入节点"
        description="当前节点尚未配置，正在打开独立页面继续。"
        actionURL={buildReportConfigListPath(uuid, { fromKomari: true, nodeName })}
        actionLabel="去接入"
      />
    );
  }

  if ((error && !detail) || !detail) {
    return (
      <NodePageError
        title="节点详情"
        subtitle={error || "节点不存在"}
        backTo="/nodes"
        error={error || "节点不存在。"}
        onRetry={reload}
      />
    );
  }

  return (
    <section className={isEmbed ? "embed-detail-page space-y-4" : "space-y-6"}>
      {!isEmbed && detail ? (
        <>
          <RenameNodeDialog
            node={detail}
            onClose={() => setRenameOpen(false)}
            onSaved={(updated) => {
              setRenameOpen(false);
              navigate(`/nodes/${updated.node_uuid}`, { replace: true });
              reload();
            }}
            onUnauthorized={props.onUnauthorized}
            open={renameOpen}
          />
          <KomariBindingDialog
            node={detail}
            onBound={(updated) => {
              setBindingOpen(false);
              navigate(`/nodes/${updated.node_uuid}`, { replace: true });
              reload();
            }}
            onClose={() => setBindingOpen(false)}
            onUnauthorized={props.onUnauthorized}
            open={bindingOpen}
          />
        </>
      ) : null}
      <PageHeader
        title={detail.name}
        subtitle={detail.has_data ? `最近更新: ${formatDateTime(detail.updated_at ?? undefined)}` : "当前还没有任何 IP 结果"}
        backTo={isEmbed ? undefined : "/nodes"}
        actions={
          !isEmbed ? (
            <>
              <Button
                className="rounded-xl border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-white hover:text-indigo-600"
                onClick={() => setRenameOpen(true)}
                type="button"
              >
                <Pencil className="size-4" />
                <span>重命名</span>
              </Button>
              {detail.current_target ? (
                <Button
                  asChild
                  className="rounded-xl border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-white hover:text-indigo-600"
                >
                  <Link to={historyPath}>查看历史记录</Link>
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />

      {!isEmbed ? (
        <section
          className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm"
          data-node-binding-panel="true"
        >
          <div className="min-w-0 space-y-1">
            <h2 className="text-sm font-semibold text-slate-900">Komari 绑定</h2>
            <p className="text-sm text-slate-500" data-node-binding-state="true">
              {detail.binding_state === "komari_bound"
                ? `已绑定：${detail.komari_node_name || detail.komari_node_uuid}`
                : "当前是独立节点"}
            </p>
            {detail.binding_state === "komari_bound" ? (
              <p className="truncate text-xs text-slate-400">{detail.komari_node_uuid}</p>
            ) : null}
            {bindingError ? <p className="text-sm text-rose-600">{bindingError}</p> : null}
          </div>
          {detail.binding_state === "komari_bound" ? (
            <Button
              className="rounded-xl border border-slate-200 bg-white text-slate-700 hover:border-rose-300 hover:bg-white hover:text-rose-600"
              disabled={bindingBusy}
              onClick={() => void unbindKomari()}
              type="button"
            >
              <Unlink className="size-4" />
              <span>{bindingBusy ? "解绑中" : "解除绑定"}</span>
            </Button>
          ) : (
            <Button
              className="rounded-xl bg-indigo-500 text-white hover:bg-indigo-600"
              onClick={() => setBindingOpen(true)}
              type="button"
            >
              <Plug className="size-4" />
              <span>绑定 Komari</span>
            </Button>
          )}
        </section>
      ) : null}

      <section className={isEmbed ? "embed-detail-card rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm" : "rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm"}>
        <div className="section space-y-4">
          {detail.targets.length > 0 ? (
            <TargetTabs
              items={detail.targets.map((item) => ({ id: item.id, label: item.ip, has_data: item.has_data }))}
              selectedId={detail.selected_target_id ?? detail.current_target?.id ?? null}
              onSelect={(targetID) => replaceTargetSelection(targetID)}
              variant="attached"
            />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              <span>当前节点还没有目标 IP。</span>
              {!isEmbed ? (
                <Button className="rounded-lg bg-[var(--accent)] px-3 text-[13px] text-white hover:bg-[#6868e8]" onClick={goToReportConfig} type="button">
                  去接入
                </Button>
              ) : null}
            </div>
          )}
        </div>

        {detail.current_target ? (
          <>
            <div className="section">
              <div className="detail-target-panel" data-detail-report="true">
                {showDelayedRefreshing ? (
                  <div className="flex min-h-[240px] items-center justify-center rounded-[20px] border border-slate-200 bg-slate-50 text-sm text-slate-500">
                    加载中…
                  </div>
                ) : (
                  <CurrentReportView
                    result={detail.current_target.current_result}
                    hiddenPaths={[]}
                    compact={isEmbed}
                  />
                )}
              </div>
            </div>
          </>
        ) : null}
      </section>
    </section>
  );
}
