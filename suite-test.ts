#!/usr/bin/env npx tsx
/**
 * suite-test.ts — Stress, load, benchmark, and resilience suite for server-commands-rtk v0.2.0
 *
 * Usage:
 *   npx tsx suite-test.ts                  # Run all
 *   npx tsx suite-test.ts --unit           # Unit tests only
 *   npx tsx suite-test.ts --integration    # Integration tests
 *   npx tsx suite-test.ts --stress         # Stress/load tests
 *   npx tsx suite-test.ts --benchmark      # Benchmark
 *   npx tsx suite-test.ts --resilience     # Resilience tests
 *   npx tsx suite-test.ts --quick          # Quick smoke test
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";
import { randomBytes } from "node:crypto";

const SERVER_SCRIPT = resolve(import.meta.dirname, "dist/index.js");
const SERVER_DIR = resolve(import.meta.dirname);
const args = process.argv.slice(2);
const RUN_ALL = args.length === 0;

interface TestResult {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail?: string;
  duration_ms?: number;
}

const results: TestResult[] = [];
let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function genId(): string {
  return randomBytes(4).toString("hex");
}

function connect(): { proc: ChildProcess; send: (cmd: string, args?: Record<string, unknown>) => Promise<string>; close: () => void } {
  const proc = spawn("node", [SERVER_SCRIPT], {
    cwd: SERVER_DIR,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, SERVER_DIR, RTK_MODEL_USED: "suite-test" },
  });

  let buffer = "";
  const pending: Array<(val: string) => void> = [];

  proc.stdout!.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    while (buffer.includes("\n")) {
      const idx = buffer.indexOf("\n");
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      const h = pending.shift();
      if (h) h(line);
    }
  });

  let msgId = 0;

  async function send(command: string, extra: Record<string, unknown> = {}): Promise<string> {
    const id = ++msgId;
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "run_process", arguments: { command, ...extra } },
    }) + "\n";

    return new Promise((resolve) => {
      pending.push((line) => resolve(line));
      proc.stdin!.write(request);
    });
  }

  function close(): void { proc.kill(); }

  return { proc, send, close };
}

async function withServer<T>(fn: (srv: ReturnType<typeof connect>) => Promise<T>): Promise<T> {
  const server = connect();
  await sleep(200);
  return fn(server).finally(() => server.close());
}

async function sendTool(server: ReturnType<typeof connect>, tool: string, params: Record<string, unknown> = {}): Promise<string> {
  const id = 999;
  const request = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: tool, arguments: params },
  }) + "\n";

  return new Promise((resolve) => {
    (server as any).pending = (server as any).pending || [];
    (server as any).pending.push((line: string) => resolve(line));
    server.proc.stdin!.write(request);
  });
}

const RUN_UNIT = RUN_ALL || args.includes("--unit");
const RUN_INTEGRATION = RUN_ALL || args.includes("--integration");
const RUN_STRESS = RUN_ALL || args.includes("--stress");
const RUN_BENCHMARK = RUN_ALL || args.includes("--benchmark");
const RUN_RESILIENCE = RUN_ALL || args.includes("--resilience");
const RUN_QUICK = args.includes("--quick");

if (RUN_QUICK && !args.includes("--unit")) {
  args.push("--unit");
}

function shouldRun(section: string): boolean {
  if (RUN_QUICK && section !== "unit") return false;
  return true;
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, status: "PASS", duration_ms: Date.now() - start });
    passed++;
  } catch (e) {
    const msg = (e as Error).message;
    results.push({ name, status: "FAIL", detail: msg, duration_ms: Date.now() - start });
    failed++;
    console.error("  FAIL " + name + ": " + msg);
  }
}

async function runSection(title: string, fn: () => Promise<void>): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("  " + title);
  console.log("=".repeat(60));
  await fn();
}

// ===========================================================================
// 1. UNIT TESTS
// ===========================================================================

async function unitTests() {
  const { prependRtk } = await import("./dist/rtk.js");
  const { categorizeError } = await import("./dist/errors.js");
  const { RunProcessArgs, ServerConfig } = await import("./dist/schemas.js");
  const { loadConfig } = await import("./dist/config.js");

  const tests = [
    ["rtk: wraps command when useRtk=true", () => {
      assert(prependRtk("ls -la", { useRtk: true }) === "rtk ls -la", "should prepend rtk");
    }],
    ["rtk: passes through when useRtk=false", () => {
      assert(prependRtk("ls -la", { useRtk: false }) === "ls -la", "should not prepend rtk");
    }],
    ["rtk: empty command", () => {
      assert(prependRtk("", { useRtk: true }) === "rtk ", "should handle empty");
    }],
    ["errors: null on exitCode 0", () => {
      assert(categorizeError(0, "", "ok") === null, "exit 0 returns null");
    }],
    ["errors: permission_error", () => {
      assert(categorizeError(1, "permission denied", "") === "permission_error");
    }],
    ["errors: not_found", () => {
      assert(categorizeError(127, "command not found", "") === "not_found");
    }],
    ["errors: timeout", () => {
      assert(categorizeError(124, "timeout", "") === "timeout");
    }],
    ["errors: network_error", () => {
      assert(categorizeError(1, "connection refused", "") === "network_error");
    }],
    ["errors: unknown fallback", () => {
      assert(categorizeError(1, "weird error", "") === "unknown_error");
    }],
    ["schemas: RunProcessArgs default", () => {
      const p = RunProcessArgs.parse({ command: "ls" });
      assert(p.command === "ls", "cmd");
      assert(p.use_rtk_filter === true, "rtk filter default");
      assert(p.use_raw === false, "raw default");
    }],
    ["schemas: RunProcessArgs rejects empty", () => {
      try { RunProcessArgs.parse({ command: "" }); assert(false, "should throw"); }
      catch { /* ok */ }
    }],
    ["schemas: RunProcessArgs all fields", () => {
      const p = RunProcessArgs.parse({
        command: "ls", cwd: "/tmp", description: "test",
        clear_cache: true, use_rtk_filter: false, use_raw: true,
        model_used: "test-model",
      });
      assert(p.cwd === "/tmp", "cwd");
      assert(p.clear_cache === true, "clear_cache");
      assert(p.model_used === "test-model", "model");
    }],
    ["schemas: ServerConfig defaults", () => {
      const c = ServerConfig.parse({});
      assert(c.timeout_ms === 60000, "timeout");
      assert(c.max_buffer_mb === 10, "buffer");
      assert(c.max_log_entries === 1000, "log");
      assert(c.debounce_ms === 2000, "debounce");
    }],
    ["schemas: ServerConfig overrides", () => {
      const c = ServerConfig.parse({ timeout_ms: 30, max_buffer_mb: 5, max_log_entries: 50 });
      assert(c.timeout_ms === 30, "timeout");
      assert(c.max_buffer_mb === 5, "buffer");
      assert(c.max_log_entries === 50, "log");
    }],
    ["config: loads from valid toml", () => {
      const tmp = join(tmpdir(), "srtk-test-" + genId() + ".toml");
      writeFileSync(tmp, "[execution]\ntimeout_ms = 12345\nmax_buffer_mb = 7\nmax_log_entries = 200\ndebounce_ms = 1500\n");
      const c = loadConfig(tmp);
      assert(c.timeout_ms === 12345, "timeout");
      assert(c.max_buffer_mb === 7, "buffer");
      assert(c.max_log_entries === 200, "log");
      assert(c.debounce_ms === 1500, "debounce");
      unlinkSync(tmp);
    }],
    ["config: debounce_ms defaults to 2000", () => {
      const c = loadConfig("/nonexistent/path.toml");
      assert(c.debounce_ms === 2000, "default debounce");
    }],
    ["config: falls back on missing file", () => {
      const c = loadConfig("/nonexistent/path.toml");
      assert(c.timeout_ms === 60000, "default timeout");
    }],
    ["config: falls back on invalid file", () => {
      const tmp = join(tmpdir(), "srtk-test-" + genId() + ".toml");
      writeFileSync(tmp, "[[[invalid toml");
      const c = loadConfig(tmp);
      assert(c.timeout_ms === 60000, "graceful fallback");
      unlinkSync(tmp);
    }],
  ];

  for (const [name, fn] of tests) {
    await runTest(name as string, fn as () => Promise<void>);
  }
}
// ===========================================================================
// 2. INTEGRATION TESTS
// ===========================================================================


