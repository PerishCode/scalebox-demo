/**
 * Scalebox SDK Main Process - Core Module
 *
 * Reusable functions for sandbox lifecycle management
 */

import 'dotenv/config';
import { Sandbox } from '@scalebox/sdk';
import { sleep, measureTime, diffByName, calculateStats, type TimingStats } from '@/lib';

export { sleep, measureTime, calculateStats, type TimingStats };

// ============== Types ==============

export interface FileInfo {
  name: string;
  type: string;
}

export interface LifecycleTimings {
  mount: number;
  listBefore: number;
  runCode: number;
  listAfter: number;
  unmount: number;
}

export interface LifecycleResult {
  sandboxId: string;
  timings: LifecycleTimings;
  filesBefore: FileInfo[];
  filesAfter: FileInfo[];
  diff: { added: string[]; removed: string[] };
  codeOutput: string;
}

export interface RoundTimings extends LifecycleTimings {
  create?: number;
  connect?: number;
  pause?: number;
  kill?: number;
}

// ============== Configuration ==============

export const config = {
  scalebox: {
    apiKey: process.env.SCALEBOX_API_KEY!,
    timeoutMs: 30 * 60 * 1000, // 30 minutes
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT!,
    accessKey: process.env.S3_ACCESS_KEY!,
    secretKey: process.env.S3_SECRET_KEY!,
    bucket: process.env.S3_BUCKET!,
    region: process.env.S3_REGION!,
    mountPath: process.env.S3_MOUNT_PATH!,
  },
  timing: {
    pauseDelayMs: 15 * 1000,
    reconnectDelayMs: 15 * 1000,
  },
};

export const SANDBOX_MOUNT_POINT = '/mnt/s3';
const S3FS_PASSWD_FILE = '/tmp/s3fs_passwd';

// ============== S3 Mount Commands ==============

export function buildMountCommand(): string {
  const { endpoint, accessKey, secretKey, bucket, region, mountPath } = config.s3;
  const passwdContent = `${accessKey}:${secretKey}`;
  const s3EndpointUrl = `https://${endpoint}`;

  const s3fsCmd = [
    `s3fs ${bucket}:/${mountPath} ${SANDBOX_MOUNT_POINT}`,
    `-o url=${s3EndpointUrl}`,
    `-o endpoint=${region}`,
    `-o passwd_file=${S3FS_PASSWD_FILE}`,
    '-o use_path_request_style',
    '-o compat_dir',
    '-o nonempty',
  ].join(' ');

  return `(mkdir -p ${SANDBOX_MOUNT_POINT} && echo "${passwdContent}" > ${S3FS_PASSWD_FILE} && chmod 600 ${S3FS_PASSWD_FILE}; ${s3fsCmd}; ret=$?; rm -f ${S3FS_PASSWD_FILE}; exit $ret)`;
}

export function buildUnmountCommand(): string {
  return `fusermount -uz ${SANDBOX_MOUNT_POINT}`;
}

// ============== Sandbox Operations ==============

export async function createSandbox(): Promise<{ sandbox: Sandbox; durationMs: number }> {
  const { result: sandbox, durationMs } = await measureTime(async () => {
    return await Sandbox.create('code-interpreter', {
      apiKey: config.scalebox.apiKey,
      timeoutMs: config.scalebox.timeoutMs,
    });
  });
  return { sandbox, durationMs };
}

export async function connectSandbox(sandboxId: string): Promise<{ sandbox: Sandbox; durationMs: number }> {
  const { result: sandbox, durationMs } = await measureTime(async () => {
    return await Sandbox.connect(sandboxId, {
      apiKey: config.scalebox.apiKey,
    });
  });
  return { sandbox, durationMs };
}

export async function pauseSandbox(sandbox: Sandbox): Promise<{ durationMs: number }> {
  const { durationMs } = await measureTime(async () => {
    await sandbox.betaPause();
  });
  return { durationMs };
}

export async function killSandbox(sandbox: Sandbox): Promise<{ durationMs: number }> {
  const { durationMs } = await measureTime(async () => {
    await sandbox.kill();
  });
  return { durationMs };
}

export interface SafeKillResult {
  success: boolean;
  attempts: number;
  durationMs: number;
  error?: string;
}

/**
 * Kill sandbox with retry logic for robust cleanup
 * @param sandbox - Sandbox to kill
 * @param maxAttempts - Max retry attempts (default 20)
 * @param intervalMs - Interval between retries (default 500ms)
 */
