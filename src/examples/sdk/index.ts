/**
 * Scalebox SDK Main Process Demo
 *
 * Demonstrates the full sandbox lifecycle:
 * 1. Create sandbox
 * 2. Mount S3 storage
 * 3. List files (before)
 * 4. Run code (create a file)
 * 5. List files (after) + diff
 * 6. Unmount S3
 * 7. Pause sandbox
 * 8. Connect and repeat
 */

import {
  config,
  createSandbox,
  connectSandbox,
  pauseSandbox,
  runLifecycle,
  sleep,
  type RoundTimings,
} from './core';

async function main() {
  console.log('Scalebox SDK Main Process Demo');
  console.log('==============================\n');

  const allTimings: { round: number; timings: RoundTimings }[] = [];

  // Round 1: Create new sandbox
  const { sandbox, durationMs: createTime } = await createSandbox();
  console.log(`[Create sandbox] ${createTime}ms - ${sandbox.sandboxId}`);

  const round1Result = await runLifecycle({ sandbox, round: 1, verbose: true });

  console.log(`\nRound 1 - Waiting ${config.timing.pauseDelayMs / 1000}s before pause...`);
  await sleep(config.timing.pauseDelayMs);

  const { durationMs: pause1Time } = await pauseSandbox(sandbox);
  console.log(`[Pause sandbox] ${pause1Time}ms`);

  allTimings.push({
    round: 1,
    timings: { create: createTime, ...round1Result.timings, pause: pause1Time },
  });

  // Wait before reconnect
  console.log(`\nWaiting ${config.timing.reconnectDelayMs / 1000}s before reconnecting...`);
  await sleep(config.timing.reconnectDelayMs);

  // Round 2: Connect to existing sandbox
  const { sandbox: reconnectedSandbox, durationMs: connectTime } = await connectSandbox(sandbox.sandboxId);
  console.log(`[Connect sandbox] ${connectTime}ms - ${reconnectedSandbox.sandboxId}`);

  const round2Result = await runLifecycle({ sandbox: reconnectedSandbox, round: 2, verbose: true });

  console.log(`\nRound 2 - Waiting ${config.timing.pauseDelayMs / 1000}s before pause...`);
  await sleep(config.timing.pauseDelayMs);

  const { durationMs: pause2Time } = await pauseSandbox(reconnectedSandbox);
  console.log(`[Pause sandbox] ${pause2Time}ms`);

  allTimings.push({
    round: 2,
    timings: { connect: connectTime, ...round2Result.timings, pause: pause2Time },
  });

  // Summary
  console.log('\n');
  console.log('='.repeat(50));
  console.log('TIMING SUMMARY');
  console.log('='.repeat(50));

  for (const { round, timings } of allTimings) {
    console.log(`\nRound ${round}:`);
    for (const [op, ms] of Object.entries(timings)) {
      if (ms !== undefined) {
        console.log(`  ${op.padEnd(15)} ${ms}ms`);
      }
    }
    const total = Object.values(timings)
      .filter((v): v is number => v !== undefined)
      .reduce((a, b) => a + b, 0);
    console.log(`  ${'TOTAL'.padEnd(15)} ${total}ms`);
  }

  console.log('\nDemo completed successfully!');
}

main().catch((error) => {
  console.error('Demo failed:', error);
  process.exit(1);
});
