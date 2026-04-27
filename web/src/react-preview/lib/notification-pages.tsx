import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest, UnauthorizedError } from "./api";
import { formatDateTime } from "./format";
import type {
  NodeDetail,
  NodeHistoryFieldOptionList,
  NodeListItem,
  NotificationChannelDetail,
  NotificationDelivery,
  NotificationProviderDefinition,
  NotificationRule,
  NotificationSettings
} from "./types";

const channelDefaults: Record<string, Record<string, string>> = {
  telegram: {
    bot_token: "",
    chat_id: "",
    message_thread_id: "",
    endpoint: "https://api.telegram.org/bot"
  },
  javascript: {
    script:
      "async function sendMessage(message, title) {\n  console.log(title, message);\n  return true;\n}\n\nasync function sendEvent(event) {\n  console.log(event);\n  return true;\n}"
  },
  webhook: {
    url: "",
    method: "POST",
    content_type: "application/json",
    headers: "",
    body: '{"message":"{{message}}"}',
    username: "",
    password: ""
  }
};

const providerTypeLabels: Record<string, string> = {
  telegram: "Telegram",
  webhook: "Webhook",
  javascript: "JavaScript"
};

const providerFieldLabels: Record<string, string> = {
  bot_token: "Bot Token",
  chat_id: "Chat ID",
  message_thread_id: "Thread ID",
  endpoint: "接口前缀",
  url: "Webhook 地址",
  method: "请求方法",
  content_type: "Content-Type",
  headers: "请求头",
  body: "请求体",
  username: "用户名",
  password: "密码",
  script: "脚本内容"
};

const providerFieldDescriptions: Record<string, string> = {
  bot_token: "Telegram Bot Token。",
  chat_id: "接收通知的聊天 ID。",
  message_thread_id: "可选，群组话题 Thread ID。",
  endpoint: "通常保持默认即可，仅在自建 Telegram 网关时修改。",
  url: "通知投递目标地址。",
  method: "目前支持 GET / POST。",
  content_type: "请求体类型。",
  headers: "使用 JSON 格式填写额外请求头。",
  body: "支持模板变量，例如 {{message}}。",
  username: "如目标接口要求 Basic Auth，可填写用户名。",
  password: "如目标接口要求 Basic Auth，可填写密码。",
  script: "实现 sendMessage(message, title)，如需完整事件对象可额外实现 sendEvent(event)。"
};

const multilineConfigFields = new Set(["headers", "body", "script"]);

const templatePlaceholders = [
  "{{node_name}}",
  "{{target_ip}}",
  "{{field_label}}",
  "{{field_path}}",
  "{{previous_value}}",
  "{{current_value}}",
  "{{previous_recorded_at}}",
  "{{recorded_at}}",
  "{{detail_url}}",
  "{{compare_url}}",
  "{{message}}"
];

const javascriptFields = [
  "node_name",
  "komari_node_uuid",
  "target_ip",
  "field_id",
  "field_label",
  "group_path",
  "previous_value",
  "current_value",
  "previous_recorded_at",
  "recorded_at",
  "detail_url",
  "compare_url"
];

function providerTypeLabel(type: string) {
  return providerTypeLabels[type] ?? type;
}

function getDefaultChannelConfig(type: string) {
  return { ...(channelDefaults[type] ?? {}) };
}

function toConfigDraft(type: string, provider: NotificationProviderDefinition | undefined, channel: NotificationChannelDetail | null) {
  const draft = getDefaultChannelConfig(type);
  if (provider) {
    for (const field of provider.fields) {
      const rawValue = channel?.config?.[field.name];
      if (rawValue === undefined || rawValue === null) {
        draft[field.name] = draft[field.name] ?? field.default ?? "";
        continue;
      }
      draft[field.name] = typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue, null, 2);
    }
    return draft;
  }
  if (channel?.config) {
    for (const [key, value] of Object.entries(channel.config)) {
      draft[key] = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    }
  }
  return draft;
}

function buildChannelConfigPayload(provider: NotificationProviderDefinition | undefined, draft: Record<string, string>) {
  const config: Record<string, string> = {};
  if (provider) {
    for (const field of provider.fields) {
      config[field.name] = draft[field.name] ?? field.default ?? "";
    }
    return config;
  }
  return { ...draft };
}

