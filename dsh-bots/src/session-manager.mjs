/**
 * Session Manager — the ONLY module that drives ctx.agents (native runtime).
 *
 * Verified signatures (DSH 0.2.2-rc.3, dsh-agent/src/index.ts + runtime-types.ts):
 * - agents.create({ sessionId, meta: { cwd, agentPreset, ... }, agentOptions?, setup? }) -> Promise<AgentHandle>
 * - agents.resume({ resumeSessionId, agentOptions?, setup?, signal? }) -> Promise<AgentHandle>
 * - AgentHandle = { agent: Agent, dispose(): Promise<void> }  — drive handle.agent, not the handle
 * - agents.get(sessionId) -> Agent | undefined
 * - agent.followup(userMessage) / agent.whenIdle() / agent.status / agent.session
 * - UserMessage is plain frozen data { id, role:'user', content:[{type:'text',text}], source:{kind:'user'} }
 *   (dsh-llm/src/message.ts createUserMessage); we build it locally to avoid an import that
 *   may not resolve from the profile, keeping the exact documented shape.
 *
 * Assumed / borrowed from the dsh-grokbot probe (unverified in-tree):
 * - resume race error message containing "cannot prepare session" while it is live;
 *   handled by falling back to agents.get().
 * - assistant reply extraction from sessionQuery.listEvents(): we filter event type
 *   'assistant/message' and read text blocks tolerantly from the event data.
 */

import fs from 'node:fs'
import path from 'node:path'
import { mintId, nowMs } from './state-dir.mjs'

