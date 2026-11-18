/**
 * Master preset bootstrap — the base every new bot preset forks from.
 *
 * On startup: if the roster has no "master" preset, fork the deployment's
 * default preset into one (id "master", name "Master") and install it through
 * the plugin manager. Idempotent; failures are logged, never fatal.
 */

const MASTER_ID = 'master'

/** Pick the base preset to fork from: the deployment default, else the first healthy row. */
async function pickBase(presetAdapter) {
  const roster = await presetAdapter.list()
  const healthy = roster.filter((p) => !p.broken && p.id !== MASTER_ID)
  return healthy.find((p) => p.isDefault) ?? healthy[0] ?? null
}

/**
 * Ensure the "master" preset exists.
 * @returns 'present' | 'created' | 'failed' with detail.
 */
export async function ensureMasterPreset(runtime) {
  const { presetAdapter, forker } = runtime
  try {
    const roster = await presetAdapter.list()
    const existing = roster.find((p) => p.id === MASTER_ID)
    if (existing) return { outcome: 'present', detail: existing.broken ? `preset exists but broken: ${existing.broken}` : 'ok' }

    const base = await pickBase(presetAdapter)
    if (!base) return { outcome: 'failed', detail: 'no healthy preset in the roster to fork from' }

    const result = await forker.fork({
      sourceId: base.id,
      newId: MASTER_ID,
      name: 'Master',
      description: `dsh-bots master preset (forked from ${base.id}); the base for every new bot preset`,
    })
    return {
      outcome: result.installed ? 'created' : 'failed',
      detail: result.installed ? `forked from ${base.id}` : result.detail,
      bundleDir: result.bundleDir,
    }
  } catch (error) {
    return { outcome: 'failed', detail: String(error?.message ?? error) }
  }
}
