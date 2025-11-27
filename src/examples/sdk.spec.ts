/**
 * Scalebox SDK Stability Tests
 *
 * sdk - (5 × 2): 5 sandboxes concurrent, each runs 2 lifecycle rounds serial
 * sdk - (1 × 5): 1 sandbox, 5 lifecycle rounds serial
 *
 * Rules:
 * - Multi-sandbox: concurrent execution
 * - Multi-lifecycle: serial execution, fail fast on any error
 */

import { describe, it, afterAll, expect } from 'vitest';
import { Sandbox } from '@scalebox/sdk';
import { formatStatsTable, calculateStats } from '@/lib';
import {
  createSandbox,
  connectSandbox,
  pauseSandbox,
  killSandbox,
  safeKillSandbox,
  runLifecycle,
  sleep,
  config,
  aggregateTimings,
  type LifecycleTimings,
  type LifecycleResult,
} from './sdk/core';

// ============== Configuration ==============

const TEST_CONFIG = {
  multiSandbox: {
    M: 5, // sandbox count
    N: 2, // lifecycle count per sandbox
  },
  singleSandbox: {
    M: 1, // sandbox count
    N: 5, // lifecycle count
  },
};

// ============== Test Results Storage ==============

interface TestResult {
  testName: string;
  sandboxId?: string;
  success: boolean;
  error?: string;
  failedAt?: string;
  timings: {
    create?: number;
    connect?: number[];
    pause?: number[];
    kill?: number;
  };
  lifecycleResults: LifecycleResult[];
}

// ============== Summary Helper ==============

function printSummary(suiteName: string, results: TestResult[]) {
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log('\n' + '='.repeat(60));
  console.log(`${suiteName} SUMMARY`);
  console.log('='.repeat(60));
  console.log(`Total: ${results.length}, Success: ${successful.length}, Failed: ${failed.length}`);
  console.log(`Success Rate: ${results.length > 0 ? ((successful.length / results.length) * 100).toFixed(1) : 0}%`);

  // Lifecycle operation statistics (from successful tests)
  if (successful.length > 0) {
    const allLifecycleTimings: LifecycleTimings[] = [];
    for (const r of successful) {
      for (const lr of r.lifecycleResults) {
        allLifecycleTimings.push(lr.timings);
      }
    }

    if (allLifecycleTimings.length > 0) {
      console.log('\nLifecycle Operation Statistics:');
      console.log(formatStatsTable(aggregateTimings(allLifecycleTimings)));
    }

    // Sandbox operation statistics
    const createTimes = successful.map((r) => r.timings.create).filter((t): t is number => t !== undefined);
    const connectTimes = successful.flatMap((r) => r.timings.connect || []);
    const pauseTimes = successful.flatMap((r) => r.timings.pause || []);
    const killTimes = successful.map((r) => r.timings.kill).filter((t): t is number => t !== undefined);

    console.log('\nSandbox Operation Statistics:');
    if (createTimes.length > 0) {
      const s = calculateStats(createTimes);
      console.log(`  create:  min=${s.min}ms, max=${s.max}ms, avg=${s.avg}ms (n=${createTimes.length})`);
    }
    if (connectTimes.length > 0) {
      const s = calculateStats(connectTimes);
      console.log(`  connect: min=${s.min}ms, max=${s.max}ms, avg=${s.avg}ms (n=${connectTimes.length})`);
    }
    if (pauseTimes.length > 0) {
      const s = calculateStats(pauseTimes);
      console.log(`  pause:   min=${s.min}ms, max=${s.max}ms, avg=${s.avg}ms (n=${pauseTimes.length})`);
    }
    if (killTimes.length > 0) {
      const s = calculateStats(killTimes);
      console.log(`  kill:    min=${s.min}ms, max=${s.max}ms, avg=${s.avg}ms (n=${killTimes.length})`);
    }
  }

  // Failed tests details
  if (failed.length > 0) {
    console.log('\nFailed Tests:');
    for (const r of failed) {
      console.log(`  [${r.testName}] ${r.sandboxId || 'no-sandbox'}`);
      console.log(`    Failed at: ${r.failedAt}`);
      console.log(`    Error: ${r.error}`);
    }
  }

  console.log('');
}

// ============== sdk - (5 × 2) ==============

