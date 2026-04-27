export type MeResponse = {
  logged_in: boolean;
  username?: string;
  app_env?: string;
  base_path?: string;
  public_base_url?: string;
  effective_public_base_url?: string;
};

export type RuntimeResponse = {
  app_name: string;
  app_env: string;
  base_path: string;
  public_base_url?: string;
  effective_public_base_url?: string;
};

export type IntegrationSettings = {
  public_base_url: string;
  effective_public_base_url: string;
  guest_read_enabled: boolean;
};

export type NotificationProviderField = {
  name: string;
  type: string;
  required?: boolean;
  default?: string;
  options?: string[];
  help?: string;
};

export type NotificationProviderDefinition = {
  type: string;
  fields: NotificationProviderField[];
};

export type NotificationSettings = {
  enabled?: boolean;
  active_channel_id?: number | null;
  title_template: string;
  message_template: string;
};

export type NotificationChannelDetail = {
  id: number;
  name: string;
  type: string;
  enabled: boolean;
  is_active?: boolean;
  config: Record<string, unknown>;
};

export type NotificationRuleTargetScope = {
  target_id: number;
  target_ip: string;
};

export type NotificationRuleNodeScope = {
  id: number;
  node_id: number;
  node_name: string;
  all_targets: boolean;
  targets: NotificationRuleTargetScope[];
};

export type NotificationRule = {
  id: number;
  node_id?: number;
  target_id?: number;
  field_id: string;
  channel_id?: number;
  all_nodes: boolean;
  enabled: boolean;
  node_scopes: NotificationRuleNodeScope[];
  created_at?: string;
  updated_at?: string;
};

export type NotificationDelivery = {
  id: number;
  rule_id: number;
  history_entry_id: number;
  status: string;
  response_summary: string;
  created_at: string;
};

export type APIKeyDetail = {
  id: number;
  name: string;
  enabled: boolean;
  last_used_at?: string | null;
};

export type APIKeyCreateResult = {
  id: number;
  name: string;
  key: string;
  enabled: boolean;
};

export type APIAccessLog = {
  id: number;
  api_key_id: number;
  method: string;
  path: string;
  status_code: number;
  remote_addr: string;
  created_at: string;
};

export type HistoryRetentionSettings = {
  retention_days: number;
  history_bytes: number;
  recent_growth_bytes_per_day: number;
  estimated_retained_bytes: number;
  estimated_is_unbounded: boolean;
};

export type NodeListItem = {
  id: number;
  node_uuid?: string;
  komari_node_uuid: string;
  komari_node_name?: string;
  has_komari_binding?: boolean;
  name: string;
  has_data: boolean;
  updated_at?: string | null;
  created_at?: string;
};

export type KomariBindingCandidate = {
  node_id: number;
  node_name: string;
  komari_node_uuid: string;
  komari_node_name: string;
  has_existing_binding: boolean;
};

export type NodeTargetListItem = {
  id: number;
  ip: string;
  source: string;
  enabled: boolean;
  has_data: boolean;
  updated_at?: string | null;
  last_seen_at?: string | null;
  sort_order: number;
};

export type NodeTargetDetail = {
  id: number;
  ip: string;
  source: string;
  enabled: boolean;
  has_data: boolean;
  updated_at?: string | null;
  last_seen_at?: string | null;
  current_result: Record<string, unknown>;
};

export type NodeDetail = {
  id: number;
  node_uuid?: string;
  komari_node_uuid: string;
  komari_node_name?: string;
  has_komari_binding?: boolean;
  needs_connect?: boolean;
  name: string;
  has_data: boolean;
  updated_at?: string | null;
  targets: NodeTargetListItem[];
  selected_target_id?: number | null;
  current_target?: NodeTargetDetail | null;
  report_config: {
    endpoint_path: string;
    installer_path: string;
    reporter_token: string;
    install_token: string;
    target_ips: string[];
    schedule_cron: string;
    timezone: string;
    run_immediately: boolean;
    next_runs: string[];
  };
};

export type NodeReportConfigPreview = {
  schedule_cron: string;
  timezone: string;
  run_immediately: boolean;
  next_runs: string[];
};

export type PublicTargetListItem = {
  id: number;
  label: string;
  has_data: boolean;
  updated_at?: string | null;
  sort_order: number;
};

export type PublicTargetDetail = {
  id: number;
  label: string;
  has_data: boolean;
  updated_at?: string | null;
  current_result: Record<string, unknown>;
};

export type PublicNodeDetail = {
  node_uuid?: string;
  has_data: boolean;
  targets: PublicTargetListItem[];
  selected_target_id?: number | null;
  current_target?: PublicTargetDetail | null;
};

export type NodeHistoryEntry = {
  id: number;
  target_id: number;
  target_ip: string;
  is_favorite: boolean;
  recorded_at: string;
  summary: string;
  result: Record<string, unknown>;
};

export type NodeHistoryListResponse = {
  items: NodeHistoryEntry[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

export type DisplayFieldValue = {
  id: string;
  path: string;
  group_path: string[];
  label: string;
  text: string;
  tone: "good" | "bad" | "warn" | "muted" | "neutral";
  missing_kind?: "missing";
};

export type NodeHistoryChangeEvent = {
  id: string;
  target_id: number;
  target_ip: string;
  field_id: string;
  group_path: string[];
  field_label: string;
  field_option_label: string;
  previous: DisplayFieldValue;
  current: DisplayFieldValue;
  previous_recorded_at: string;
  recorded_at: string;
};

export type NodeHistoryChangeEventPage = {
  items: NodeHistoryChangeEvent[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

export type NodeHistoryFieldOption = {
  id: string;
  label: string;
};

export type NodeHistoryFieldOptionList = {
  items: NodeHistoryFieldOption[];
};
