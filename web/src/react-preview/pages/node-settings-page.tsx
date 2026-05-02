import {
  type DragEvent,
  type FormEvent,
  useEffect,
  useState
} from "react";
import {
  CheckCircle2,
  GripVertical,
  Link2,
  Plus,
  Power,
  PowerOff,
  RotateCcw,
  Save,
  Trash2,
  Unlink
} from "lucide-react";
import {
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import { PageHeader } from "../components/layout/page-header";
import { NodeDetailLoading } from "../components/node/node-detail-loading";
import { NodePageError } from "../components/node/node-page-error";
import { pushToast } from "../components/toast";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useNodePageData } from "../hooks/node-data";
import { apiRequest, RequestError, UnauthorizedError } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { formatDateTime, formatDateTimeInTimeZone } from "../lib/format";
import type {
  KomariBindingCandidate,
  MeResponse,
  NodeDetail,
  NodeReportConfigPreview,
  NodeTargetListItem
} from "../lib/types";

const githubRawInstallScriptURL = "https://raw.githubusercontent.com/qqqasdwx/Komari-ip-history/master/deploy/install.sh";
const fallbackTimeZones = [
  "UTC",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles"
];

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function supportedTimeZones(current: string) {
  const intlWithSupportedValues = Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
  };
  const supported =
    typeof intlWithSupportedValues.supportedValuesOf === "function"
      ? intlWithSupportedValues.supportedValuesOf("timeZone")
      : fallbackTimeZones;
  return Array.from(new Set([current, ...fallbackTimeZones, ...supported])).filter(Boolean).sort();
}