export async function safeKillSandbox(
  sandbox: Sandbox,
  maxAttempts = 20,
  intervalMs = 500
): Promise<SafeKillResult> {
  const start = Date.now();
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sandbox.kill();
      return {
        success: true,
        attempts: attempt,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < maxAttempts) {
        await sleep(intervalMs);
      }
    }
  }

  return {
    success: false,
    attempts: maxAttempts,
    durationMs: Date.now() - start,
    error: lastError,
  };
}

export async function mountS3(sandbox: Sandbox): Promise<{ durationMs: number }> {
  const { durationMs } = await measureTime(async () => {
    const mountCmd = buildMountCommand();
    const result = await sandbox.commands.run(mountCmd);
    if (result.exitCode !== 0) {
      throw new Error(`Mount failed: ${result.stderr}`);
    }
  });
  return { durationMs };
}

export async function unmountS3(sandbox: Sandbox): Promise<{ durationMs: number }> {
  const { durationMs } = await measureTime(async () => {
    const unmountCmd = buildUnmountCommand();
    const result = await sandbox.commands.run(unmountCmd);
    if (result.exitCode !== 0) {
      console.warn(`Unmount warning: ${result.stderr}`);
    }
  });
  return { durationMs };
}

export async function listFiles(sandbox: Sandbox): Promise<{ files: FileInfo[]; durationMs: number }> {
  const { result: files, durationMs } = await measureTime(async () => {
    return (await sandbox.files.list(SANDBOX_MOUNT_POINT)) as FileInfo[];
  });
  return { files, durationMs };
}

export async function runTestCode(sandbox: Sandbox, round: number): Promise<{ output: string; durationMs: number }> {
  const testFileName = `test-${Date.now()}.txt`;
  const testFileContent = `Hello from round ${round} at ${new Date().toISOString()}`;
  const pythonCode = `
with open("${SANDBOX_MOUNT_POINT}/${testFileName}", "w") as f:
    f.write("${testFileContent}")
print(f"Created file: ${testFileName}")
`;

  const { result, durationMs } = await measureTime(async () => {
    return await sandbox.runCode(pythonCode, { language: 'python' });
  });

  if (result.exitCode !== 0) {
    throw new Error(`Code execution failed: ${result.logs?.stderr || 'unknown error'}`);
  }

  return {
    output: result.logs?.stdout || result.text || '',
    durationMs,
  };
}

// ============== Lifecycle ==============

export interface RunLifecycleOptions {
  sandbox: Sandbox;
  round: number;
  verbose?: boolean;
}

export async function runLifecycle(options: RunLifecycleOptions): Promise<LifecycleResult> {
  const { sandbox, round, verbose = false } = options;
  const log = verbose ? console.log.bind(console) : () => {};

  log(`\n${'='.repeat(50)}`);
  log(`Round ${round}: Starting lifecycle for sandbox ${sandbox.sandboxId}`);
  log(`${'='.repeat(50)}\n`);

  // Mount S3
  const { durationMs: mountTime } = await mountS3(sandbox);
  log(`[Mount S3] ${mountTime}ms`);

  // List files (before)
  const { files: filesBefore, durationMs: listBeforeTime } = await listFiles(sandbox);
  log(`[List files (before)] ${listBeforeTime}ms - ${filesBefore.length} files`);

  // Run code
  const { output: codeOutput, durationMs: runCodeTime } = await runTestCode(sandbox, round);
  log(`[Run code] ${runCodeTime}ms - ${codeOutput.trim()}`);

  // List files (after)
  const { files: filesAfter, durationMs: listAfterTime } = await listFiles(sandbox);
  log(`[List files (after)] ${listAfterTime}ms - ${filesAfter.length} files`);

  // Diff
  const diff = diffByName(filesBefore, filesAfter);
  log(`[Diff] Added: ${diff.added.join(', ') || '(none)'}`);

  // Unmount S3
  const { durationMs: unmountTime } = await unmountS3(sandbox);
  log(`[Unmount S3] ${unmountTime}ms`);

  return {
    sandboxId: sandbox.sandboxId,
    timings: {
      mount: mountTime,
      listBefore: listBeforeTime,
      runCode: runCodeTime,
      listAfter: listAfterTime,
      unmount: unmountTime,
    },
    filesBefore,
    filesAfter,
    diff,
    codeOutput,
  };
}

// ============== Statistics ==============

export function aggregateTimings(allTimings: LifecycleTimings[]): Record<keyof LifecycleTimings, TimingStats> {
  const keys: (keyof LifecycleTimings)[] = ['mount', 'listBefore', 'runCode', 'listAfter', 'unmount'];
  const result = {} as Record<keyof LifecycleTimings, TimingStats>;

  for (const key of keys) {
    const values = allTimings.map((t) => t[key]);
    result[key] = calculateStats(values);
  }

  return result;
}
