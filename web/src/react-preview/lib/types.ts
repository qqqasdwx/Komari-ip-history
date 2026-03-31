export type MeResponse = {
  logged_in: boolean;
  username?: string;
  app_env?: string;
  base_path?: string;
  public_base_url?: string;
};

export type DisplayFieldsConfig = {
  hidden_paths: string[];
};

export type ChangePriorityConfig = {
  secondary_paths: string[];
};

export type NodeListItem = {
  komari_node_uuid: string;
  name: string;
  has_data: boolean;
  current_summary: string;
  current_result: Record<string, unknown>;
  updated_at?: string | null;
  created_at?: string;
};

export type NodeHistoryItem = {
  id: number;
  node_id?: number;
  summary: string;
  recorded_at: string;
  result_json: string;
  created_at?: string;
};

export type NodeDetail = {
  komari_node_uuid: string;
  name: string;
  has_data: boolean;
  current_summary: string;
  updated_at?: string | null;
  current_result: Record<string, unknown>;
  history: NodeHistoryItem[];
  report_config: {
    endpoint_path: string;
    reporter_token: string;
  };
};
