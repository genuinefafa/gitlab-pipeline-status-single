import * as fs from 'fs';
import * as path from 'path';
import { TreeData } from './types';

const CACHE_DIR = path.join(process.cwd(), '.cache');
const CACHE_FILE_BASE = path.join(CACHE_DIR, 'pipeline-data.json');
const CACHE_FILE_JOBS = path.join(CACHE_DIR, 'pipeline-data-jobs.json');
const CACHE_DURATION = 10 * 1000; // 10 seconds

interface CacheData {
  timestamp: number;
  data: TreeData[];
  duration?: number; // Duration in milliseconds for the fetch operation
}

export class CacheManager {
  constructor() {
    // Ensure cache directory exists
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
  }

  /**
   * Get cached data if it exists and is not expired
   */
  get(force: boolean = false, includeJobs: boolean = false): TreeData[] | null {
    if (force) {
      return null;
    }

    const cacheFile = includeJobs ? CACHE_FILE_JOBS : CACHE_FILE_BASE;

    try {
      if (!fs.existsSync(cacheFile)) {
        return null;
      }

      const content = fs.readFileSync(cacheFile, 'utf-8');
      const cached: CacheData = JSON.parse(content);

      const age = Date.now() - cached.timestamp;
      if (age > CACHE_DURATION) {
        // Cache expired
        return null;
      }

      return cached.data;
    } catch (error) {
      console.error('Error reading cache:', error);
      return null;
    }
  }

  /**
   * Save data to cache
   */
  set(data: TreeData[], includeJobs: boolean = false, duration?: number): void {
    const cacheFile = includeJobs ? CACHE_FILE_JOBS : CACHE_FILE_BASE;

    try {
      const cacheData: CacheData = {
        timestamp: Date.now(),
        data,
        duration,
      };

      fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error writing cache:', error);
    }
  }

  /**
   * Clear the cache
   */
  clear(): void {
    try {
      if (fs.existsSync(CACHE_FILE_BASE)) {
        fs.unlinkSync(CACHE_FILE_BASE);
      }
      if (fs.existsSync(CACHE_FILE_JOBS)) {
        fs.unlinkSync(CACHE_FILE_JOBS);
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }

  /**
   * Get cache age in seconds, or null if no cache exists
   */
  getAge(includeJobs: boolean = false): number | null {
    const cacheFile = includeJobs ? CACHE_FILE_JOBS : CACHE_FILE_BASE;

    try {
      if (!fs.existsSync(cacheFile)) {
        return null;
      }

      const content = fs.readFileSync(cacheFile, 'utf-8');
      const cached: CacheData = JSON.parse(content);

      return Math.floor((Date.now() - cached.timestamp) / 1000);
    } catch (error) {
      return null;
    }
  }

  /**
   * Get cache duration (fetch time) in seconds, or null if no cache exists or no duration recorded
   */
  getDuration(includeJobs: boolean = false): number | null {
    const cacheFile = includeJobs ? CACHE_FILE_JOBS : CACHE_FILE_BASE;

    try {
      if (!fs.existsSync(cacheFile)) {
        return null;
      }

      const content = fs.readFileSync(cacheFile, 'utf-8');
      const cached: CacheData = JSON.parse(content);

      return cached.duration ? cached.duration / 1000 : null;
    } catch (error) {
      return null;
    }
  }
}