function resolvePublicBaseURL(me: MeResponse) {
  const publicBaseURL = (me.effective_public_base_url ?? me.public_base_url ?? "").replace(/\/$/, "");
  return publicBaseURL || window.location.origin;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildInstallCommand(publicBaseURL: string, installToken: string) {
  const args = ["-e", publicBaseURL, "-t", installToken];
  const argString = args.map(shellQuote).join(" ");
  return `curl -fsSL ${shellQuote(githubRawInstallScriptURL)} | { SUDO=$(command -v sudo || true); [ "$(id -u)" -eq 0 ] && SUDO=; \${SUDO:-} bash -s -- ${argString}; }`;
}

function targetSourceLabel(source: string) {
  return source === "auto" ? "自动发现" : "手动添加";
}

function optionalDateTime(value?: string | null) {
  return value ? formatDateTime(value) : "暂无";
}

function ReportTargetList(props: {
  items: NodeTargetListItem[];
  selectedId: number | null;
  busy: boolean;
  onSelect: (targetID: number) => void;
  onReorder: (sourceID: number, destinationID: number) => void;
  onDelete: (targetID: number) => void;
  onToggle: (targetID: number, enabled: boolean) => void;
}) {
  const [draggingTargetID, setDraggingTargetID] = useState<number | null>(null);

  function handleDrop(destinationID: number) {
    if (draggingTargetID === null || draggingTargetID === destinationID) {
      setDraggingTargetID(null);
      return;
    }
    props.onReorder(draggingTargetID, destinationID);
    setDraggingTargetID(null);
  }

  return (
    <div className="grid gap-2">
      {props.items.map((item) => {
        const selected = props.selectedId === item.id;
        return (
          <div
            key={item.id}
            className={[
              "grid gap-3 rounded-2xl border bg-white px-3 py-3 text-sm transition md:grid-cols-[minmax(0,1fr)_auto]",
              selected ? "border-indigo-200 ring-2 ring-indigo-100" : "border-slate-200"
            ].join(" ")}
            data-report-enabled={item.report_enabled ? "true" : "false"}
            data-report-target-row="true"
            data-target-id={item.id}
            data-target-ip={item.ip}
            data-target-source={item.source}
            draggable={!props.busy}
            onDragOver={(event: DragEvent<HTMLDivElement>) => event.preventDefault()}
            onDragStart={() => setDraggingTargetID(item.id)}
            onDrop={() => handleDrop(item.id)}
            onDragEnd={() => setDraggingTargetID(null)}
          >
            <button className="min-w-0 text-left" onClick={() => props.onSelect(item.id)} type="button">
              <span className="flex min-w-0 items-center gap-2">
                <GripVertical className="size-4 shrink-0 text-slate-300" />
                <span className={["h-2.5 w-2.5 shrink-0 rounded-full", item.has_data ? "bg-emerald-500" : "bg-slate-300"].join(" ")} />
                <span className="truncate font-medium text-slate-900">{item.ip}</span>
              </span>
              <span className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">
                  {targetSourceLabel(item.source)}
                </span>
                <span className={[
                  "rounded-full border px-2 py-0.5",
                  item.report_enabled
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-slate-100 text-slate-500"
                ].join(" ")}>
                  {item.report_enabled ? "已启用" : "已停用"}
                </span>
              </span>
              <span className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
                <span>最近发现：{optionalDateTime(item.last_discovered_at)}</span>
                <span>最近上报：{optionalDateTime(item.updated_at)}</span>
              </span>
            </button>
            <div className="flex items-center gap-2 md:justify-end">
              <Button
                className={[
                  "h-9 rounded-xl px-3 text-xs",
                  item.report_enabled
                    ? "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    : "bg-indigo-500 text-white hover:bg-indigo-600"
                ].join(" ")}
                disabled={props.busy}
                onClick={() => props.onToggle(item.id, !item.report_enabled)}
                type="button"
              >
                {item.report_enabled ? <PowerOff className="mr-1.5 size-3.5" /> : <Power className="mr-1.5 size-3.5" />}
                {item.report_enabled ? "停用" : "启用"}
              </Button>
              <Button
                aria-label={`删除 ${item.ip}`}
                className="h-9 w-9 rounded-xl border border-slate-200 bg-white p-0 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                disabled={props.busy}
                onClick={() => props.onDelete(item.id)}
                type="button"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NodeIdentitySection(props: {
  detail: NodeDetail;
  onSaved: (detail: NodeDetail) => void;
  onUnauthorized: () => void;
}) {
  const [name, setName] = useState(props.detail.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(props.detail.name);
    setError("");
    setSaved(false);
  }, [props.detail.name, props.detail.node_uuid]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请输入节点名称。");
      return;
    }
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const detail = await apiRequest<NodeDetail>(`/nodes/${props.detail.node_uuid}`, {
        method: "PATCH",
        body: JSON.stringify({ name: trimmedName })
      });
      props.onSaved(detail);
      setSaved(true);
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

  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm" data-node-identity-settings="true">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-900">基础信息</h2>
          <p className="text-sm text-slate-500">这里只修改 IPQ 节点名称，不会改动 Komari 节点名称。</p>
        </div>
        {saved ? (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="size-3.5" />
            已保存
          </span>
        ) : null}
      </div>
      <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]" data-node-rename-form="true" onSubmit={handleSubmit}>
        <div className="grid min-w-0 gap-2">
          <Label className="text-slate-900" htmlFor="node-settings-name">
            节点名称
          </Label>
          <Input
            className="h-11 rounded-xl px-3 focus:border-indigo-300 focus:ring-indigo-100"
            id="node-settings-name"
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </div>
        <div className="flex items-end">
          <Button
            className="h-11 rounded-xl bg-indigo-500 px-4 text-white hover:bg-indigo-600 disabled:bg-indigo-300"
            disabled={saving || !name.trim() || name.trim() === props.detail.name}
            type="submit"
          >
            <Save className="size-4" />
            <span>{saving ? "保存中" : "保存名称"}</span>
          </Button>
        </div>
      </form>
      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
    </section>
  );
}

function KomariBindingSection(props: {
  detail: NodeDetail;
  onSaved: (detail: NodeDetail) => void;
  onUnauthorized: () => void;
}) {
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [bindingUUID, setBindingUUID] = useState("");
  const [items, setItems] = useState<KomariBindingCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCandidateOpen(false);
    setItems([]);
    setError("");
  }, [props.detail.node_uuid]);

  useEffect(() => {
    if (!candidateOpen || props.detail.binding_state === "komari_bound") {
      return undefined;
    }
    let cancelled = false;
    async function load() {
      setLoadingCandidates(true);
      setError("");
      try {
        const response = await apiRequest<{ items: KomariBindingCandidate[] }>(
          `/nodes/${props.detail.node_uuid}/komari-binding/candidates`
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
          setLoadingCandidates(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [candidateOpen, props.detail.binding_state, props.detail.node_uuid, props.onUnauthorized]);

  async function bindCandidate(candidate: KomariBindingCandidate) {
    if (!candidate.available || bindingUUID) {
      return;
    }
    setBindingUUID(candidate.komari_node_uuid);
    setError("");
    try {
      const detail = await apiRequest<NodeDetail>(`/nodes/${props.detail.node_uuid}/komari-binding`, {
        method: "POST",
        body: JSON.stringify({ komari_node_uuid: candidate.komari_node_uuid })
      });
      props.onSaved(detail);
      setCandidateOpen(false);
      pushToast("Komari 节点已绑定。");
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

  async function unbindKomari() {
    if (busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const detail = await apiRequest<NodeDetail>(`/nodes/${props.detail.node_uuid}/komari-binding`, { method: "DELETE" });
      props.onSaved(detail);
      pushToast("Komari 绑定已解除。");
    } catch (unbindError) {
      if (unbindError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(unbindError instanceof Error ? unbindError.message : "解绑失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm" data-node-binding-panel="true">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-900">Komari 绑定</h2>
          <p className="text-sm text-slate-500" data-node-binding-state="true">
            {props.detail.binding_state === "komari_bound"
              ? `已绑定：${props.detail.komari_node_name || props.detail.komari_node_uuid}`
              : "当前是独立节点"}
          </p>
          {props.detail.binding_state === "komari_bound" ? (
            <p className="truncate text-xs text-slate-400">{props.detail.komari_node_uuid}</p>
          ) : null}
        </div>
        {props.detail.binding_state === "komari_bound" ? (
          <Button
            className="rounded-xl border border-slate-200 bg-white text-slate-700 hover:border-rose-300 hover:bg-white hover:text-rose-600"
            disabled={busy}
            onClick={() => void unbindKomari()}
            type="button"
          >
            <Unlink className="size-4" />
            <span>{busy ? "解绑中" : "解除绑定"}</span>
          </Button>
        ) : (
          <Button
            className="rounded-xl bg-indigo-500 text-white hover:bg-indigo-600"
            onClick={() => setCandidateOpen((value) => !value)}
            type="button"
          >
            <Link2 className="size-4" />
            <span>{candidateOpen ? "收起候选" : "选择 Komari 节点"}</span>
          </Button>
        )}
      </div>
      {candidateOpen && props.detail.binding_state !== "komari_bound" ? (
        <div className="space-y-3" data-komari-binding-candidates="true">
          {loadingCandidates ? (
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
                className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto]"
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
                      : "border border-slate-200 bg-white text-slate-400"
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
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
    </section>
  );
}

function ReportConfigPanel(props: {
  me: MeResponse;
  detail: NodeDetail;
  fromKomari: boolean;
  onSaved: () => void;
  targetInput: string;
  targetError: string;
  targetSaving: boolean;
  onTargetInputChange: (value: string) => void;
  onAddTarget: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteCurrentTarget: (targetID: number) => void;
  onSelectTarget: (targetID: number) => void;
  onReorderTargets: (sourceID: number, destinationID: number) => void;
  onUpdateTarget: (targetID: number, enabled: boolean) => void;
}) {
  const publicBaseURL = resolvePublicBaseURL(props.me);
  const storedScheduleTimezone = props.detail.report_config.schedule_timezone.trim();
  const defaultScheduleTimezone = storedScheduleTimezone || browserTimeZone();
  const defaultNextRuns = storedScheduleTimezone ? props.detail.report_config.next_runs : [];
  const timeZoneOptions = supportedTimeZones(defaultScheduleTimezone);
  const [scheduleCron, setScheduleCron] = useState(props.detail.report_config.schedule_cron);
  const [scheduleTimezone, setScheduleTimezone] = useState(defaultScheduleTimezone);
  const [runImmediately, setRunImmediately] = useState(props.detail.report_config.run_immediately);
  const [preview, setPreview] = useState<NodeReportConfigPreview>({
    schedule_cron: props.detail.report_config.schedule_cron,
    schedule_timezone: defaultScheduleTimezone,
    run_immediately: props.detail.report_config.run_immediately,
    next_runs: defaultNextRuns
  });
  const [previewError, setPreviewError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [persistedConfig, setPersistedConfig] = useState({
    scheduleCron: props.detail.report_config.schedule_cron,
    scheduleTimezone: props.detail.report_config.schedule_timezone,
    runImmediately: props.detail.report_config.run_immediately
  });
  const installCommand = buildInstallCommand(publicBaseURL, props.detail.report_config.install_token);
  const routeUUID = props.detail.node_uuid || props.detail.komari_node_uuid;
  const [loadedNodeUUID, setLoadedNodeUUID] = useState(routeUUID);

  useEffect(() => {
    if (loadedNodeUUID === routeUUID) {
      return;
    }
    const nextStoredScheduleTimezone = props.detail.report_config.schedule_timezone.trim();
    const nextScheduleTimezone = nextStoredScheduleTimezone || browserTimeZone();
    setLoadedNodeUUID(routeUUID);
    setScheduleCron(props.detail.report_config.schedule_cron);
    setScheduleTimezone(nextScheduleTimezone);
    setRunImmediately(props.detail.report_config.run_immediately);
    setPreview({
      schedule_cron: props.detail.report_config.schedule_cron,
      schedule_timezone: nextScheduleTimezone,
      run_immediately: props.detail.report_config.run_immediately,
      next_runs: nextStoredScheduleTimezone ? props.detail.report_config.next_runs : []
    });
    setPersistedConfig({
      scheduleCron: props.detail.report_config.schedule_cron,
      scheduleTimezone: props.detail.report_config.schedule_timezone,
      runImmediately: props.detail.report_config.run_immediately
    });
    setPreviewError("");
    setSaveError("");
    setSaveState("idle");
  }, [
    loadedNodeUUID,
    props.detail.node_uuid,
    props.detail.report_config.next_runs,
    props.detail.report_config.run_immediately,
    props.detail.report_config.schedule_cron,
    props.detail.report_config.schedule_timezone,
    routeUUID
  ]);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutID = window.setTimeout(async () => {
      try {
        const search = new URLSearchParams();
        search.set("cron", scheduleCron);
        search.set("timezone", scheduleTimezone);
        search.set("run_immediately", runImmediately ? "1" : "0");
        const data = await apiRequest<NodeReportConfigPreview>(`/nodes/${routeUUID}/report-config/preview?${search.toString()}`, {
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
  }, [routeUUID, runImmediately, scheduleCron, scheduleTimezone]);

  useEffect(() => {
    if (previewError) {
      return undefined;
    }
    const normalizedCron = preview.schedule_cron.trim();
    const normalizedTimezone = preview.schedule_timezone.trim();
    if (
      normalizedCron === persistedConfig.scheduleCron &&
      normalizedTimezone === persistedConfig.scheduleTimezone &&
      runImmediately === persistedConfig.runImmediately
    ) {
      return undefined;
    }

    let cancelled = false;
    const timeoutID = window.setTimeout(async () => {
      setSaveState("saving");
      setSaveError("");
      try {
        const config = await apiRequest<NodeDetail["report_config"]>(`/nodes/${routeUUID}/report-config`, {
          method: "PUT",
          body: JSON.stringify({
            schedule_cron: normalizedCron,
            schedule_timezone: normalizedTimezone,
            run_immediately: runImmediately
          })
        });
        if (cancelled) {
          return;
        }
        setPersistedConfig({
          scheduleCron: config.schedule_cron,
          scheduleTimezone: config.schedule_timezone,
          runImmediately: config.run_immediately
        });
        setScheduleCron(config.schedule_cron);
        setScheduleTimezone(config.schedule_timezone);
        setRunImmediately(config.run_immediately);
        setPreview({
          schedule_cron: config.schedule_cron,
          schedule_timezone: config.schedule_timezone,
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
    persistedConfig.scheduleTimezone,
    preview.schedule_cron,
    preview.schedule_timezone,
    previewError,
    props.onSaved,
    routeUUID,
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

  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm" data-node-report-config="true">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-900">接入与上报</h2>
          <p className="text-sm text-slate-500">统一管理目标 IP、执行计划和接入命令。</p>
        </div>
      </div>
      <div className="space-y-4">
        {props.fromKomari ? (
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-800" data-komari-return-hint="true">
            {props.detail.report_config.target_ips.length > 0
              ? "配置已保存。请回到 Komari 节点页重新点击 IPQ，查看当前 IP 质量结果。"
              : "从 Komari 入口打开。可以手动添加目标 IP，也可以安装脚本后让节点自动发现本机 IP。"}
          </div>
        ) : null}
        <div className="space-y-1">
          {props.detail.report_config.target_ips.length > 0 ? (
            <p className="text-sm text-slate-500">节点执行时会先请求上报计划，再按已启用的目标 IP 探查并上报。</p>
          ) : (
            <p className="text-sm text-slate-500">可以先安装脚本，节点执行时会自动发现本机候选 IP 并请求上报计划。</p>
          )}
        </div>
        <div className="space-y-4 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-900">目标 IP</h3>
              <p className="text-sm text-slate-500">手动目标会按启用状态纳入计划，自动发现目标来自节点脚本上报的候选 IP。</p>
            </div>
          </div>
          {props.detail.targets.length > 0 ? (
            <ReportTargetList
              busy={props.targetSaving}
              items={props.detail.targets}
              onDelete={(targetID) => void props.onDeleteCurrentTarget(targetID)}
              onReorder={(sourceID, destinationID) => void props.onReorderTargets(sourceID, destinationID)}
              onSelect={(targetID) => props.onSelectTarget(targetID)}
              onToggle={(targetID, enabled) => props.onUpdateTarget(targetID, enabled)}
              selectedId={props.detail.selected_target_id ?? props.detail.current_target?.id ?? null}
            />
          ) : (
            <div className="rounded-[20px] border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
              当前节点还没有目标 IP。可以手动添加，也可以先安装脚本，让节点执行时自动发现本机 IP。
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
          <div className="space-y-1">
            <Label className="text-slate-900" htmlFor="report-config-timezone">
              解析时区
            </Label>
            <select
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
              id="report-config-timezone"
              onChange={(event) => setScheduleTimezone(event.target.value)}
              value={scheduleTimezone}
            >
              {timeZoneOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500">新节点默认使用当前浏览器时区。</p>
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
              {previewError ? "请先修正 Cron" : saveState === "saving" ? "正在保存..." : saveState === "saved" ? "已自动保存" : "自动保存"}
            </span>
          </div>
          <p className="text-xs text-slate-500">当前 Cron 按 {preview.schedule_timezone || scheduleTimezone} 解析。</p>
          <div className="report-config-next-runs">
            {preview.next_runs.map((value) => (
              <div key={value} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {formatDateTimeInTimeZone(value, preview.schedule_timezone || scheduleTimezone)}
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-2 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 sm:grid-cols-3">
          <span>计划：{preview.schedule_cron}</span>
          <span>时区：{preview.schedule_timezone || scheduleTimezone}</span>
          <span>立即执行：{runImmediately ? "启用" : "关闭"}</span>
        </div>
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
      </div>
    </section>
  );
}

export function NodeSettingsPage(props: { me: MeResponse; onUnauthorized: () => void }) {
  const { uuid = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedTargetID = Number(searchParams.get("target_id") || "") || null;
  const fromKomari = searchParams.get("from_komari") === "1";
  const { loading, error, detail, reload } = useNodePageData(uuid, selectedTargetID, props.onUnauthorized);
  const [localDetail, setLocalDetail] = useState<NodeDetail | null>(null);
  const [targetInput, setTargetInput] = useState("");
  const [targetError, setTargetError] = useState("");
  const [targetSaving, setTargetSaving] = useState(false);

  function buildSettingsPath(targetID?: number | null) {
    const params = new URLSearchParams(searchParams);
    if (targetID) {
      params.set("target_id", String(targetID));
    } else {
      params.delete("target_id");
    }
    const query = params.toString();
    return `/nodes/${uuid}/settings${query ? `?${query}` : ""}`;
  }

  useEffect(() => {
    setLocalDetail(detail);
  }, [detail]);

  useEffect(() => {
    setTargetInput("");
    setTargetError("");
  }, [uuid]);

  async function handleAddTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTargetSaving(true);
    setTargetError("");
    try {
      const created = await apiRequest<NodeTargetListItem>(`/nodes/${uuid}/targets`, {
        method: "POST",
        body: JSON.stringify({ ip: targetInput.trim() })
      });
      setTargetInput("");
      setLocalDetail((current) => {
        if (!current) {
          return current;
        }
        const nextTargets = [...current.targets, created].sort((a, b) => a.sort_order - b.sort_order);
        return {
          ...current,
          targets: nextTargets,
          selected_target_id: created.id,
          report_config: {
            ...current.report_config,
            target_ips: nextTargets.map((item) => item.ip)
          }
        };
      });
      navigate(buildSettingsPath(created.id), { replace: true });
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
      await apiRequest(`/nodes/${uuid}/targets/${targetID}`, { method: "DELETE" });
      reload();
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

  async function handleUpdateTarget(targetID: number, enabled: boolean) {
    const previousDetail = localDetail;
    setTargetSaving(true);
    setTargetError("");
    try {
      const updated = await apiRequest<NodeTargetListItem>(`/nodes/${uuid}/targets/${targetID}`, {
        method: "PATCH",
        body: JSON.stringify({ report_enabled: enabled })
      });
      setLocalDetail((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          targets: current.targets.map((item) => (item.id === targetID ? updated : item)).sort((a, b) => a.sort_order - b.sort_order),
          current_target:
            current.current_target?.id === targetID
              ? {
                  ...current.current_target,
                  source: updated.source,
                  report_enabled: updated.report_enabled,
                  last_discovered_at: updated.last_discovered_at,
                  has_data: updated.has_data,
                  updated_at: updated.updated_at
                }
              : current.current_target
        };
      });
    } catch (targetUpdateError) {
      setLocalDetail(previousDetail);
      if (targetUpdateError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setTargetError(targetUpdateError instanceof Error ? targetUpdateError.message : "更新目标 IP 状态失败");
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
      await apiRequest(`/nodes/${uuid}/targets/reorder`, {
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
    return <NodeDetailLoading />;
  }

  if ((error && !localDetail) || !localDetail) {
    return (
      <NodePageError
        title="节点设置"
        subtitle={error || "节点不存在"}
        backTo="/nodes"
        error={error || "节点不存在。"}
        onRetry={reload}
      />
    );
  }

  const activeUUID = localDetail.node_uuid || uuid;

  return (
    <section className="space-y-6" data-node-settings-page="true">
      <PageHeader
        title={`${localDetail.name} 设置`}
        subtitle="节点名称、绑定关系、目标 IP、执行计划和接入命令。"
      />
      {fromKomari ? (
        <section className="rounded-[24px] border border-indigo-200 bg-indigo-50 px-4 py-4 text-sm leading-6 text-indigo-800">
          已从 Komari 入口打开。完成接入配置后，回到 Komari 节点页重新点击 IPQ 查看结果。
        </section>
      ) : null}
      <NodeIdentitySection
        detail={localDetail}
        onSaved={(updated) => {
          setLocalDetail(updated);
          if (updated.node_uuid !== activeUUID) {
            navigate(`/nodes/${updated.node_uuid}/settings`, { replace: true });
          }
          reload();
        }}
        onUnauthorized={props.onUnauthorized}
      />
      <KomariBindingSection
        detail={localDetail}
        onSaved={(updated) => {
          setLocalDetail(updated);
          if (updated.node_uuid !== activeUUID) {
            navigate(`/nodes/${updated.node_uuid}/settings`, { replace: true });
          }
          reload();
        }}
        onUnauthorized={props.onUnauthorized}
      />
      <ReportConfigPanel
        detail={localDetail}
        fromKomari={fromKomari}
        me={props.me}
        onAddTarget={handleAddTarget}
        onSaved={reload}
        onDeleteCurrentTarget={(targetID) => void handleDeleteTarget(targetID)}
        onReorderTargets={(sourceID, destinationID) => void handleReorderTargets(sourceID, destinationID)}
        onSelectTarget={(targetID) => navigate(buildSettingsPath(targetID), { replace: true })}
        onTargetInputChange={setTargetInput}
        onUpdateTarget={(targetID, enabled) => void handleUpdateTarget(targetID, enabled)}
        targetError={targetError}
        targetInput={targetInput}
        targetSaving={targetSaving}
      />
      <div className="flex justify-end">
        <Button
          className="rounded-xl border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-white hover:text-indigo-600"
          onClick={reload}
          type="button"
        >
          <RotateCcw className="size-4" />
          <span>刷新设置</span>
        </Button>
      </div>
    </section>
  );
}
