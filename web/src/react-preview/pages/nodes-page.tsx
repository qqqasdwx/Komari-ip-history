import {
  Plus,
  RotateCcw,
  Settings
} from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useState
} from "react";
import {
  Link,
  useNavigate,
  useSearchParams
} from "react-router-dom";
import { apiRequest, RequestError, UnauthorizedError } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { formatDateTime } from "../lib/format";
import { useNodePageData } from "../hooks/node-data";
import type {
  MeResponse,
  NodeDetail,
  NodeListItem,
  NodeReportConfigPreview,
  NodeTargetListItem
} from "../lib/types";
import { PageHeader } from "../components/layout/page-header";
import { SearchBox } from "../components/common/search-box";
import { StatusPill } from "../components/node/status-pill";
import { TargetTabs } from "../components/node/target-tabs";
import { pushToast } from "../components/toast";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

const githubRawInstallScriptURL = "https://raw.githubusercontent.com/qqqasdwx/Komari-ip-history/master/deploy/install.sh";

function resolvePublicBaseURL(me: MeResponse) {
  const publicBaseURL = (me.effective_public_base_url ?? me.public_base_url ?? "").replace(/\/$/, "");
  return publicBaseURL || window.location.origin;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildInstallCommand(
  publicBaseURL: string,
  installToken: string
) {
  const args = ["-e", publicBaseURL, "-t", installToken];
  const argString = args.map(shellQuote).join(" ");
  return `curl -fsSL ${shellQuote(githubRawInstallScriptURL)} | { SUDO=$(command -v sudo || true); [ "$(id -u)" -eq 0 ] && SUDO=; \${SUDO:-} bash -s -- ${argString}; }`;
}

function ReportConfigSection(props: {
  me: MeResponse;
  detail: NodeDetail;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  targetInput: string;
  targetError: string;
  targetSaving: boolean;
  onTargetInputChange: (value: string) => void;
  onAddTarget: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteCurrentTarget: (targetID: number) => void;
  onSelectTarget: (targetID: number) => void;
  onReorderTargets: (sourceID: number, destinationID: number) => void;
}) {
  const publicBaseURL = resolvePublicBaseURL(props.me);
  const [scheduleCron, setScheduleCron] = useState(props.detail.report_config.schedule_cron);
  const [runImmediately, setRunImmediately] = useState(props.detail.report_config.run_immediately);
  const [preview, setPreview] = useState<NodeReportConfigPreview>({
    schedule_cron: props.detail.report_config.schedule_cron,
    run_immediately: props.detail.report_config.run_immediately,
    next_runs: props.detail.report_config.next_runs
  });
  const [previewError, setPreviewError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [persistedConfig, setPersistedConfig] = useState({
    scheduleCron: props.detail.report_config.schedule_cron,
    runImmediately: props.detail.report_config.run_immediately
  });
  const installCommand = buildInstallCommand(
    publicBaseURL,
    props.detail.report_config.install_token
  );

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setScheduleCron(props.detail.report_config.schedule_cron);
    setRunImmediately(props.detail.report_config.run_immediately);
    setPreview({
      schedule_cron: props.detail.report_config.schedule_cron,
      run_immediately: props.detail.report_config.run_immediately,
      next_runs: props.detail.report_config.next_runs
    });
    setPersistedConfig({
      scheduleCron: props.detail.report_config.schedule_cron,
      runImmediately: props.detail.report_config.run_immediately
    });
    setPreviewError("");
    setSaveError("");
    setSaveState("idle");
  }, [
    props.open,
    props.detail.report_config.next_runs,
    props.detail.report_config.run_immediately,
    props.detail.report_config.schedule_cron
  ]);

  useEffect(() => {
    if (!props.open) {
      return undefined;
    }
    const controller = new AbortController();
    const timeoutID = window.setTimeout(async () => {
      try {
        const search = new URLSearchParams();
        search.set("cron", scheduleCron);
        search.set("run_immediately", runImmediately ? "1" : "0");
        const data = await apiRequest<NodeReportConfigPreview>(`/nodes/${props.detail.komari_node_uuid}/report-config/preview?${search.toString()}`, {
          signal: controller.signal
        });
        setPreview(data);
        setPreviewError("");
      } catch (error) {
        if (error instanceof RequestError) {
          setPreviewError(error.message || "Cron 表达式无效。");
          return;
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setPreviewError("无法预览当前计划。");
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timeoutID);
    };
  }, [props.detail.komari_node_uuid, props.open, runImmediately, scheduleCron]);

  useEffect(() => {
    if (!props.open || previewError) {
      return undefined;
    }
    const normalizedCron = preview.schedule_cron.trim();
    if (
      normalizedCron === persistedConfig.scheduleCron &&
      runImmediately === persistedConfig.runImmediately
    ) {
      return undefined;
    }

    let cancelled = false;
    const timeoutID = window.setTimeout(async () => {
      setSaveState("saving");
      setSaveError("");
      try {
        const config = await apiRequest<NodeDetail["report_config"]>(`/nodes/${props.detail.komari_node_uuid}/report-config`, {
          method: "PUT",
          body: JSON.stringify({
            schedule_cron: normalizedCron,
            run_immediately: runImmediately
          })
        });
        if (cancelled) {
          return;
        }
        setPersistedConfig({
          scheduleCron: config.schedule_cron,
          runImmediately: config.run_immediately
        });
        setScheduleCron(config.schedule_cron);
        setRunImmediately(config.run_immediately);
        setPreview({
          schedule_cron: config.schedule_cron,
          run_immediately: config.run_immediately,
          next_runs: config.next_runs
        });
        setSaveState("saved");
        props.onSaved();
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (error instanceof RequestError) {
          setSaveError(error.message || "保存失败。");
        } else {
          setSaveError("保存失败。");
        }
        setSaveState("idle");
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutID);
    };
  }, [
    persistedConfig.runImmediately,
    persistedConfig.scheduleCron,
    preview.schedule_cron,
    previewError,
    props.detail.komari_node_uuid,
    props.onSaved,
    props.open,
    runImmediately
  ]);

  async function handleCopy(value: string, successText: string) {
    try {
      await copyText(value);
      pushToast(successText);
    } catch {
      pushToast("复制失败，请手动复制。", "error");
    }
  }

  if (!props.open) {
    return null;
  }

  return (
    <div className="field-modal-backdrop" onClick={props.onClose}>
      <section
        className="field-modal report-config-modal"
        data-node-report-config="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="field-modal-head">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">节点上报设置</h2>
            <p className="text-sm text-slate-500">统一管理目标 IP、执行计划和接入命令。</p>
          </div>
          <Button
            className="rounded-lg border border-[var(--line)] bg-white px-3 text-[13px] text-[var(--ink)] hover:bg-slate-50"
            onClick={props.onClose}
            type="button"
          >
            关闭
          </Button>
        </div>
        <div className="field-modal-body">
        <div className="space-y-1">
          {props.detail.report_config.target_ips.length > 0 ? (
            <p className="text-sm text-slate-500">当前命令会顺序探查以下 IP，并逐个上报结果。</p>
          ) : (
            <p className="text-sm text-slate-500">请先添加目标 IP，添加后才会生成接入命令。</p>
          )}
        </div>
        <div className="space-y-4 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-900">目标 IP</h3>
              <p className="text-sm text-slate-500">拖拽可调整顺序，接入命令会按当前顺序依次探查。</p>
            </div>
          </div>
          {props.detail.targets.length > 0 ? (
            <TargetTabs
              items={props.detail.targets.map((item) => ({ id: item.id, label: item.ip, has_data: item.has_data }))}
              onDelete={(targetID) => void props.onDeleteCurrentTarget(targetID)}
              onReorder={(sourceID, destinationID) => void props.onReorderTargets(sourceID, destinationID)}
              onSelect={(targetID) => props.onSelectTarget(targetID)}
              selectedId={props.detail.selected_target_id ?? props.detail.current_target?.id ?? null}
            />
          ) : (
            <div className="rounded-[20px] border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
              当前节点还没有目标 IP，请先添加。
            </div>
          )}
          <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_48px]" onSubmit={props.onAddTarget}>
            <div className="grid min-w-0 gap-2">
              <Label className="sr-only" htmlFor="report-config-target-ip">
                目标 IP
              </Label>
              <Input
                className="h-11 rounded-xl px-3 focus:border-indigo-300 focus:ring-indigo-100"
                id="report-config-target-ip"
                onChange={(event) => props.onTargetInputChange(event.target.value)}
                placeholder="例如 1.1.1.1 或 2606:4700:4700::1111"
                value={props.targetInput}
              />
            </div>
            <Button
              aria-label="添加 IP"
              className="h-11 w-12 rounded-xl bg-indigo-500 px-0 text-white hover:bg-indigo-600 disabled:bg-indigo-300"
              disabled={props.targetSaving || !props.targetInput.trim()}
              type="submit"
            >
              <Plus className="size-4" />
            </Button>
          </form>
          {props.targetError ? <p className="text-sm text-rose-600">{props.targetError}</p> : null}
        </div>
        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-1">
            <Label className="text-slate-900" htmlFor="report-config-cron">
              Cron
            </Label>
            <Input
              className="rounded-xl px-3 py-2 focus:border-slate-400"
              id="report-config-cron"
              onChange={(event) => setScheduleCron(event.target.value)}
              placeholder="0 0 * * *"
              spellCheck={false}
              value={scheduleCron}
            />
            <p className="text-xs text-slate-500">默认每天 0 点执行，使用标准 5 段 cron 表达式。</p>
          </div>
          <label className="space-y-1 text-sm text-slate-700">
            <span className="font-medium text-slate-900">安装后立即执行一次</span>
            <span className="flex h-11 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <input checked={runImmediately} onChange={(event) => setRunImmediately(event.target.checked)} type="checkbox" />
              <span>启用</span>
            </span>
          </label>
        </div>
        {previewError ? <p className="text-sm font-medium text-rose-600">{previewError}</p> : null}
        {!previewError && saveError ? <p className="text-sm font-medium text-rose-600">{saveError}</p> : null}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <strong className="text-sm text-slate-900">最近 10 次执行时间</strong>
            <span className="text-xs text-slate-500">
              {previewError ? "请先修正 Cron" : saveState === "saving" ? "正在保存…" : saveState === "saved" ? "已自动保存" : "自动保存"}
            </span>
          </div>
          <div className="report-config-next-runs">
            {preview.next_runs.map((value) => (
              <div key={value} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {formatDateTime(value)}
              </div>
            ))}
          </div>
        </div>
        {props.detail.report_config.target_ips.length > 0 ? (
          <>
            <div className="summary-section">
              <div className="summary-head">
                <strong>接入命令</strong>
                <Button
                  className="rounded-lg border border-[var(--line)] bg-white px-3 text-[13px] text-[var(--ink)] hover:bg-slate-50"
                  disabled={previewError !== ""}
                  onClick={() => void handleCopy(installCommand, "接入命令已复制。")}
                  type="button"
                >
                  复制
                </Button>
              </div>
              <pre className="code-block report-config-command">{installCommand}</pre>
            </div>
          </>
        ) : null}
        </div>
      </section>
    </div>
  );
}

function NodeReportConfigDialog(props: {
  me: MeResponse;
  nodeUUID: string;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [selectedTargetID, setSelectedTargetID] = useState<number | null>(null);
  const [targetInput, setTargetInput] = useState("");
  const [targetError, setTargetError] = useState("");
  const [targetSaving, setTargetSaving] = useState(false);
  const { loading, error, detail, reload } = useNodePageData(props.nodeUUID, selectedTargetID, props.onUnauthorized);
  const [localDetail, setLocalDetail] = useState<NodeDetail | null>(null);

  useEffect(() => {
    setSelectedTargetID(null);
    setTargetInput("");
    setTargetError("");
  }, [props.nodeUUID]);

  useEffect(() => {
    setLocalDetail(detail);
  }, [detail]);

  async function handleAddTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTargetSaving(true);
    setTargetError("");
    try {
      const created = await apiRequest<NodeTargetListItem>(`/nodes/${props.nodeUUID}/targets`, {
        method: "POST",
        body: JSON.stringify({ ip: targetInput.trim() })
      });
      setTargetInput("");
      setSelectedTargetID(created.id);
      setLocalDetail((current) =>
        current
          ? {
              ...current,
              targets: [...current.targets, created].sort((a, b) => a.sort_order - b.sort_order),
              selected_target_id: created.id
            }
          : current
      );
      reload();
    } catch (targetCreateError) {
      if (targetCreateError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setTargetError(targetCreateError instanceof Error ? targetCreateError.message : "添加目标 IP 失败");
    } finally {
      setTargetSaving(false);
    }
  }

  async function handleDeleteTarget(targetID: number) {
    const previousDetail = localDetail;
    setTargetSaving(true);
    setTargetError("");
    try {
      setLocalDetail((current) => {
        if (!current) {
          return current;
        }
        const nextTargets = current.targets.filter((item) => item.id !== targetID);
        const nextSelectedTargetID =
          current.selected_target_id === targetID
            ? nextTargets[0]?.id ?? null
            : current.selected_target_id ?? nextTargets[0]?.id ?? null;
        const nextCurrentTarget =
          current.current_target?.id === targetID
            ? null
            : current.current_target && nextTargets.some((item) => item.id === current.current_target?.id)
              ? current.current_target
              : null;
        return {
          ...current,
          targets: nextTargets,
          selected_target_id: nextSelectedTargetID,
          current_target: nextCurrentTarget,
          report_config: {
            ...current.report_config,
            target_ips: nextTargets.map((item) => item.ip)
          }
        };
      });
      setSelectedTargetID((current) => (current === targetID ? null : current));
      await apiRequest(`/nodes/${props.nodeUUID}/targets/${targetID}`, { method: "DELETE" });
    } catch (targetDeleteError) {
      setLocalDetail(previousDetail);
      if (targetDeleteError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setTargetError(targetDeleteError instanceof Error ? targetDeleteError.message : "删除目标 IP 失败");
    } finally {
      setTargetSaving(false);
    }
  }

  async function handleReorderTargets(sourceID: number, destinationID: number) {
    if (!localDetail) {
      return;
    }

    const orderedIDs = localDetail.targets.map((item) => item.id);
    const sourceIndex = orderedIDs.indexOf(sourceID);
    const destinationIndex = orderedIDs.indexOf(destinationID);
    if (sourceIndex === -1 || destinationIndex === -1 || sourceIndex === destinationIndex) {
      return;
    }

    const next = [...orderedIDs];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(destinationIndex, 0, moved);

    setTargetSaving(true);
    setTargetError("");
    try {
      setLocalDetail((current) => {
        if (!current) {
          return current;
        }
        const targetMap = new Map(current.targets.map((item) => [item.id, item]));
        const reorderedTargets = next
          .map((id, index) => {
            const item = targetMap.get(id);
            if (!item) {
              return null;
            }
            return { ...item, sort_order: index };
          })
          .filter((item): item is NodeTargetListItem => item !== null);
        return {
          ...current,
          targets: reorderedTargets,
          report_config: {
            ...current.report_config,
            target_ips: reorderedTargets.map((item) => item.ip)
          }
        };
      });
      await apiRequest(`/nodes/${props.nodeUUID}/targets/reorder`, {
        method: "POST",
        body: JSON.stringify({ target_ids: next })
      });
    } catch (reorderError) {
      setLocalDetail(detail);
      if (reorderError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setTargetError(reorderError instanceof Error ? reorderError.message : "调整目标 IP 顺序失败");
    } finally {
      setTargetSaving(false);
    }
  }

  if (loading && !localDetail) {
    return (
      <div className="field-modal-backdrop" onClick={props.onClose}>
        <section className="field-modal report-config-modal" onClick={(event) => event.stopPropagation()}>
          <div className="field-modal-head">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900">节点上报设置</h2>
              <p className="text-sm text-slate-500">正在加载当前节点配置。</p>
            </div>
            <Button
              className="rounded-lg border border-[var(--line)] bg-white px-3 text-[13px] text-[var(--ink)] hover:bg-slate-50"
              onClick={props.onClose}
              type="button"
            >
              关闭
            </Button>
          </div>
          <div className="field-modal-body">
            <div className="grid gap-3">
              <div className="h-12 animate-pulse rounded-2xl bg-slate-100" />
              <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
              <div className="h-28 animate-pulse rounded-2xl bg-slate-100" />
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (error || !localDetail) {
    return (
      <div className="field-modal-backdrop" onClick={props.onClose}>
        <section className="field-modal report-config-modal" onClick={(event) => event.stopPropagation()}>
          <div className="field-modal-head">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900">节点上报设置</h2>
              <p className="text-sm text-slate-500">加载失败，请重试。</p>
            </div>
            <Button
              className="rounded-lg border border-[var(--line)] bg-white px-3 text-[13px] text-[var(--ink)] hover:bg-slate-50"
              onClick={props.onClose}
              type="button"
            >
              关闭
            </Button>
          </div>
          <div className="field-modal-body space-y-4">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
              {error || "加载节点上报设置失败。"}
            </div>
            <div>
              <Button
                className="rounded-lg bg-[var(--accent)] px-3 text-[13px] text-white hover:bg-[#6868e8]"
                onClick={reload}
                type="button"
              >
                重试
              </Button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <ReportConfigSection
      detail={localDetail}
      me={props.me}
      onAddTarget={handleAddTarget}
      onClose={props.onClose}
      onSaved={reload}
      onDeleteCurrentTarget={(targetID) => void handleDeleteTarget(targetID)}
      onReorderTargets={(sourceID, destinationID) => void handleReorderTargets(sourceID, destinationID)}
      onSelectTarget={(targetID) => setSelectedTargetID(targetID)}
      onTargetInputChange={setTargetInput}
      open={true}
      targetError={targetError}
      targetInput={targetInput}
      targetSaving={targetSaving}
    />
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
  const [reportConfigNodeUUID, setReportConfigNodeUUID] = useState("");

  useEffect(() => {
    const requestedUUID = searchParams.get("report_config")?.trim() || "";
    setReportConfigNodeUUID(requestedUUID);
  }, [searchParams]);

  function openReportConfig(uuid: string) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("report_config", uuid);
    navigate(`/nodes?${nextParams.toString()}`, { replace: true });
    setReportConfigNodeUUID(uuid);
  }

  function closeReportConfig() {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("report_config");
    const query = nextParams.toString();
    navigate(`/nodes${query ? `?${query}` : ""}`, { replace: true });
    setReportConfigNodeUUID("");
  }

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
      {reportConfigNodeUUID ? (
        <NodeReportConfigDialog
          me={props.me}
          nodeUUID={reportConfigNodeUUID}
          onClose={closeReportConfig}
          onUnauthorized={props.onUnauthorized}
        />
      ) : null}
      <PageHeader
        title="节点列表"
        subtitle={`${nodes.length} 个已接入节点`}
        actions={
          showSearch ? (
            <SearchBox value={searchInput} onChange={setSearchInput} onSubmit={() => setSearchQuery(searchInput.trim())} />
          ) : undefined
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
                  asChild
                  className="rounded-xl bg-indigo-500 text-white hover:bg-indigo-600"
                >
                  <Link to="/settings/integration">去接入</Link>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-[18px] border border-slate-200">
            <div className="react-node-list-head bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              <span>节点</span>
              <span className="text-center">状态</span>
              <span className="text-center">最近更新</span>
              <span className="text-center">操作</span>
            </div>
            <div className="react-node-list-body">
              {nodes.map((item) => (
                <div
                  key={item.komari_node_uuid}
                  className="react-node-list-row cursor-pointer border-t border-slate-200 px-4 py-4 text-sm text-slate-700 transition hover:bg-slate-50 first:border-t-0"
                  data-node-row="true"
                  data-node-uuid={item.komari_node_uuid}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(`/nodes/${item.komari_node_uuid}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(`/nodes/${item.komari_node_uuid}`);
                    }
                  }}
                >
                  <div className="min-w-0">
                    <strong className="block truncate text-sm font-semibold text-slate-900" data-node-name="true">
                      {item.name}
                    </strong>
                  </div>
                  <div className="flex min-w-0 justify-center">
                    <StatusPill hasData={item.has_data} />
                  </div>
                  <div className="min-w-0 text-center text-sm text-slate-500">{formatDateTime(item.updated_at ?? undefined)}</div>
                  <div className="flex items-center justify-center gap-2">
                    <Button
                      aria-label="上报设置"
                      className="h-9 w-9 rounded-xl border border-slate-200 bg-white p-0 text-slate-700 hover:border-indigo-300 hover:bg-white hover:text-indigo-600"
                      data-node-report-settings="true"
                      onClick={(event) => {
                        event.stopPropagation();
                        openReportConfig(item.komari_node_uuid);
                      }}
                      type="button"
                    >
                      <Settings className="size-4" />
                    </Button>
                    <span className="text-sm font-semibold text-indigo-600">查看</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </section>
  );
}
