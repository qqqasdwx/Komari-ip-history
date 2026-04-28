import {
  ExitIcon,
  GearIcon,
  PlusIcon,
  ReloadIcon,
  RowsIcon
} from "@radix-ui/react-icons";
import {
  type FormEvent,
  useEffect,
  useRef,
  useState
} from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import { apiRequest, RequestError, UnauthorizedError } from "./lib/api";
import { copyText } from "./lib/clipboard";
import { renderDisplayValueBadge } from "./lib/display-fields";
import {
  buildConnectPath,
  buildReportConfigListPath,
  toStandaloneAppURL
} from "./lib/embed-navigation";
import { formatDateTime } from "./lib/format";
import {
  describeHistoryDateRange,
  historyDateRangePresets,
  historyInputValueToQueryValue,
  historyQueryValueToInputValue
} from "./lib/history-date";
import { buildHistoryCompareRows, mapDisplayPathToReportPaths } from "./lib/history";
import { CurrentReportView } from "./lib/report";
import { routeLabel } from "./lib/route-label";
import {
  useAllNodeHistoryData,
  useNodeHistoryEvents,
  useNodeHistoryFieldOptions,
  useNodePageData,
  usePublicNodePageData
} from "./hooks/node-data";
import type {
  MeResponse,
  NodeDetail,
  NodeReportConfigPreview,
  NodeHistoryEntry,
  NodeListItem,
  NodeTargetListItem
} from "./lib/types";
import { AppLoading } from "./components/layout/app-loading";
import { HistoryPagination } from "./components/history/history-pagination";
import {
  EmbedFrameShell,
  getEmbedAppearance,
  getEmbedGlassStyle,
  getEmbedTheme
} from "./components/layout/embed-frame-shell";
import { PageHeader } from "./components/layout/page-header";
import { SidebarSection, type NavItem } from "./components/layout/sidebar-section";
import { SearchBox } from "./components/common/search-box";
import { NodeDetailLoading } from "./components/node/node-detail-loading";
import { NodePageError } from "./components/node/node-page-error";
import { StatusPill } from "./components/node/status-pill";
import { TargetTabs } from "./components/node/target-tabs";
import { ConnectPage } from "./pages/connect-page";
import { EmbedAdminAccessBridge } from "./pages/embed-admin-access-bridge";
import { EmbedBridgePage } from "./pages/embed-bridge-page";
import { AdminPage } from "./pages/admin-page";
import { HistoryRetentionPage } from "./pages/history-retention-page";
import { IntegrationPage } from "./pages/integration-page";
import { LoginPage } from "./pages/login-page";
import { pushToast, ToastViewport } from "./components/toast";

const githubRawInstallScriptURL = "https://raw.githubusercontent.com/qqqasdwx/Komari-ip-history/master/deploy/install.sh";

const nodeNavItems: NavItem[] = [{ to: "/nodes", label: "节点结果", icon: <RowsIcon /> }];

const settingsNavItems: NavItem[] = [
  { to: "/settings/integration", label: "接入配置", icon: <GearIcon /> },
  { to: "/settings/history-retention", label: "历史保留", icon: <GearIcon /> },
  { to: "/settings/user", label: "用户", icon: <GearIcon /> }
];

