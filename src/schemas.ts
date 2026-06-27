import { z } from "zod";

export const RunProcessArgs = z.object({
  command: z.string().min(1, "command is required"),
  cwd: z.string().optional(),
  description: z.string().optional(),
  clear_cache: z.boolean().default(false),
  use_rtk_filter: z.boolean().default(true),
  use_raw: z.boolean().default(false),
  model_used: z.string().optional(),
});

export type RunProcessArgs = z.infer<typeof RunProcessArgs>;

export const ExecutionLogArgs = z.object({
  limit: z.number().int().positive().default(100),
  include_archives: z.boolean().default(false),
});

export type ExecutionLogArgs = z.infer<typeof ExecutionLogArgs>;

export const ServerConfig = z.object({
  timeout_ms: z.number().int().positive().default(60000),
  max_buffer_mb: z.number().int().positive().default(10),
  max_log_entries: z.number().int().positive().default(1000),
  debounce_ms: z.number().int().positive().default(2000),
  max_active_entries: z.number().int().nonnegative().default(1000),
  max_archives: z.number().int().nonnegative().default(10),
  compress_archives: z.boolean().default(true),
});

export type ServerConfig = z.infer<typeof ServerConfig>;

export const ErrorCategory = z.enum([
  "permission_error",
  "not_found",
  "timeout",
  "syntax_error",
  "network_error",
  "memory_error",
  "unknown_error",
]);

export type ErrorCategory = z.infer<typeof ErrorCategory>;

export const ExecResult = z.object({
  success: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  duration_ms: z.number(),
  error_type: ErrorCategory.nullable(),
});

export type ExecResult = z.infer<typeof ExecResult>;

export const CacheEntry = z.object({
  result: ExecResult,
  timestamp: z.number(),
  command: z.string(),
  raw_command: z.string(),
  rtk_filtered: z.boolean(),
  model_used: z.string(),
});

export type CacheEntry = z.infer<typeof CacheEntry>;

export const CacheStore = z.object({
  cache: z.record(z.string(), CacheEntry),
  stats: z.object({
    hits: z.number().int().nonnegative(),
    misses: z.number().int().nonnegative(),
  }),
});

export type CacheStore = z.infer<typeof CacheStore>;

export const ExecutionLogEntry = z.object({
  timestamp: z.number(),
  key: z.string(),
  command: z.string(),
  command_exec: z.string(),
  rtk_filtered: z.boolean(),
  cached: z.boolean(),
  success: z.boolean(),
  exitCode: z.number(),
  duration_ms: z.number(),
  model_used: z.string(),
  error_type: ErrorCategory.nullable(),
  stdout: z.string(),
  stderr: z.string(),
  stdout_lines: z.number(),
  stderr_lines: z.number(),
});

export type ExecutionLogEntry = z.infer<typeof ExecutionLogEntry>;

export const WriteFileArgs = z.object({
  path: z.string().min(1, "path is required"),
  content_b64: z.string().min(1, "content_b64 is required"),
});

export type WriteFileArgs = z.infer<typeof WriteFileArgs>;

export const WriteFileResult = z.object({
  path: z.string(),
  bytes_written: z.number(),
});

export type WriteFileResult = z.infer<typeof WriteFileResult>;
