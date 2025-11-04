import * as fs from 'fs';
import * as path from 'path';
import { TreeData } from './types';

const CACHE_DIR = path.join(process.cwd(), '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'pipeline-data.json');
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes default

interface CacheData {
  timestamp: number;
  data: TreeData[];
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
  get(force: boolean = false): TreeData[] | null {
    if (force) {
      return null;
    }

    try {
      if (!fs.existsSync(CACHE_FILE)) {
        return null;
      }

      const content = fs.readFileSync(CACHE_FILE, 'utf-8');
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
  set(data: TreeData[]): void {
    try {
      const cacheData: CacheData = {
        timestamp: Date.now(),
        data,
      };

      fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error writing cache:', error);
    }
  }

  /**
   * Clear the cache
   */
  clear(): void {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        fs.unlinkSync(CACHE_FILE);
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }

  /**
   * Get cache age in seconds, or null if no cache exists
   */
  getAge(): number | null {
    try {
      if (!fs.existsSync(CACHE_FILE)) {
        return null;
      }

      const content = fs.readFileSync(CACHE_FILE, 'utf-8');
      const cached: CacheData = JSON.parse(content);

      return Math.floor((Date.now() - cached.timestamp) / 1000);
    } catch (error) {
      return null;
    }
  }
}
