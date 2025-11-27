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

import { describe, it, expect } from 'vitest';
import { Sandbox } from '@scalebox/sdk';
import {
  createSandbox,
  connectSandbox,
  pauseSandbox,
  killSandbox,
  safeKillSandbox,
  runLifecycle,
  sleep,
  config,
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

// ============== sdk - (5 × 2) ==============

describe('sdk - (5 × 2)', () => {
  for (let i = 1; i <= TEST_CONFIG.multiSandbox.M; i++) {
    it.concurrent(`Sandbox ${i}/${TEST_CONFIG.multiSandbox.M}`, async () => {
      const result: TestResult = {
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
        // noop
      }
    }, 5 * 60 * 1000);
  }
});

// ============== sdk - (1 × 5) ==============

describe('sdk - (1 × 5)', () => {
  it('Full lifecycle', async () => {
    const result: TestResult = {
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
      // noop
    }
  }, 10 * 60 * 1000);
});
