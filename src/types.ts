export interface CacheTTL {
  groupsProjects?: number; // TTL in seconds for groups/projects cache (default: 1800s = 30min)
  branches?: number;       // TTL in seconds for branches cache (default: 300s = 5min)
  pipelines?: number;      // TTL in seconds for pipeline status cache (default: 5s)
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

export interface GitLabServer {
  name: string;
  url: string;
  token: string;
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
  jobs?: PipelineJob[];
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
  error?: string;
}
