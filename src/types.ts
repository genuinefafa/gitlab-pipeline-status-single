export interface CacheTTL {
  groupsProjects?: number; // TTL in seconds for groups/projects cache (default: 1800s = 30min)
  branches?: number;       // TTL in seconds for branches cache (default: 300s = 5min)
  pipelines?: number;      // TTL in seconds for pipeline status cache (default: 5s)
  statistics?: number;     // TTL in seconds for pipeline statistics cache (default: 1800s = 30min)
}

export interface Config {
  refreshInterval: number;
  servers: GitLabServer[];
  excludeProjects?: string[];
  cache?: CacheTTL;
  display?: {
    recentOnly?: boolean;
    pipelinesPerBranch?: number;
    compact?: boolean;
  };
}

export interface GitLabToken {
  value: string;
  name?: string;
  expiresAt?: string; // ISO date format YYYY-MM-DD
}

export interface GitLabServer {
  name: string;
  url: string;
  token?: string; // Legacy: single token (still supported)
  tokens?: GitLabToken[]; // New: multiple tokens with metadata
  projects?: ProjectConfig[];
  groups?: GroupConfig[];
}

export interface ProjectConfig {
  id?: number;
  path?: string;
  name?: string;
}

export interface GroupConfig {
  id?: number;
  path?: string;
  name?: string;
  includeSubgroups?: boolean;
}

export interface Project {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url: string;
}

export interface Branch {
  name: string;
  web_url: string;
  commit: {
    id: string;
    short_id: string;
    title: string;
  };
}

export interface Pipeline {
  id: number;
  status: PipelineStatus;
  ref: string;
  sha: string;
  web_url: string;
  created_at: string;
  updated_at: string;
  duration: number | null;      // Duration in seconds, null if not finished
  started_at: string | null;    // ISO timestamp when pipeline started
  finished_at: string | null;   // ISO timestamp when pipeline finished
  jobs?: PipelineJob[];
}

export interface PipelineStatistics {
  projectId: number;
  branchName: string;
  estimatedDuration: number | null;  // Median duration in seconds, null if not enough data
  sampleSize: number;                // Number of pipelines used for estimation
  lastUpdated: string;               // ISO timestamp
}

export interface PipelineJob {
  id: number;
  name: string;
  status: PipelineStatus;
  stage: string;
  web_url: string;
}

export type PipelineStatus =
  | 'created'
  | 'waiting_for_resource'
  | 'preparing'
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'canceled'
  | 'skipped'
  | 'manual';

export interface TokenInfo {
  id: number;
  name: string;
  revoked: boolean;
  created_at: string;
  scopes: string[];
  user_id: number;
  last_used_at: string | null;
  active: boolean;
  expires_at: string | null; // ISO date YYYY-MM-DD or null if no expiration
}

export interface TokenHealthStatus {
  serverName: string;
  tokens: Array<{
    name: string;
    status: 'valid' | 'expiring' | 'expired' | 'invalid';
    expiresAt: string | null;
    daysRemaining: number | null;
    message: string;
  }>;
}

export interface TreeData {
  serverName: string;
  projects: ProjectTreeNode[];
}

export interface ProjectTreeNode {
  name: string;
  path: string;
  url: string;
  branches: BranchTreeNode[];
  error?: string;
}

export interface BranchTreeNode {
  name: string;
  commitTitle?: string;
  commitShortId?: string;
  pipeline?: Pipeline;
  estimatedDuration?: number | null; // Estimated duration in seconds based on history
  error?: string;
}
