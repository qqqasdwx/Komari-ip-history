import {
  GripVertical,
  Plus,
  Power,
  PowerOff,
  RotateCcw,
  Server,
  Settings,
  Trash2
} from "lucide-react";
import {
  type DragEvent,
  type FormEvent,
  useEffect,
  useState
} from "react";
import {
  useNavigate,
  useSearchParams
} from "react-router-dom";
import { apiRequest, RequestError, UnauthorizedError } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { formatDateTime, formatDateTimeInTimeZone } from "../lib/format";
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
import { pushToast } from "../components/toast";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

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

function buildInstallCommand(
  publicBaseURL: string,
  installToken: string
) {
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

function nodeRouteID(item: Pick<NodeListItem, "node_uuid" | "komari_node_uuid">) {
  return item.node_uuid || item.komari_node_uuid;
}

function nodeBindingLabel(item: Pick<NodeListItem, "binding_state" | "komari_node_name">) {
  return item.binding_state === "komari_bound"
    ? `已绑定 Komari${item.komari_node_name ? `：${item.komari_node_name}` : ""}`
    : "独立节点";
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

function ReportConfigSection(props: {
  me: MeResponse;
  detail: NodeDetail;
  fromKomari: boolean;
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
  const installCommand = buildInstallCommand(
    publicBaseURL,
    props.detail.report_config.install_token
  );
  const routeUUID = props.detail.node_uuid || props.detail.komari_node_uuid;

  useEffect(() => {
    if (!props.open) {
      return;
    }
    const nextStoredScheduleTimezone = props.detail.report_config.schedule_timezone.trim();
    const nextScheduleTimezone = nextStoredScheduleTimezone || browserTimeZone();
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
    props.open,
    props.detail.report_config.next_runs,
    props.detail.report_config.run_immediately,
    props.detail.report_config.schedule_cron,
    props.detail.report_config.schedule_timezone
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
  }, [props.open, routeUUID, runImmediately, scheduleCron, scheduleTimezone]);

  useEffect(() => {
    if (!props.open || previewError) {
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
    props.open,
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
              {previewError ? "请先修正 Cron" : saveState === "saving" ? "正在保存…" : saveState === "saved" ? "已自动保存" : "自动保存"}
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
    </div>
  );
}

function NodeReportConfigDialog(props: {
  me: MeResponse;
  nodeUUID: string;
  fromKomari: boolean;
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
              selected_target_id: created.id,
              report_config: {
                ...current.report_config,
                target_ips: [...current.targets, created].sort((a, b) => a.sort_order - b.sort_order).map((item) => item.ip)
              }
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

  async function handleUpdateTarget(targetID: number, enabled: boolean) {
    const previousDetail = localDetail;
    setTargetSaving(true);
    setTargetError("");
    try {
      const updated = await apiRequest<NodeTargetListItem>(`/nodes/${props.nodeUUID}/targets/${targetID}`, {
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
      fromKomari={props.fromKomari}
      me={props.me}
      onAddTarget={handleAddTarget}
      onClose={props.onClose}
      onSaved={reload}
      onDeleteCurrentTarget={(targetID) => void handleDeleteTarget(targetID)}
      onReorderTargets={(sourceID, destinationID) => void handleReorderTargets(sourceID, destinationID)}
      onSelectTarget={(targetID) => setSelectedTargetID(targetID)}
      onTargetInputChange={setTargetInput}
      onUpdateTarget={(targetID, enabled) => void handleUpdateTarget(targetID, enabled)}
      open={true}
      targetError={targetError}
      targetInput={targetInput}
      targetSaving={targetSaving}
    />
  );
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
  const [reportConfigNodeUUID, setReportConfigNodeUUID] = useState("");
  const [createNodeOpen, setCreateNodeOpen] = useState(false);
  const reportConfigFromKomari = searchParams.get("from_komari") === "1";

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
    nextParams.delete("from_komari");
    nextParams.delete("node_name");
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
      <CreateIndependentNodeDialog
        onClose={() => setCreateNodeOpen(false)}
        onCreated={(detail) => {
          setCreateNodeOpen(false);
          setReloadToken((value) => value + 1);
          pushToast("节点已创建。");
          openReportConfig(detail.node_uuid);
        }}
        onUnauthorized={props.onUnauthorized}
        open={createNodeOpen}
      />
      {reportConfigNodeUUID ? (
        <NodeReportConfigDialog
          me={props.me}
          fromKomari={reportConfigFromKomari}
          nodeUUID={reportConfigNodeUUID}
          onClose={closeReportConfig}
          onUnauthorized={props.onUnauthorized}
        />
      ) : null}
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
              <span className="text-center">操作</span>
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
                    <span className="mt-1 block truncate text-xs text-slate-400">IPQ ID：{item.node_uuid}</span>
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
                    >
                      <span className="truncate">{nodeBindingLabel(item)}</span>
                    </span>
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
                        openReportConfig(routeID);
                      }}
                      type="button"
                    >
                      <Settings className="size-4" />
                    </Button>
                    <span className="text-sm font-semibold text-indigo-600">查看</span>
                  </div>
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
