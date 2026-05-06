import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BellRing,
  CheckCircle2,
  ClipboardList,
  Pencil,
  PlayCircle,
  RefreshCw,
  Send,
  Settings2,
  Trash2,
  X
} from "lucide-react";
import { apiRequest, UnauthorizedError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type {
  NodeDetail,
  NodeHistoryFieldOption,
  NodeHistoryFieldOptionList,
  NodeListItem,
  NotificationChannelItem,
  NotificationChannelListResponse,
  NotificationChannelType,
  NotificationDeliveryLogItem,
  NotificationDeliveryLogResponse,
  NotificationRuleItem,
  NotificationRuleListResponse,
  NotificationSettings
} from "../lib/types";
import { PageHeader } from "../components/layout/page-header";
import { pushToast } from "../components/toast";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

type NotificationsPageProps = {
  onUnauthorized: () => void;
};

type ChannelForm = {
  type: NotificationChannelType;
  bot_token: string;
  chat_id: string;
  message_thread_id: string;
  endpoint: string;
  url: string;
  method: string;
  content_type: string;
  headers: string;
  body: string;
  username: string;
  password: string;
  script: string;
};

type RulePayload = {
  name: string;
  enabled: boolean;
  channel_id: number;
  node_uuid: string;
  target_ip: string;
  field_id: string;
};

const defaultSettings: NotificationSettings = {
  enabled: false,
  active_channel_id: null,
  title_template: "",
  body_template:
    "节点：{{node_name}}\n目标 IP：{{target_ip}}\n字段：{{field_label}}\n旧值：{{old_value}}\n新值：{{new_value}}\n记录时间：{{recorded_at}}\n详情：{{detail_url}}\n对比：{{compare_url}}"
};

const defaultScript =
  "function sendEvent(event) {\n  return { ok: true };\n}\n\nfunction sendMessage(message, title) {\n  return { ok: true };\n}\n";

const eventPlaceholderTokens = [
  "{{node_name}}",
  "{{target_ip}}",
  "{{field_label}}",
  "{{old_value}}",
  "{{new_value}}",
  "{{recorded_at}}",
  "{{detail_url}}",
  "{{compare_url}}"
];

const javascriptFields = [
  "node_name",
  "target_ip",
  "field_id",
  "field_label",
  "old_value",
  "new_value",
  "recorded_at",
  "detail_url",
  "compare_url"
];

function channelTypeLabel(type: string) {
  switch (type) {
    case "telegram":
      return "Telegram";
    case "webhook":
      return "Webhook";
    case "javascript":
      return "JavaScript";
    default:
      return "未知通道";
  }
}

function defaultChannelForm(type: NotificationChannelType): ChannelForm {
  return {
    type,
    bot_token: "",
    chat_id: "",
    message_thread_id: "",
    endpoint: "https://api.telegram.org/bot",
    url: "",
    method: "POST",
    content_type: "application/json",
    headers: "",
    body: '{\n  "node_name": "{{node_name}}",\n  "target_ip": "{{target_ip}}",\n  "field": "{{field_label}}",\n  "old_value": "{{old_value}}",\n  "new_value": "{{new_value}}",\n  "detail_url": "{{detail_url}}"\n}',
    username: "",
    password: "",
    script: defaultScript
  };
}

function channelToForm(channel: NotificationChannelItem): ChannelForm {
  const form = defaultChannelForm(channel.type);
  return {
    ...form,
    bot_token: channel.config.bot_token ?? "",
    chat_id: channel.config.chat_id ?? "",
    message_thread_id: channel.config.message_thread_id ?? "",
    endpoint: channel.config.endpoint ?? channel.config.api_url ?? form.endpoint,
    url: channel.config.url ?? "",
    method: channel.config.method ?? form.method,
    content_type: channel.config.content_type ?? form.content_type,
    headers: channel.config.headers ?? channel.config.headers_json ?? "",
    body: channel.config.body ?? form.body,
    username: channel.config.username ?? "",
    password: channel.config.password ?? "",
    script: channel.config.script ?? form.script
  };
}

function channelFormConfig(form: ChannelForm): Record<string, string> {
  if (form.type === "telegram") {
    return {
      bot_token: form.bot_token.trim(),
      chat_id: form.chat_id.trim(),
      message_thread_id: form.message_thread_id.trim(),
      endpoint: form.endpoint.trim()
    };
  }
  if (form.type === "javascript") {
    return { script: form.script };
  }
  return {
    url: form.url.trim(),
    method: form.method.trim().toUpperCase() || "POST",
    content_type: form.content_type.trim() || "application/json",
    headers: form.headers.trim(),
    body: form.body,
    username: form.username.trim(),
    password: form.password
  };
}

function routeNodeUUID(node: NodeListItem) {
  return node.node_uuid?.trim() || node.komari_node_uuid;
}

function nodeLabel(nodes: NodeListItem[], nodeUUID: string) {
  if (!nodeUUID) {
    return "所有节点";
  }
  const node = nodes.find((item) => routeNodeUUID(item) === nodeUUID || item.node_uuid === nodeUUID);
  return node?.name || "已删除节点";
}

function statusBadgeClass(status: string) {
  return status === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-rose-200 bg-rose-50 text-rose-700";
}

function enabledBadge(enabled: boolean) {
  return enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500";
}

function formatLogChange(log: NotificationDeliveryLogItem) {
  const previous = log.previous_value || "N/A";
  const current = log.current_value || "N/A";
  return `${previous} -> ${current}`;
}

function fieldLabel(fieldOptions: NodeHistoryFieldOption[], fieldID: string) {
  if (!fieldID) {
    return "全部字段";
  }
  return fieldOptions.find((item) => item.id === fieldID)?.label || fieldID;
}

function activeChannel(settings: NotificationSettings, channels: NotificationChannelItem[]) {
  if (settings.active_channel_id) {
    return channels.find((item) => item.id === settings.active_channel_id) ?? null;
  }
  return channels[0] ?? null;
}

function HeaderBackButton(props: { to: string }) {
  const navigate = useNavigate();
  return (
    <Button className="rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50" onClick={() => navigate(props.to)} type="button">
      <ArrowLeft className="size-4" />
      <span>返回</span>
    </Button>
  );
}

function LoadingCards() {
  return (
    <div className="grid gap-4">
      <div className="h-44 animate-pulse rounded-[24px] bg-slate-100" />
      <div className="h-72 animate-pulse rounded-[24px] bg-slate-100" />
    </div>
  );
}

function RuleDialog(props: {
  open: boolean;
  initialRule: NotificationRuleItem | null;
  nodes: NodeListItem[];
  fieldOptions: NodeHistoryFieldOption[];
  currentChannel: NotificationChannelItem | null;
  onClose: () => void;
  onSave: (payloads: RulePayload[], editingID: number | null) => Promise<void>;
  onUnauthorized: () => void;
}) {
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [fieldID, setFieldID] = useState("");
  const [allNodes, setAllNodes] = useState(true);
  const [nodeSearch, setNodeSearch] = useState("");
  const [selectedNodeUUIDs, setSelectedNodeUUIDs] = useState<string[]>([]);
  const [nodeDetails, setNodeDetails] = useState<Record<string, NodeDetail>>({});
  const [nodeAllTargets, setNodeAllTargets] = useState<Record<string, boolean>>({});
  const [nodeTargetIPs, setNodeTargetIPs] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!props.open) {
      return;
    }
    const rule = props.initialRule;
    setName(rule?.name ?? "");
    setEnabled(rule?.enabled ?? true);
    setFieldID(rule?.field_id ?? "");
    setAllNodes(!rule || !rule.node_uuid);
    setSelectedNodeUUIDs(rule?.node_uuid ? [rule.node_uuid] : []);
    setNodeAllTargets(rule?.node_uuid ? { [rule.node_uuid]: !rule.target_ip } : {});
    setNodeTargetIPs(rule?.node_uuid && rule.target_ip ? { [rule.node_uuid]: [rule.target_ip] } : {});
    setNodeSearch("");
    setError("");
  }, [props.initialRule, props.open]);

  useEffect(() => {
    if (!props.open || allNodes) {
      return;
    }
    let cancelled = false;
    async function loadDetails() {
      const missing = selectedNodeUUIDs.filter((uuid) => uuid && !nodeDetails[uuid]);
      if (missing.length === 0) {
        return;
      }
      try {
        const loaded = await Promise.all(
          missing.map(async (uuid) => {
            const detail = await apiRequest<NodeDetail>(`/nodes/${encodeURIComponent(uuid)}`);
            return [uuid, detail] as const;
          })
        );
        if (cancelled) {
          return;
        }
        setNodeDetails((current) => {
          const next = { ...current };
          for (const [uuid, detail] of loaded) {
            next[uuid] = detail;
          }
          return next;
        });
      } catch (loadError) {
        if (loadError instanceof UnauthorizedError) {
          props.onUnauthorized();
          return;
        }
      }
    }
    void loadDetails();
    return () => {
      cancelled = true;
    };
  }, [allNodes, nodeDetails, props.onUnauthorized, props.open, selectedNodeUUIDs]);

  const filteredNodes = useMemo(() => {
    const keyword = nodeSearch.trim().toLowerCase();
    if (!keyword) {
      return props.nodes;
    }
    return props.nodes.filter((node) => node.name.toLowerCase().includes(keyword));
  }, [nodeSearch, props.nodes]);

  if (!props.open) {
    return null;
  }

  function toggleNode(node: NodeListItem, checked: boolean) {
    const uuid = routeNodeUUID(node);
    setSelectedNodeUUIDs((current) => (checked ? Array.from(new Set([...current, uuid])) : current.filter((item) => item !== uuid)));
    if (checked) {
      setNodeAllTargets((current) => ({ ...current, [uuid]: true }));
    } else {
      setNodeAllTargets((current) => {
        const next = { ...current };
        delete next[uuid];
        return next;
      });
      setNodeTargetIPs((current) => {
        const next = { ...current };
        delete next[uuid];
        return next;
      });
    }
  }

  function toggleTarget(nodeUUID: string, targetIP: string, checked: boolean) {
    setNodeTargetIPs((current) => {
      const selected = current[nodeUUID] ?? [];
      return {
        ...current,
        [nodeUUID]: checked ? Array.from(new Set([...selected, targetIP])) : selected.filter((item) => item !== targetIP)
      };
    });
  }

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请填写规则名称。");
      return;
    }
    if (!fieldID.trim()) {
      setError("请选择字段。");
      return;
    }
    if (!props.currentChannel) {
      setError("请先配置发送器。");
      return;
    }

    const base = {
      name: trimmedName,
      enabled,
      channel_id: props.currentChannel.id,
      field_id: fieldID.trim()
    };
    const payloads: RulePayload[] = [];
    if (allNodes) {
      payloads.push({ ...base, node_uuid: "", target_ip: "" });
    } else {
      if (selectedNodeUUIDs.length === 0) {
        setError("请至少选择一个节点。");
        return;
      }
      for (const nodeUUID of selectedNodeUUIDs) {
        if (nodeAllTargets[nodeUUID]) {
          payloads.push({ ...base, node_uuid: nodeUUID, target_ip: "" });
          continue;
        }
        const targets = nodeTargetIPs[nodeUUID] ?? [];
        if (targets.length === 0) {
          setError("指定节点未选择所有 IP 时，请至少选择一个 IP。");
          return;
        }
        for (const targetIP of targets) {
          payloads.push({ ...base, node_uuid: nodeUUID, target_ip: targetIP });
        }
      }
    }

    if (props.initialRule && payloads.length !== 1) {
      setError("编辑单条规则时只能保存一个范围；多范围请新建规则。");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await props.onSave(payloads, props.initialRule?.id ?? null);
      props.onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-8 backdrop-blur-sm" onClick={props.onClose}>
      <section className="max-h-[min(760px,92vh)] w-full max-w-3xl overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{props.initialRule ? "编辑订阅规则" : "添加订阅规则"}</h2>
            <p className="text-sm text-slate-500">发送器：{props.currentChannel ? channelTypeLabel(props.currentChannel.type) : "未设置"}</p>
          </div>
          <Button aria-label="关闭" className="size-9 rounded-full border border-slate-200 bg-white p-0 text-slate-700 hover:bg-slate-50" onClick={props.onClose} type="button">
            <X className="size-4" />
          </Button>
        </div>

        <div className="max-h-[calc(min(760px,92vh)-76px)] space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
            <div className="grid gap-2">
              <Label className="text-slate-900" htmlFor="notification-rule-name">
                规则名称
              </Label>
              <Input id="notification-rule-name" placeholder="例如：组织变化" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <label className="mt-auto flex h-10 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700">
              <input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
              <span>启用</span>
            </label>
          </div>

          <div className="grid gap-2">
            <Label className="text-slate-900" htmlFor="notification-rule-field">
              字段
            </Label>
            <select
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              id="notification-rule-field"
              value={fieldID}
              onChange={(event) => setFieldID(event.target.value)}
            >
              <option value="">请选择字段</option>
              {props.fieldOptions.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3">
            <Label className="text-slate-900">节点范围</Label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                <input checked={allNodes} onChange={() => setAllNodes(true)} type="radio" />
                <span>
                  <span className="block font-medium text-slate-900">所有节点</span>
                  <span className="block text-slate-500">新节点会自动纳入。</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                <input checked={!allNodes} onChange={() => setAllNodes(false)} type="radio" />
                <span>
                  <span className="block font-medium text-slate-900">指定节点</span>
                  <span className="block text-slate-500">可按节点继续选择 IP。</span>
                </span>
              </label>
            </div>
          </div>

          {!allNodes ? (
            <div className="grid gap-4">
              <Input placeholder="搜索节点" value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} />
              <div className="max-h-52 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="grid gap-2">
                  {filteredNodes.map((node) => {
                    const uuid = routeNodeUUID(node);
                    const checked = selectedNodeUUIDs.includes(uuid);
                    return (
                      <label key={uuid} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                        <input checked={checked} onChange={(event) => toggleNode(node, event.target.checked)} type="checkbox" />
                        <span className="truncate">{node.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {selectedNodeUUIDs.map((nodeUUID) => {
                const node = props.nodes.find((item) => routeNodeUUID(item) === nodeUUID);
                const detail = nodeDetails[nodeUUID];
                const allTargets = nodeAllTargets[nodeUUID] ?? true;
                return (
                  <div key={nodeUUID} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="font-medium text-slate-900">{node?.name || "已删除节点"}</div>
                    <label className="mt-3 flex items-center gap-3 rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                      <input
                        checked={allTargets}
                        onChange={(event) => setNodeAllTargets((current) => ({ ...current, [nodeUUID]: event.target.checked }))}
                        type="checkbox"
                      />
                      <span>监控该节点的所有 IP</span>
                    </label>
                    {!allTargets ? (
                      <div className="mt-3 grid gap-2">
                        {(detail?.targets ?? []).length === 0 ? <div className="text-sm text-slate-500">正在加载 IP 列表...</div> : null}
                        {(detail?.targets ?? []).map((target) => {
                          const checked = (nodeTargetIPs[nodeUUID] ?? []).includes(target.ip);
                          return (
                            <label key={target.id} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                              <input checked={checked} onChange={(event) => toggleTarget(nodeUUID, target.ip, event.target.checked)} type="checkbox" />
                              <span>{target.ip}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

          <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-5">
            <Button className="rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50" onClick={props.onClose} type="button">
              取消
            </Button>
            <Button className="rounded-lg bg-[var(--accent)] px-3 text-[13px] text-white hover:bg-[#6868e8]" disabled={saving} onClick={() => void handleSave()} type="button">
              <CheckCircle2 className="size-4" />
              <span>{saving ? "保存中..." : props.initialRule ? "保存规则" : "创建规则"}</span>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function NotificationsPage(props: NotificationsPageProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<NotificationSettings>(defaultSettings);
  const [channels, setChannels] = useState<NotificationChannelItem[]>([]);
  const [rules, setRules] = useState<NotificationRuleItem[]>([]);
  const [logs, setLogs] = useState<NotificationDeliveryLogResponse | null>(null);
  const [nodes, setNodes] = useState<NodeListItem[]>([]);
  const [fieldOptions, setFieldOptions] = useState<NodeHistoryFieldOption[]>([]);
  const [busyKey, setBusyKey] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<NotificationRuleItem | null>(null);

  const currentChannel = useMemo(() => activeChannel(settings, channels), [settings, channels]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [nextSettings, nextChannels, nextRules, nextLogs, nextNodes] = await Promise.all([
        apiRequest<NotificationSettings>("/admin/notifications/settings"),
        apiRequest<NotificationChannelListResponse>("/admin/notifications/channels"),
        apiRequest<NotificationRuleListResponse>("/admin/notifications/rules"),
        apiRequest<NotificationDeliveryLogResponse>("/admin/notifications/logs?page_size=10"),
        apiRequest<{ items: NodeListItem[] }>("/nodes")
      ]);
      setSettings({ ...defaultSettings, ...nextSettings });
      setChannels(nextChannels.items);
      setRules(nextRules.items);
      setLogs(nextLogs);
      setNodes(nextNodes.items);
      await loadFieldOptions(nextNodes.items);
    } catch (loadError) {
      if (loadError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "加载通知页面失败");
    } finally {
      setLoading(false);
    }
  }

  async function loadFieldOptions(nextNodes: NodeListItem[]) {
    const merged = new Map<string, string>();
    await Promise.all(
      nextNodes
        .filter((node) => node.has_data)
        .map(async (node) => {
          try {
            const response = await apiRequest<NodeHistoryFieldOptionList>(`/nodes/${encodeURIComponent(routeNodeUUID(node))}/history/fields`);
            for (const item of response.items ?? []) {
              if (!merged.has(item.id)) {
                merged.set(item.id, item.label);
              }
            }
          } catch {
            // Field options are best-effort; rule creation can still use existing rules and loaded nodes.
          }
        })
    );
    setFieldOptions(Array.from(merged.entries()).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)));
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveSettings(nextSettings: NotificationSettings, successMessage: string) {
    setBusyKey("settings");
    setError("");
    try {
      const saved = await apiRequest<NotificationSettings>("/admin/notifications/settings", {
        method: "PUT",
        body: JSON.stringify(nextSettings)
      });
      setSettings({ ...defaultSettings, ...saved });
      pushToast(successMessage);
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "保存通知设置失败");
    } finally {
      setBusyKey("");
    }
  }

  async function saveRules(payloads: RulePayload[], editingID: number | null) {
    setError("");
    try {
      if (editingID) {
        await apiRequest<NotificationRuleItem>(`/admin/notifications/rules/${editingID}`, {
          method: "PATCH",
          body: JSON.stringify(payloads[0])
        });
        pushToast("通知规则已保存。");
      } else {
        await Promise.all(
          payloads.map((payload) =>
            apiRequest<NotificationRuleItem>("/admin/notifications/rules", {
              method: "POST",
              body: JSON.stringify(payload)
            })
          )
        );
        pushToast(payloads.length > 1 ? `已创建 ${payloads.length} 条通知规则。` : "通知规则已创建。");
      }
      await load();
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "保存通知规则失败");
      throw saveError;
    }
  }

  async function toggleRule(rule: NotificationRuleItem) {
    setBusyKey(`rule:${rule.id}`);
    setError("");
    try {
      await apiRequest<NotificationRuleItem>(`/admin/notifications/rules/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !rule.enabled })
      });
      await load();
      pushToast(rule.enabled ? "通知规则已停用。" : "通知规则已启用。");
    } catch (updateError) {
      if (updateError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(updateError instanceof Error ? updateError.message : "更新通知规则失败");
    } finally {
      setBusyKey("");
    }
  }

  async function deleteRule(rule: NotificationRuleItem) {
    if (!window.confirm(`删除通知规则「${rule.name}」？`)) {
      return;
    }
    setBusyKey(`rule:${rule.id}`);
    setError("");
    try {
      await apiRequest(`/admin/notifications/rules/${rule.id}`, { method: "DELETE" });
      await load();
      pushToast("通知规则已删除。");
    } catch (deleteError) {
      if (deleteError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(deleteError instanceof Error ? deleteError.message : "删除通知规则失败");
    } finally {
      setBusyKey("");
    }
  }

  const recentFailedLogs = logs?.items.filter((item) => item.status === "failed").length ?? 0;

  return (
    <section className="space-y-6">
      <PageHeader
        title="通知"
        subtitle="设置通知发送方式和字段变化订阅规则。"
        actions={
          <Button className="rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50" onClick={() => void load()} type="button">
            <RefreshCw className="size-4" />
            <span>刷新</span>
          </Button>
        }
      />

      {error ? <Card className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</Card> : null}

      {loading ? (
        <LoadingCards />
      ) : (
        <>
          <Card className="p-6">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge className={enabledBadge(settings.enabled)}>{settings.enabled ? "已启用" : "已停用"}</Badge>
                  <Badge className={currentChannel ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-slate-50 text-slate-500"}>
                    {currentChannel ? channelTypeLabel(currentChannel.type) : "未设置发送器"}
                  </Badge>
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">发送器</h2>
                  <p className="mt-1 text-sm text-slate-500">{currentChannel ? "字段变化符合规则时会发送通知。" : "还没有配置发送器。"}</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button className="rounded-lg bg-[var(--accent)] px-3 text-[13px] text-white hover:bg-[#6868e8]" onClick={() => navigate("/settings/notifications/channel")} type="button">
                    <Settings2 className="size-4" />
                    <span>发送器设置</span>
                  </Button>
                  <Button className="rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50" onClick={() => navigate("/settings/notifications/logs")} type="button">
                    <ClipboardList className="size-4" />
                    <span>投递记录</span>
                  </Button>
                  <Button
                    className="rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50"
                    disabled={busyKey === "settings"}
                    onClick={() => void saveSettings({ ...settings, enabled: !settings.enabled, active_channel_id: currentChannel?.id ?? settings.active_channel_id ?? null }, settings.enabled ? "通知系统已停用。" : "通知系统已启用。")}
                    type="button"
                  >
                    <BellRing className="size-4" />
                    <span>{settings.enabled ? "停用通知" : "启用通知"}</span>
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-500">订阅规则</span>
                  <strong className="text-lg text-slate-900">{rules.length}</strong>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-500">发送器</span>
                  <strong className="text-lg text-slate-900">{currentChannel ? channelTypeLabel(currentChannel.type) : "-"}</strong>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-500">最近失败</span>
                  <strong className={recentFailedLogs > 0 ? "text-lg text-rose-600" : "text-lg text-slate-900"}>{recentFailedLogs}</strong>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">字段变化订阅规则</h2>
                <p className="text-sm text-slate-500">规则触发后会使用发送器设置中的配置发送通知。</p>
              </div>
              <Button
                className="rounded-lg bg-[var(--accent)] px-3 text-[13px] text-white hover:bg-[#6868e8]"
                onClick={() => {
                  setEditingRule(null);
                  setDialogOpen(true);
                }}
                type="button"
              >
                <CheckCircle2 className="size-4" />
                <span>添加规则</span>
              </Button>
            </div>

            {rules.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">暂无通知规则。</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">名称</th>
                      <th className="px-3 py-2 font-medium">字段</th>
                      <th className="px-3 py-2 font-medium">范围</th>
                      <th className="px-3 py-2 font-medium">状态</th>
                      <th className="px-3 py-2 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {rules.map((rule) => (
                      <tr key={rule.id}>
                        <td className="whitespace-nowrap px-3 py-3 font-medium text-slate-900">{rule.name}</td>
                        <td className="whitespace-nowrap px-3 py-3">{fieldLabel(fieldOptions, rule.field_id)}</td>
                        <td className="px-3 py-3">
                          <div className="max-w-[520px] truncate text-slate-700">
                            {nodeLabel(nodes, rule.node_uuid)} · {rule.target_ip || "所有 IP"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <Badge className={enabledBadge(rule.enabled)}>{rule.enabled ? "已启用" : "已停用"}</Badge>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50"
                              onClick={() => {
                                setEditingRule(rule);
                                setDialogOpen(true);
                              }}
                              type="button"
                            >
                              <Pencil className="size-4" />
                              <span>编辑</span>
                            </Button>
                            <Button
                              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50"
                              disabled={busyKey === `rule:${rule.id}`}
                              onClick={() => void toggleRule(rule)}
                              type="button"
                            >
                              <PlayCircle className="size-4" />
                              <span>{rule.enabled ? "停用" : "启用"}</span>
                            </Button>
                            <Button
                              className="h-9 rounded-lg border border-rose-200 bg-white px-3 text-[13px] text-rose-700 hover:bg-rose-50"
                              disabled={busyKey === `rule:${rule.id}`}
                              onClick={() => void deleteRule(rule)}
                              type="button"
                            >
                              <Trash2 className="size-4" />
                              <span>删除</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <RuleDialog
        currentChannel={currentChannel}
        fieldOptions={fieldOptions}
        initialRule={editingRule}
        nodes={nodes}
        onClose={() => setDialogOpen(false)}
        onSave={saveRules}
        onUnauthorized={props.onUnauthorized}
        open={dialogOpen}
      />
    </section>
  );
}

export function NotificationChannelSettingsPage(props: NotificationsPageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<NotificationSettings>(defaultSettings);
  const [channels, setChannels] = useState<NotificationChannelItem[]>([]);
  const [selectedType, setSelectedType] = useState<NotificationChannelType>("webhook");
  const [form, setForm] = useState<ChannelForm>(defaultChannelForm("webhook"));
  const [savingChannel, setSavingChannel] = useState(false);
  const [savingTemplates, setSavingTemplates] = useState(false);
  const [testingID, setTestingID] = useState<number | null>(null);

  const currentChannel = useMemo(() => activeChannel(settings, channels), [settings, channels]);
  const selectedChannel = useMemo(() => channels.find((item) => item.type === selectedType) ?? null, [channels, selectedType]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [nextSettings, nextChannels] = await Promise.all([
        apiRequest<NotificationSettings>("/admin/notifications/settings"),
        apiRequest<NotificationChannelListResponse>("/admin/notifications/channels")
      ]);
      const mergedSettings = { ...defaultSettings, ...nextSettings };
      const items = nextChannels.items;
      const current = activeChannel(mergedSettings, items);
      const nextType = current?.type ?? selectedType;
      const sameType = items.find((item) => item.type === nextType) ?? null;
      setSettings(mergedSettings);
      setChannels(items);
      setSelectedType(nextType);
      setForm(sameType ? channelToForm(sameType) : defaultChannelForm(nextType));
    } catch (loadError) {
      if (loadError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "加载发送器设置失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const sameType = channels.find((item) => item.type === selectedType) ?? null;
    setForm(sameType ? channelToForm(sameType) : defaultChannelForm(selectedType));
  }, [channels, selectedType]);

  async function submitChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingChannel(true);
    setError("");
    try {
      const payload = {
        name: channelTypeLabel(form.type),
        type: form.type,
        enabled: true,
        config: channelFormConfig(form)
      };
      const saved = selectedChannel
        ? await apiRequest<NotificationChannelItem>(`/admin/notifications/channels/${selectedChannel.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
          })
        : await apiRequest<NotificationChannelItem>("/admin/notifications/channels", {
            method: "POST",
            body: JSON.stringify(payload)
          });
      const savedSettings = await apiRequest<NotificationSettings>("/admin/notifications/settings", {
        method: "PUT",
        body: JSON.stringify({ ...settings, active_channel_id: saved.id })
      });
      setSettings({ ...defaultSettings, ...savedSettings });
      pushToast("发送器设置已保存。");
      await load();
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "保存发送器失败");
    } finally {
      setSavingChannel(false);
    }
  }

  async function saveTemplates() {
    setSavingTemplates(true);
    setError("");
    try {
      const saved = await apiRequest<NotificationSettings>("/admin/notifications/settings", {
        method: "PUT",
        body: JSON.stringify(settings)
      });
      setSettings({ ...defaultSettings, ...saved });
      pushToast("通知模板已保存。");
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "保存通知模板失败");
    } finally {
      setSavingTemplates(false);
    }
  }

  async function testChannel(channel: NotificationChannelItem) {
    setTestingID(channel.id);
    setError("");
    try {
      const log = await apiRequest<NotificationDeliveryLogItem>(`/admin/notifications/channels/${channel.id}/test`, {
        method: "POST"
      });
      pushToast(log.status === "success" ? "测试发送已完成。" : "测试发送失败，已记录原因。", log.status === "success" ? "success" : "error");
    } catch (testError) {
      if (testError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(testError instanceof Error ? testError.message : "测试发送失败");
    } finally {
      setTestingID(null);
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="发送器设置"
        subtitle="选择通知发送方式并填写发送配置。"
        actions={
          <div className="flex flex-wrap gap-2">
            <HeaderBackButton to="/settings/notifications" />
            <Button className="rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50" onClick={() => void load()} type="button">
              <RefreshCw className="size-4" />
              <span>刷新</span>
            </Button>
          </div>
        }
      />

      {error ? <Card className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</Card> : null}

      {loading ? (
        <LoadingCards />
      ) : (
        <>
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">发送器</h2>
                <p className="mt-1 text-sm text-slate-500">{currentChannel ? channelTypeLabel(currentChannel.type) : "未设置"}</p>
              </div>
              <Badge className={settings.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}>
                {settings.enabled ? "通知已启用" : "通知已停用"}
              </Badge>
            </div>
          </Card>

          <Card className="p-6">
            <form className="grid gap-5" onSubmit={submitChannel}>
              <div className="grid max-w-sm gap-4">
                <div className="grid gap-2">
                  <Label className="text-slate-900" htmlFor="notification-channel-type">
                    发送器类型
                  </Label>
                  <select
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    id="notification-channel-type"
                    value={selectedType}
                    onChange={(event) => setSelectedType(event.target.value as NotificationChannelType)}
                  >
                    <option value="webhook">Webhook</option>
                    <option value="telegram">Telegram</option>
                    <option value="javascript">JavaScript</option>
                  </select>
                </div>
              </div>

              {form.type === "telegram" ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="grid gap-2">
                    <Label className="text-slate-900" htmlFor="notification-telegram-token">
                      Bot Token
                    </Label>
                    <Input id="notification-telegram-token" value={form.bot_token} onChange={(event) => setForm((current) => ({ ...current, bot_token: event.target.value }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-slate-900" htmlFor="notification-telegram-chat">
                      Chat ID
                    </Label>
                    <Input id="notification-telegram-chat" value={form.chat_id} onChange={(event) => setForm((current) => ({ ...current, chat_id: event.target.value }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-slate-900" htmlFor="notification-telegram-thread">
                      Thread ID
                    </Label>
                    <Input id="notification-telegram-thread" value={form.message_thread_id} onChange={(event) => setForm((current) => ({ ...current, message_thread_id: event.target.value }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-slate-900" htmlFor="notification-telegram-endpoint">
                      接口前缀
                    </Label>
                    <Input id="notification-telegram-endpoint" value={form.endpoint} onChange={(event) => setForm((current) => ({ ...current, endpoint: event.target.value }))} />
                  </div>
                </div>
              ) : null}

              {form.type === "webhook" ? (
                <div className="grid gap-4">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_140px_220px]">
                    <div className="grid gap-2">
                      <Label className="text-slate-900" htmlFor="notification-webhook-url">
                        Webhook URL
                      </Label>
                      <Input id="notification-webhook-url" placeholder="https://example.com/webhook" value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-slate-900" htmlFor="notification-webhook-method">
                        请求方法
                      </Label>
                      <select
                        className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                        id="notification-webhook-method"
                        value={form.method}
                        onChange={(event) => setForm((current) => ({ ...current, method: event.target.value }))}
                      >
                        <option value="POST">POST</option>
                        <option value="GET">GET</option>
                      </select>
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-slate-900" htmlFor="notification-webhook-content-type">
                        Content-Type
                      </Label>
                      <Input id="notification-webhook-content-type" value={form.content_type} onChange={(event) => setForm((current) => ({ ...current, content_type: event.target.value }))} />
                    </div>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="grid gap-2">
                      <Label className="text-slate-900" htmlFor="notification-webhook-headers">
                        请求头 JSON
                      </Label>
                      <textarea
                        className="min-h-28 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                        id="notification-webhook-headers"
                        placeholder='{"Authorization":"Bearer token"}'
                        value={form.headers}
                        onChange={(event) => setForm((current) => ({ ...current, headers: event.target.value }))}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-slate-900" htmlFor="notification-webhook-body">
                        请求体
                      </Label>
                      <textarea
                        className="min-h-28 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                        id="notification-webhook-body"
                        value={form.body}
                        onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
                      />
                      <p className="text-xs text-slate-500">请求体可使用下方变量。</p>
                    </div>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="grid gap-2">
                      <Label className="text-slate-900" htmlFor="notification-webhook-username">
                        用户名
                      </Label>
                      <Input id="notification-webhook-username" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-slate-900" htmlFor="notification-webhook-password">
                        密码
                      </Label>
                      <Input id="notification-webhook-password" type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
                    </div>
                  </div>
                </div>
              ) : null}

              {form.type === "javascript" ? (
                <div className="grid gap-2">
                  <Label className="text-slate-900" htmlFor="notification-js-script">
                    Sender 脚本
                  </Label>
                  <textarea
                    className="min-h-72 rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 font-mono text-sm text-slate-50 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    id="notification-js-script"
                    value={form.script}
                    onChange={(event) => setForm((current) => ({ ...current, script: event.target.value }))}
                  />
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button className="rounded-lg bg-[var(--accent)] px-3 text-[13px] text-white hover:bg-[#6868e8]" disabled={savingChannel} type="submit">
                  <Send className="size-4" />
                  <span>{savingChannel ? "保存中..." : "保存发送器"}</span>
                </Button>
                <Button
                  className="rounded-lg border border-indigo-200 bg-white px-3 text-[13px] text-indigo-700 hover:bg-indigo-50"
                  disabled={!selectedChannel || testingID === selectedChannel.id}
                  onClick={() => selectedChannel && void testChannel(selectedChannel)}
                  type="button"
                >
                  <PlayCircle className="size-4" />
                  <span>{testingID === selectedChannel?.id ? "测试中..." : "发送测试通知"}</span>
                </Button>
              </div>
            </form>
          </Card>

          <Card className="p-6">
            <div className="mb-5">
              <h2 className="text-base font-semibold text-slate-900">{selectedType === "telegram" ? "消息正文" : "可用变量"}</h2>
              <p className="text-sm text-slate-500">
                {selectedType === "telegram"
                  ? "收到通知时会显示这段正文。"
                  : selectedType === "webhook"
                    ? "请求体可使用这些变量。"
                    : "脚本可读取这些事件字段。"}
              </p>
            </div>
            {selectedType === "javascript" ? (
              <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-xs text-slate-600">
                {javascriptFields.map((item) => (
                  <code key={item} className="rounded-md bg-white px-2 py-1">
                    {item}
                  </code>
                ))}
              </div>
            ) : selectedType === "webhook" ? (
              <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-xs text-slate-600">
                {eventPlaceholderTokens.map((item) => (
                  <code key={item} className="rounded-md bg-white px-2 py-1">
                    {item}
                  </code>
                ))}
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label className="text-slate-900" htmlFor="notification-body-template">
                    正文模板
                  </Label>
                  <textarea
                    className="min-h-36 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    id="notification-body-template"
                    value={settings.body_template}
                    onChange={(event) => setSettings((current) => ({ ...current, body_template: event.target.value }))}
                  />
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                  {eventPlaceholderTokens.map((item) => (
                    <code key={item} className="rounded-md bg-slate-100 px-2 py-1">
                      {item}
                    </code>
                  ))}
                </div>
                <Button className="w-fit rounded-lg bg-[var(--accent)] px-3 text-[13px] text-white hover:bg-[#6868e8]" disabled={savingTemplates} onClick={() => void saveTemplates()} type="button">
                  <CheckCircle2 className="size-4" />
                  <span>{savingTemplates ? "保存中..." : "保存模板"}</span>
                </Button>
              </div>
            )}
          </Card>
        </>
      )}
    </section>
  );
}

export function NotificationDeliveryLogsPage(props: NotificationsPageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<NotificationDeliveryLogResponse | null>(null);
  const [status, setStatus] = useState("");
  const [busyKey, setBusyKey] = useState("");

  async function load(nextStatus = status) {
    setLoading(true);
    setError("");
    try {
      const query = nextStatus ? `&status=${encodeURIComponent(nextStatus)}` : "";
      const nextLogs = await apiRequest<NotificationDeliveryLogResponse>(`/admin/notifications/logs?page_size=80${query}`);
      setLogs(nextLogs);
    } catch (loadError) {
      if (loadError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "加载投递记录失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void load(status);
  }, [status]);

  async function clearLogs() {
    if (!window.confirm("清空全部投递记录？")) {
      return;
    }
    setBusyKey("clear-logs");
    setError("");
    try {
      await apiRequest("/admin/notifications/logs", { method: "DELETE" });
      await load(status);
      pushToast("投递记录已清空。");
    } catch (clearError) {
      if (clearError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(clearError instanceof Error ? clearError.message : "清空投递记录失败");
    } finally {
      setBusyKey("");
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="投递记录"
        subtitle="查看通知发送结果和失败原因。"
        actions={
          <div className="flex flex-wrap gap-2">
            <HeaderBackButton to="/settings/notifications" />
            <Button className="rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50" onClick={() => void load()} type="button">
              <RefreshCw className="size-4" />
              <span>刷新</span>
            </Button>
          </div>
        }
      />

      {error ? <Card className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</Card> : null}

      <Card className="p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-2">
            <Label className="text-slate-900" htmlFor="notification-log-status">
              状态
            </Label>
            <select
              className="h-10 w-48 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              id="notification-log-status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">全部</option>
              <option value="success">成功</option>
              <option value="failed">失败</option>
            </select>
          </div>
          <Button
            className="rounded-lg border border-rose-200 bg-white px-3 text-[13px] text-rose-700 hover:bg-rose-50"
            disabled={busyKey === "clear-logs" || !logs?.items.length}
            onClick={() => void clearLogs()}
            type="button"
          >
            <Trash2 className="size-4" />
            <span>清空记录</span>
          </Button>
        </div>

        {loading ? (
          <div className="h-64 animate-pulse rounded-[24px] bg-slate-100" />
        ) : !logs || logs.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">暂无投递记录。</div>
        ) : (
          <div className="grid gap-3">
            {logs.items.map((log) => (
              <article key={log.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700" data-notification-log-status={log.status}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-slate-900">{log.title || log.rule_name || "测试发送"}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {formatDateTime(log.created_at)} · {log.channel_type ? channelTypeLabel(log.channel_type) : "已删除发送器"} · {log.rule_name || "测试发送"}
                    </div>
                  </div>
                  <Badge className={statusBadgeClass(log.status)}>{log.status === "success" ? "成功" : "失败"}</Badge>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="rounded-xl bg-white px-3 py-2">
                    <div className="text-xs text-slate-400">变化</div>
                    <div className="mt-1 truncate text-slate-900" title={`${log.node_name} ${log.target_ip} ${log.field_label}`}>
                      {log.node_name || "测试节点"} · {log.target_ip || "测试 IP"} · {log.field_label || "测试字段"}
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-500">{formatLogChange(log)}</div>
                  </div>
                  <div className={log.error ? "rounded-xl bg-rose-50 px-3 py-2 text-rose-700" : "rounded-xl bg-white px-3 py-2 text-slate-500"}>
                    <div className="text-xs text-current opacity-70">失败原因</div>
                    <div className="mt-1 break-words">{log.error || "-"}</div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