function SimplePageHeader(props: { title: string; subtitle: string; backTo?: string }) {
  const navigate = useNavigate();
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-950">{props.title}</h1>
        <p className="text-sm text-slate-500">{props.subtitle}</p>
      </div>
      {props.backTo ? (
        <button className="button ghost" onClick={() => void navigate(props.backTo!)} type="button">
          返回
        </button>
      ) : null}
    </div>
  );
}

function NotificationPageLoading() {
  return (
    <section className="space-y-6">
      <SimplePageHeader title="通知" subtitle="正在加载通知工作区…" />
      <div className="grid gap-4">
        <div className="h-40 animate-pulse rounded-[24px] bg-slate-100" />
        <div className="h-56 animate-pulse rounded-[24px] bg-slate-100" />
      </div>
    </section>
  );
}

function resolveNodeRouteUUID(node: { node_uuid?: string | null; komari_node_uuid: string }) {
  return node.node_uuid?.trim() || node.komari_node_uuid;
}

function summarizeRule(rule: NotificationRule) {
  if (rule.all_nodes) {
    return "监控所有节点（新节点自动加入）";
  }
  return rule.node_scopes
    .map((scope) =>
      scope.all_targets
        ? `${scope.node_name} · 所有 IP（新增 IP 自动加入）`
        : `${scope.node_name} · ${scope.targets.map((target) => target.target_ip).join("、")}`
    )
    .join("；");
}

type FieldOption = { id: string; label: string };

