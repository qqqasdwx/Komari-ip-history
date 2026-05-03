import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  CheckCircle2,
  Pencil,
  PlayCircle,
  RefreshCw,
  Send,
  Trash2,
  XCircle
} from "lucide-react";
import { apiRequest, UnauthorizedError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type {
  NodeDetail,
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

type ChannelForm = {
  id: number | null;
  name: string;
  type: NotificationChannelType;
  enabled: boolean;
  bot_token: string;
  chat_id: string;
  api_url: string;
  url: string;
  headers_json: string;
  script: string;
};

type RuleForm = {
  id: number | null;
  name: string;
  enabled: boolean;
  channel_id: string;
  node_uuid: string;
  target_ip: string;
  field_id: string;
};

const defaultSettings: NotificationSettings = {
  enabled: false,
  title_template: "{{node_name}} {{target_ip}} {{field_label}} 发生变化",
  body_template:
    "节点：{{node_name}}\n目标 IP：{{target_ip}}\n字段：{{field_label}}\n旧值：{{old_value}}\n新值：{{new_value}}\n记录时间：{{recorded_at}}\n详情：{{detail_url}}\n对比：{{compare_url}}"
};

const defaultScript = "function send(input) {\n  return { ok: true };\n}\n";

function emptyChannelForm(): ChannelForm {
  return {
    id: null,
    name: "",
    type: "webhook",
    enabled: true,
    bot_token: "",
    chat_id: "",
    api_url: "",
    url: "",
    headers_json: "",
    script: defaultScript
  };
}

function emptyRuleForm(): RuleForm {
  return {
    id: null,
    name: "",
    enabled: true,
    channel_id: "",
    node_uuid: "",
    target_ip: "",
    field_id: ""
  };
}

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

function channelFormConfig(form: ChannelForm): Record<string, string> {
  if (form.type === "telegram") {
    return {
      bot_token: form.bot_token.trim(),
      chat_id: form.chat_id.trim(),
      api_url: form.api_url.trim()
    };
  }
  if (form.type === "javascript") {
    return { script: form.script };
  }
  return {
    url: form.url.trim(),
    headers_json: form.headers_json.trim()
  };
}

function channelToForm(channel: NotificationChannelItem): ChannelForm {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    enabled: channel.enabled,
    bot_token: channel.config.bot_token ?? "",
    chat_id: channel.config.chat_id ?? "",
    api_url: channel.config.api_url ?? "",
    url: channel.config.url ?? "",
    headers_json: channel.config.headers_json ?? "",
    script: channel.config.script ?? defaultScript
  };
}

function statusBadgeClass(status: string) {
  return status === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-rose-200 bg-rose-50 text-rose-700";
}

function nodeLabel(nodes: NodeListItem[], nodeUUID: string) {
  if (!nodeUUID) {
    return "全部节点";
  }
  const node = nodes.find((item) => item.node_uuid === nodeUUID);
  return node?.name || "已删除节点";
}

function formatLogChange(log: NotificationDeliveryLogItem) {
  const previous = log.previous_value || "N/A";
  const current = log.current_value || "N/A";
  return `${previous} -> ${current}`;
}

export function NotificationsPage(props: { onUnauthorized: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<NotificationSettings>(defaultSettings);
  const [channels, setChannels] = useState<NotificationChannelItem[]>([]);
  const [rules, setRules] = useState<NotificationRuleItem[]>([]);
  const [logs, setLogs] = useState<NotificationDeliveryLogResponse | null>(null);
  const [nodes, setNodes] = useState<NodeListItem[]>([]);
  const [channelForm, setChannelForm] = useState<ChannelForm>(emptyChannelForm);
  const [ruleForm, setRuleForm] = useState<RuleForm>(emptyRuleForm);
  const [ruleTargets, setRuleTargets] = useState<NodeDetail["targets"]>([]);
  const [fieldOptions, setFieldOptions] = useState<NodeHistoryFieldOptionList["items"]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [busyKey, setBusyKey] = useState("");

  const selectedChannel = useMemo(
    () => channels.find((item) => item.id === Number(ruleForm.channel_id)),
    [channels, ruleForm.channel_id]
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [nextSettings, nextChannels, nextRules, nextLogs, nextNodes] = await Promise.all([
        apiRequest<NotificationSettings>("/admin/notifications/settings"),
        apiRequest<NotificationChannelListResponse>("/admin/notifications/channels"),
        apiRequest<NotificationRuleListResponse>("/admin/notifications/rules"),
        apiRequest<NotificationDeliveryLogResponse>("/admin/notifications/logs?page_size=30"),
        apiRequest<{ items: NodeListItem[] }>("/nodes")
      ]);
      setSettings(nextSettings);
      setChannels(nextChannels.items);
      setRules(nextRules.items);
      setLogs(nextLogs);
      setNodes(nextNodes.items);
    } catch (loadError) {
      if (loadError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "加载通知设置失败");
    } finally {
      setLoading(false);
    }
  }

  async function loadLogs() {
    const nextLogs = await apiRequest<NotificationDeliveryLogResponse>("/admin/notifications/logs?page_size=30");
    setLogs(nextLogs);
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadRuleScope() {
      if (!ruleForm.node_uuid) {
        setRuleTargets([]);
        setFieldOptions([]);
        return;
      }
      try {
        const detail = await apiRequest<NodeDetail>(`/nodes/${ruleForm.node_uuid}`);
        if (cancelled) {
          return;
        }
        setRuleTargets(detail.targets);
        const selectedTarget = detail.targets.find((item) => item.ip === ruleForm.target_ip);
        const query = selectedTarget ? `?target_id=${selectedTarget.id}` : "";
        const fields = await apiRequest<NodeHistoryFieldOptionList>(`/nodes/${ruleForm.node_uuid}/history/fields${query}`);
        if (!cancelled) {
          setFieldOptions(fields.items);
        }
      } catch {
        if (!cancelled) {
          setRuleTargets([]);
          setFieldOptions([]);
        }
      }
    }

    void loadRuleScope();
    return () => {
      cancelled = true;
    };
  }, [ruleForm.node_uuid, ruleForm.target_ip]);

  async function saveSettings() {
    setSavingSettings(true);
    setError("");
    try {
      const saved = await apiRequest<NotificationSettings>("/admin/notifications/settings", {
        method: "PUT",
        body: JSON.stringify(settings)
      });
      setSettings(saved);
      pushToast("通知设置已保存。");
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "保存通知设置失败");
    } finally {
      setSavingSettings(false);
    }
  }

  async function submitChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = channelForm.name.trim();
    if (!name) {
      setError("请填写通道名称。");
      return;
    }

    setSavingChannel(true);
    setError("");
    try {
      const payload = {
        name,
        type: channelForm.type,
        enabled: channelForm.enabled,
        config: channelFormConfig(channelForm)
      };
      if (channelForm.id) {
        await apiRequest<NotificationChannelItem>(`/admin/notifications/channels/${channelForm.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        pushToast("通知通道已保存。");
      } else {
        await apiRequest<NotificationChannelItem>("/admin/notifications/channels", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        pushToast("通知通道已创建。");
      }
      setChannelForm(emptyChannelForm());
      await load();
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "保存通知通道失败");
    } finally {
      setSavingChannel(false);
    }
  }

  async function toggleChannel(channel: NotificationChannelItem, enabled: boolean) {
    setBusyKey(`channel:${channel.id}`);
    setError("");
    try {
      await apiRequest<NotificationChannelItem>(`/admin/notifications/channels/${channel.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled })
      });
      await load();
      pushToast(enabled ? "通知通道已启用。" : "通知通道已停用。");
    } catch (updateError) {
      if (updateError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(updateError instanceof Error ? updateError.message : "更新通知通道失败");
    } finally {
      setBusyKey("");
    }
  }

  async function testChannel(channel: NotificationChannelItem) {
    setBusyKey(`test:${channel.id}`);
    setError("");
    try {
      const log = await apiRequest<NotificationDeliveryLogItem>(`/admin/notifications/channels/${channel.id}/test`, {
        method: "POST"
      });
      await loadLogs();
      pushToast(log.status === "success" ? "测试发送已完成。" : "测试发送失败，已记录原因。", log.status === "success" ? "success" : "error");
    } catch (testError) {
      if (testError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(testError instanceof Error ? testError.message : "测试发送失败");
    } finally {
      setBusyKey("");
    }
  }

  async function deleteChannel(channel: NotificationChannelItem) {
    if (!window.confirm(`删除通知通道「${channel.name}」？关联规则会一并删除。`)) {
      return;
    }
    setBusyKey(`channel:${channel.id}`);
    setError("");
    try {
      await apiRequest(`/admin/notifications/channels/${channel.id}`, { method: "DELETE" });
      if (channelForm.id === channel.id) {
        setChannelForm(emptyChannelForm());
      }
      await load();
      pushToast("通知通道已删除。");
    } catch (deleteError) {
      if (deleteError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(deleteError instanceof Error ? deleteError.message : "删除通知通道失败");
    } finally {
      setBusyKey("");
    }
  }

  async function submitRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = ruleForm.name.trim();
    const channelID = Number(ruleForm.channel_id);
    if (!name) {
      setError("请填写规则名称。");
      return;
    }
    if (!channelID) {
      setError("请选择通知通道。");
      return;
    }

    setSavingRule(true);
    setError("");
    try {
      const payload = {
        name,
        enabled: ruleForm.enabled,
        channel_id: channelID,
        node_uuid: ruleForm.node_uuid,
        target_ip: ruleForm.target_ip,
        field_id: ruleForm.field_id
      };
      if (ruleForm.id) {
        await apiRequest<NotificationRuleItem>(`/admin/notifications/rules/${ruleForm.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        pushToast("通知规则已保存。");
      } else {
        await apiRequest<NotificationRuleItem>("/admin/notifications/rules", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        pushToast("通知规则已创建。");
      }
      setRuleForm(emptyRuleForm());
      await load();
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "保存通知规则失败");
    } finally {
      setSavingRule(false);
    }
  }

  async function toggleRule(rule: NotificationRuleItem, enabled: boolean) {
    setBusyKey(`rule:${rule.id}`);
    setError("");
    try {
      await apiRequest<NotificationRuleItem>(`/admin/notifications/rules/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled })
      });
      await load();
      pushToast(enabled ? "通知规则已启用。" : "通知规则已停用。");
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
      if (ruleForm.id === rule.id) {
        setRuleForm(emptyRuleForm());
      }
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

  async function clearLogs() {
    if (!window.confirm("清空全部投递日志？")) {
      return;
    }
    setBusyKey("clear-logs");
    setError("");
    try {
      await apiRequest("/admin/notifications/logs", { method: "DELETE" });
      await loadLogs();
      pushToast("投递日志已清空。");
    } catch (clearError) {
      if (clearError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(clearError instanceof Error ? clearError.message : "清空投递日志失败");
    } finally {
      setBusyKey("");
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="通知"
        subtitle="按节点、目标 IP 和字段变化发送外部通知。"
        actions={
          <Button
            className="rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50"
            onClick={() => void load()}
            type="button"
          >
            <RefreshCw className="size-4" />
            <span>刷新</span>
          </Button>
        }
      />

      {error ? <Card className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</Card> : null}

      {loading ? (
        <div className="grid gap-4">
          <div className="h-52 animate-pulse rounded-[24px] bg-slate-100" />
          <div className="h-72 animate-pulse rounded-[24px] bg-slate-100" />
        </div>
      ) : (
        <>
          <Card className="p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">全局设置</h2>
                <p className="text-sm text-slate-500">总开关关闭后，字段变化不会触发投递。</p>
              </div>
              <Badge className={settings.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}>
                {settings.enabled ? "已启用" : "已停用"}
              </Badge>
            </div>
            <div className="grid gap-4">
              <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                <input
                  checked={settings.enabled}
                  onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))}
                  type="checkbox"
                />
                <span>启用通知系统</span>
              </label>
              <div className="grid gap-2">
                <Label className="text-slate-900" htmlFor="notification-title-template">
                  标题模板
                </Label>
                <Input
                  className="h-11 rounded-xl px-3 focus:border-indigo-300 focus:ring-indigo-100"
                  id="notification-title-template"
                  value={settings.title_template}
                  onChange={(event) => setSettings((current) => ({ ...current, title_template: event.target.value }))}
                />
              </div>
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
              <div>
                <Button
                  className="rounded-lg bg-[var(--accent)] px-3 text-[13px] text-white hover:bg-[#6868e8]"
                  disabled={savingSettings}
                  onClick={() => void saveSettings()}
                  type="button"
                >
                  <BellRing className="size-4" />
                  <span>{savingSettings ? "保存中..." : "保存通知设置"}</span>
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="mb-5">
              <h2 className="text-base font-semibold text-slate-900">{channelForm.id ? "编辑通知通道" : "创建通知通道"}</h2>
              <p className="text-sm text-slate-500">支持 Telegram、Webhook 和 JavaScript sender。</p>
            </div>
            <form className="grid gap-4" onSubmit={submitChannel}>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_160px]">
                <div className="grid gap-2">
                  <Label className="text-slate-900" htmlFor="notification-channel-name">
                    通道名称
                  </Label>
                  <Input
                    className="h-11 rounded-xl px-3 focus:border-indigo-300 focus:ring-indigo-100"
                    id="notification-channel-name"
                    placeholder="例如：运营群"
                    value={channelForm.name}
                    onChange={(event) => setChannelForm((current) => ({ ...current, name: event.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-slate-900" htmlFor="notification-channel-type">
                    通道类型
                  </Label>
                  <select
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    id="notification-channel-type"
                    value={channelForm.type}
                    onChange={(event) => setChannelForm((current) => ({ ...current, type: event.target.value as NotificationChannelType }))}
                  >
                    <option value="webhook">Webhook</option>
                    <option value="telegram">Telegram</option>
                    <option value="javascript">JavaScript</option>
                  </select>
                </div>
                <label className="mt-auto flex h-11 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700">
                  <input
                    checked={channelForm.enabled}
                    onChange={(event) => setChannelForm((current) => ({ ...current, enabled: event.target.checked }))}
                    type="checkbox"
                  />
                  <span>启用</span>
                </label>
              </div>

              {channelForm.type === "telegram" ? (
                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="grid gap-2">
                    <Label className="text-slate-900" htmlFor="notification-telegram-token">
                      Bot Token
                    </Label>
                    <Input
                      className="h-11 rounded-xl px-3 focus:border-indigo-300 focus:ring-indigo-100"
                      id="notification-telegram-token"
                      value={channelForm.bot_token}
                      onChange={(event) => setChannelForm((current) => ({ ...current, bot_token: event.target.value }))}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-slate-900" htmlFor="notification-telegram-chat">
                      Chat ID
                    </Label>
                    <Input
                      className="h-11 rounded-xl px-3 focus:border-indigo-300 focus:ring-indigo-100"
                      id="notification-telegram-chat"
                      value={channelForm.chat_id}
                      onChange={(event) => setChannelForm((current) => ({ ...current, chat_id: event.target.value }))}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-slate-900" htmlFor="notification-telegram-api-url">
                      API 地址
                    </Label>
                    <Input
                      className="h-11 rounded-xl px-3 focus:border-indigo-300 focus:ring-indigo-100"
                      id="notification-telegram-api-url"
                      placeholder="默认使用 Telegram 官方地址"
                      value={channelForm.api_url}
                      onChange={(event) => setChannelForm((current) => ({ ...current, api_url: event.target.value }))}
                    />
                  </div>
                </div>
              ) : null}

              {channelForm.type === "webhook" ? (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                  <div className="grid gap-2">
                    <Label className="text-slate-900" htmlFor="notification-webhook-url">
                      Webhook URL
                    </Label>
                    <Input
                      className="h-11 rounded-xl px-3 focus:border-indigo-300 focus:ring-indigo-100"
                      id="notification-webhook-url"
                      placeholder="https://example.com/webhook"
                      value={channelForm.url}
                      onChange={(event) => setChannelForm((current) => ({ ...current, url: event.target.value }))}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-slate-900" htmlFor="notification-webhook-headers">
                      请求头 JSON
                    </Label>
                    <textarea
                      className="min-h-24 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      id="notification-webhook-headers"
                      placeholder='{"Authorization":"Bearer token"}'
                      value={channelForm.headers_json}
                      onChange={(event) => setChannelForm((current) => ({ ...current, headers_json: event.target.value }))}
                    />
                  </div>
                </div>
              ) : null}

              {channelForm.type === "javascript" ? (
                <div className="grid gap-2">
                  <Label className="text-slate-900" htmlFor="notification-js-script">
                    Sender 脚本
                  </Label>
                  <textarea
                    className="min-h-48 rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 font-mono text-sm text-slate-50 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    id="notification-js-script"
                    value={channelForm.script}
                    onChange={(event) => setChannelForm((current) => ({ ...current, script: event.target.value }))}
                  />
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button
                  className="rounded-lg bg-[var(--accent)] px-3 text-[13px] text-white hover:bg-[#6868e8]"
                  disabled={savingChannel}
                  type="submit"
                >
                  <Send className="size-4" />
                  <span>{savingChannel ? "保存中..." : channelForm.id ? "保存通道" : "创建通道"}</span>
                </Button>
                {channelForm.id ? (
                  <Button
                    className="rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50"
                    onClick={() => setChannelForm(emptyChannelForm())}
                    type="button"
                  >
                    取消编辑
                  </Button>
                ) : null}
              </div>
            </form>
          </Card>

          <Card className="p-6">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-slate-900">通知通道</h2>
            </div>
            {channels.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">暂无通知通道。</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">名称</th>
                      <th className="px-3 py-2 font-medium">类型</th>
                      <th className="px-3 py-2 font-medium">状态</th>
                      <th className="px-3 py-2 font-medium">更新时间</th>
                      <th className="px-3 py-2 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {channels.map((channel) => (
                      <tr key={channel.id}>
                        <td className="whitespace-nowrap px-3 py-3 font-medium text-slate-900">{channel.name}</td>
                        <td className="whitespace-nowrap px-3 py-3">{channelTypeLabel(channel.type)}</td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <Badge className={channel.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}>
                            {channel.enabled ? "已启用" : "已停用"}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-500">{formatDateTime(channel.updated_at)}</td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50"
                              onClick={() => setChannelForm(channelToForm(channel))}
                              type="button"
                            >
                              <Pencil className="size-4" />
                              <span>编辑</span>
                            </Button>
                            <Button
                              className="h-9 rounded-lg border border-indigo-200 bg-white px-3 text-[13px] text-indigo-700 hover:bg-indigo-50"
                              disabled={busyKey === `test:${channel.id}`}
                              onClick={() => void testChannel(channel)}
                              type="button"
                            >
                              <Send className="size-4" />
                              <span>测试</span>
                            </Button>
                            <Button
                              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50"
                              disabled={busyKey === `channel:${channel.id}`}
                              onClick={() => void toggleChannel(channel, !channel.enabled)}
                              type="button"
                            >
                              {channel.enabled ? <XCircle className="size-4" /> : <PlayCircle className="size-4" />}
                              <span>{channel.enabled ? "停用" : "启用"}</span>
                            </Button>
                            <Button
                              className="h-9 rounded-lg border border-rose-200 bg-white px-3 text-[13px] text-rose-700 hover:bg-rose-50"
                              disabled={busyKey === `channel:${channel.id}`}
                              onClick={() => void deleteChannel(channel)}
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

          <Card className="p-6">
            <div className="mb-5">
              <h2 className="text-base font-semibold text-slate-900">{ruleForm.id ? "编辑通知规则" : "创建通知规则"}</h2>
              <p className="text-sm text-slate-500">规则未选择范围时，将匹配全部节点、目标 IP 或字段。</p>
            </div>
            <form className="grid gap-4" onSubmit={submitRule}>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px]">
                <div className="grid gap-2">
                  <Label className="text-slate-900" htmlFor="notification-rule-name">
                    规则名称
                  </Label>
                  <Input
                    className="h-11 rounded-xl px-3 focus:border-indigo-300 focus:ring-indigo-100"
                    id="notification-rule-name"
                    placeholder="例如：组织变化"
                    value={ruleForm.name}
                    onChange={(event) => setRuleForm((current) => ({ ...current, name: event.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-slate-900" htmlFor="notification-rule-channel">
                    通知通道
                  </Label>
                  <select
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    id="notification-rule-channel"
                    value={ruleForm.channel_id}
                    onChange={(event) => setRuleForm((current) => ({ ...current, channel_id: event.target.value }))}
                  >
                    <option value="">请选择通道</option>
                    {channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.name} · {channelTypeLabel(channel.type)}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="mt-auto flex h-11 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700">
                  <input
                    checked={ruleForm.enabled}
                    onChange={(event) => setRuleForm((current) => ({ ...current, enabled: event.target.checked }))}
                    type="checkbox"
                  />
                  <span>启用</span>
                </label>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <div className="grid gap-2">
                  <Label className="text-slate-900" htmlFor="notification-rule-node">
                    节点范围
                  </Label>
                  <select
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    id="notification-rule-node"
                    value={ruleForm.node_uuid}
                    onChange={(event) =>
                      setRuleForm((current) => ({ ...current, node_uuid: event.target.value, target_ip: "", field_id: "" }))
                    }
                  >
                    <option value="">全部节点</option>
                    {nodes.map((node) => (
                      <option key={node.node_uuid} value={node.node_uuid}>
                        {node.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label className="text-slate-900" htmlFor="notification-rule-target">
                    目标 IP 范围
                  </Label>
                  <select
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    id="notification-rule-target"
                    value={ruleForm.target_ip}
                    onChange={(event) => setRuleForm((current) => ({ ...current, target_ip: event.target.value, field_id: "" }))}
                  >
                    <option value="">全部目标 IP</option>
                    {ruleTargets.map((target) => (
                      <option key={target.id} value={target.ip}>
                        {target.ip}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label className="text-slate-900" htmlFor="notification-rule-field">
                    字段范围
                  </Label>
                  <select
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    id="notification-rule-field"
                    value={ruleForm.field_id}
                    onChange={(event) => setRuleForm((current) => ({ ...current, field_id: event.target.value }))}
                  >
                    <option value="">全部字段</option>
                    {fieldOptions.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedChannel ? (
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
                  当前规则将通过 {selectedChannel.name} 发送。
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button
                  className="rounded-lg bg-[var(--accent)] px-3 text-[13px] text-white hover:bg-[#6868e8]"
                  disabled={savingRule}
                  type="submit"
                >
                  <CheckCircle2 className="size-4" />
                  <span>{savingRule ? "保存中..." : ruleForm.id ? "保存规则" : "创建规则"}</span>
                </Button>
                {ruleForm.id ? (
                  <Button
                    className="rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50"
                    onClick={() => setRuleForm(emptyRuleForm())}
                    type="button"
                  >
                    取消编辑
                  </Button>
                ) : null}
              </div>
            </form>
          </Card>

          <Card className="p-6">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-slate-900">通知规则</h2>
            </div>
            {rules.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">暂无通知规则。</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">名称</th>
                      <th className="px-3 py-2 font-medium">通道</th>
                      <th className="px-3 py-2 font-medium">范围</th>
                      <th className="px-3 py-2 font-medium">状态</th>
                      <th className="px-3 py-2 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {rules.map((rule) => (
                      <tr key={rule.id}>
                        <td className="whitespace-nowrap px-3 py-3 font-medium text-slate-900">{rule.name}</td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <div className="font-medium text-slate-900">{rule.channel_name || "已删除通道"}</div>
                          <div className="text-xs text-slate-400">{channelTypeLabel(rule.channel_type)}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="max-w-[520px] truncate text-slate-700">
                            {nodeLabel(nodes, rule.node_uuid)} · {rule.target_ip || "全部目标 IP"} · {rule.field_id || "全部字段"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <Badge className={rule.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}>
                            {rule.enabled ? "已启用" : "已停用"}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50"
                              onClick={() =>
                                setRuleForm({
                                  id: rule.id,
                                  name: rule.name,
                                  enabled: rule.enabled,
                                  channel_id: String(rule.channel_id || ""),
                                  node_uuid: rule.node_uuid,
                                  target_ip: rule.target_ip,
                                  field_id: rule.field_id
                                })
                              }
                              type="button"
                            >
                              <Pencil className="size-4" />
                              <span>编辑</span>
                            </Button>
                            <Button
                              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50"
                              disabled={busyKey === `rule:${rule.id}`}
                              onClick={() => void toggleRule(rule, !rule.enabled)}
                              type="button"
                            >
                              {rule.enabled ? <XCircle className="size-4" /> : <PlayCircle className="size-4" />}
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

          <Card className="p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">投递日志</h2>
                <p className="text-sm text-slate-500">展示最近 30 次通知投递。</p>
              </div>
              <Button
                className="rounded-lg border border-rose-200 bg-white px-3 text-[13px] text-rose-700 hover:bg-rose-50"
                disabled={busyKey === "clear-logs" || !logs?.items.length}
                onClick={() => void clearLogs()}
                type="button"
              >
                <Trash2 className="size-4" />
                <span>清空日志</span>
              </Button>
            </div>
            {!logs || logs.items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">暂无投递日志。</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">时间</th>
                      <th className="px-3 py-2 font-medium">状态</th>
                      <th className="px-3 py-2 font-medium">通道 / 规则</th>
                      <th className="px-3 py-2 font-medium">变化</th>
                      <th className="px-3 py-2 font-medium">失败原因</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {logs.items.map((log) => (
                      <tr key={log.id} data-notification-log-status={log.status}>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-500">{formatDateTime(log.created_at)}</td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <Badge className={statusBadgeClass(log.status)}>{log.status === "success" ? "成功" : "失败"}</Badge>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <div className="font-medium text-slate-900">{log.channel_name || "已删除通道"}</div>
                          <div className="text-xs text-slate-400">{log.rule_name || "测试发送"}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="max-w-[520px] truncate text-slate-900" title={log.title}>
                            {log.node_name || "测试节点"} · {log.target_ip || "测试 IP"} · {log.field_label || "测试字段"}
                          </div>
                          <div className="max-w-[520px] truncate text-xs text-slate-500">{formatLogChange(log)}</div>
                        </td>
                        <td className="max-w-[360px] truncate px-3 py-3 text-rose-600" title={log.error}>
                          {log.error || "-"}
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
    </section>
  );
}
