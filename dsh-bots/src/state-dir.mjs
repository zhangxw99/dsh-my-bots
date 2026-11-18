import { homedir } from 'node:os'
import path from 'node:path'

/** Resolve the plugin state directory. Empty/absent config falls back to ~/.dsh/bots. */
export function resolveStateDir(configured) {
  const raw = typeof configured === 'string' && configured.trim() !== '' ? configured.trim() : null
  const base = raw && path.isAbsolute(raw) ? raw : path.join(homedir(), '.dsh', 'bots')
  return path.resolve(base)
}

export function nowMs() {
  return Date.now()
}

/** Mint a stable, readable unique id with the given prefix. */
export function mintId(prefix) {
  const rand = globalThis.crypto?.randomUUID?.() ?? `${process.pid}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${rand}`
}

const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/

/** Bot and preset identity characters we allow at our own boundary. */
export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id)
}

export function sanitizeId(id, fallback) {
  const cleaned = String(id ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return cleaned !== '' ? cleaned : fallback
}
