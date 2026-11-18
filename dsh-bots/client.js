/* dsh-bots client half: LEFT-SIDEBAR panel "DSH Bots" with a main-area
 * Bot Workbench (create with auto preset + model picker; chat per bot).
 * Pattern: sidebar.panellist (icon) + main (key = panel id), like schedule.
 * Everything lives inside the factory closure: re-executable, no top-level
 * lexical declarations. */
window.__ModuleLoader__.load({
  id: '@local/dsh-bots',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PANEL_ID = 'dsh-bots'
    const API = '/api/plugins/bots'
    const CSS = `
.dshb-page{height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;padding:20px 24px;overflow:auto;font-size:13px}
.dshb-header{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.dshb-title{margin:0;font-size:18px;font-weight:650;letter-spacing:.2px}
.dshb-sub{opacity:.6;font-size:12px}
.dshb-body{display:flex;gap:16px;flex:1;min-height:0}
.dshb-list{width:300px;flex:none;display:flex;flex-direction:column;gap:10px;overflow:auto}
.dshb-detail{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px;min-height:0}
.dshb-card{border:1px solid rgba(128,128,128,.28);border-radius:10px;padding:10px 12px;background:rgba(128,128,128,.05);text-align:left;cursor:pointer;color:inherit;display:flex;flex-direction:column;gap:5px}
.dshb-card:hover{background:rgba(128,128,128,.1)}
.dshb-card.dshb-active{border-color:#4a9eff;background:rgba(74,158,255,.08)}
.dshb-card.dshb-unavailable{opacity:.55}
.dshb-name{font-weight:600;font-size:13px;display:flex;align-items:center;gap:8px}
.dshb-dot{width:7px;height:7px;border-radius:50%;flex:none;background:#8a8a8a}
.dshb-dot.dshb-ok{background:#3fb950}
.dshb-dot.dshb-bad{background:#f85149}
.dshb-chips{display:flex;flex-wrap:wrap;gap:6px}
.dshb-chip{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;background:rgba(128,128,128,.16);font-size:11px;opacity:.85;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshb-form{border:1px dashed rgba(128,128,128,.35);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px}
.dshb-label{font-size:10px;text-transform:uppercase;letter-spacing:.8px;opacity:.55}
.dshb-input,.dshb-select{width:100%;box-sizing:border-box;padding:6px 10px;border-radius:7px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;font-size:13px}
.dshb-btn{border:1px solid rgba(128,128,128,.4);background:rgba(128,128,128,.1);color:inherit;border-radius:7px;padding:5px 14px;cursor:pointer;font-size:12px}
.dshb-btn.dshb-primary{background:#2f81f7;border-color:#2f81f7;color:#fff}
.dshb-btn:disabled{opacity:.5;cursor:default}
.dshb-err{color:#f85149;font-size:12px;white-space:pre-wrap}
.dshb-warn{color:#d29922;font-size:12px;white-space:pre-wrap}
.dshb-chat{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;border:1px solid rgba(128,128,128,.28);border-radius:12px;padding:14px;background:rgba(128,128,128,.04)}
.dshb-msgs{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding-right:4px}
.dshb-bubble{max-width:78%;padding:8px 12px;border-radius:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
.dshb-bubble.dshb-user{align-self:flex-end;background:rgba(47,129,247,.18);border:1px solid rgba(47,129,247,.35)}
.dshb-bubble.dshb-bot{align-self:flex-start;background:rgba(128,128,128,.12);border:1px solid rgba(128,128,128,.25)}
.dshb-bubble.dshb-bote{align-self:flex-start;background:rgba(248,81,73,.1);border:1px solid rgba(248,81,73,.35);color:#f85149}
.dshb-composer{display:flex;gap:8px}
.dshb-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;opacity:.55;text-align:center}
.dshb-detailhead{display:flex;align-items:center;justify-content:space-between;gap:10px}
.dshb-detailname{font-size:15px;font-weight:650}
`

    async function api(path, init) {
      const res = await fetch(API + path, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || res.statusText)
      return body
    }

    /* ---- shared bits ---- */

    function Labeled({ label, children }) {
      return h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('span', { className: 'dshb-label' }, label), children)
    }

    function Dot({ ok, bad }) {
      return h('span', { className: 'dshb-dot' + (ok ? ' dshb-ok' : bad ? ' dshb-bad' : '') })
    }

    function Chip({ children, title }) {
      return h('span', { className: 'dshb-chip', title }, children)
    }

    /* ---- create form ---- */

    function CreateCard({ presets, models, onCreated }) {
      const [name, setName] = React.useState('')
      const [basePreset, setBasePreset] = React.useState('')
      const [model, setModel] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)

      React.useEffect(() => {
        if (!basePreset && presets.length > 0) {
          setBasePreset(presets.find((p) => p.id === 'master' && !p.broken)?.id
            ?? presets.find((p) => p.isDefault && !p.broken)?.id
            ?? presets.find((p) => !p.broken)?.id ?? '')
        }
      }, [presets])
      React.useEffect(() => {
        if (!model && models?.default?.provider) setModel(`${models.default.provider}::${models.default.model}`)
      }, [models])

      const submit = async (e) => {
        e.preventDefault()
        setBusy(true); setError(null)
        try {
          const [provider, modelId] = model ? model.split('::') : []
          const result = await api('/bots', {
            method: 'POST',
            body: JSON.stringify({
              name,
              basePreset,
              provider: provider || undefined,
              model: modelId || undefined,
            }),
          })
          setName('')
          onCreated(result)
        } catch (err) {
          setError(String(err.message || err))
        } finally {
          setBusy(false)
        }
      }

      return h(
        'form',
        { className: 'dshb-form', onSubmit: submit },
        h('strong', { style: { fontSize: 13 } }, 'New bot'),
        Labeled({ label: 'Name' }, input('e.g. Researcher', name, setName)),
        Labeled({ label: 'Base preset (forked per bot)' },
          h('select', { className: 'dshb-select', value: basePreset, onChange: (e) => setBasePreset(e.target.value) },
            presets.map((p) =>
              h('option', { key: p.id, value: p.id, disabled: !!p.broken },
                `${p.id}${p.id === 'master' ? '  · master' : ''}${p.broken ? ' (broken)' : ''}${p.isDefault ? '  · default' : ''}`)))),
        Labeled({ label: 'Model' },
          h('select', { className: 'dshb-select', value: model, onChange: (e) => setModel(e.target.value) },
            h('option', { value: '' }, models?.default ? `Deployment default (${models.default.provider} / ${models.default.model})` : 'Deployment default'),
            (models?.groups ?? []).map((g) =>
              h('optgroup', { key: g.id, label: g.name },
                g.models.map((m) => h('option', { key: m.id, value: `${g.id}::${m.id}` }, m.name || m.id)))))),
        error ? h('div', { className: 'dshb-err' }, error) : null,
        h('button', { className: 'dshb-btn dshb-primary', type: 'submit', disabled: busy || !name.trim() }, busy ? 'Creating…' : 'Create bot'),
        h('div', { className: 'dshb-sub' }, 'Each bot gets its own preset forked from the selected base (default: master).'),
      )
    }

    function input(placeholder, value, setValue) {
      return h('input', { className: 'dshb-input', value, placeholder, onChange: (e) => setValue(e.target.value) })
    }

    /* ---- chat ---- */

    function ChatPane({ bot }) {
      const [messages, setMessages] = React.useState([])
      const [text, setText] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const msgsRef = React.useRef(null)
      React.useEffect(() => {
        let alive = true
        setMessages([])
        setError(null)
        api(`/bots/${bot.id}/messages`)
          .then((d) => alive && setMessages(d.messages ?? []))
          .catch(() => {})
        return () => { alive = false }
      }, [bot.id])
      React.useEffect(() => {
        if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight
      }, [messages, busy])
      const send = async (e) => {
        e.preventDefault()
        const t = text.trim()
        if (!t || busy) return
        setBusy(true); setError(null)
        setMessages((m) => [...m, { role: 'user', text: t }])
        setText('')
        try {
          const result = await api(`/bots/${bot.id}/chat`, { method: 'POST', body: JSON.stringify({ text: t }) })
          setMessages((m) => [...m, { role: 'bot', text: result.reply }])
        } catch (err) {
          setError(String(err.message || err))
          setMessages((m) => [...m, { role: 'bot', text: `Error: ${String(err.message || err)}` }])
        } finally {
          setBusy(false)
        }
      }
      return h(
        'div',
        { className: 'dshb-chat' },
        h('div', { className: 'dshb-msgs', ref: msgsRef },
          messages.length === 0 && !busy
            ? h('div', { className: 'dshb-empty' }, h('span', null, `Say something to ${bot.name}…`))
            : null,
          messages.map((m, i) =>
            h('div', {
              key: i,
              className: 'dshb-bubble ' + (m.role === 'user' ? 'dshb-user' : m.role === 'bot' ? 'dshb-bot' : 'dshb-bote'),
            }, m.text)),
        ),
        error ? h('div', { className: 'dshb-err' }, error) : null,
        h('form', { className: 'dshb-composer', onSubmit: send },
          h('input', {
            className: 'dshb-input',
            value: text,
            placeholder: busy ? `${bot.name} is thinking…` : `Message ${bot.name}…`,
            onChange: (e) => setText(e.target.value),
            disabled: busy,
          }),
          h('button', { className: 'dshb-btn dshb-primary', type: 'submit', disabled: busy || !text.trim() }, busy ? '…' : 'Send')),
      )
    }

    /* ---- pages ---- */

    function BotList({ bots, selected, onSelect, onDeleted }) {
      const [confirmId, setConfirmId] = React.useState(null)
      const remove = async (id) => {
        try {
          await api(`/bots/${id}`, { method: 'DELETE' })
          setConfirmId(null)
          onDeleted(id)
        } catch { setConfirmId(null) }
      }
      return h('div', null,
        bots.map((b) =>
          h('div', {
            key: b.id,
            className: 'dshb-card' + (selected === b.id ? ' dshb-active' : ''),
            onClick: () => onSelect(selected === b.id ? null : b.id),
          },
            h('div', { className: 'dshb-name' },
              h(Dot, { ok: b.enabled }),
              h('span', { style: { flex: 1 } }, b.name),
              confirmId === b.id
                ? h('span', { style: { display: 'flex', gap: 6 } },
                    h('button', {
                      className: 'dshb-btn',
                      onClick: (e) => { e.stopPropagation(); remove(b.id) },
                    }, 'confirm'),
                    h('button', {
                      className: 'dshb-btn',
                      onClick: (e) => { e.stopPropagation(); setConfirmId(null) },
                    }, 'keep'))
                : h('button', {
                    className: 'dshb-btn',
                    title: 'Delete bot (sessions are kept)',
                    onClick: (e) => { e.stopPropagation(); setConfirmId(b.id) },
                  }, '✕')),
            h('div', { className: 'dshb-chips' },
              h(Chip, { title: 'Agent preset' }, b.presetId),
              b.modelOverride ? h(Chip, { title: 'Model override' }, `${b.modelOverride.providerId} / ${b.modelOverride.modelId}`) : h(Chip, null, 'default model')))),
      )
    }

    function WorkbenchPage() {
      const [bots, setBots] = React.useState([])
      const [presets, setPresets] = React.useState([])
      const [models, setModels] = React.useState(null)
      const [selected, setSelected] = React.useState(null)
      const [error, setError] = React.useState(null)
      const refresh = React.useCallback(() => {
        api('/bots').then((d) => setBots(d.bots ?? [])).catch((e) => setError(String(e.message || e)))
        api('/presets').then((d) => setPresets(d.presets ?? [])).catch(() => {})
        api('/models').then((d) => setModels(d)).catch(() => {})
      }, [])
      React.useEffect(() => { refresh() }, [refresh])
      const selectedBot = bots.find((b) => b.id === selected)
      const healthyPresets = presets.filter((p) => !p.broken)

      return h(
        'div',
        { className: 'dshb-page' },
        h('div', { className: 'dshb-header' },
          h('h2', { className: 'dshb-title' }, 'Bots'),
          h('span', { className: 'dshb-sub' }, `${bots.length} bot${bots.length === 1 ? '' : 's'} · ${healthyPresets.length} preset${healthyPresets.length === 1 ? '' : 's'}`)),
        error ? h('div', { className: 'dshb-err' }, error) : null,
        h(
          'div',
          { className: 'dshb-body' },
          h('div', { className: 'dshb-list' },
            h(CreateCard, {
              presets,
              models,
              onCreated: (result) => {
                refresh()
                if (result?.bot?.id) setSelected(result.bot.id)
              },
            }),
            h(BotList, {
              bots,
              selected,
              onSelect: setSelected,
              onDeleted: (id) => {
                if (selected === id) setSelected(null)
                refresh()
              },
            })),
          h(
            'div',
            { className: 'dshb-detail' },
            selectedBot
              ? [
                  h('div', { className: 'dshb-detailhead' },
                    h('div', { className: 'dshb-detailname' }, selectedBot.name),
                    h('div', { className: 'dshb-chips' },
                      h(Chip, { title: 'Agent preset' }, selectedBot.presetId),
                      selectedBot.modelOverride
                        ? h(Chip, null, `${selectedBot.modelOverride.providerId} / ${selectedBot.modelOverride.modelId}`)
                        : h(Chip, null, 'default model'))),
                  h(ChatPane, { bot: selectedBot }),
                ]
              : h('div', { className: 'dshb-empty' },
                  h('div', null, 'Select a bot on the left to chat, or create one.'),
                  h('div', { style: { fontSize: 12 } }, 'Every bot gets its own preset forked from the master preset.')),
          ),
        ),
      )
    }

    /** Decorative sidebar glyph; the sidebar owns the accessible label. */
    function BotsPanelIcon({ size }) {
      const s = size ?? 18
      return h(
        'svg',
        { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', color: 'inherit' }, 'aria-hidden': true },
        h('rect', { x: 4, y: 7, width: 16, height: 12, rx: 3, stroke: 'currentColor', 'stroke-width': 1.6 }),
        h('circle', { cx: 9.5, cy: 13, r: 1.4, fill: 'currentColor' }),
        h('circle', { cx: 14.5, cy: 13, r: 1.4, fill: 'currentColor' }),
        h('path', { d: 'M9 16.5c1.6 1.2 4.4 1.2 6 0', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' }),
        h('path', { d: 'M8 4v3M16 4v3', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // Package stylesheet; removed when the entry unmounts.
        const styleEl = document.createElement('style')
        styleEl.setAttribute('data-plugin', PANEL_ID)
        styleEl.textContent = CSS
        document.head.append(styleEl)
        ctx.effect(() => () => styleEl.remove(), 'dsh-bots: stylesheet')

        // Sidebar entry (icon row) — the sidebar owns selection + label.
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: 'DSH Bots' },
            BotsPanelIcon,
          ),
        )
        // Main-area page shown while the panel is selected.
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, WorkbenchPage),
        )
      },
    }
  },
})
