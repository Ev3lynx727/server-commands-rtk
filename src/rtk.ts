import { execFileSync } from "node:child_process"

export interface RtkOptions {
  useRtk: boolean
  compact: boolean
}

let rtkChecked = false
let rtkAvailable = false

function isRtkAvailable(): boolean {
  if (!rtkChecked) {
    try {
      execFileSync("which", ["rtk"], { stdio: "ignore", timeout: 1000 })
      rtkAvailable = true
    } catch {
      rtkAvailable = false
    }
    rtkChecked = true
  }
  return rtkAvailable
}

export function tryRewrite(command: string, opts: RtkOptions): { command: string; rewritten: boolean } {
  if (!opts.useRtk) return { command, rewritten: false }
  if (!isRtkAvailable()) return { command, rewritten: false }

  const rtkArgs = ["rewrite", command]
  if (opts.compact && !command.startsWith("rtk ")) rtkArgs.push("-u")

  try {
    const result = execFileSync("rtk", rtkArgs, {
      encoding: "utf-8",
      timeout: 3000,
      maxBuffer: 1024 * 10,
    })
    const out = result.trim()
    if (out && out !== command) return { command: out, rewritten: true }
    return { command, rewritten: false }
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "status" in e) {
      const err = e as { status?: number; stdout?: Buffer | string }
      if (err.status === 3 && err.stdout) {
        const out = err.stdout.toString().trim()
        if (out && out !== command) return { command: out, rewritten: true }
      }
    }
    return { command, rewritten: false }
  }
}
