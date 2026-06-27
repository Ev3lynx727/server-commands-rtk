import { readFileSync, existsSync } from "node:fs";
import { parse } from "smol-toml";
import type { ServerConfig } from "./schemas.js";

export interface NestedConfig {
  execution?: {
    timeout_ms?: number;
    max_buffer_mb?: number;
    max_log_entries?: number;
    debounce_ms?: number;
  };
  log?: {
    max_active_entries?: number;
    max_archives?: number;
    compress?: boolean;
  };
  [key: string]: unknown;
}

const DEFAULTS: ServerConfig = {
  timeout_ms: 60000,
  max_buffer_mb: 10,
  max_log_entries: 1000,
  debounce_ms: 2000,
  max_active_entries: 1000,
  max_archives: 10,
  compress_archives: true,
};

export function loadConfig(configPath: string): ServerConfig {
  if (!existsSync(configPath)) {
    console.error("Config not found, using defaults:", configPath);
    return { ...DEFAULTS };
  }
  try {
    const content = readFileSync(configPath, "utf8");
    const parsed = parse(content) as NestedConfig;
    const exec = parsed.execution ?? {};
    const logCfg = parsed.log ?? {};
    return {
      timeout_ms: Number(exec.timeout_ms) || DEFAULTS.timeout_ms,
      max_buffer_mb: Number(exec.max_buffer_mb) || DEFAULTS.max_buffer_mb,
      max_log_entries: Number(exec.max_log_entries) || DEFAULTS.max_log_entries,
      debounce_ms: Number(exec.debounce_ms) || DEFAULTS.debounce_ms,
      max_active_entries: Number(logCfg.max_active_entries) ?? Number(exec.max_log_entries) ?? DEFAULTS.max_active_entries,
      max_archives: Number(logCfg.max_archives) ?? DEFAULTS.max_archives,
      compress_archives: logCfg.compress ?? DEFAULTS.compress_archives,
    };
  } catch (e) {
    console.error("Failed to load config, using defaults:", e);
    return { ...DEFAULTS };
  }
}
