/**
 * REST API on ctx.webServer.
 *
 * Verified: WebRoute { kind: 'exact' | 'prefix', path, handler(req, res) } where
 * 'prefix' matches the pathname and everything below it. There is no pattern
 * matching, so one prefix route dispatches internally.
 *
 * Prefix: /api/plugins/bots
 */

const PREFIX = '/api/plugins/bots'

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > 1_000_000) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      parts.push(c)
    })
    req.on('end', () => {
      if (parts.length === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(parts).toString('utf8')))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/** Split '/api/plugins/bots/bots/x/chat?y' into ['bots','x','chat']. */
function segmentsOf(url) {
  const path = url.split('?')[0].slice(PREFIX.length)
  return path.split('/').filter((s) => s !== '')
}

export function registerApi(runtime) {
  const { ctx, bots, sessions, presetAdapter, forker } = runtime

  async function dispatch(req, res) {
    const seg = segmentsOf(req.url)
    const method = req.method === 'HEAD' ? 'GET' : req.method

    // Degraded mode: storage held by another DSH process — report, don't serve.
    if (runtime.degraded) {
      return send(res, 503, { ok: false, degraded: true, error: runtime.degraded })
    }

    // GET /status
    if (method === 'GET' && seg.join('/') === 'status') {
      const unavailable = await bots.validatePresetReferences()
      return send(res, 200, {
        ok: true,
        stateDir: runtime.stateDir,
        botCount: bots.list().length,
        unavailablePresets: unavailable,
      })
    }

    // /presets, /presets/copy
    if (seg[0] === 'presets') {
      if (method === 'GET' && seg.length === 1) {
        return send(res, 200, { presets: await presetAdapter.list() })
      }
      if (method === 'POST' && seg.length === 2 && seg[1] === 'copy') {
        return send(res, 200, await forker.fork(await readBody(req)))
      }
    }

    // /bots, /bots/:id, /bots/:id/chat, /bots/:id/sessions, /bots/:id/messages
    if (seg[0] === 'bots') {
      if (method === 'GET' && seg.length === 1) return send(res, 200, { bots: bots.list() })
      if (method === 'POST' && seg.length === 1) {
        return send(res, 200, { bot: await bots.create(await readBody(req)) })
      }
      const id = seg[1]
      if (id !== undefined && seg.length === 2) {
        if (method === 'GET') {
          const bot = bots.get(id)
          if (!bot) return send(res, 404, { error: `bot "${id}" not found` })
          return send(res, 200, { bot, presetStatus: await presetAdapter.inspect(bot.presetId) })
        }
        if (method === 'PUT') return send(res, 200, { bot: await bots.update(id, await readBody(req)) })
        if (method === 'DELETE') return send(res, 200, { deleted: await bots.remove(id) })
      }
      if (id !== undefined && seg.length === 3) {
        const bot = bots.get(id)
        if (!bot) return send(res, 404, { error: `bot "${id}" not found` })
        if (method === 'POST' && seg[2] === 'chat') {
          if (!bot.enabled) return send(res, 400, { error: `bot "${id}" is disabled` })
          const body = await readBody(req)
          return send(res, 200, await sessions.chat(bot, body.text))
        }
        if (method === 'GET' && seg[2] === 'sessions') return send(res, 200, { sessions: sessions.listFor(id) })
        if (method === 'GET' && seg[2] === 'messages') return send(res, 200, { messages: sessions.transcript(id) })
        if (method === 'GET' && seg[2] === 'events') {
          const binding = sessions.listFor(id).filter((b) => b.type === 'direct').pop()
          if (!binding) return send(res, 404, { error: 'no direct session binding' })
          const snap = await ctx.sessionQuery.readSession(binding.dshSessionId).catch((e) => ({ error: String(e) }))
          const events = snap?.events ?? snap?.log ?? []
          return send(res, 200, {
            sessionId: binding.dshSessionId,
            model: snap?.header?.model ?? snap?.model ?? null,
            events: events.map((e) => ({ seq: e?.seq, type: e?.type, data: e?.data })),
          })
        }
      }
    }

    send(res, 404, { error: `no route for ${method} ${req.url}` })
  }

  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    async handler(req, res) {
      try {
        await dispatch(req, res)
      } catch (error) {
        send(res, 400, { error: String(error?.message ?? error) })
      }
    },
  })
  return () => dispose?.()
}
