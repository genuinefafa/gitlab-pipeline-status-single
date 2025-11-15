import { Pipeline, PipelineStatistics } from './types';
import { GitLabClient } from './gitlab';

/**
 * Calculate median from an array of numbers
 */
function calculateMedian(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    // Even number of values: average of two middle values
    return (sorted[middle - 1] + sorted[middle]) / 2;
  } else {
    // Odd number of values: middle value
    return sorted[middle];
  }
}

/**
 * Get pipeline statistics for a branch
 * Returns median duration based on last N successful pipelines
 */
export async function getPipelineStatistics(
  client: GitLabClient,
  projectId: number,
  branchName: string,
  sampleCount: number = 10
): Promise<PipelineStatistics> {
  const recentPipelines = await client.getRecentPipelines(projectId, branchName, sampleCount);

  // Extract durations from pipelines
  const durations = recentPipelines
    .map((p) => p.duration)
    .filter((d): d is number => d !== null && d > 0);

  const estimatedDuration = calculateMedian(durations);

  return {
    projectId,
    branchName,
    estimatedDuration,
    sampleSize: durations.length,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Format duration in seconds to human-readable format
 * Examples: "2m 15s", "45s", "1h 23m 45s"
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds === 0 || isNaN(seconds)) {
    return '0s';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

/**
 * Calculate elapsed time for a running pipeline
 */
export function calculateElapsedTime(startedAt: string | null | undefined): number | null {
  if (!startedAt) return null;

  const started = new Date(startedAt).getTime();
  if (isNaN(started)) return null; // Invalid date

  const now = Date.now();
  return Math.floor((now - started) / 1000); // Convert to seconds
}

/**
 * Format pipeline duration and estimation for display
 * For running pipelines: "2m 15s / ~7m 30s"
 * For completed pipelines: "7m 45s"
 */
export function formatPipelineDuration(
  pipeline: Pipeline,
  estimatedDuration: number | null
): string {
  if (pipeline.status === 'running') {
    const elapsed = calculateElapsedTime(pipeline.started_at);
    const elapsedStr = elapsed !== null && elapsed > 0 ? formatDuration(elapsed) : '?';
    const estimatedStr = estimatedDuration !== null && estimatedDuration > 0 ? `~${formatDuration(estimatedDuration)}` : '?';
    return `${elapsedStr} / ${estimatedStr}`;
  }

  // For completed pipelines, show actual duration
  if (pipeline.duration !== null && pipeline.duration !== undefined && !isNaN(pipeline.duration)) {
    return formatDuration(pipeline.duration);
  }

  return '-';
}
