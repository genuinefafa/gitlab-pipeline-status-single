import * as fs from 'fs';
import * as path from 'path';
import { TreeData, ProjectTreeNode, BranchTreeNode, CacheTTL } from './types';

const CACHE_DIR = path.join(process.cwd(), '.cache');

interface CacheEntry<T> {
  timestamp: number;
  data: T;
  duration?: number; // Fetch duration in ms
}

interface CacheResult<T> {
  data: T | null;
  isStale: boolean;
  age?: number;
}

interface GroupsProjectsCache {
  [serverName: string]: {
    timestamp: number;
    projects: Array<{
      id: number;
      name: string;
      path: string;
      url: string;
    }>;
  };
}

interface BranchesCache {
  [projectKey: string]: {
    timestamp: number;
    branches: Array<{
      name: string;
      commitTitle?: string;
      commitShortId?: string;
    }>;
  };
}

interface PipelinesCache {
  [branchKey: string]: {
    timestamp: number;
    pipeline?: any;
    includeJobs: boolean;
  };
}

export class MultiLevelCacheManager {
  private groupsProjectsFile: string;
  private branchesFile: string;
  private pipelinesFile: string;
  private ttl: {
    groupsProjects: number; // in milliseconds
    branches: number;       // in milliseconds
    pipelines: number;      // in milliseconds
  };

  /**
   * @param cacheTTL - Cache TTL configuration in seconds (will be converted to milliseconds internally)
   */
  constructor(cacheTTL?: CacheTTL) {
    // Ensure cache directory exists
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }

    this.groupsProjectsFile = path.join(CACHE_DIR, 'groups-projects.json');
    this.branchesFile = path.join(CACHE_DIR, 'branches.json');
    this.pipelinesFile = path.join(CACHE_DIR, 'pipelines.json');

