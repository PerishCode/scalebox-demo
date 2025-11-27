// ============== Timing ==============

/**
 * Execute a function and measure its execution time
 */
export async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  const result = await fn();
  const durationMs = Date.now() - start;
  return { result, durationMs };
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============== Diff ==============

/**
 * Compare two arrays by name and return added/removed items
 */
export function diffByName<T extends { name: string }>(
  before: T[],
  after: T[]
): { added: string[]; removed: string[] } {
  const beforeNames = new Set(before.map((f) => f.name));
  const afterNames = new Set(after.map((f) => f.name));

  const added = after.filter((f) => !beforeNames.has(f.name)).map((f) => f.name);
  const removed = before.filter((f) => !afterNames.has(f.name)).map((f) => f.name);

  return { added, removed };
}

// ============== Statistics ==============

export interface TimingStats {
  min: number;
  max: number;
  avg: number;
  total: number;
}

export function calculateStats(values: number[]): TimingStats {
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, total: 0 };
  }
  const total = values.reduce((a, b) => a + b, 0);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: Math.round(total / values.length),
    total,
  };
}

export function formatStatsTable(stats: Record<string, TimingStats>): string {
  const lines: string[] = [];
  lines.push('Operation'.padEnd(15) + 'Min'.padStart(10) + 'Max'.padStart(10) + 'Avg'.padStart(10));
  lines.push('-'.repeat(45));

  for (const [op, s] of Object.entries(stats)) {
    lines.push(
      op.padEnd(15) + `${s.min}ms`.padStart(10) + `${s.max}ms`.padStart(10) + `${s.avg}ms`.padStart(10)
    );
  }

  return lines.join('\n');
}
