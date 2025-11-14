## Summary

Adds pipeline duration tracking and estimation to provide better visibility into pipeline execution times and predict completion for running pipelines.

## Features

### Pipeline Duration Display

Shows actual duration for completed pipelines and estimated completion for running pipelines:

**Running Pipeline:**
```
SUCCESS ⏱️ 2m 15s / ~7m 30s
```
- First value: elapsed time since pipeline started
- Second value: estimated total duration based on history

**Completed Pipeline:**
```
SUCCESS ⏱️ 7m 45s
```
- Shows actual pipeline duration

**No Estimation Available:**
```
RUNNING ⏱️ 2m 15s / ?
```
- Shows elapsed time with `?` when no historical data exists

### Intelligent Estimation

- **Algorithm**: Median of last 10 successful pipelines from the same branch
- **Why median?** More robust than average - not affected by occasional outliers
- **Filtered data**: Excludes canceled/skipped pipelines (they don't represent normal execution)
- **Branch-specific**: Each branch has its own estimation (develop vs. feature branches may differ)

### Smart Caching

- Statistics cached for **30 minutes** (separate from pipeline cache)
- Reduces GitLab API calls while keeping estimates fresh
- Cache key: `projectId:branchName`
- Automatic cache invalidation after TTL expires

## Implementation

### New Files

**src/pipeline-statistics.ts** (103 lines)
- `getPipelineStatistics()` - Fetch and calculate branch statistics
- `calculateMedian()` - Median calculation from array
- `formatDuration()` - Human-readable time format (e.g., "2m 15s")
- `calculateElapsedTime()` - Running pipeline elapsed time
- `formatPipelineDuration()` - Unified formatting for all pipeline states

### Type Updates (src/types.ts)

**Pipeline interface** - Added fields from GitLab API:
```typescript
interface Pipeline {
  // ... existing fields
  duration: number | null;      // Duration in seconds
  started_at: string | null;    // ISO timestamp
  finished_at: string | null;   // ISO timestamp
}
```

**New PipelineStatistics interface:**
```typescript
interface PipelineStatistics {
  projectId: number;
  branchName: string;
  estimatedDuration: number | null;  // Median in seconds
  sampleSize: number;                // Pipelines used
  lastUpdated: string;               // ISO timestamp
}
```

**BranchTreeNode** - Added estimation:
```typescript
interface BranchTreeNode {
  // ... existing fields
  estimatedDuration?: number | null;
}
```

**CacheTTL** - New statistics cache:
```typescript
interface CacheTTL {
  // ... existing caches
  statistics?: number;  // Default: 1800s (30 min)
}
```

### GitLab Client (src/gitlab.ts)

**New method: `getRecentPipelines()`**
```typescript
async getRecentPipelines(
  projectId: number,
  branchName: string,
  count: number = 10
): Promise<Pipeline[]>
```

- Fetches last N pipelines for a branch
- Automatically filters out canceled/skipped
- Only includes pipelines with valid duration > 0
- Requests `count * 2` to account for filtering

### Cache Manager (src/cache.ts)

**New methods for statistics cache:**
- `getStatistics(projectId, branchName)` - Get cached stats
- `setStatistics(projectId, branchName, stats)` - Save stats (30min TTL)
- `clearStatistics()` - Clear statistics cache

**Cache file:** `.cache/pipeline-statistics.json`
**Format:**
```json
{
  "timestamp": 1234567890,
  "statistics": {
    "123:main": {
      "projectId": 123,
      "branchName": "main",
      "estimatedDuration": 450,
      "sampleSize": 10,
      "lastUpdated": "2025-01-14T..."
    }
  }
}
```

### Data Fetching (src/api-server.ts)

**Integrated statistics in main fetch loop:**

For each branch:
1. Check statistics cache first
2. If cache miss: Calculate from recent pipelines
3. Cache the result for 30 minutes
4. Add `estimatedDuration` to `BranchTreeNode`
5. Silent failure if statistics unavailable (estimation is optional)

### htmx Routes (src/api-routes-htmx.ts)

**Real-time updates:**
- On-demand statistics calculation for live branches
- Fetches project info from L1 cache
- Calculates and adds duration to template data
- Fixed variable scoping for `projectInfo`/`serverForProject`

**Template data additions:**
```javascript
{
  pipeline: {
    // ... existing fields
    durationText: "2m 15s / ~7m 30s",  // Formatted duration
    hasDuration: true,                 // Show duration UI
  }
}
```

### Templates Updated

All templates now display duration after status badge:

**branch-row.mustache** - List view
**branch-row-content.mustache** - List view (content only)
**branch-chart-summary.mustache** - Chart view summary

```html
{{#pipeline}}
  <mark data-status="{{status}}">{{statusText}}</mark>
  {{#hasDuration}}
    <small class="duration-text"> ⏱️ {{durationText}}</small>
  {{/hasDuration}}
{{/pipeline}}
```

## Display Examples

### Chart View

```
📦 my-project
  ⏵ main
    SUCCESS ⏱️ 7m 45s  abc123
  ⏵ feature/new-ui
    RUNNING ⏱️ 2m 15s / ~7m 30s  def456
  ⏵ hotfix/critical-bug
    FAILED ⏱️ 3m 12s  ghi789
```

### List View

```
Branch         | Status                          | Commit
-------------  | ------------------------------- | --------
main           | SUCCESS ⏱️ 7m 45s               | abc123
feature/new-ui | RUNNING ⏱️ 2m 15s / ~7m 30s     | def456
hotfix/bug     | FAILED ⏱️ 3m 12s                | ghi789
```

## Benefits

✅ **Better visibility** - See how long pipelines actually take
✅ **Predictability** - Estimate when running pipelines will complete
✅ **Historical context** - Understand typical execution times per branch
✅ **Minimal overhead** - Cached for 30 minutes, smart filtering
✅ **Robust estimations** - Median algorithm resists outliers
✅ **Branch-specific** - Different branches have different characteristics

## Technical Notes

**Why median instead of average?**
- More robust to outliers (occasional slow runs don't skew data)
- Better represents "typical" pipeline duration
- Example: `[5m, 5m, 5m, 5m, 50m]` → median: 5m, average: 14m

**Why filter canceled/skipped?**
- Canceled pipelines don't represent normal execution
- Skipped pipelines have 0 duration (not useful for estimation)
- Only successful/failed/running pipelines reflect actual work

**Why 30-minute cache?**
- Pipeline patterns don't change frequently
- Reduces API load (10 pipelines per branch × N branches)
- Fresh enough to catch recent optimizations
- Can be configured via `cache.statistics` in config.yaml

## Backward Compatibility

✅ No breaking changes
✅ New Pipeline fields already exist in GitLab API
✅ Duration display is optional (hidden if no data)
✅ Existing templates work unchanged (new sections are conditional)
✅ Statistics cache is separate from existing caches

## Files Changed

- **New**: `src/pipeline-statistics.ts` (103 lines)
- **Modified**: `src/types.ts` - Added interfaces and fields
- **Modified**: `src/gitlab.ts` - Added `getRecentPipelines()`
- **Modified**: `src/cache.ts` - Added statistics cache methods
- **Modified**: `src/api-server.ts` - Integrated statistics fetching
- **Modified**: `src/api-routes-htmx.ts` - Added duration to templates
- **Modified**: Templates (3 files) - Display duration