    // Convert TTL from seconds to milliseconds, with defaults
    this.ttl = {
      groupsProjects: (cacheTTL?.groupsProjects ?? 1800) * 1000, // default: 30 minutes
      branches: (cacheTTL?.branches ?? 300) * 1000,              // default: 5 minutes
      pipelines: (cacheTTL?.pipelines ?? 5) * 1000,              // default: 5 seconds
    };
  }

  // ============================================================================
  // LEVEL 1: Groups & Projects (30min TTL)
  // ============================================================================

  getGroupsProjects(serverName: string): CacheResult<Array<{id: number, name: string, path: string, url: string}>> {
    try {
      if (!fs.existsSync(this.groupsProjectsFile)) {
        return { data: null, isStale: false };
      }

      const cache: GroupsProjectsCache = JSON.parse(fs.readFileSync(this.groupsProjectsFile, 'utf-8'));
      const entry = cache[serverName];

      if (!entry) {
        return { data: null, isStale: false };
      }

      const age = Date.now() - entry.timestamp;
      const isStale = age > this.ttl.groupsProjects;

      // Always return data even if stale - never leave client with nothing
      return { 
        data: entry.projects, 
        isStale,
        age 
      };
    } catch (error) {
      console.error('Error reading groups/projects cache:', error);
      return { data: null, isStale: false };
    }
  }

  setGroupsProjects(serverName: string, projects: Array<{id: number, name: string, path: string, url: string}>): void {
    try {
      let cache: GroupsProjectsCache = {};
      
      if (fs.existsSync(this.groupsProjectsFile)) {
        cache = JSON.parse(fs.readFileSync(this.groupsProjectsFile, 'utf-8'));
      }

      cache[serverName] = {
        timestamp: Date.now(),
        projects,
      };

      fs.writeFileSync(this.groupsProjectsFile, JSON.stringify(cache, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error writing groups/projects cache:', error);
    }
  }

  // ============================================================================
  // LEVEL 2: Branches per project (5min TTL)
  // ============================================================================

  getBranches(projectPath: string): CacheResult<Array<{name: string, commitTitle?: string, commitShortId?: string}>> {
    try {
      if (!fs.existsSync(this.branchesFile)) {
        return { data: null, isStale: false };
      }

      const cache: BranchesCache = JSON.parse(fs.readFileSync(this.branchesFile, 'utf-8'));
      const entry = cache[projectPath];

      if (!entry) {
        return { data: null, isStale: false };
      }

      const age = Date.now() - entry.timestamp;
      const isStale = age > this.ttl.branches;

      // Always return data even if stale - never leave client with nothing
      return {
        data: entry.branches, 
        isStale,
        age 
      };
    } catch (error) {
      console.error('Error reading branches cache:', error);
      return { data: null, isStale: false };
    }
  }

  setBranches(projectPath: string, branches: Array<{name: string, commitTitle?: string, commitShortId?: string}>): void {
    try {
      let cache: BranchesCache = {};
      
      if (fs.existsSync(this.branchesFile)) {
        cache = JSON.parse(fs.readFileSync(this.branchesFile, 'utf-8'));
      }

      cache[projectPath] = {
        timestamp: Date.now(),
        branches,
      };

      fs.writeFileSync(this.branchesFile, JSON.stringify(cache, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error writing branches cache:', error);
    }
  }

  // ============================================================================
  // LEVEL 3: Pipeline status per branch (5sec TTL)
  // ============================================================================

  getPipeline(projectPath: string, branchName: string, includeJobs: boolean): CacheResult<any> {
    try {
      if (!fs.existsSync(this.pipelinesFile)) {
        return { data: null, isStale: false };
      }

      const cache: PipelinesCache = JSON.parse(fs.readFileSync(this.pipelinesFile, 'utf-8'));
      const key = `${projectPath}:${branchName}`;
      const entry = cache[key];

      if (!entry || entry.includeJobs !== includeJobs) {
        return { data: null, isStale: false };
      }

      const age = Date.now() - entry.timestamp;
      const isStale = age > this.ttl.pipelines;

      // Always return data even if stale - never leave client with nothing
      return {
        data: entry.pipeline || null, 
        isStale,
        age 
      };
    } catch (error) {
      console.error('Error reading pipeline cache:', error);
      return { data: null, isStale: false };
    }
  }

  setPipeline(projectPath: string, branchName: string, pipeline: any | undefined, includeJobs: boolean): void {
    try {
      let cache: PipelinesCache = {};
      
      if (fs.existsSync(this.pipelinesFile)) {
        cache = JSON.parse(fs.readFileSync(this.pipelinesFile, 'utf-8'));
      }

      const key = `${projectPath}:${branchName}`;
      cache[key] = {
        timestamp: Date.now(),
        pipeline,
        includeJobs,
      };

      fs.writeFileSync(this.pipelinesFile, JSON.stringify(cache, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error writing pipeline cache:', error);
    }
  }

  // ============================================================================
  // CACHE METADATA & UTILITIES
  // ============================================================================

  getGroupsProjectsAge(serverName: string): number | null {
    try {
      if (!fs.existsSync(this.groupsProjectsFile)) {
        return null;
      }

      const cache: GroupsProjectsCache = JSON.parse(fs.readFileSync(this.groupsProjectsFile, 'utf-8'));
      const entry = cache[serverName];

      if (!entry) {
        return null;
      }

      return Math.floor((Date.now() - entry.timestamp) / 1000);
    } catch (error) {
      return null;
    }
  }

  getBranchesAge(projectPath: string): number | null {
    try {
      if (!fs.existsSync(this.branchesFile)) {
        return null;
      }

      const cache: BranchesCache = JSON.parse(fs.readFileSync(this.branchesFile, 'utf-8'));
      const entry = cache[projectPath];

      if (!entry) {
        return null;
      }

      return Math.floor((Date.now() - entry.timestamp) / 1000);
    } catch (error) {
      return null;
    }
  }

  getPipelineAge(projectPath: string, branchName: string): number | null {
    try {
      if (!fs.existsSync(this.pipelinesFile)) {
        return null;
      }

      const cache: PipelinesCache = JSON.parse(fs.readFileSync(this.pipelinesFile, 'utf-8'));
      const key = `${projectPath}:${branchName}`;
      const entry = cache[key];

      if (!entry) {
        return null;
      }

      return Math.floor((Date.now() - entry.timestamp) / 1000);
    } catch (error) {
      return null;
    }
  }

  /**
   * Clear all caches
   */
  clear(): void {
    try {
      [this.groupsProjectsFile, this.branchesFile, this.pipelinesFile].forEach(file => {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      });
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }
}
