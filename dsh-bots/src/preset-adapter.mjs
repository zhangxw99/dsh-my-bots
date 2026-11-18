/**
 * Preset Adapter — the ONLY module that talks to ctx.agentPresets.
 *
 * Verified signatures (DSH 0.2.2-rc.3, Cordis Inspect + dsh-agent-preset-registry src):
 * - agentPresets.list(): Promise<AgentPreset[]>
 * - agentPresets.resolve(id?): Promise<AgentPreset>  (throws agent-preset/not-found)
 * - agentPresets.readDocument(id): Promise<AgentPresetDocument> { agentPreset, content, name?, description? }
 * - remoteExportList(): Promise<AgentPresetRoster> { presets: [{id,isDefault,name?,description?,broken?}] }
 *
 * Assumed (tolerant, probed at call time): AgentPreset row field names id/name/description.
 * Failure of any read surfaces as a thrown Error with the host message preserved.
 */

export function createPresetAdapter(ctx) {
  const api = ctx.agentPresets

  function rowOf(p) {
    return {
      id: p?.id,
      name: p?.name ?? p?.id,
      description: p?.description ?? '',
      isDefault: p?.isDefault ?? false,
      broken: p?.broken ?? null,
    }
  }

  return {
    /** Preset roster for pickers; includes broken entries so the UI can explain them. */
    async list() {
      try {
        const roster = await api.remoteExportList()
        if (roster && Array.isArray(roster.presets)) return roster.presets.map(rowOf)
      } catch {
        // fall through to list()
      }
      const rows = await api.list()
      return (Array.isArray(rows) ? rows : []).map(rowOf)
    },

    /** Resolve one preset; returns null when it does not exist or is broken. */
    async inspect(id) {
      if (typeof id !== 'string' || id === '') return null
      try {
        const p = await api.resolve(id)
        return p ? { ok: true, preset: rowOf(p) } : null
      } catch (error) {
        return { ok: false, id, reason: String(error?.message ?? error) }
      }
    },

    async isAvailable(id) {
      const r = await this.inspect(id)
      return !!r?.ok
    },

    /** Entry-list YAML of one preset's composition (Fork source). */
    async readDocument(id) {
      const doc = await api.readDocument(id)
      if (!doc || typeof doc.content !== 'string') {
        throw new Error(`preset ${id} returned no composition document`)
      }
      return doc
    },
  }
}
