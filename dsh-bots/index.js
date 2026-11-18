/**
 * dsh-bots — persistent multi-Bot organization plugin for DeepSeek Harness.
 *
 * Milestone 1: Preset-based Bot registry, native DSH Sessions, direct chat,
 * Preset Fork bundle generation, REST API, minimal Web UI.
 *
 * Architecture docs: ../../docs/01-DSH-API-调研报告.md, ../../docs/02-架构设计.md
 * Host API assumptions are isolated in src/preset-adapter.mjs and
 * src/session-manager.mjs; see their headers for the verified-vs-assumed list.
 */

export const inject = ['agents', 'agentPresets', 'webServer', 'sessionQuery', 'storageDomain', 'agentDefaultModel', 'pluginManager']

import { resolveStateDir } from './src/state-dir.mjs'
import { openBotsDomain } from './src/domain.mjs'
import { createPresetAdapter } from './src/preset-adapter.mjs'
import { createBotManager } from './src/bot-manager.mjs'
import { createSessionManager } from './src/session-manager.mjs'
import { createPresetForker } from './src/preset-forker.mjs'
import { registerApi } from './src/api.mjs'

export function apply(ctx, config) {
  const stateDir = resolveStateDir(config.stateDir)
  const presetAdapter = createPresetAdapter(ctx)
  const forker = createPresetForker(ctx, presetAdapter, stateDir)
  const runtime = {
    ctx,
    config,
    stateDir,
    presetAdapter,
    forker,
    domain: null,
    bots: null,
    sessions: null,
    ready: null,
    /** Non-null while storage could not be opened: the plugin serves only this explanation. */
    degraded: null,
  }

  runtime.ready = (async () => {
    try {
      runtime.domain = await openBotsDomain(ctx)
    } catch (error) {
      // Never fatal: a busy domain (another DSH process holds it) or a corrupt
      // medium only disables this plugin, it must not crash the harness.
      runtime.degraded = String(error?.message ?? error)
      ctx.logger?.error?.('dsh-bots degraded: %s', runtime.degraded)
      runtime.domain = null
      return () => {}
    }
    runtime.bots = createBotManager(runtime)
    runtime.sessions = createSessionManager(runtime)
    await runtime.bots.validatePresetReferences()
    const disposeApi = registerApi(runtime)
    ctx.logger?.info?.('dsh-bots ready at %s', stateDir)
    return disposeApi
  })()

  return () => {
    void runtime.ready.then((dispose) => {
      dispose?.()
      return runtime.domain?.close()
    }, () => {})
  }
}
