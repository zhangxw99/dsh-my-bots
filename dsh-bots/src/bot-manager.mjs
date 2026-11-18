/**
 * Bot Manager — CRUD over the plugin-owned Bot identities (storageDomain `bots`).
 *
 * Invariants (docs/02-架构设计.md §1):
 * - BotDefinition stores presetId only; never persona/tools duplicates.
 * - Delete is soft; native sessions and workspaces are never touched here.
 */

import fs from 'node:fs'
import path from 'node:path'
import { isValidId, mintId, nowMs } from './state-dir.mjs'

export function createBotManager(runtime) {
  const { domain, stateDir, presetAdapter } = runtime

  function table() {
    return domain.table('bots')
  }

  function workspaceOf(bot) {
    if (bot.workspace && bot.workspace.trim() !== '') return path.resolve(bot.workspace)
    return path.join(stateDir, 'workspaces', bot.id)
  }

  function publicView(bot) {
    return { ...bot, derivedWorkspace: workspaceOf(bot) }
  }

  return {
    workspaceOf,

    list({ includeDeleted = false } = {}) {
      const rows = [...table().entries()].map(([, v]) => v).filter((b) => !b.deletedAt || includeDeleted)
      rows.sort((a, b) => a.createdAt - b.createdAt)
      return rows.map(publicView)
    },

    get(id) {
      const bot = table().get(id)
      if (!bot || bot.deletedAt) return undefined
      return publicView(bot)
    },

    async create(input) {
      const name = String(input?.name ?? '').trim()
      if (name === '') throw new Error('name is required')
      const presetId = String(input?.presetId ?? '').trim()
      if (!isValidId(presetId)) throw new Error(`invalid presetId "${presetId}"`)
      const check = await presetAdapter.inspect(presetId)
      if (!check?.ok) throw new Error(`preset "${presetId}" is unavailable: ${check?.reason ?? 'not found'}`)
      let id = String(input?.id ?? '').trim()
      if (id !== '') {
        if (!isValidId(id)) throw new Error(`invalid bot id "${id}"`)
        if (table().get(id)) throw new Error(`bot "${id}" already exists`)
      } else {
        do id = mintId('bot')
        while (table().get(id))
      }
      const now = nowMs()
      const bot = {
        id,
        name,
        description: String(input?.description ?? ''),
        presetId,
        workspace: input?.workspace ? String(input.workspace) : undefined,
        modelOverride:
          input?.modelOverride?.providerId && input?.modelOverride?.modelId
            ? { providerId: String(input.modelOverride.providerId), modelId: String(input.modelOverride.modelId) }
            : undefined,
        teamId: 'default',
        enabled: input?.enabled !== false,
        createdAt: now,
        updatedAt: now,
      }
      fs.mkdirSync(workspaceOf(bot), { recursive: true })
      await table().put(id, bot)
      return publicView(bot)
    },

    async update(id, patch) {
      const bot = table().get(id)
      if (!bot || bot.deletedAt) throw new Error(`bot "${id}" not found`)
      const next = { ...bot, updatedAt: nowMs() }
      if (patch?.name !== undefined) {
        const name = String(patch.name).trim()
        if (name === '') throw new Error('name must not be empty')
        next.name = name
      }
      if (patch?.description !== undefined) next.description = String(patch.description)
      if (patch?.enabled !== undefined) next.enabled = !!patch.enabled
      if (patch?.workspace !== undefined) next.workspace = patch.workspace ? String(patch.workspace) : undefined
      if (patch?.modelOverride !== undefined) {
        next.modelOverride =
          patch.modelOverride?.providerId && patch.modelOverride?.modelId
            ? {
                providerId: String(patch.modelOverride.providerId),
                modelId: String(patch.modelOverride.modelId),
              }
            : undefined
      }
      if (patch?.presetId !== undefined) {
        const presetId = String(patch.presetId).trim()
        if (!isValidId(presetId)) throw new Error(`invalid presetId "${presetId}"`)
        const check = await presetAdapter.inspect(presetId)
        if (!check?.ok) throw new Error(`preset "${presetId}" is unavailable: ${check?.reason ?? 'not found'}`)
        next.presetId = presetId
        // Only future sessions use the new preset; existing bindings are untouched by design.
      }
      await table().put(id, next)
      return publicView(next)
    },

    /** Soft delete: keep history, sessions, and workspace; drop from active lists. */
    async remove(id) {
      const bot = table().get(id)
      if (!bot || bot.deletedAt) return false
      await table().put(id, { ...bot, deletedAt: nowMs(), enabled: false, updatedAt: nowMs() })
      return true
    },

    /** Startup sweep: report bots whose preset no longer resolves (kept visible, not deleted). */
    async validatePresetReferences() {
      const unavailable = []
      for (const [id, bot] of table().entries()) {
        if (bot.deletedAt) continue
        const check = await presetAdapter.inspect(bot.presetId)
        if (!check?.ok) unavailable.push({ botId: id, presetId: bot.presetId, reason: check?.reason ?? 'not found' })
      }
      return unavailable
    },
  }
}