function NotificationRuleDialog(props: {
  open: boolean;
  nodes: NodeListItem[];
  initialRule: NotificationRule | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onUnauthorized: () => void;
}) {
  const [fieldOptions, setFieldOptions] = useState<FieldOption[]>([]);
  const [fieldID, setFieldID] = useState("");
  const [allNodes, setAllNodes] = useState(false);
  const [nodeSearch, setNodeSearch] = useState("");
  const [selectedNodeIDs, setSelectedNodeIDs] = useState<number[]>([]);
  const [scopeAllTargets, setScopeAllTargets] = useState<Record<number, boolean>>({});
  const [scopeTargetIDs, setScopeTargetIDs] = useState<Record<number, number[]>>({});
  const [nodeDetails, setNodeDetails] = useState<Record<number, NodeDetail>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!props.open) {
      return;
    }
    if (!props.initialRule) {
      setFieldID("");
      setAllNodes(false);
      setSelectedNodeIDs([]);
      setScopeAllTargets({});
      setScopeTargetIDs({});
      setError("");
      return;
    }
    setFieldID(props.initialRule.field_id);
    setAllNodes(props.initialRule.all_nodes);
    setSelectedNodeIDs(props.initialRule.node_scopes.map((scope) => scope.node_id));
    setScopeAllTargets(Object.fromEntries(props.initialRule.node_scopes.map((scope) => [scope.node_id, scope.all_targets])));
    setScopeTargetIDs(
      Object.fromEntries(props.initialRule.node_scopes.map((scope) => [scope.node_id, scope.targets.map((target) => target.target_id)]))
    );
    setError("");
  }, [props.initialRule, props.open]);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    let cancelled = false;
    async function loadFieldOptions() {
      const merged = new Map<string, string>();
      for (const node of props.nodes.filter((item) => item.has_data)) {
        try {
          const response = await apiRequest<NodeHistoryFieldOptionList>(`/nodes/${resolveNodeRouteUUID(node)}/history/fields`);
          for (const item of response.items ?? []) {
            if (!merged.has(item.id)) {
              merged.set(item.id, item.label);
            }
          }
        } catch (loadError) {
          if (loadError instanceof UnauthorizedError) {
            props.onUnauthorized();
            return;
          }
        }
      }
      if (cancelled) {
        return;
      }
      setFieldOptions(Array.from(merged.entries()).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)));
    }
    void loadFieldOptions();
    return () => {
      cancelled = true;
    };
  }, [props.nodes, props.onUnauthorized, props.open]);

  useEffect(() => {
    if (!props.open || allNodes) {
      return;
    }
    let cancelled = false;
    async function loadNodeDetails() {
      const missing = selectedNodeIDs.filter((nodeID) => !nodeDetails[nodeID]);
      if (missing.length === 0) {
        return;
      }
      const loaded = await Promise.all(
        missing.map(async (nodeID) => {
          const node = props.nodes.find((item) => item.id === nodeID);
          if (!node) return null;
          const detail = await apiRequest<NodeDetail>(`/nodes/${resolveNodeRouteUUID(node)}`);
          return [nodeID, detail] as const;
        })
      );
      if (cancelled) {
        return;
      }
      setNodeDetails((current) => {
        const next = { ...current };
        for (const item of loaded) {
          if (item) next[item[0]] = item[1];
        }
        return next;
      });
    }
    void loadNodeDetails();
    return () => {
      cancelled = true;
    };
  }, [allNodes, nodeDetails, props.nodes, props.open, selectedNodeIDs]);

  const filteredNodes = useMemo(() => {
    const keyword = nodeSearch.trim().toLowerCase();
    if (!keyword) return props.nodes;
    return props.nodes.filter((node) => node.name.toLowerCase().includes(keyword));
  }, [nodeSearch, props.nodes]);

  if (!props.open) return null;

  async function handleSave() {
    if (!fieldID.trim()) {
      setError("字段是必选的。");
      return;
    }
    if (!allNodes && selectedNodeIDs.length === 0) {
      setError("请至少选择一个节点。");
      return;
    }
    const nodeScopes = allNodes
      ? []
      : selectedNodeIDs.map((nodeID) => ({
          node_id: nodeID,
          all_targets: scopeAllTargets[nodeID] ?? false,
          target_ids: scopeAllTargets[nodeID] ? [] : scopeTargetIDs[nodeID] ?? []
        }));

    setSaving(true);
    setError("");
    try {
      await apiRequest(props.initialRule ? `/admin/notification/rules/${props.initialRule.id}` : "/admin/notification/rules", {
        method: props.initialRule ? "PUT" : "POST",
        body: JSON.stringify({
          field_id: fieldID.trim(),
          all_nodes: allNodes,
          enabled: true,
          node_scopes: nodeScopes
        })
      });
      await props.onSaved();
      props.onClose();
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "保存订阅规则失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="field-modal-backdrop" onClick={props.onClose}>
      <section className="field-modal report-config-modal" onClick={(event) => event.stopPropagation()}>
        <div className="field-modal-head">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">{props.initialRule ? "编辑订阅规则" : "添加订阅规则"}</h2>
            <p className="text-sm text-slate-500">字段必选；监控所有变化和每节点监控所有 IP 都会自动兼容未来新增节点/IP。</p>
          </div>
          <button className="button ghost" onClick={props.onClose} type="button">
            关闭
          </button>
        </div>
        <div className="field-modal-body space-y-5">
          <label className="block space-y-2 text-sm text-slate-700">
            <span>字段</span>
            <select className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" value={fieldID} onChange={(event) => setFieldID(event.target.value)}>
              <option value="">请选择字段</option>
              {fieldOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
            <input checked={allNodes} onChange={(event) => setAllNodes(event.target.checked)} type="checkbox" />
            <span className="space-y-1">
              <span className="block font-medium text-slate-900">监控所有变化</span>
              <span className="block text-slate-500">打开后不再手动选择节点和 IP，未来新节点会自动纳入。</span>
            </span>
          </label>

          {!allNodes ? (
            <>
              <div className="space-y-2 text-sm text-slate-700">
                <span>节点</span>
                <input className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" placeholder="搜索节点" value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} />
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  {filteredNodes.map((node) => {
                    const checked = selectedNodeIDs.includes(node.id);
                    return (
                      <label key={node.id} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                        <input
                          checked={checked}
                          onChange={(event) =>
                            setSelectedNodeIDs((current) =>
                              event.target.checked ? [...current, node.id] : current.filter((item) => item !== node.id)
                            )
                          }
                          type="checkbox"
                        />
                        <span>{node.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {selectedNodeIDs.map((nodeID) => {
                const node = props.nodes.find((item) => item.id === nodeID);
                const detail = nodeDetails[nodeID];
                const allTargets = scopeAllTargets[nodeID] ?? false;
                return (
                  <div key={nodeID} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                    <div className="font-medium text-slate-900">{node?.name ?? nodeID}</div>
                    <label className="mt-3 flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-700">
                      <input
                        checked={allTargets}
                        onChange={(event) => setScopeAllTargets((current) => ({ ...current, [nodeID]: event.target.checked }))}
                        type="checkbox"
                      />
                      <span className="space-y-1">
                        <span className="block font-medium text-slate-900">监控所有 IP</span>
                        <span className="block text-slate-500">打开后未来新 IP 也会自动纳入，不再手动选择。</span>
                      </span>
                    </label>
                    {!allTargets ? (
                      <div className="mt-3 grid gap-2">
                        {(detail?.targets ?? []).map((target) => {
                          const checked = (scopeTargetIDs[nodeID] ?? []).includes(target.id);
                          return (
                            <label key={target.id} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                              <input
                                checked={checked}
                                onChange={(event) =>
                                  setScopeTargetIDs((current) => {
                                    const selected = current[nodeID] ?? [];
                                    return {
                                      ...current,
                                      [nodeID]: event.target.checked
                                        ? [...selected, target.id]
                                        : selected.filter((item) => item !== target.id)
                                    };
                                  })
                                }
                                type="checkbox"
                              />
                              <span>{target.ip}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </>
          ) : null}

          {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
          <button className="button" disabled={saving} onClick={() => void handleSave()} type="button">
            {saving ? "保存中..." : props.initialRule ? "保存规则" : "创建规则"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function NotificationHomePage(props: { onUnauthorized: () => void }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<NotificationSettings>({ active_channel_id: null, title_template: "", message_template: "" });
  const [channels, setChannels] = useState<NotificationChannelDetail[]>([]);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [nodes, setNodes] = useState<NodeListItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<NotificationRule | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [settingsResponse, channelResponse, ruleResponse, nodeResponse] = await Promise.all([
        apiRequest<NotificationSettings>("/admin/notification/settings"),
        apiRequest<{ items: NotificationChannelDetail[] }>("/admin/notification/channels"),
        apiRequest<{ items: NotificationRule[] }>("/admin/notification/rules"),
        apiRequest<{ items: NodeListItem[] }>("/nodes")
      ]);
      setSettings(settingsResponse);
      setChannels(channelResponse.items ?? []);
      setRules(ruleResponse.items ?? []);
      setNodes(nodeResponse.items ?? []);
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

  useEffect(() => {
    void load();
  }, []);

  async function handleDelete(ruleID: number) {
    try {
      await apiRequest(`/admin/notification/rules/${ruleID}`, { method: "DELETE" });
      await load();
    } catch (deleteError) {
      if (deleteError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(deleteError instanceof Error ? deleteError.message : "删除规则失败");
    }
  }

  async function handleToggle(rule: NotificationRule) {
    try {
      await apiRequest(`/admin/notification/rules/${rule.id}`, {
        method: "PUT",
        body: JSON.stringify({
          field_id: rule.field_id,
          all_nodes: rule.all_nodes,
          enabled: !rule.enabled,
          node_scopes: rule.node_scopes.map((scope) => ({
            node_id: scope.node_id,
            all_targets: scope.all_targets,
            target_ids: scope.targets.map((target) => target.target_id)
          }))
        })
      });
      await load();
    } catch (toggleError) {
      if (toggleError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(toggleError instanceof Error ? toggleError.message : "更新规则失败");
    }
  }

  const currentChannel = channels.find((channel) => channel.is_active) ?? null;

  if (loading) {
    return <NotificationPageLoading />;
  }

  return (
    <section className="space-y-6">
      <SimplePageHeader title="通知" subtitle="当前发信通道概览与字段变化订阅规则。" />
      {error ? <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 shadow-sm">{error}</div> : null}

      <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">当前发信通道</h2>
            <p className="text-sm text-slate-500">
              {currentChannel ? `${providerTypeLabel(currentChannel.type)} · ${currentChannel.enabled ? "已启用" : "已停用"}` : "当前还没有激活的发信通道。"}
            </p>
          </div>
          <div className="flex flex-wrap gap-6 pt-2">
            <button className="button ghost" onClick={() => navigate("/settings/notification/deliveries")} type="button">
              最近投递记录
            </button>
            <button className="button" onClick={() => navigate("/settings/notification/channel")} type="button">
              通道设置
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">字段变化订阅规则</h2>
            <p className="text-sm text-slate-500">规则不再单独选通道，全局只使用当前发信通道。</p>
          </div>
          <div>
            <button
              className="button"
              onClick={() => {
                setEditingRule(null);
                setDialogOpen(true);
              }}
              type="button"
            >
              添加规则
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {rules.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              还没有字段变化订阅规则。
            </div>
          ) : (
            rules.map((rule) => (
              <div key={rule.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="font-medium text-slate-900">{rule.field_id}</div>
                    <div className="text-xs text-slate-500">{summarizeRule(rule)}</div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-3 pt-1">
                    <button
                      className="button ghost"
                      onClick={() => {
                        setEditingRule(rule);
                        setDialogOpen(true);
                      }}
                      type="button"
                    >
                      编辑
                    </button>
                    <button className="button ghost" onClick={() => void handleToggle(rule)} type="button">
                      {rule.enabled ? "停用" : "启用"}
                    </button>
                    <button className="button ghost" onClick={() => void handleDelete(rule.id)} type="button">
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <NotificationRuleDialog
        initialRule={editingRule}
        nodes={nodes}
        onClose={() => setDialogOpen(false)}
        onSaved={load}
        onUnauthorized={props.onUnauthorized}
        open={dialogOpen}
      />
    </section>
  );
}

export function NotificationChannelSettingsPage(props: { onUnauthorized: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<NotificationSettings>({ active_channel_id: null, title_template: "", message_template: "" });
  const [providers, setProviders] = useState<NotificationProviderDefinition[]>([]);
  const [channels, setChannels] = useState<NotificationChannelDetail[]>([]);
  const [selectedProviderType, setSelectedProviderType] = useState("telegram");
  const [channelConfigDraft, setChannelConfigDraft] = useState<Record<string, string>>(getDefaultChannelConfig("telegram"));
  const [savingChannel, setSavingChannel] = useState(false);
  const [savingTemplates, setSavingTemplates] = useState(false);
  const [testingChannelID, setTestingChannelID] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [settingsResponse, providerResponse, channelResponse] = await Promise.all([
        apiRequest<NotificationSettings>("/admin/notification/settings"),
        apiRequest<{ items: NotificationProviderDefinition[] }>("/admin/notification/providers"),
        apiRequest<{ items: NotificationChannelDetail[] }>("/admin/notification/channels")
      ]);
      setSettings(settingsResponse);
      const nextProviders = providerResponse.items ?? [];
      const nextChannels = channelResponse.items ?? [];
      setProviders(nextProviders);
      setChannels(nextChannels);
      const current = nextChannels.find((channel) => channel.is_active) ?? nextChannels[0] ?? null;
      const nextType = current?.type ?? nextProviders[0]?.type ?? "telegram";
      if (current) {
        setSelectedProviderType(nextType);
      } else {
        setSelectedProviderType(nextType);
      }
      const provider = nextProviders.find((item) => item.type === nextType);
      const sameTypeChannel = nextChannels.find((channel) => channel.type === nextType) ?? current;
      setChannelConfigDraft(toConfigDraft(nextType, provider, sameTypeChannel));
    } catch (loadError) {
      if (loadError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "加载通道设置失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const provider = providers.find((item) => item.type === selectedProviderType);
    const selectedChannel = channels.find((channel) => channel.type === selectedProviderType) ?? null;
    setChannelConfigDraft(toConfigDraft(selectedProviderType, provider, selectedChannel));
  }, [channels, providers, selectedProviderType]);

  async function handleSaveChannel() {
    setSavingChannel(true);
    setError("");
    try {
      const provider = providers.find((item) => item.type === selectedProviderType);
      const selectedChannel = channels.find((channel) => channel.type === selectedProviderType) ?? null;
      const savedChannel = await apiRequest<NotificationChannelDetail>(
        selectedChannel ? `/admin/notification/channels/${selectedChannel.id}` : "/admin/notification/channels",
        {
          method: selectedChannel ? "PUT" : "POST",
          body: JSON.stringify({
            name: selectedProviderType,
            type: selectedProviderType,
            enabled: true,
            config: buildChannelConfigPayload(provider, channelConfigDraft)
          })
        }
      );
      const savedSettings = await apiRequest<NotificationSettings>("/admin/notification/settings", {
        method: "PUT",
        body: JSON.stringify({
          active_channel_id: savedChannel.id,
          title_template: "",
          message_template: settings.message_template
        })
      });
      setSettings(savedSettings);
      await load();
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "保存通道失败");
    } finally {
      setSavingChannel(false);
    }
  }

  async function handleSaveTemplates() {
    setSavingTemplates(true);
    setError("");
    try {
      const saved = await apiRequest<NotificationSettings>("/admin/notification/settings", {
        method: "PUT",
        body: JSON.stringify({
          active_channel_id: settings.active_channel_id ?? null,
          title_template: "",
          message_template: settings.message_template
        })
      });
      setSettings(saved);
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "保存模板失败");
    } finally {
      setSavingTemplates(false);
    }
  }

  async function handleTestChannel(channelID: number) {
    setTestingChannelID(channelID);
    setError("");
    try {
      await apiRequest("/admin/notification/test", { method: "POST", body: JSON.stringify({ channel_id: channelID }) });
    } catch (testError) {
      if (testError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(testError instanceof Error ? testError.message : "测试通道失败");
    } finally {
      setTestingChannelID(null);
    }
  }

  const currentChannel = channels.find((channel) => channel.is_active) ?? null;
  const selectedProvider = providers.find((provider) => provider.type === selectedProviderType);
  const selectedChannel = channels.find((channel) => channel.type === selectedProviderType) ?? null;
  const templateProviderType = selectedProviderType;

  if (loading) {
    return <NotificationPageLoading />;
  }

  return (
    <section className="space-y-6">
      <SimplePageHeader title="通道设置" subtitle="管理全局当前发信通道、模板和发送器。" backTo="/settings/notification" />
      {error ? <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 shadow-sm">{error}</div> : null}
      <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">当前发信通道</h2>
          <p className="text-sm text-slate-600">{currentChannel ? providerTypeLabel(currentChannel.type) : "未设置"}</p>
          <p className="text-sm text-slate-500">通知模块全局只使用一个发信通道。切换类型后保存，即会覆盖当前生效通道。</p>
        </div>
      </section>
      <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-6">
          <label className="block space-y-2 text-sm text-slate-700">
            <span className="font-medium text-slate-900">发送器类型</span>
            <p className="text-sm text-slate-500">先选择发信方式，再填写该通道专属配置项。</p>
            <select
              className="block h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              value={selectedProviderType}
              onChange={(event) => setSelectedProviderType(event.target.value)}
            >
              {providers.map((provider) => (
                <option key={provider.type} value={provider.type}>
                  {providerTypeLabel(provider.type)}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-5">
            {(selectedProvider?.fields ?? []).map((field) => {
              const label = providerFieldLabels[field.name] ?? field.name;
              const help = providerFieldDescriptions[field.name] ?? field.help;
              const value = channelConfigDraft[field.name] ?? field.default ?? "";
              const commonClassName =
                "block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100";
              return (
                <label key={field.name} className="block space-y-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">
                    {label}
                    {field.required ? <span className="ml-1 text-rose-500">*</span> : null}
                  </span>
                  {help ? <p className="text-sm text-slate-500">{help}</p> : null}
                  {field.type === "option" ? (
                    <select
                      className="block h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      value={value}
                      onChange={(event) =>
                        setChannelConfigDraft((current) => ({
                          ...current,
                          [field.name]: event.target.value
                        }))
                      }
                    >
                      {(field.options ?? []).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : multilineConfigFields.has(field.name) || field.type === "richtext" ? (
                    <textarea
                      className={`${commonClassName} ${field.name === "script" ? "min-h-[320px]" : "min-h-[140px]"} font-mono text-xs`}
                      value={value}
                      onChange={(event) =>
                        setChannelConfigDraft((current) => ({
                          ...current,
                          [field.name]: event.target.value
                        }))
                      }
                    />
                  ) : (
                    <input
                      className={commonClassName}
                      type={field.type === "password" ? "password" : "text"}
                      value={value}
                      onChange={(event) =>
                        setChannelConfigDraft((current) => ({
                          ...current,
                          [field.name]: event.target.value
                        }))
                      }
                    />
                  )}
                </label>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-5 pt-2">
            <button className="button" disabled={savingChannel} onClick={() => void handleSaveChannel()} type="button">
              {savingChannel ? "保存中..." : "保存并设为当前通道"}
            </button>
            <button className="button ghost" disabled={!selectedChannel} onClick={() => selectedChannel && void handleTestChannel(selectedChannel.id)} type="button">
              {testingChannelID === selectedChannel?.id ? "测试中..." : "测试已保存配置"}
            </button>
          </div>
        </div>
      </section>
      <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">模板 / 字段</h2>
            <p className="text-sm text-slate-500">Telegram / Webhook 使用模板；JavaScript 通道直接拿到完整事件字段。</p>
          </div>
          {templateProviderType === "telegram" || templateProviderType === "webhook" ? (
            <>
              <label className="block space-y-2 text-sm text-slate-700">
                <span className="font-medium text-slate-900">消息模板</span>
                <p className="text-sm text-slate-500">通知只保留消息正文模板，不再单独配置标题。</p>
                <textarea
                  className="block min-h-[180px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-xs outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  value={settings.message_template}
                  onChange={(event) => setSettings((current) => ({ ...current, message_template: event.target.value }))}
                />
              </label>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-xs text-slate-600">
                {templatePlaceholders.map((item) => (
                  <code key={item} className="mr-2">
                    {item}
                  </code>
                ))}
              </div>
              <button className="button" disabled={savingTemplates} onClick={() => void handleSaveTemplates()} type="button">
                {savingTemplates ? "保存中..." : "保存模板"}
              </button>
            </>
          ) : templateProviderType === "javascript" ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
              <div className="font-medium text-slate-900">Javascript 通道可用字段</div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {javascriptFields.map((item) => (
                  <code key={item}>{item}</code>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              请先配置并设定当前发信通道。
            </div>
          )}
        </div>
      </section>
    </section>
  );
}

export function NotificationDeliveriesPage(props: { onUnauthorized: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);

  async function load(nextStatus = statusFilter) {
    setLoading(true);
    setError("");
    try {
      const response = await apiRequest<{ items: NotificationDelivery[] }>(`/admin/notification/deliveries${nextStatus ? `?status=${encodeURIComponent(nextStatus)}` : ""}`);
      setDeliveries(response.items ?? []);
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
    if (!loading) {
      void load(statusFilter);
    }
  }, [statusFilter]);

  async function handleClear() {
    if (!window.confirm("确认清空最近投递记录吗？")) {
      return;
    }
    try {
      await apiRequest("/admin/notification/deliveries", { method: "DELETE" });
      await load(statusFilter);
    } catch (clearError) {
      if (clearError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(clearError instanceof Error ? clearError.message : "清空投递记录失败");
    }
  }

  if (loading) {
    return <NotificationPageLoading />;
  }

  return (
    <section className="space-y-6">
      <SimplePageHeader title="最近投递记录" subtitle="查看最近通知投递结果，并支持清空。" backTo="/settings/notification" />
      {error ? <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 shadow-sm">{error}</div> : null}
      <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-3">
          <select className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">全部状态</option>
            <option value="success">成功</option>
            <option value="failed">失败</option>
          </select>
          <div>
            <button className="button ghost" onClick={() => void handleClear()} type="button">
              清空记录
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-3">
          {deliveries.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              暂无投递记录。
            </div>
          ) : (
            deliveries.map((delivery) => (
              <div key={delivery.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                <div className="font-medium text-slate-900">
                  规则 #{delivery.rule_id} · 历史 #{delivery.history_entry_id}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {formatDateTime(delivery.created_at)} · {delivery.status === "success" ? "发送成功" : "发送失败"}
                </div>
                {delivery.response_summary ? <div className="mt-2 text-xs text-rose-600">{delivery.response_summary}</div> : null}
              </div>
            ))
          )}
        </div>
      </section>
    </section>
  );
}
