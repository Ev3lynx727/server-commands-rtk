import {
  appendFileSync, readFileSync, writeFileSync,
  renameSync, existsSync, readdirSync, unlinkSync,
} from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { join, dirname, basename } from "node:path";
import type { ExecutionLogEntry } from "./schemas.js";

export class ExecutionLogger {
  private readonly filePath: string;
  private readonly maxActive: number;
  private readonly maxArchives: number;
  private readonly compress: boolean;
  private entryCount: number;

  constructor(
    filePath: string,
    maxActive: number,
    maxArchives: number,
    compress: boolean,
  ) {
    this.filePath = filePath;
    this.maxActive = maxActive;
    this.maxArchives = maxArchives;
    this.compress = compress;
    this.entryCount = 0;
    if (existsSync(filePath)) {
      try {
        const lines = readFileSync(filePath, "utf8")
          .split("\n")
          .filter(Boolean);
        this.entryCount = lines.length;
      } catch {
        this.entryCount = 0;
      }
    }
  }

  append(entry: ExecutionLogEntry): void {
    try {
      if (this.maxActive > 0 && this.entryCount >= this.maxActive) {
        this.rotate();
      }
      appendFileSync(this.filePath, JSON.stringify(entry) + "\n");
      this.entryCount++;
    } catch {
      // best-effort append
    }
  }

  private rotate(): void {
    try {
      const lines = readFileSync(this.filePath, "utf8")
        .split("\n")
        .filter(Boolean);
      if (lines.length < this.maxActive) {
        this.entryCount = lines.length;
        return;
      }

      const splitIdx = Math.floor(lines.length / 2);
      const archiveContent = lines.slice(0, splitIdx).join("\n") + "\n";
      const keepContent = lines.slice(splitIdx).join("\n") + "\n";

      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const dir = dirname(this.filePath);
      const base = basename(this.filePath, ".jsonl");
      let archivePath = join(dir, `${base}-${ts}.jsonl`);

      const raw = Buffer.from(archiveContent, "utf8");
      if (this.compress) {
        writeFileSync(archivePath + ".gz", gzipSync(raw));
      } else {
        writeFileSync(archivePath, raw);
      }

      writeFileSync(this.filePath, keepContent);
      this.entryCount = keepContent.length;

      this.pruneArchives(dir, base);
    } catch {
      // best-effort rotate
    }
  }

  private pruneArchives(dir: string, base: string): void {
    if (this.maxArchives === 0) return;
    try {
      const pattern = new RegExp(`^${base}-\\d{4}-\\d{2}-\\d{2}T`);
      const entries = readdirSync(dir)
        .filter((f) => pattern.test(f))
        .sort()
        .slice(0, -this.maxArchives);
      for (const f of entries) {
        unlinkSync(join(dir, f));
      }
    } catch {
      // best-effort prune
    }
  }

  read(limit: number = 100, includeArchives: boolean = false): ExecutionLogEntry[] {
    try {
      const all: ExecutionLogEntry[] = [];

      if (includeArchives) {
        const dir = dirname(this.filePath);
        const base = basename(this.filePath, ".jsonl");
        const pattern = new RegExp(`^${base}-\\d{4}-\\d{2}-\\d{2}T`);
        const archives = readdirSync(dir)
          .filter((f) => pattern.test(f))
          .sort();
        for (const a of archives) {
          const raw = readFileSync(join(dir, a));
          const content = a.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
          for (const line of content.split("\n").filter(Boolean)) {
            all.push(JSON.parse(line));
          }
        }
      }

      if (existsSync(this.filePath)) {
        const lines = readFileSync(this.filePath, "utf8")
          .split("\n")
          .filter(Boolean);
        for (const line of lines) {
          all.push(JSON.parse(line));
        }
      }

      return all.slice(-limit);
    } catch {
      return [];
    }
  }

  listArchives(): string[] {
    try {
      const dir = dirname(this.filePath);
      const base = basename(this.filePath, ".jsonl");
      const pattern = new RegExp(`^${base}-\\d{4}-\\d{2}-\\d{2}T`);
      return readdirSync(dir)
        .filter((f) => pattern.test(f))
        .sort();
    } catch {
      return [];
    }
  }
}
