import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

const { resolveStateDir, sanitizeId, isValidId, mintId } = await import('../dsh-bots/src/state-dir.mjs')
assert.equal(resolveStateDir(''), path.join(process.env.HOME, '.dsh/bots'))
assert.equal(resolveStateDir('/tmp/x'), '/tmp/x')
assert.ok(isValidId('researcher-2'))
assert.ok(!isValidId('Bad Id!'))
assert.equal(sanitizeId('My Bot!'), 'my-bot')
assert.ok(mintId('bot').startsWith('bot-'))

const { botDefinitionSchema, sessionBindingSchema } = await import('../dsh-bots/src/domain.mjs')
const bot = botDefinitionSchema.parse({ id: 'bot-1', name: 'R', presetId: 'researcher', createdAt: 1, updatedAt: 1 })
assert.equal(bot.teamId, 'default'); assert.equal(bot.enabled, true)
assert.throws(() => botDefinitionSchema.parse({ id: 'x', name: 'R', presetId: '', createdAt: 1, updatedAt: 1 }))
const bind = sessionBindingSchema.parse({ id: 'b1', botId: 'bot-1', type: 'direct', dshSessionId: 's1', presetId: 'researcher', createdAt: 1, updatedAt: 1 })
assert.equal(bind.status, 'active')

const { createPresetForker } = await import('../dsh-bots/src/preset-forker.mjs')
const dir = fs.mkdtempSync('/tmp/dsh-bots-test-')
const forker = createPresetForker(
  { },
  { readDocument: async () => ({ agentPreset: 'src', name: 'Src', description: 'd', content: "- name: '@deepseek-ai/dsh-web'\n- id: x\n  name: y\n  config: {a: 1}\n" }) },
  dir,
)
const result = await forker.fork({ sourceId: 'src', newId: 'My Fork!', name: 'F' })
assert.equal(result.newId, 'my-fork')
const patch = fs.readFileSync(path.join(result.bundleDir, 'cordis.patch.yml'), 'utf8')
assert.ok(patch.includes("name: '@deepseek-ai/dsh-agent-preset'"))
assert.ok(patch.includes('plugins:'))
assert.ok(patch.includes("'@deepseek-ai/dsh-web'"))
const after = patch.split('plugins:\n')[1]
assert.ok(after.split('\n').every(l => l.trim() === '' || l.startsWith(' '.repeat(10))), 'composition indented')
assert.equal(result.installed, false)

const { registerApi } = await import('../dsh-bots/src/api.mjs')
const routes = []
const stubCtx = { webServer: { register: (r) => { routes.push(r); return () => {} } } }
let chatCalls = []
const runtime = {
  ctx: stubCtx, stateDir: dir,
  presetAdapter: {
    list: async () => [{ id: 'p1', name: 'P1', description: '', isDefault: true, broken: null }],
    inspect: async (id) => (id === 'p1' ? { ok: true, preset: { id: 'p1' } } : { ok: false, reason: 'missing' }),
  },
  forker,
  bots: {
    list: () => [{ id: 'b1', name: 'Bot', presetId: 'p1', enabled: true }],
    get: (id) => (id === 'b1' ? { id: 'b1', name: 'Bot', presetId: 'p1', enabled: true } : undefined),
    create: async (i) => ({ id: 'b2', ...i }),
    update: async (id) => ({ id }),
    remove: async () => true,
    validatePresetReferences: async () => [],
  },
  sessions: {
    listFor: () => [],
    transcript: () => [{ role: 'user', text: 'hi' }],
    chat: async (bot, text) => ({ reply: `echo:${text}`, sessionId: 's1', presetId: bot.presetId }),
  },
}
registerApi(runtime)
assert.equal(routes.length, 1)
const route = routes[0]
assert.equal(route.kind, 'prefix')
assert.equal(route.path, '/api/plugins/bots')

function makeRes() { return { code: 0, body: null, writeHead(c) { this.code = c }, end(b) { this.body = b ? JSON.parse(b) : null } } }
function makeReq(method, url, body) {
  const req = { method, url, handlers: {}, on(ev, cb) { this.handlers[ev] = cb } }
  if (body !== undefined) setImmediate(() => { req.handlers.data?.(Buffer.from(JSON.stringify(body))); req.handlers.end?.() })
  else setImmediate(() => req.handlers.end?.())
  return req
}
async function hit(method, url, body) {
  const req = makeReq(method, url, body)
  const res = makeRes()
  await route.handler(req, res)
  return res
}
let r = await hit('GET', '/api/plugins/bots/status')
assert.equal(r.code, 200); assert.ok(r.body.ok)
r = await hit('GET', '/api/plugins/bots/presets')
assert.equal(r.code, 200); assert.equal(r.body.presets[0].id, 'p1')
r = await hit('GET', '/api/plugins/bots/bots')
assert.equal(r.code, 200); assert.equal(r.body.bots[0].id, 'b1')
r = await hit('GET', '/api/plugins/bots/bots/b1')
assert.equal(r.code, 200); assert.equal(r.body.presetStatus.ok, true)
r = await hit('GET', '/api/plugins/bots/bots/missing')
assert.equal(r.code, 404)
r = await hit('POST', '/api/plugins/bots/bots', { name: 'N', presetId: 'p1' })
assert.equal(r.code, 200); assert.equal(r.body.bot.id, 'b2')
r = await hit('POST', '/api/plugins/bots/bots/b1/chat', { text: 'hello' })
assert.equal(r.code, 200); assert.equal(r.body.reply, 'echo:hello')
r = await hit('GET', '/api/plugins/bots/bots/b1/messages')
assert.equal(r.code, 200); assert.equal(r.body.messages[0].text, 'hi')
r = await hit('POST', '/api/plugins/bots/bots/b1/chat', {})
assert.equal(r.code, 200) // stub chat does no validation; real one rejects empty text
r = await hit('GET', '/api/plugins/bots/nonsense')
assert.equal(r.code, 404)

console.log('ALL UNIT CHECKS PASSED')
