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

export type NodeListItem = {
  komari_node_uuid: string;
  name: string;
  has_data: boolean;
  updated_at?: string | null;
  created_at?: string;
};

export type NodeTargetListItem = {
  id: number;
  ip: string;
  has_data: boolean;
  updated_at?: string | null;
  sort_order: number;
};

export type NodeTargetDetail = {
  id: number;
  ip: string;
  has_data: boolean;
  updated_at?: string | null;
  current_result: Record<string, unknown>;
};

export type NodeDetail = {
  komari_node_uuid: string;
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
    target_ips: string[];
  };
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
  has_data: boolean;
  targets: PublicTargetListItem[];
  selected_target_id?: number | null;
  current_target?: PublicTargetDetail | null;
};

export type NodeHistoryEntry = {
  id: number;
  target_id: number;
  target_ip: string;
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

export type NodeHistoryDetailResponse = {
  item: NodeHistoryEntry;
  previous?: NodeHistoryEntry | null;
};