async function integrationTests() {
  await withServer(async (srv) => {
    await runTest("integration: simple echo", async () => {
      const resp = await srv.send("echo integration-test-ok");
      const parsed = JSON.parse(resp);
      const res = parsed.result?.content?.[0]?.text || "";
      const data = JSON.parse(res);
      assert(data.result?.stdout?.includes("integration-test-ok"), "echo output");
      assert(data.cached === false, "not cached");
    });

    await runTest("integration: cache hit returns cached=true", async () => {
      const resp = await srv.send("echo integration-test-ok");
      const parsed = JSON.parse(resp);
      const data = JSON.parse(parsed.result?.content?.[0]?.text || "{}");
      assert(data.cached === true, "should be cached");
    });

    await runTest("integration: non-zero exit (raw)", async () => {
      const resp = await srv.send("exit 42", { use_raw: true });
      const parsed = JSON.parse(resp);
      const data = JSON.parse(parsed.result?.content?.[0]?.text || "{}");
      assert(data.result?.exitCode === 42, "exit code 42");
      assert(data.result?.success === false, "not success");
    });

    await runTest("integration: command not found (raw)", async () => {
      const resp = await srv.send("nonexistent-command-12345", { use_raw: true });
      const parsed = JSON.parse(resp);
      const data = JSON.parse(parsed.result?.content?.[0]?.text || "{}");
      assert(data.result?.success === false, "not success");
    });
  });
}


