/**
 * storageDomain declaration for dsh-bots (domain name "dsh-bots", version 1).
 *
 * Verified against @deepseek-ai/dsh-storage-domain 0.2.2-rc.3:
 * - DomainSpec { name, version, layout?, compatibleVersions?, invalidRecords?, global?, tables }
 * - table valueSchema is a zod schema; zod resolves from the profile node_modules.
 * - Domain.table(name) -> KvTable { get, entries, keys, size, put, delete, deleteMany, update }
 * - Domain.close() releases the unit; we own the call via ctx.effect-style cleanup.
 */

import { z } from 'zod'

const isoId = z.string().min(1).max(128)

export const botDefinitionSchema = z.object({
  id: isoId,
  name: z.string().min(1).max(64),
  description: z.string().max(500).default(''),
  avatar: z.string().max(200).optional(),
  /** Core binding: a real DSH Agent Preset id. Never duplicated persona/tool config here. */
  presetId: isoId,
  workspace: z.string().max(1024).optional(),
  modelOverride: z
    .object({ providerId: z.string().min(1).max(128), modelId: z.string().min(1).max(128) })
    .optional(),
  teamId: z.string().min(1).max(128).default('default'),
  enabled: z.boolean().default(true),
  /** "unavailable" is derived at runtime when the preset cannot resolve; not stored. */
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  deletedAt: z.number().int().nonnegative().optional(),
})

export const sessionBindingSchema = z.object({
  id: isoId,
  botId: isoId,
  /** direct | group | task (group/task reserved for M2/M3; M1 creates direct only). */
  type: z.enum(['direct', 'group', 'task']),
  /** The native DSH Session; the durable log stays the single source of history. */
  dshSessionId: isoId,
  /** Snapshot of the preset bound at creation; the session projection is authoritative. */
  presetId: isoId,
  status: z.enum(['active', 'idle', 'completed', 'archived', 'error']).default('active'),
  groupId: z.string().optional(),
  taskId: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

const domainSpec = {
  // UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/ — hyphens are rejected by the storage backend.
  name: 'dsh_bots',
  version: 1,
  global: {
    schema: z.object({
      schemaVersion: z.literal(1),
      defaultTeamId: z.string().default('default'),
    }),
    initial: { schemaVersion: 1, defaultTeamId: 'default' },
  },
  tables: {
    bots: { valueSchema: botDefinitionSchema },
    sessions: { valueSchema: sessionBindingSchema },
  },
}

/**
 * Open (or reopen after migration) the dsh_bots storage domain.
 *
 * The storage hub lives under the shared DSH home, so the domain name is a
 * machine-wide singleton: a second DSH process (a test profile, a second
 * window) opening the same domain rejects with `already-open`. That must never
 * be fatal for the host — degrade to a disabled runtime instead and let the
 * caller surface the condition.
 */
export async function openBotsDomain(ctx) {
  try {
    return await ctx.storageDomain.open(domainSpec)
  } catch (error) {
    const message = String(error?.message ?? error)
    if (/already open/i.test(message)) {
      const err = new Error(
        `dsh-bots storage is held by another DSH process on this machine (${message}). `
        + 'Close the other instance or give it a separate DSH_HOME, then reload.',
      )
      err.code = 'dsh-bots/domain-busy'
      throw err
    }
    throw error
  }
}
