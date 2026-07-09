import { spawn, type ChildProcess, execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";
import type { ErrorCategory, ExecResult } from "./schemas.js";

export interface ExecOptions {
  timeout_ms: number;
  max_buffer_mb: number;
  cwd?: string | null;
}

function classifyError(err: NodeJS.ErrnoException, timedOut: boolean): ErrorCategory {
  if (timedOut) return "timeout";
  const code = err.code;
  if (code === "ENOENT") return "not_found";
  if (code === "EACCES" || code === "EPERM") return "permission_error";
  if (code === "ENOMEM") return "memory_error";
  return "unknown_error";
}

function collectStream(
  stream: NodeJS.ReadableStream | null,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  return new Promise((resolve, reject) => {
    if (!stream) { resolve(""); return; }
    if (signal?.aborted) { resolve(""); return; }
    const onAbort = () => {
      cleanup();
      resolve(Buffer.concat(chunks).toString());
    };
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      stream.removeListener("data", onData);
      stream.removeListener("error", onError);
      stream.removeListener("end", onEnd);
    };
    const onData = (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        (stream as any).destroy();
        cleanup();
        reject(new Error("maxBuffer exceeded"));
        return;
      }
      chunks.push(chunk);
    };
    const onError = (err: Error) => { cleanup(); reject(err); };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks).toString()); };
    stream.on("data", onData);
    stream.on("error", onError);
    stream.on("end", onEnd);
    signal?.addEventListener("abort", onAbort);
  });
}

export async function executeCommand(
  command: string,
  opts: ExecOptions,
): Promise<ExecResult> {
  const startTime = Date.now();
  const cwd = opts.cwd ? resolve(opts.cwd) : undefined;
  const maxBytes = opts.max_buffer_mb * 1024 * 1024;

  if (cwd) {
    try {
      accessSync(cwd, constants.R_OK | constants.X_OK);
    } catch {
      return {
        success: false,
        stdout: "",
        stderr: `cwd does not exist or is not accessible: ${cwd}`,
        exitCode: 1,
        duration_ms: Date.now() - startTime,
        error_type: "not_found",
      };
    }
  }

  const trimmed = command.trimStart();
  const isBuiltin = /^(cd|pushd|popd|export|source|\.|set|unset|alias|unalias|exit|trap|exec|type)($|\s)/.test(trimmed);
  const isCompound = /[;&|]/.test(trimmed.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, ""));
  // Check if rtk can rewrite this command. If not (exit 1, passthrough), run raw.
  // Avoids rtk prepending commands find/fd with unsupported predicates.
  let cmdLine: string;
  if (isBuiltin || isCompound) {
    cmdLine = command;
  } else {
    try {
      const out = execFileSync("rtk", ["rewrite", trimmed], { encoding: "utf8", timeout: 2000 }).trim();
      cmdLine = out && out !== trimmed ? out : trimmed;
    } catch {
      cmdLine = trimmed;
    }
  }

  let timedOut = false;
  let child: ChildProcess | null = null;
  const ac = new AbortController();

  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
    if (child && child.pid) {
      try { process.kill(child.pid, "SIGKILL"); } catch {}
    }
  }, opts.timeout_ms);

  try {
    child = spawn("/bin/sh", ["-c", cmdLine], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    }) as ChildProcess;

    const exitCodePromise = new Promise<number>((resolve) => {
      child!.on("close", resolve);
      child!.on("error", () => resolve(1));
    });

    const [stdout, stderr] = await Promise.all([
      collectStream(child.stdout, maxBytes, ac.signal),
      collectStream(child.stderr, maxBytes, ac.signal),
    ]);

    clearTimeout(timer);
    if (timedOut) {
      child.kill();
      return {
        success: false,
        stdout,
        stderr: `Command timed out after ${opts.timeout_ms}ms`,
        exitCode: 124,
        duration_ms: Date.now() - startTime,
        error_type: "timeout",
      };
    }

    const exitCode = await exitCodePromise;
    return {
      success: exitCode === 0,
      stdout,
      stderr,
      exitCode,
      duration_ms: Date.now() - startTime,
      error_type: null,
    };
  } catch (error: unknown) {
    clearTimeout(timer);
    if (timedOut) {
      return {
        success: false,
        stdout: "",
        stderr: `Command timed out after ${opts.timeout_ms}ms`,
        exitCode: 124,
        duration_ms: Date.now() - startTime,
        error_type: "timeout",
      };
    }
    const err = error as NodeJS.ErrnoException;
    return {
      success: false,
      stdout: "",
      stderr: err.message === "maxBuffer exceeded"
        ? `Output exceeded ${opts.max_buffer_mb}MB limit`
        : err.message,
      exitCode: 1,
      duration_ms: Date.now() - startTime,
      error_type: classifyError(err, false),
    };
  }
}