function newUserMessage(text) {
  return {
    id: mintId('msg'),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

/** Pull plain text out of an assistant/message event data shape, tolerantly. */
function textOfEventData(data) {
  if (data == null) return ''
  const blocks = data.content ?? data.blocks ?? (Array.isArray(data) ? data : null)
  if (Array.isArray(blocks)) {
    return blocks
      .map((b) => (typeof b === 'string' ? b : typeof b?.text === 'string' ? b.text : ''))
      .filter((s) => s !== '')
      .join('\n')
  }
  if (typeof data.text === 'string') return data.text
  return ''
}

export function createSessionManager(runtime) {
  const { ctx, domain, stateDir, presetAdapter } = runtime

  const handles = new Map() // dshSessionId -> { agent, botId }
  let chatSerial = Promise.resolve()

  function bindings() {
    return domain.table('sessions')
  }

  function transcriptPath(botId) {
    return path.join(stateDir, 'transcripts', 'dm', `${botId}.jsonl`)
  }

  function appendTranscript(botId, entry) {
    const file = transcriptPath(botId)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8')
  }

  function readTranscript(botId, limit = 200) {
    const file = transcriptPath(botId)
    if (!fs.existsSync(file)) return []
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '')
    return lines.slice(-limit).map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
  }

  function agentOptionsFor(bot) {
    if (bot?.modelOverride?.providerId && bot?.modelOverride?.modelId) {
      return { provider: bot.modelOverride.providerId, model: bot.modelOverride.modelId }
    }
    return undefined
  }

  /**
   * Bot modelOverride wins; otherwise fall back to the deployment's default
   * model selection (agentDefaultModel.currentSelection), mirroring the
   * native new-session behavior. Returns undefined when nothing is configured,
   * which the turn surfaces as a clear error instead of a runtime turn error.
   */
  function resolveAgentOptions(bot) {
    const override = agentOptionsFor(bot)
    if (override) return { options: override }
    try {
      const sel = ctx.agentDefaultModel?.currentSelection?.()
      if (sel?.provider && sel?.model) return { options: { provider: sel.provider, model: sel.model } }
    } catch {
      // no default selection available
    }
    return { options: undefined }
  }

  function setupFor(bot) {
    return (agentCtx) => {
      try {
        agentCtx.systemPrompt?.section?.({
          name: 'dsh-bots:identity',
          order: -20,
          text: [
            `You are "${bot.name}", a long-lived team member managed by the dsh-bots plugin.`,
            bot.description ? `Your role: ${bot.description}` : '',
            'Answer as this identity. Tool and skill capabilities come from your Agent Preset.',
          ]
            .filter(Boolean)
            .join('\n'),
        })
      } catch {
        // section registration is best-effort; the preset remains the capability source
      }
    }
  }

  /** Borrow a live agent, or create/resume one. Never disposes agents we did not create. */
  async function openHandle(bot, binding, agentOptions) {
    const live = ctx.agents.get(binding.dshSessionId)
    if (live) {
      handles.set(binding.dshSessionId, { agent: live, botId: bot.id })
      return live
    }
    const options = {
      resumeSessionId: binding.dshSessionId,
      agentOptions,
      setup: setupFor(bot),
    }
    try {
      const handle = await ctx.agents.resume(options)
      const agent = handle?.agent ?? handle
      handles.set(binding.dshSessionId, { agent, botId: bot.id })
      return agent
    } catch (error) {
      const message = String(error?.message ?? error)
      if (/cannot prepare session|while it is live/i.test(message)) {
        const raced = ctx.agents.get(binding.dshSessionId)
        if (raced) {
          handles.set(binding.dshSessionId, { agent: raced, botId: bot.id })
          return raced
        }
      }
      if (binding.status !== 'error') {
        await bindings().put(binding.id, { ...binding, status: 'error', updatedAt: nowMs() })
      }
      throw error
    }
  }

  async function latestDirectBinding(botId) {
    let best = null
    for (const [, b] of bindings().entries()) {
      if (b.botId !== botId || b.type !== 'direct' || b.status === 'archived') continue
      if (!best || b.createdAt > best.createdAt) best = b
    }
    return best
  }

  async function createDirectSession(bot, agentOptions) {
    const check = await presetAdapter.inspect(bot.presetId)
    if (!check?.ok) {
      throw new Error(`bot "${bot.id}" preset "${bot.presetId}" is unavailable: ${check?.reason ?? 'not found'}`)
    }
    const dshSessionId = mintId(`bots-${bot.id}-direct`)
    const handle = await ctx.agents.create({
      sessionId: dshSessionId,
      meta: { cwd: bot.derivedWorkspace ?? bot.workspace, agentPreset: bot.presetId },
      agentOptions,
      setup: setupFor(bot),
    })
    const agent = handle?.agent ?? handle
    const now = nowMs()
    const binding = {
      id: mintId('bind'),
      botId: bot.id,
      type: 'direct',
      dshSessionId,
      presetId: bot.presetId,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    await bindings().put(binding.id, binding)
    handles.set(dshSessionId, { agent, botId: bot.id })
    return { agent, binding }
  }

  async function extractReply(sessionId, afterSeq = 0) {
    let events = []
    try {
      const snap = await ctx.sessionQuery.readSession(sessionId)
      events = snap?.events ?? snap?.log ?? []
    } catch {
      try {
        events = await ctx.sessionQuery.listEvents(sessionId)
      } catch {
        events = []
      }
    }
    const norm = events.map((e) => ({ seq: e?.seq, type: e?.type, data: e?.data }))
    const replies = []
    let lastError = null
    for (const e of norm) {
      if (typeof e.seq === 'number' && e.seq <= afterSeq) continue
      if (e.type === 'assistant/message') {
        const text = textOfEventData(e.data)
        if (text !== '') replies.push(text)
      }
      if (e.type === 'turn/end' && e.data?.reason?.kind === 'error') {
        lastError = e.data.reason.error?.message ?? 'unknown turn error'
      }
      if (e.type === 'turn-error') {
        lastError = textOfEventData(e.data) || lastError
      }
    }
    if (replies.length > 0) return replies[replies.length - 1]
    if (lastError) return `Turn failed: ${lastError}`
    return '(no reply text found; see the session log)'
  }

  async function lastSeq(sessionId) {
    try {
      const snap = await ctx.sessionQuery.readSession(sessionId)
      const events = snap?.events ?? snap?.log ?? []
      let max = 0
      for (const e of events) if (typeof e?.seq === 'number' && e.seq > max) max = e.seq
      return max
    } catch {
      return 0
    }
  }

  function listFor(botId) {
    const rows = []
    for (const [, b] of bindings().entries()) {
      if (b.botId === botId && !rows.includes(b)) rows.push(b)
    }
    rows.sort((a, b) => a.createdAt - b.createdAt)
    return rows
  }

  return {
    listFor,

    /** Open an existing binding as a handle (for resume/replay paths). */
    async openBinding(binding, bot) {
      return openHandle(bot, binding)
    },

    /** One direct-chat turn: persist-first transcript, native execution, reply extraction. */
    async chat(bot, text) {
      const run = async () => {
        const trimmed = String(text ?? '').trim()
        if (trimmed === '') throw new Error('text is required')
        const { options: agentOptions } = resolveAgentOptions(bot)
        if (!agentOptions) {
          throw new Error(
            'no model configured: set modelOverride on the bot or configure a default model in DSH settings',
          )
        }

        let binding = await latestDirectBinding(bot.id)
        let agent
        let created = false
        if (binding && binding.status !== 'error') {
          agent = await openHandle(bot, binding, agentOptions)
        } else {
          ;({ agent, binding } = await createDirectSession(bot, agentOptions))
          created = true
        }

        appendTranscript(bot.id, { role: 'user', text: trimmed, at: nowMs(), sessionId: binding.dshSessionId })
        const before = created ? 0 : await lastSeq(binding.dshSessionId)

        agent.followup(newUserMessage(trimmed))
        await agent.whenIdle()

        const reply = await extractReply(binding.dshSessionId, before)
        appendTranscript(bot.id, { role: 'bot', text: reply, at: nowMs(), sessionId: binding.dshSessionId })

        if (!created && binding.status !== 'active') {
          await bindings().put(binding.id, { ...binding, status: 'active', updatedAt: nowMs() })
        }
        return { reply, sessionId: binding.dshSessionId, presetId: binding.presetId }
      }
      // Serialize turns; the chain itself must never stay rejected (an unhandled
      // rejection is fatal to the host process), while the caller still sees it.
      const turn = chatSerial.then(run, run)
      chatSerial = turn.catch(() => {})
      return turn
    },

    transcript: readTranscript,

    handleCount() {
      return handles.size
    },
  }
}
