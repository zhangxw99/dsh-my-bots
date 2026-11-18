/**
 * Preset Forker — Fork mode per docs/02-架构设计.md §3.1 (corrected path).
 *
 * The registry scans no directories: a preset is a profile patch row
 * (`@deepseek-ai/dsh-agent-preset`). Fork therefore:
 *   1. reads the source composition via PresetAdapter.readDocument (entry-list YAML),
 *   2. writes a small bundle package under <stateDir>/forks/<newId>/ whose patch inserts
 *      one `@deepseek-ai/dsh-agent-preset` row with the copied composition,
 *   3. attempts installation through ctx.pluginManager.installBundle when the service
 *      is present; otherwise returns the bundle dir for manual installation.
 *
 * Verified: readDocument content is entry-list YAML (README: "nothing accepts YAML back"
 * refers to the Remote; embedding the YAML verbatim as the `plugins:` value keeps the
 * original composition, including any `!!js` expressions).
 * Assumed: installBundle(spec) accepts an absolute bundle directory path, matching the
 * tool-level plugin_manager contract.
 */

import fs from 'node:fs'
import path from 'node:path'
import { sanitizeId } from './state-dir.mjs'

function indent(yamlText, spaces) {
  const pad = ' '.repeat(spaces)
  return yamlText
    .split('\n')
    .map((l) => (l.trim() === '' ? '' : pad + l))
    .join('\n')
}

function esc(s) {
  return String(s).replace(/'/g, "''")
}

export function createPresetForker(ctx, presetAdapter, stateDir) {
  const forksRoot = path.join(stateDir, 'forks')

  function optionalService(name) {
    try {
      const s = ctx[name]
      return typeof s === 'object' && s !== null ? s : undefined
    } catch {
      return undefined
    }
  }

  return {
    /** Generate (and try to install) a fork bundle; returns { newId, bundleDir, installed, detail }. */
    async fork(input) {
      const sourceId = String(input?.sourceId ?? '').trim()
      if (sourceId === '') throw new Error('sourceId is required')
      const doc = await presetAdapter.readDocument(sourceId)

      const newId = sanitizeId(input?.newId ?? `${sourceId}-fork`, `fork-${Date.now()}`)
      const name = String(input?.name ?? `${doc.name ?? sourceId} (fork)`).slice(0, 64)
      const description = String(input?.description ?? doc.description ?? `Forked from ${sourceId}`).slice(0, 200)

      const pkgName = `@local/preset-${newId}`
      const dir = path.join(forksRoot, newId)
      fs.mkdirSync(dir, { recursive: true })

      const manifest = {
        name: pkgName,
        version: '1.0.0',
        private: true,
        type: 'module',
        exports: { '.': './index.js' },
        files: ['index.js', 'cordis.patch.yml'],
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }
      const patchYml = [
        '- insert:',
        '    - id: ' + `preset-${newId}`,
        "      name: '@deepseek-ai/dsh-agent-preset'",
        '      config:',
        `        id: '${esc(newId)}'`,
        `        name: '${esc(name)}'`,
        `        description: '${esc(description)}'`,
        '        plugins:',
        indent(doc.content.trim(), 10),
        '',
      ].join('\n')

      fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), patchYml, 'utf8')
      fs.writeFileSync(path.join(dir, 'index.js'), "export function apply() {}\n", 'utf8')

      let installed = false
      let detail = 'bundle generated; install it from Plugins > Add plugin, or restart-aware auto-install below'
      const pm = optionalService('pluginManager')
      if (pm && typeof pm.installBundle === 'function') {
        try {
          const result = await pm.installBundle(dir)
          installed = !!result && result.applied !== false && !result.failed
          detail = installed ? 'installed and applied' : `installation returned: ${JSON.stringify(result)}`
        } catch (error) {
          detail = `auto-install failed (${String(error?.message ?? error)}); install ${dir} manually`
        }
      } else {
        detail = `pluginManager service unavailable; install ${dir} manually`
      }

      return { newId, name, description, bundleDir: dir, installed, detail, sourceContentLines: doc.content.split('\n').length }
    },
  }
}