function NodesPage(props: { me: MeResponse; onUnauthorized: () => void }) {
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
              <button
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
                onClick={() => setReloadToken((value) => value + 1)}
                type="button"
              >
                <ReloadIcon />
                <span>重试</span>
              </button>
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
                <Link
                  className="inline-flex h-10 items-center rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white transition hover:bg-indigo-600"
                  to="/settings/integration"
                >
                  去接入
                </Link>
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
                    <button
                      aria-label="上报设置"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
                      data-node-report-settings="true"
                      onClick={(event) => {
                        event.stopPropagation();
                        openReportConfig(item.komari_node_uuid);
                      }}
                      type="button"
                    >
                      <GearIcon />
                    </button>
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
          <button className="button ghost" onClick={props.onClose} type="button">
            关闭
          </button>
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
            <label className="grid min-w-0 gap-2 text-sm text-slate-700">
              <input
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                onChange={(event) => props.onTargetInputChange(event.target.value)}
                placeholder="例如 1.1.1.1 或 2606:4700:4700::1111"
                value={props.targetInput}
              />
            </label>
            <button
              aria-label="添加 IP"
              className="inline-flex h-11 w-12 items-center justify-center rounded-xl bg-indigo-500 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-indigo-300"
              disabled={props.targetSaving || !props.targetInput.trim()}
              type="submit"
            >
              <PlusIcon />
            </button>
          </form>
          {props.targetError ? <p className="text-sm text-rose-600">{props.targetError}</p> : null}
        </div>
        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
          <label className="space-y-1 text-sm text-slate-700">
            <span className="font-medium text-slate-900">Cron</span>
            <input
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400"
              onChange={(event) => setScheduleCron(event.target.value)}
              placeholder="0 0 * * *"
              spellCheck={false}
              value={scheduleCron}
            />
            <p className="text-xs text-slate-500">默认每天 0 点执行，使用标准 5 段 cron 表达式。</p>
          </label>
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
                <button
                  className="button ghost"
                  disabled={previewError !== ""}
                  onClick={() => void handleCopy(installCommand, "接入命令已复制。")}
                  type="button"
                >
                  复制
                </button>
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
            <button className="button ghost" onClick={props.onClose} type="button">
              关闭
            </button>
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
            <button className="button ghost" onClick={props.onClose} type="button">
              关闭
            </button>
          </div>
          <div className="field-modal-body space-y-4">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
              {error || "加载节点上报设置失败。"}
            </div>
            <div>
              <button className="button" onClick={reload} type="button">
                重试
              </button>
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

function HistoryChangeFiltersBar(props: {
  startDate: string;
  endDate: string;
  targetOptions: Array<{ id: number; label: string }>;
  selectedTargetID: number | null;
  fieldOptions: Array<{ id: string; label: string }>;
  selectedFieldID: string;
  onApply: (next: { startDate: string; endDate: string }) => void;
  onTargetChange: (targetID: number | null) => void;
  onFieldChange: (fieldID: string) => void;
}) {
  const [startDate, setStartDate] = useState(props.startDate);
  const [endDate, setEndDate] = useState(props.endDate);
  const [rangeOpen, setRangeOpen] = useState(false);
  const rangePanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setStartDate(historyQueryValueToInputValue(props.startDate));
  }, [props.startDate]);

  useEffect(() => {
    setEndDate(historyQueryValueToInputValue(props.endDate));
  }, [props.endDate]);

  useEffect(() => {
    if (!rangeOpen) {
      return undefined;
    }
    function handlePointerDown(event: MouseEvent) {
      if (rangePanelRef.current && !rangePanelRef.current.contains(event.target as Node)) {
        setRangeOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [rangeOpen]);

  const selectedTargetLabel =
    props.selectedTargetID === null
      ? "所有 IP"
      : props.targetOptions.find((option) => option.id === props.selectedTargetID)?.label ?? "所有 IP";

  const selectedFieldLabel =
    props.selectedFieldID === ""
      ? "全部字段"
      : props.fieldOptions.find((option) => option.id === props.selectedFieldID)?.label ?? "全部字段";

  return (
    <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 xl:grid-cols-[minmax(360px,1.8fr)_minmax(180px,220px)_minmax(220px,1fr)]">
        <div className="relative" ref={rangePanelRef}>
          <button
            data-history-range-trigger="true"
            className={[
              "flex h-11 w-full items-center justify-between rounded-xl border bg-white px-3 text-left text-sm outline-none transition focus:ring-2 focus:ring-indigo-100",
              rangeOpen || props.startDate || props.endDate
                ? "border-indigo-300 text-slate-900 focus:border-indigo-300"
                : "border-slate-200 text-slate-700 hover:border-indigo-300 focus:border-indigo-300"
            ].join(" ")}
            onClick={() => setRangeOpen((value) => !value)}
            type="button"
          >
            <span className="truncate">{describeHistoryDateRange(startDate, endDate)}</span>
            <span className="ml-3 shrink-0 text-slate-400">{rangeOpen ? "收起" : "展开"}</span>
          </button>
          {rangeOpen ? (
            <div className="absolute left-0 top-full z-20 mt-2 w-[min(720px,calc(100vw-8rem))] rounded-[18px] border border-slate-200 bg-white p-4 shadow-xl">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">选择时间范围</p>
                  <p className="text-xs text-slate-500">支持快捷范围，也可以手动指定开始和结束日期。</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-2 text-sm text-slate-700">
                  <span>开始日期</span>
                  <input
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    type="datetime-local"
                    step={1}
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-sm text-slate-700">
                  <span>结束日期</span>
                  <input
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    type="datetime-local"
                    step={1}
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {historyDateRangePresets.map((preset) => (
                  <button
                    key={preset.label}
                    className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
                    onClick={() => {
                      const next = preset.resolve();
                      setStartDate(next.startDate);
                      setEndDate(next.endDate);
                    }}
                    type="button"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
                  onClick={() => {
                    props.onApply({
                      startDate: historyInputValueToQueryValue(startDate),
                      endDate: historyInputValueToQueryValue(endDate)
                    });
                    setRangeOpen(false);
                  }}
                  type="button"
                >
                  应用筛选
                </button>
                <button
                  className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
                  onClick={() => {
                    setStartDate("");
                    setEndDate("");
                    props.onApply({ startDate: "", endDate: "" });
                    setRangeOpen(false);
                  }}
                  type="button"
                >
                  清空
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <label className="grid gap-2 text-sm text-slate-700">
          <select
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            value={props.selectedTargetID ?? ""}
            onChange={(event) => {
              const value = event.target.value.trim();
              props.onTargetChange(value ? Number(value) : null);
            }}
          >
            <option value="">所有 IP</option>
            {props.targetOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm text-slate-700">
          <select
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            value={props.selectedFieldID}
            onChange={(event) => props.onFieldChange(event.target.value)}
          >
            <option value="">全部字段</option>
            {props.fieldOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span>当前筛选：</span>
        <span>时间 {describeHistoryDateRange(startDate, endDate)}</span>
        <span>IP {selectedTargetLabel}</span>
        <span>字段 {selectedFieldLabel}</span>
      </div>
    </div>
  );
}

function HistoryChangeList(props: {
  items: Array<{
    id: string;
    targetIP: string;
    groupPath: string[];
    fieldLabel: string;
    previous: { text: string; tone: string; missingKind?: "missing" };
    current: { text: string; tone: string; missingKind?: "missing" };
    recordedAt: string;
    previousRecordedAt: string;
  }>;
}) {
  if (props.items.length === 0) {
    return (
      <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
        当前筛选条件下没有历史变化。
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-sm">
      <div className="divide-y divide-slate-200">
        {props.items.map((item) => (
          <div
            key={item.id}
            className="grid grid-cols-[160px_minmax(0,1fr)] gap-4 px-4 py-4"
            data-history-change-row="true"
          >
            <div className="pt-1 text-sm text-slate-500">{formatDateTime(item.recordedAt)}</div>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm leading-6 text-slate-700">
                <span className="inline-flex min-h-7 items-center rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-600">
                  {item.targetIP}
                </span>
                <span className="font-medium text-slate-900">
                  {[...item.groupPath, item.fieldLabel].filter(Boolean).join(" / ")}：
                </span>
                {renderDisplayValueBadge({
                  id: "",
                  path: "",
                  groupPath: [],
                  label: item.fieldLabel,
                  text: item.previous.text,
                  tone: item.previous.tone as "good" | "bad" | "warn" | "muted" | "neutral",
                  missingKind: item.previous.missingKind
                })}
                <span className="font-medium text-slate-300">-&gt;</span>
                {renderDisplayValueBadge({
                  id: "",
                  path: "",
                  groupPath: [],
                  label: item.fieldLabel,
                  text: item.current.text,
                  tone: item.current.tone as "good" | "bad" | "warn" | "muted" | "neutral",
                  missingKind: item.current.missingKind
                })}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                <span>旧值时间 {formatDateTime(item.previousRecordedAt)}</span>
                <span>新值时间 {formatDateTime(item.recordedAt)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function reportPathMatchesHighlight(nodePath: string, highlightPath: string) {
  return nodePath === highlightPath;
}

function CompareReportPane(props: {
  entry: NodeHistoryEntry;
  changedPaths: string[];
  favoriteSaving: boolean;
  onToggleFavorite: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const nodes = Array.from(containerRef.current.querySelectorAll<HTMLElement>("[data-field-path]"));
    for (const node of nodes) {
      const nodePath = node.dataset.fieldPath?.trim() || "";
      const highlighted = nodePath
        ? props.changedPaths.some((path) => reportPathMatchesHighlight(nodePath, path))
        : false;
      node.classList.toggle("report-compare-highlight", highlighted);
    }
  }, [props.changedPaths, props.entry.result]);

  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-900">{formatDateTime(props.entry.recorded_at)}</h2>
          {props.entry.is_favorite ? (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              已收藏
            </span>
          ) : null}
        </div>
        <button
          className={[
            "inline-flex h-9 items-center rounded-full border px-4 text-sm font-medium transition",
            props.entry.is_favorite
              ? "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300"
              : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-600"
          ].join(" ")}
          disabled={props.favoriteSaving}
          onClick={props.onToggleFavorite}
          type="button"
        >
          {props.favoriteSaving ? "处理中..." : props.entry.is_favorite ? "取消收藏" : "收藏快照"}
        </button>
      </div>
      <div ref={containerRef}>
        <CurrentReportView result={props.entry.result} hiddenPaths={[]} compact />
      </div>
    </section>
  );
}

function HistoryCompareEmptyState(props: { rows: ReturnType<typeof buildHistoryCompareRows> }) {
  if (props.rows.length === 0) {
    return (
      <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
        当前没有可对比的字段。
      </div>
    );
  }
  return null;
}

function parseRecordedAtTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatCompareSliderValue(value: number) {
  return formatDateTime(new Date(value).toISOString());
}

function clampCompareTimestamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function pickHistoryEntryAtOrBefore(items: NodeHistoryEntry[], timestamp: number) {
  let candidate = items[0] ?? null;
  for (const item of items) {
    const itemTimestamp = parseRecordedAtTimestamp(item.recorded_at);
    if (itemTimestamp <= timestamp) {
      candidate = item;
      continue;
    }
    break;
  }
  return candidate;
}

function CompareTimeline(props: {
  items: NodeHistoryEntry[];
  leftTimestamp: number;
  rightTimestamp: number;
  onLeftChange: (timestamp: number) => void;
  onRightChange: (timestamp: number) => void;
}) {
  const min = parseRecordedAtTimestamp(props.items[0]?.recorded_at ?? "");
  const max = parseRecordedAtTimestamp(props.items[props.items.length - 1]?.recorded_at ?? "");
  const span = Math.max(max - min, 1);
  const leftPercent = ((props.leftTimestamp - min) / span) * 100;
  const rightPercent = ((props.rightTimestamp - min) / span) * 100;
  const points = props.items.map((item) => {
    const timestamp = parseRecordedAtTimestamp(item.recorded_at);
    return {
      id: item.id,
      recordedAt: item.recorded_at,
      left: `${((timestamp - min) / span) * 100}%`,
      isFavorite: item.is_favorite
    };
  });

  return (
    <section className="compare-timeline-panel rounded-[18px] border border-slate-200 bg-slate-50 p-4">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">时间范围</h2>
            <p className="text-sm text-slate-500">
              首次上报：{formatDateTime(props.items[0]?.recorded_at)} · 最近上报：{formatDateTime(props.items[props.items.length - 1]?.recorded_at)}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="compare-timeline-point compare-timeline-point-legend" aria-hidden="true" />
            <span>普通快照</span>
            <span className="compare-timeline-point compare-timeline-point-favorite compare-timeline-point-legend" aria-hidden="true" />
            <span>已收藏</span>
          </div>
        </div>
        <div className="compare-timeline">
          <div className="compare-timeline-labels">
            <div className="compare-timeline-value" style={{ left: `${leftPercent}%` }}>
              {formatCompareSliderValue(props.leftTimestamp)}
            </div>
            <div className="compare-timeline-value compare-timeline-value-right" style={{ left: `${rightPercent}%` }}>
              {formatCompareSliderValue(props.rightTimestamp)}
            </div>
          </div>
          <div className="compare-timeline-track-wrap">
            <div className="compare-timeline-track" />
            <div className="compare-timeline-points" aria-hidden="true">
              {points.map((point) => (
                <span
                  key={point.id}
                  className={["compare-timeline-point", point.isFavorite ? "compare-timeline-point-favorite" : ""].filter(Boolean).join(" ")}
                  style={{ left: point.left }}
                  title={`${formatDateTime(point.recordedAt)}${point.isFavorite ? " · 已收藏" : ""}`}
                />
              ))}
            </div>
            <div
              className="compare-timeline-range"
              style={{
                left: `${Math.min(leftPercent, rightPercent)}%`,
                width: `${Math.max(rightPercent - leftPercent, 0)}%`
              }}
            />
            <input
              className="compare-timeline-input compare-timeline-input-left"
              type="range"
              min={min}
              max={max}
              step={1000}
              value={props.leftTimestamp}
              onChange={(event) => props.onLeftChange(clampCompareTimestamp(Number(event.target.value), min, props.rightTimestamp))}
            />
            <input
              className="compare-timeline-input compare-timeline-input-right"
              type="range"
              min={min}
              max={max}
              step={1000}
              value={props.rightTimestamp}
              onChange={(event) => props.onRightChange(clampCompareTimestamp(Number(event.target.value), props.leftTimestamp, max))}
            />
          </div>
          <div className="compare-timeline-ends">
            <span>{formatDateTime(props.items[0]?.recorded_at)}</span>
            <span>{formatDateTime(props.items[props.items.length - 1]?.recorded_at)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function NodeDetailPage(props: { me: MeResponse; onUnauthorized: () => void }) {
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

  useEffect(() => {
    if (!refreshing) {
      setShowDelayedRefreshing(false);
      return undefined;
    }
    const timeoutID = window.setTimeout(() => setShowDelayedRefreshing(true), 180);
    return () => window.clearTimeout(timeoutID);
  }, [refreshing]);

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
  const targetQuery = currentTargetID ? `?target_id=${currentTargetID}` : "";
  const historyPath = `/nodes/${uuid}/history${targetQuery}`;
  const comparePath = `/nodes/${uuid}/compare${targetQuery}`;

  function goToReportConfig() {
    const path = buildReportConfigListPath(uuid);
    if (isEmbed) {
      window.location.assign(toStandaloneAppURL(path));
      return;
    }
    navigate(path);
  }

  if (loading && !detail) {
    return <NodeDetailLoading />;
  }

  if (isEmbed && errorStatus === 404 && komariReturn) {
    return (
      <EmbedBridgePage
        title="接入节点"
        description="当前节点尚未接入，正在打开独立页面继续。"
        actionURL={buildConnectPath(uuid, nodeName, { returnTo: komariReturn, resumePopup: true })}
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
      <PageHeader
        title={detail.name}
        subtitle={detail.has_data ? `最近更新: ${formatDateTime(detail.updated_at ?? undefined)}` : "当前还没有任何 IP 结果"}
        backTo={isEmbed ? undefined : "/nodes"}
        actions={
          detail.current_target ? (
            isEmbed ? (
              <>
                <a
                  className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-indigo-300 hover:text-indigo-600"
                  href={toStandaloneAppURL(historyPath)}
                  rel="noreferrer"
                  target="_blank"
                >
                  历史记录
                </a>
                <a
                  className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-indigo-300 hover:text-indigo-600"
                  href={toStandaloneAppURL(comparePath)}
                  rel="noreferrer"
                  target="_blank"
                >
                  快照对比
                </a>
              </>
            ) : (
              <Link
                className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-indigo-300 hover:text-indigo-600"
                to={historyPath}
              >
                查看历史记录
              </Link>
            )
          ) : undefined
        }
      />

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
              <button className="button" onClick={goToReportConfig} type="button">
                去接入
              </button>
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

function NodeHistoryPage(props: { onUnauthorized: () => void }) {
  const { uuid = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const selectedTargetID = Number(searchParams.get("target_id") || "") || null;
  const historyPage = Number(searchParams.get("page") || "") || 1;
  const startDate = searchParams.get("start_date")?.trim() || "";
  const endDate = searchParams.get("end_date")?.trim() || "";
  const selectedFieldID = searchParams.get("field")?.trim() || "";
  const requestedPageSize = Number(searchParams.get("page_size") || "");
  const historyPageSize = [10, 20, 50, 100].includes(requestedPageSize) ? requestedPageSize : 10;
  const { loading, error, detail, reload } = useNodePageData(uuid, selectedTargetID, props.onUnauthorized);
  const {
    loading: historyLoading,
    error: historyError,
    items: changeEvents,
    total: historyTotal,
    totalPages: historyTotalPages,
    reload: reloadHistory
  } = useNodeHistoryEvents(uuid, selectedTargetID, selectedFieldID, props.onUnauthorized, {
    page: historyPage,
    pageSize: historyPageSize,
    startDate,
    endDate
  });
  const {
    loading: fieldOptionsLoading,
    error: fieldOptionsError,
    items: fieldOptions,
    reload: reloadFieldOptions
  } = useNodeHistoryFieldOptions(uuid, selectedTargetID, props.onUnauthorized, {
    startDate,
    endDate
  });

  function replaceSelection(
    nextTargetID: number | null,
    nextPage?: number | null,
    nextFilters?: { startDate?: string; endDate?: string },
    nextFieldID?: string,
    nextPageSize?: number
  ) {
    const params = new URLSearchParams(searchParams);
    if (nextTargetID) {
      params.set("target_id", String(nextTargetID));
    } else {
      params.delete("target_id");
    }
    if (nextPage && nextPage > 1) {
      params.set("page", String(nextPage));
    } else {
      params.delete("page");
    }
    const resolvedStartDate = nextFilters?.startDate ?? startDate;
    const resolvedEndDate = nextFilters?.endDate ?? endDate;
    if (resolvedStartDate.trim()) {
      params.set("start_date", resolvedStartDate.trim());
    } else {
      params.delete("start_date");
    }
    if (resolvedEndDate.trim()) {
      params.set("end_date", resolvedEndDate.trim());
    } else {
      params.delete("end_date");
    }
    const resolvedFieldID = nextFieldID ?? selectedFieldID;
    if (resolvedFieldID.trim()) {
      params.set("field", resolvedFieldID.trim());
    } else {
      params.delete("field");
    }
    const resolvedPageSize = nextPageSize ?? historyPageSize;
    if (resolvedPageSize !== 10) {
      params.set("page_size", String(resolvedPageSize));
    } else {
      params.delete("page_size");
    }
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: true });
  }

  if (loading) {
    return <NodeDetailLoading />;
  }

  if (error || !detail) {
    return (
      <NodePageError
        title="历史记录"
        subtitle={error || "节点不存在"}
        backTo="/nodes"
        error={error || "节点不存在。"}
        onRetry={reload}
      />
    );
  }

  const detailBackTo = `/nodes/${uuid}${detail.current_target?.id ? `?target_id=${detail.current_target.id}` : ""}`;
  const compareTargetID = selectedTargetID ?? detail.current_target?.id ?? null;
  const historyPathForCompare = `/nodes/${uuid}/compare${compareTargetID ? `?target_id=${compareTargetID}` : ""}`;
  const currentHistoryPage = historyTotalPages > 0 ? Math.min(Math.max(historyPage, 1), historyTotalPages) : 1;
  const currentPageItems = changeEvents.map((item) => ({
    id: item.id,
    targetIP: item.target_ip,
    groupPath: item.group_path,
    fieldLabel: item.field_label,
    previous: item.previous,
    current: item.current,
    recordedAt: item.recorded_at,
    previousRecordedAt: item.previous_recorded_at
  }));
  const historyLoadError = historyError || fieldOptionsError;

  return (
    <section className="space-y-6">
      <PageHeader
        title={`${detail.name} 历史记录`}
        subtitle={selectedTargetID ? `当前查看 ${detail.current_target?.ip ?? "目标 IP"}` : "当前查看所有目标 IP 的变化"}
        backTo={detailBackTo}
        actions={
          compareTargetID ? (
            <Link
              className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-indigo-300 hover:text-indigo-600"
              to={historyPathForCompare}
            >
              快照对比
            </Link>
          ) : undefined
        }
      />

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        {historyLoadError ? (
          <div className="section">
            <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
              {historyLoadError}
            </div>
          </div>
        ) : null}

        {detail.targets.length === 0 ? (
          <div className="section">
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              当前节点还没有目标 IP，请先回到详情页添加。
            </div>
          </div>
        ) : historyLoading || fieldOptionsLoading ? (
          <div className="section">
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">正在加载历史记录...</div>
          </div>
        ) : historyTotal === 0 ? (
          <div className="section">
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              {selectedFieldID || startDate || endDate
                ? "当前筛选条件下没有历史变化。"
                : "当前目标 IP 还没有历史变化。"}
            </div>
          </div>
        ) : (
          <div className="section space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900">字段变化</h2>
                <p className="text-sm text-slate-500">按字段独立记录变化，默认按时间倒序展示。</p>
              </div>
              <button
                className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
                onClick={() => {
                  reload();
                  reloadHistory();
                  reloadFieldOptions();
                }}
                type="button"
              >
                刷新
              </button>
            </div>

            <HistoryChangeFiltersBar
              startDate={startDate}
              endDate={endDate}
              targetOptions={detail.targets.map((item) => ({ id: item.id, label: item.ip }))}
              selectedTargetID={selectedTargetID}
              fieldOptions={fieldOptions}
              selectedFieldID={selectedFieldID}
              onApply={({ startDate: nextStartDate, endDate: nextEndDate }) =>
                replaceSelection(selectedTargetID, 1, {
                  startDate: nextStartDate,
                  endDate: nextEndDate
                }, "")
              }
              onTargetChange={(targetID) => replaceSelection(targetID, 1, undefined, "")}
              onFieldChange={(fieldID) => {
                replaceSelection(selectedTargetID, 1, undefined, fieldID);
              }}
            />

            <HistoryPagination
              page={currentHistoryPage}
              totalPages={historyTotalPages}
              total={historyTotal}
              pageSize={historyPageSize}
              onPageChange={(page) => replaceSelection(selectedTargetID, page)}
              onPageSizeChange={(pageSize) => {
                replaceSelection(selectedTargetID, 1, undefined, selectedFieldID, pageSize);
              }}
            />

            <HistoryChangeList items={currentPageItems} />
          </div>
        )}
      </section>
    </section>
  );
}

function NodeHistoryComparePage(props: { onUnauthorized: () => void }) {
  const { uuid = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const selectedTargetID = Number(searchParams.get("target_id") || "") || null;
  const { loading, error, detail, reload } = useNodePageData(uuid, selectedTargetID, props.onUnauthorized);
  const compareTargetID = detail?.current_target?.id ?? selectedTargetID ?? null;
  const { loading: historyLoading, error: historyError, items: historyItems, reload: reloadHistory } = useAllNodeHistoryData(
    uuid,
    compareTargetID,
    props.onUnauthorized
  );
  const [historyItemsOverride, setHistoryItemsOverride] = useState<NodeHistoryEntry[] | null>(null);
  const [leftTimestamp, setLeftTimestamp] = useState(0);
  const [rightTimestamp, setRightTimestamp] = useState(0);
  const [favoriteSavingIDs, setFavoriteSavingIDs] = useState<number[]>([]);

  useEffect(() => {
    setHistoryItemsOverride(historyItems);
  }, [historyItems]);

  function replaceSelection(targetID: number | null) {
    const params = new URLSearchParams(searchParams);
    if (targetID) {
      params.set("target_id", String(targetID));
    } else {
      params.delete("target_id");
    }
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: true });
  }

  const effectiveHistoryItems = historyItemsOverride ?? historyItems;
  const orderedHistory = [...effectiveHistoryItems].sort(
    (left, right) => new Date(left.recorded_at).getTime() - new Date(right.recorded_at).getTime()
  );
  const firstRecordedAt = orderedHistory[0]?.recorded_at ?? "";
  const lastRecordedAt = orderedHistory[orderedHistory.length - 1]?.recorded_at ?? "";

  useEffect(() => {
    if (orderedHistory.length === 0) {
      setLeftTimestamp(0);
      setRightTimestamp(0);
      return;
    }
    setLeftTimestamp(parseRecordedAtTimestamp(orderedHistory[0].recorded_at));
    setRightTimestamp(parseRecordedAtTimestamp(orderedHistory[orderedHistory.length - 1].recorded_at));
  }, [detail?.current_target?.id, firstRecordedAt, lastRecordedAt]);

  if (loading) {
    return <NodeDetailLoading />;
  }

  if (error || !detail) {
    return (
      <NodePageError
        title="快照对比"
        subtitle={error || "节点不存在"}
        backTo="/nodes"
        error={error || "节点不存在。"}
        onRetry={reload}
      />
    );
  }

  const leftEntry = pickHistoryEntryAtOrBefore(orderedHistory, leftTimestamp);
  const rightEntry = pickHistoryEntryAtOrBefore(orderedHistory, rightTimestamp);
  const compareRows =
    leftEntry && rightEntry ? buildHistoryCompareRows(leftEntry.result, rightEntry.result) : [];
  const changedPaths = Array.from(
    new Set(
      compareRows
        .filter((row) => row.changed)
        .flatMap((row) => mapDisplayPathToReportPaths(row.path))
    )
  );
  const detailBackTo = `/nodes/${uuid}/history${detail.current_target?.id ? `?target_id=${detail.current_target.id}` : ""}`;

  async function toggleSnapshotFavorite(entry: NodeHistoryEntry) {
    setFavoriteSavingIDs((current) => (current.includes(entry.id) ? current : [...current, entry.id]));
    const nextFavorite = !entry.is_favorite;
    setHistoryItemsOverride((current) =>
      (current ?? historyItems).map((item) =>
        item.id === entry.id
          ? {
              ...item,
              is_favorite: nextFavorite
            }
          : item
      )
    );
    try {
      const suffix = compareTargetID ? `?target_id=${compareTargetID}` : "";
      if (entry.is_favorite) {
        await apiRequest<NodeHistoryEntry>(`/nodes/${uuid}/history/${entry.id}/favorite${suffix}`, { method: "DELETE" });
      } else {
        await apiRequest<NodeHistoryEntry>(`/nodes/${uuid}/history/${entry.id}/favorite${suffix}`, { method: "POST" });
      }
    } catch (toggleError) {
      setHistoryItemsOverride((current) =>
        (current ?? historyItems).map((item) =>
          item.id === entry.id
            ? {
                ...item,
                is_favorite: entry.is_favorite
              }
            : item
        )
      );
      if (toggleError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      pushToast(toggleError instanceof Error ? toggleError.message : "更新快照收藏状态失败", "error");
    } finally {
      setFavoriteSavingIDs((current) => current.filter((id) => id !== entry.id));
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title={`${detail.name} 快照对比`}
        subtitle={detail.current_target ? `当前查看 ${detail.current_target.ip}` : "请选择一个目标 IP"}
        backTo={detailBackTo}
      />

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="section space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900">目标 IP</h2>
              <p className="text-sm text-slate-500">切换标签可查看不同目标 IP 的独立快照对比。</p>
            </div>
            <button
              className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
              onClick={() => {
                reload();
                reloadHistory();
              }}
              type="button"
            >
              刷新
            </button>
          </div>
          {detail.targets.length > 0 ? (
            <TargetTabs
              items={detail.targets.map((item) => ({ id: item.id, label: item.ip, has_data: item.has_data }))}
              selectedId={detail.selected_target_id ?? detail.current_target?.id ?? null}
              onSelect={(targetID) => replaceSelection(targetID)}
            />
          ) : (
            <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              当前节点还没有目标 IP，请先回到详情页添加。
            </div>
          )}
        </div>

        {historyError ? (
          <div className="section">
            <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
              {historyError}
            </div>
          </div>
        ) : null}

        {!detail.current_target ? null : historyLoading ? (
          <div className="section">
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">正在加载历史记录...</div>
          </div>
        ) : orderedHistory.length < 2 ? (
          <div className="section">
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              当前目标 IP 至少需要两条历史记录，才能进行快照对比。
            </div>
          </div>
        ) : (
          <div className="section space-y-6">
            <CompareTimeline
              items={orderedHistory}
              leftTimestamp={leftTimestamp}
              rightTimestamp={rightTimestamp}
              onLeftChange={(timestamp) => setLeftTimestamp(timestamp)}
              onRightChange={(timestamp) => setRightTimestamp(timestamp)}
            />

            {leftEntry && rightEntry ? (
              compareRows.length === 0 ? (
                <HistoryCompareEmptyState rows={compareRows} />
              ) : (
                <div className="grid gap-6 xl:grid-cols-2">
                  <CompareReportPane
                    entry={leftEntry}
                    changedPaths={changedPaths}
                    favoriteSaving={favoriteSavingIDs.includes(leftEntry.id)}
                    onToggleFavorite={() => toggleSnapshotFavorite(leftEntry)}
                  />
                  <CompareReportPane
                    entry={rightEntry}
                    changedPaths={changedPaths}
                    favoriteSaving={favoriteSavingIDs.includes(rightEntry.id)}
                    onToggleFavorite={() => toggleSnapshotFavorite(rightEntry)}
                  />
                </div>
              )
            ) : null}
          </div>
        )}
      </section>
    </section>
  );
}

function PublicNodeDetailPage() {
  const { uuid = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const nodeName = searchParams.get("node_name")?.trim() || "IP质量体检报告";
  const displayIP = searchParams.get("display_ip")?.trim() || "";
  const selectedTargetID = Number(searchParams.get("target_id") || "") || null;
  const { loading, error, detail, reload } = usePublicNodePageData(uuid, selectedTargetID, displayIP);

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

  function goToReportConfig() {
    if (isEmbed) {
      return;
    }
    const path = buildReportConfigListPath(uuid);
    navigate(path);
  }

  if (loading) {
    return <NodeDetailLoading />;
  }

  if (error || !detail) {
    return (
      <NodePageError
        title="IP质量体检报告"
        subtitle={error || "当前结果不可用"}
        backTo="/"
        error={error || "当前结果不可用。"}
        onRetry={reload}
      />
    );
  }

  const targets = detail.targets ?? [];
  const currentTargetUpdatedAt = detail.current_target?.updated_at ?? undefined;

  return (
    <section className={isEmbed ? "embed-detail-page space-y-4" : "space-y-6"}>
      <PageHeader
        title={isEmbed ? nodeName : "IP质量体检报告"}
        subtitle={currentTargetUpdatedAt ? `最近更新: ${formatDateTime(currentTargetUpdatedAt)}` : "当前公开结果"}
        backTo={isEmbed ? undefined : "/"}
      />
      <section className={isEmbed ? "embed-detail-card rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm" : "rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm"}>
        <div className="section space-y-4">
          {targets.length > 0 ? (
            <TargetTabs
              items={targets.map((item) => ({ id: item.id, label: item.label, has_data: item.has_data }))}
              selectedId={detail.selected_target_id ?? detail.current_target?.id ?? null}
              onSelect={(targetID) => replaceTargetSelection(targetID)}
              variant={isEmbed ? "attached" : "default"}
            />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              <span>管理员还没有配置可查看的目标 IP。</span>
              {!isEmbed ? (
                <button className="button" onClick={goToReportConfig} type="button">
                  去接入
                </button>
              ) : null}
            </div>
          )}
        </div>
        {detail.current_target ? (
          <div className="section">
            <div className="detail-target-panel" data-detail-report="true">
              <CurrentReportView result={detail.current_target.current_result} hiddenPaths={[]} compact={isEmbed} />
            </div>
          </div>
        ) : null}
      </section>
    </section>
  );
}

function AppShell(props: { me: MeResponse; onLogout: () => Promise<void>; onUnauthorized: () => void }) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const embedTheme = getEmbedTheme(searchParams);
  const embedAppearance = getEmbedAppearance(searchParams);
  const embedGlassStyle = getEmbedGlassStyle(searchParams);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    if (!isEmbed) {
      delete root.dataset.ipqEmbedTheme;
      delete body.dataset.ipqEmbedTheme;
      delete root.dataset.ipqEmbedAppearance;
      delete body.dataset.ipqEmbedAppearance;
      return;
    }

    root.dataset.ipqEmbedTheme = embedTheme;
    body.dataset.ipqEmbedTheme = embedTheme;
    root.dataset.ipqEmbedAppearance = embedAppearance;
    body.dataset.ipqEmbedAppearance = embedAppearance;

    return () => {
      delete root.dataset.ipqEmbedTheme;
      delete body.dataset.ipqEmbedTheme;
      delete root.dataset.ipqEmbedAppearance;
      delete body.dataset.ipqEmbedAppearance;
    };
  }, [embedAppearance, embedTheme, isEmbed]);

  const content = (
    <Routes>
      <Route path="/" element={<Navigate to="/nodes" replace />} />
      <Route path="/connect" element={<ConnectPage onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes" element={<NodesPage me={props.me} onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes/:uuid" element={<NodeDetailPage me={props.me} onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes/:uuid/history" element={<NodeHistoryPage onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes/:uuid/compare" element={<NodeHistoryComparePage onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes/:uuid/changes" element={<Navigate to="../history" relative="path" replace />} />
      <Route path="/settings/integration" element={<IntegrationPage me={props.me} onUnauthorized={props.onUnauthorized} />} />
      <Route path="/settings/history-retention" element={<HistoryRetentionPage onUnauthorized={props.onUnauthorized} />} />
      <Route path="/settings/fields" element={<Navigate to="/nodes" replace />} />
      <Route path="/settings/admin" element={<Navigate to="/settings/user" replace />} />
      <Route
        path="/settings/user"
        element={<AdminPage me={props.me} onUnauthorized={props.onUnauthorized} />}
      />
      <Route path="*" element={<Navigate to="/nodes" replace />} />
    </Routes>
  );

  if (isEmbed) {
    return (
      <div
        className={`embed-shell embed-theme-${embedTheme} embed-appearance-${embedAppearance} bg-slate-50 text-slate-900`}
        style={embedGlassStyle}
      >
        <div className="embed-panel mx-auto max-w-[1120px] space-y-6">{content}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="react-preview-shell grid min-h-screen grid-cols-1">
        <aside className="border-b border-slate-200 bg-white px-4 py-5 lg:border-b-0 lg:border-r">
          <div className="space-y-1 px-3 pb-6">
            <p className="text-3xl font-medium tracking-tight text-slate-900">Komari</p>
            <p className="text-sm text-slate-400">IP Quality</p>
          </div>
          <nav className="space-y-6">
            <SidebarSection title="节点" items={nodeNavItems} />
            <SidebarSection title="设置" items={settingsNavItems} />
          </nav>
        </aside>
        <main className="min-w-0">
          <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 lg:px-8">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Komari IP Quality</p>
              <p className="text-sm text-slate-500">{routeLabel(location.pathname)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-xs font-medium text-slate-500">
                模式 {props.me.app_env ?? "unknown"}
              </span>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
                onClick={() => void props.onLogout()}
                type="button"
              >
                <ExitIcon />
                <span>退出登录</span>
              </button>
            </div>
          </header>
          <div className="space-y-6 px-6 pb-8 lg:px-8">{content}</div>
        </main>
      </div>
    </div>
  );
}

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const response = await apiRequest<MeResponse>("/auth/me");
        if (cancelled) {
          return;
        }
        setMe(response.logged_in ? response : null);
      } catch {
        if (!cancelled) {
          setMe(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    try {
      await apiRequest("/auth/logout", { method: "POST" });
    } finally {
      setMe(null);
      navigate("/login", { replace: true });
    }
  }

  if (loading) {
    return <AppLoading />;
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to={me ? "/nodes" : "/login"} replace />} />
        <Route
          path="/public/nodes/:uuid"
          element={
            <EmbedFrameShell>
              <PublicNodeDetailPage />
            </EmbedFrameShell>
          }
        />
        <Route
          path="/login"
          element={<LoginPage me={me} onAuthenticated={(nextMe) => setMe(nextMe)} />}
        />
        <Route
          path="/*"
          element={
            me ? (
              <AppShell
                me={me}
                onLogout={handleLogout}
                onUnauthorized={() => {
                  setMe(null);
                }}
              />
            ) : (
              isEmbed ? (
                <EmbedAdminAccessBridge />
              ) : (
                <Navigate to={`/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`} replace />
              )
            )
          }
        />
      </Routes>
      <ToastViewport />
    </>
  );
}
