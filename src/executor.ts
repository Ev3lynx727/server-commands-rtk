import { spawn, type ChildProcess } from "node:child_process";
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
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  return new Promise((resolve, reject) => {
    if (!stream) { resolve(""); return; }
    stream.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        (stream as any).destroy();
        reject(new Error("maxBuffer exceeded"));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString()));
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

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeout_ms);

  try {
    const child = spawn("/bin/sh", ["-c", command], {
      cwd,
      signal: ac.signal,
      stdio: ["ignore", "pipe", "pipe"],
    }) as ChildProcess;

    const [stdout, stderr] = await Promise.all([
      collectStream(child.stdout, maxBytes),
      collectStream(child.stderr, maxBytes),
    ]);

    const exitCode = await new Promise<number>((resolve) => {
      child.on("close", resolve);
      child.on("error", () => resolve(1));
    });

    clearTimeout(timer);
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
    const err = error as NodeJS.ErrnoException;
    const timedOut = err.name === "AbortError";
    return {
      success: false,
      stdout: "",
      stderr: timedOut
        ? `Command timed out after ${opts.timeout_ms}ms`
        : err.message === "maxBuffer exceeded"
          ? `Output exceeded ${opts.max_buffer_mb}MB limit`
          : err.message,
      exitCode: timedOut ? 124 : 1,
      duration_ms: Date.now() - startTime,
      error_type: classifyError(err, timedOut),
    };
  }
}