describe('sdk - (5 × 2)', () => {
  const results: TestResult[] = [];

  afterAll(() => {
    printSummary('sdk - (5 × 2)', results);
  });

  for (let i = 1; i <= TEST_CONFIG.multiSandbox.M; i++) {
    it.concurrent(`Sandbox ${i}/${TEST_CONFIG.multiSandbox.M}`, async () => {
      const testName = `Sandbox ${i}/${TEST_CONFIG.multiSandbox.M}`;
      const result: TestResult = {
        testName,
        success: false,
        timings: { connect: [], pause: [] },
        lifecycleResults: [],
      };
      let sandbox: Sandbox | null = null;

      try {
        // Create sandbox
        const { sandbox: newSandbox, durationMs: createTime } = await createSandbox();
        sandbox = newSandbox;
        result.sandboxId = sandbox.sandboxId;
        result.timings.create = createTime;
        console.log(`[${i}] Created: ${sandbox.sandboxId} (${createTime}ms)`);

        // Serial lifecycle rounds
        for (let round = 1; round <= TEST_CONFIG.multiSandbox.N; round++) {
          if (round > 1) {
            // Pause
            await sleep(config.timing.pauseDelayMs);
            const { durationMs: pauseTime } = await pauseSandbox(sandbox);
            result.timings.pause!.push(pauseTime);
            console.log(`[${i}] Round ${round - 1} paused (${pauseTime}ms)`);

            // Reconnect
            await sleep(config.timing.reconnectDelayMs);
            const { sandbox: reconnected, durationMs: connectTime } = await connectSandbox(sandbox.sandboxId);
            sandbox = reconnected;
            result.timings.connect!.push(connectTime);
            console.log(`[${i}] Reconnected (${connectTime}ms)`);
          }

          result.failedAt = `round ${round} lifecycle`;
          const lifecycleResult = await runLifecycle({ sandbox, round, verbose: false });
          result.lifecycleResults.push(lifecycleResult);

          const totalTime = Object.values(lifecycleResult.timings).reduce((a, b) => a + b, 0);
          console.log(`[${i}] Round ${round} completed (${totalTime}ms) - Added: ${lifecycleResult.diff.added.join(', ')}`);

          expect(lifecycleResult.diff.added.length).toBeGreaterThan(0);
        }

        // Final pause before kill
        await sleep(config.timing.pauseDelayMs);
        result.failedAt = 'final pause';
        const { durationMs: finalPauseTime } = await pauseSandbox(sandbox);
        result.timings.pause!.push(finalPauseTime);

        // Kill sandbox
        result.failedAt = 'kill';
        const { durationMs: killTime } = await killSandbox(sandbox);
        result.timings.kill = killTime;
        console.log(`[${i}] Killed (${killTime}ms)`);

        result.success = true;
        result.failedAt = undefined;
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        console.error(`[${i}] Error at ${result.failedAt}: ${result.error}`);

        // Robust cleanup with retry
        if (sandbox) {
          const killResult = await safeKillSandbox(sandbox);
          if (killResult.success) {
            console.log(`[${i}] Cleanup: killed after ${killResult.attempts} attempt(s)`);
          } else {
            console.error(`[${i}] Cleanup FAILED: ${killResult.error}`);
          }
        }

        throw error;
      } finally {
        results.push(result);
      }
    }, 5 * 60 * 1000);
  }
});

// ============== sdk - (1 × 5) ==============

describe('sdk - (1 × 5)', () => {
  const results: TestResult[] = [];

  afterAll(() => {
    printSummary('sdk - (1 × 5)', results);
  });

  it('Full lifecycle', async () => {
    const testName = 'Full lifecycle';
    const result: TestResult = {
      testName,
      success: false,
      timings: { connect: [], pause: [] },
      lifecycleResults: [],
    };
    let sandbox: Sandbox | null = null;

    try {
      // Create sandbox
      result.failedAt = 'create';
      const { sandbox: newSandbox, durationMs: createTime } = await createSandbox();
      sandbox = newSandbox;
      result.sandboxId = sandbox.sandboxId;
      result.timings.create = createTime;
      console.log(`Created: ${sandbox.sandboxId} (${createTime}ms)`);

      // Serial lifecycle rounds
      for (let round = 1; round <= TEST_CONFIG.singleSandbox.N; round++) {
        if (round > 1) {
          // Reconnect (previous round already paused)
          await sleep(config.timing.reconnectDelayMs);
          result.failedAt = `round ${round} connect`;
          const { sandbox: reconnected, durationMs: connectTime } = await connectSandbox(sandbox.sandboxId);
          sandbox = reconnected;
          result.timings.connect!.push(connectTime);
          console.log(`Round ${round} reconnected (${connectTime}ms)`);
        }

        // Run lifecycle
        result.failedAt = `round ${round} lifecycle`;
        const lifecycleResult = await runLifecycle({ sandbox, round, verbose: false });
        result.lifecycleResults.push(lifecycleResult);

        const totalTime = Object.values(lifecycleResult.timings).reduce((a, b) => a + b, 0);
        console.log(`Round ${round} completed (${totalTime}ms) - Added: ${lifecycleResult.diff.added.join(', ')}`);

        expect(lifecycleResult.diff.added.length).toBeGreaterThan(0);

        // Pause for next round or final
        await sleep(config.timing.pauseDelayMs);
        result.failedAt = `round ${round} pause`;
        const { durationMs: pauseTime } = await pauseSandbox(sandbox);
        result.timings.pause!.push(pauseTime);
        console.log(`Round ${round} paused (${pauseTime}ms)`);
      }

      // Kill sandbox
      result.failedAt = 'kill';
      const { durationMs: killTime } = await killSandbox(sandbox);
      result.timings.kill = killTime;
      console.log(`Killed (${killTime}ms)`);

      result.success = true;
      result.failedAt = undefined;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      console.error(`Error at ${result.failedAt}: ${result.error}`);

      // Robust cleanup with retry
      if (sandbox) {
        const killResult = await safeKillSandbox(sandbox);
        if (killResult.success) {
          console.log(`Cleanup: killed after ${killResult.attempts} attempt(s)`);
        } else {
          console.error(`Cleanup FAILED: ${killResult.error}`);
        }
      }

      throw error;
    } finally {
      results.push(result);
    }
  }, 10 * 60 * 1000);
});