// ===========================================================================
// 3. STRESS / LOAD TESTS
// ===========================================================================

async function stressTests() {
  await withServer(async (srv) => {
    await runTest("stress: 10 rapid unique commands", async () => {
      const cmds = Array.from({ length: 10 }, (_, i) => "echo " + genId() + "-" + i);
      const results = await Promise.all(cmds.map((c) => srv.send(c)));
      for (const r of results) {
        const parsed = JSON.parse(r);
        const data = JSON.parse(parsed.result?.content?.[0]?.text || "{}");
        assert(data.result?.success === true, "all should succeed");
      }
    });

    await runTest("stress: 50 sequential commands", async () => {
      for (let i = 0; i < 50; i++) {
        const resp = await srv.send("echo seq-" + i + "-" + genId());
        const parsed = JSON.parse(resp);
        const data = JSON.parse(parsed.result?.content?.[0]?.text || "{}");
        assert(data.result?.success === true, "cmd " + i + " failed");
      }
    });

    await runTest("stress: large output (50KB)", async () => {
      const resp = await srv.send("head -c 100000 /dev/urandom | base64 | head -c 50000");
      const parsed = JSON.parse(resp);
      const data = JSON.parse(parsed.result?.content?.[0]?.text || "{}");
      assert(data.result?.success === true, "large output should work");
      assert((data.result?.stdout?.length || 0) > 1000, "significant output");
    });

    await runTest("stress: special characters in command", async () => {
      const resp = await srv.send("echo 'hello' && echo \"world\" && echo $((2+2))");
      const parsed = JSON.parse(resp);
      const data = JSON.parse(parsed.result?.content?.[0]?.text || "{}");
      assert(data.result?.success === true, "special chars");
    });

    await runTest("stress: 5 concurrent cache hits", async () => {
      const cmd = "echo concurrent-cache-" + genId();
      await srv.send(cmd);
      const hits = await Promise.all(Array.from({ length: 5 }, () => srv.send(cmd)));
      for (const h of hits) {
        const parsed = JSON.parse(h);
        const data = JSON.parse(parsed.result?.content?.[0]?.text || "{}");
        assert(data.cached === true, "all cache hits");
      }
    });
  });
}


// ===========================================================================
// 4. BENCHMARK
// ===========================================================================

