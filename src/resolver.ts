import { homedir } from "node:os"
import { resolve as resolvePath } from "node:path"

export interface SchemeEntry {
  scheme: string
  path: string
  absolutePath: string
  source: string
}

export interface ResolveResult {
  scheme: string
  uri: string
  relativePath: string
  absolutePath: string
  source: string
}

const HOME = homedir()

export function expandHome(p: string): string {
  return p.startsWith("~/") ? p.replace("~", HOME) : p
}

export function resolveUri(
  uri: string,
  registry: SchemeEntry[],
): ResolveResult | null {
  const match = uri.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.+)$/)
  if (!match) return null

  const [, scheme, relativePath] = match
  const entry = registry.find((e) => e.scheme === scheme)
  if (!entry) return null

  const absolutePath = resolvePath(entry.absolutePath, relativePath)

  return { scheme, uri, relativePath, absolutePath, source: entry.source }
}

export function listSchemes(registry: SchemeEntry[]): SchemeEntry[] {
  return [...registry]
}
