// Stream Deck SDK Types
export interface StreamDeckEvent {
  action: string;
  event: string;
  context: string;
  device: string;
  payload: Record<string, unknown>;
}

export interface ActionSettings {
  githubToken: string;
  owner: string;
  repo: string;
  workflow?: string;
  refreshInterval: number;
}

export interface KeyDownPayload {
  settings: ActionSettings;
  coordinates: { column: number; row: number };
  state: number;
  userDesiredState: number;
  isInMultiAction: boolean;
}

export interface WillAppearPayload {
  settings: ActionSettings;
  coordinates: { column: number; row: number };
  state: number;
  isInMultiAction: boolean;
}

// GitHub API Types
export type WorkflowStatus = 'success' | 'failure' | 'pending' | 'unknown';

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  head_branch: string;
  head_sha: string;
}

export interface GitHubActionsResponse {
  total_count: number;
  workflow_runs: WorkflowRun[];
}

export interface WorkflowStatusResult {
  status: WorkflowStatus;
  name: string;
  url: string;
  branch: string;
  updatedAt?: string;
  error?: string;
}

// Action Instance
export interface ActionInstance {
  context: string;
  settings: ActionSettings;
  refreshTimer?: ReturnType<typeof setInterval>;
  keyDownTime?: number;
}