async function benchmarkTests() {
  await withServer(async (srv) => {
    const trials = 5;
    let missTotal = 0;
    let hitTotal = 0;

    for (let t = 0; t < trials; t++) {
      const cmd = "echo bm-miss-" + genId();
      const start = Date.now();
      await srv.send(cmd);
      missTotal += Date.now() - start;
    }

    const cachedCmd = "echo bm-hit-" + genId();
    await srv.send(cachedCmd);

    for (let t = 0; t < trials; t++) {
      const start = Date.now();
      await srv.send(cachedCmd);
      hitTotal += Date.now() - start;
    }

    const avgMiss = (missTotal / trials).toFixed(1);
    const avgHit = (hitTotal / trials).toFixed(1);
    const speedup = (missTotal / Math.max(hitTotal, 1)).toFixed(1);

    results.push({
      name: "benchmark: avg cache MISS (" + trials + " runs)",
      status: "PASS",
      duration_ms: Math.round(Number(avgMiss)),
    });
    results.push({
      name: "benchmark: avg cache HIT (" + trials + " runs)",
      status: "PASS",
      duration_ms: Math.round(Number(avgHit)),
    });
    results.push({
      name: "benchmark: speedup (miss/hit ratio)",
      status: "PASS",
      detail: speedup + "x faster",
    });
    passed += 3;

    console.log("  [benchmark] Avg miss: " + avgMiss + "ms | Avg hit: " + avgHit + "ms | " + speedup + "x faster");
  });
}


// ===========================================================================
// 5. RESILIENCE TESTS
// ===========================================================================

async function resilienceTests() {
  await runTest("resilience: cache corruption recovery", async () => {
    const cacheFile = join(homedir(), ".local/share/state/server-commands-rtk/command-cache.json");
    const original = existsSync(cacheFile) ? readFileSync(cacheFile, "utf8") : "";
    try {
      writeFileSync(cacheFile, "corrupted garbage data");
      await withServer(async (srv) => {
        const resp = await srv.send("echo after-corruption-" + genId());
        const parsed = JSON.parse(resp);
        const data = JSON.parse(parsed.result?.content?.[0]?.text || "{}");
        assert(data.result?.success === true, "should recover from corruption");
      });
    } finally {
      if (original) writeFileSync(cacheFile, original);
    }
  });

  await runTest("resilience: missing rtk-hook.toml", async () => {
    const cfgFile = join(SERVER_DIR, "rtk-hook.toml");
    const original = existsSync(cfgFile) ? readFileSync(cfgFile, "utf8") : "";
    try {
      if (original) unlinkSync(cfgFile);
      await withServer(async (srv) => {
        const resp = await srv.send("echo no-config-" + genId());
        const parsed = JSON.parse(resp);
        const data = JSON.parse(parsed.result?.content?.[0]?.text || "{}");
        assert(data.result?.success === true, "should work without config");
      });
    } finally {
      if (original) writeFileSync(cfgFile, original);
    }
  });

  await runTest("resilience: non-existent cwd", async () => {
    await withServer(async (srv) => {
      const resp = await srv.send("echo bad-cwd-test", { cwd: "/nonexistent/path/12345" });
      const parsed = JSON.parse(resp);
      const data = JSON.parse(parsed.result?.content?.[0]?.text || "{}");
      assert(data.result?.success === false, "should fail on bad cwd");
    });
  });
}

// ===========================================================================
// MAIN RUNNER
// ===========================================================================

const sections: { name: string; arg: string; fn: () => Promise<void> }[] = [
  { name: "Unit Tests",        arg: "unit",        fn: unitTests },
  { name: "Integration Tests", arg: "integration", fn: integrationTests },
  { name: "Stress / Load Tests", arg: "stress",   fn: stressTests },
  { name: "Benchmark",         arg: "benchmark",   fn: benchmarkTests },
  { name: "Resilience Tests",  arg: "resilience",  fn: resilienceTests },
];

async function main() {
  console.log("");
  console.log("  SERVER-COMMANDS-RTK v0.2.0 — Test Suite");
  console.log("  " + new Date().toISOString());
  console.log("  " + "-".repeat(50));

  const selected = args.length > 0 ? sections.filter(s => args.includes("--" + s.arg)) : sections;
  const label = selected.length === sections.length ? "all" : selected.map(s => s.arg).join(", ");

  for (const s of selected) {
    if (shouldRun(s.arg)) {
      await runSection(s.name + " (" + label + ")", s.fn);
    }
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("  RESULTS");
  console.log("=".repeat(60));
  console.log("  Total: " + (passed + failed + skipped) + " | PASS: " + passed + " | FAIL: " + failed + " | SKIP: " + skipped);
  console.log("");

  if (failed > 0) {
    console.log("  FAILED TESTS:");
    for (const r of results) {
      if (r.status === "FAIL") {
        console.log("    - " + r.name + ": " + (r.detail || ""));
      }
    }
    console.log("");
    process.exit(1);
  }
}

main();
