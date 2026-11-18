/* dsh-bots client half: a LEFT-SIDEBAR panel ("DSH Bots") whose main-area page
 * hosts the Bot Workbench. Pattern copied from the shipped schedule plugin:
 *   sidebar.panellist  -> icon row (selected by the sidebar)
 *   main (key = panel id) -> the page shown when selected
 * Everything lives inside the factory closure: this file must stay
 * re-executable without top-level lexical declarations. */
window.__ModuleLoader__.load({
  id: '@local/dsh-bots',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PANEL_ID = 'dsh-bots'
    const API = '/api/plugins/bots'

    async function api(path, init) {
      const res = await fetch(API + path, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || res.statusText)
      return body
    }

    /* ---- styles ---- */
    const panelIconStyle = { display: 'block', color: 'inherit' }
    const pageStyle = {
      height: '100%',
      overflow: 'auto',
      padding: 24,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      boxSizing: 'border-box',
    }
    const formStyle = { display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 420 }
    const fieldStyle = { padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(128,128,128,.4)', background: 'transparent', color: 'inherit' }
    const rowStyle = { display: 'flex', gap: 8, alignItems: 'center' }
    const errorStyle = { color: '#ff7b72', fontSize: 12 }
    const paneStyle = {
      flex: 1,
      minHeight: 200,
      overflow: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      padding: 10,
      borderRadius: 8,
      background: 'rgba(128,128,128,.08)',
    }
    const userMsg = { alignSelf: 'flex-end', textAlign: 'right', opacity: 0.9, maxWidth: '80%' }
    const botMsg = { alignSelf: 'flex-start', whiteSpace: 'pre-wrap', maxWidth: '80%' }
    const cardStyle = (active) => ({
      textAlign: 'left',
      cursor: 'pointer',
      borderRadius: 8,
      padding: '8px 12px',
      minWidth: 170,
      border: active ? '1px solid #4a9eff' : '1px solid rgba(128,128,128,.35)',
      background: 'rgba(128,128,128,.06)',
      color: 'inherit',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    })

    /* ---- components ---- */

    /** Decorative sidebar glyph; the sidebar owns the accessible label. */
    function BotsPanelIcon({ size }) {
      const s = size ?? 18
      return h(
        'svg',
        { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', style: panelIconStyle, 'aria-hidden': true },
        h('rect', { x: 4, y: 7, width: 16, height: 12, rx: 3, stroke: 'currentColor', 'stroke-width': 1.6 }),
        h('circle', { cx: 9.5, cy: 13, r: 1.4, fill: 'currentColor' }),
        h('circle', { cx: 14.5, cy: 13, r: 1.4, fill: 'currentColor' }),
        h('path', { d: 'M9 16.5c1.6 1.2 4.4 1.2 6 0', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' }),
        h('path', { d: 'M8 4v3M16 4v3', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
      )
    }

    function CreateBot({ presets, onCreated }) {
      const [name, setName] = React.useState('')
      const [presetId, setPresetId] = React.useState('')
      const [mode, setMode] = React.useState('reference')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      React.useEffect(() => {
        if (!presetId && presets.length > 0) setPresetId(presets.find((p) => !p.broken)?.id ?? '')
      }, [presets])
      const submit = async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
          let finalPreset = presetId
          if (mode === 'fork') {
            const fork = await api('/presets/copy', {
              method: 'POST',
              body: JSON.stringify({
                sourceId: presetId,
                newId: `${presetId}-${name}`.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').slice(0, 40),
              }),
            })
            if (!fork.installed) throw new Error(fork.detail)
            finalPreset = fork.newId
          }
          await api('/bots', { method: 'POST', body: JSON.stringify({ name, presetId: finalPreset }) })
          setName('')
          onCreated()
        } catch (err) {
          setError(String(err.message || err))
        } finally {
          setBusy(false)
        }
      }
      return h(
        'form',
        { onSubmit: submit, style: formStyle },
        h('strong', null, 'Create bot'),
        input('Bot name', name, setName),
        h(
          'select',
          { value: presetId, onChange: (e) => setPresetId(e.target.value), style: fieldStyle },
          presets.map((p) =>
            h('option', { key: p.id, value: p.id }, `${p.name}${p.broken ? ' (broken)' : ''}${p.isDefault ? ' · default' : ''}`),
          ),
        ),
        h(
          'div',
          { style: rowStyle },
          radio('reference', mode, setMode, 'Reference'),
          radio('fork', mode, setMode, 'Fork preset'),
        ),
        error ? h('div', { style: errorStyle }, error) : null,
        h('button', { type: 'submit', disabled: busy || !name || !presetId }, busy ? 'Working…' : 'Create'),
      )
    }

    function radio(value, mode, setMode, text) {
      return h(
        'label',
        { style: { marginRight: 12, cursor: 'pointer', fontSize: 12 } },
        h('input', { type: 'radio', checked: mode === value, onChange: () => setMode(value) }),
        ' ' + text,
      )
    }

    function input(placeholder, value, setValue) {
      return h('input', {
        value,
        placeholder,
        onChange: (e) => setValue(e.target.value),
        style: fieldStyle,
      })
    }

    function ChatPane({ bot }) {
      const [messages, setMessages] = React.useState([])
      const [text, setText] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      React.useEffect(() => {
        let alive = true
        api(`/bots/${bot.id}/messages`)
          .then((d) => alive && setMessages(d.messages ?? []))
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [bot.id])
      const send = async (e) => {
        e.preventDefault()
        if (!text.trim()) return
        setBusy(true)
        try {
          const result = await api(`/bots/${bot.id}/chat`, { method: 'POST', body: JSON.stringify({ text }) })
          setMessages((m) => [
            ...m,
            { role: 'user', text },
            { role: 'bot', text: result.reply },
          ])
          setText('')
        } catch (err) {
          setMessages((m) => [...m, { role: 'bot', text: `Error: ${String(err.message || err)}` }])
        } finally {
          setBusy(false)
        }
      }
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 220 } },
        h('strong', null, bot.name),
        h(
          'div',
          { style: paneStyle },
          messages.length === 0 ? h('i', { style: { opacity: 0.6 } }, 'No messages yet.') : null,
          messages.map((m, i) => h('div', { key: i, style: m.role === 'user' ? userMsg : botMsg }, m.text)),
        ),
        h(
          'form',
          { onSubmit: send, style: rowStyle },
          h('input', {
            value: text,
            onChange: (e) => setText(e.target.value),
            placeholder: `Message ${bot.name}…`,
            style: { ...fieldStyle, flex: 1 },
          }),
          h('button', { type: 'submit', disabled: busy }, busy ? '…' : 'Send'),
        ),
      )
    }

    function WorkbenchPage() {
      const [bots, setBots] = React.useState([])
      const [presets, setPresets] = React.useState([])
      const [selected, setSelected] = React.useState(null)
      const [error, setError] = React.useState(null)
      const refresh = React.useCallback(() => {
        api('/bots').then((d) => setBots(d.bots ?? [])).catch((e) => setError(String(e.message || e)))
        api('/presets').then((d) => setPresets(d.presets ?? [])).catch(() => {})
      }, [])
      React.useEffect(() => {
        refresh()
      }, [refresh])
      const selectedBot = bots.find((b) => b.id === selected)
      return h(
        'div',
        { style: pageStyle },
        h('h2', { style: { margin: 0 } }, 'DSH Bots'),
        error ? h('div', { style: errorStyle }, error) : null,
        h(CreateBot, { presets, onCreated: refresh }),
        h(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: 10 } },
          bots.map((b) =>
            h(
              'button',
              {
                key: b.id,
                onClick: () => setSelected(selected === b.id ? null : b.id),
                style: cardStyle(selected === b.id),
              },
              h('div', { style: { fontWeight: 600 } }, b.name),
              h('div', { style: { opacity: 0.65, fontSize: 11 } }, `preset: ${b.presetId}`),
            ),
          ),
        ),
        selectedBot ? h(ChatPane, { bot: selectedBot }) : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
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
