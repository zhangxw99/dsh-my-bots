import assert from 'node:assert'

// Minimal react stub: createElement + hooks used by client.js
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  Fragment: 'Fragment',
}

let registrations = []
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) { registrations.push({ id, factory }) },
  },
}
// Minimal document stub: apply() inserts a stylesheet element.
const styleEl = { attrs: {}, text: '', setAttribute(k, v) { this.attrs[k] = v }, remove() {} }
globalThis.document = {
  createElement: () => styleEl,
  head: { append() {} },
}

await import('../dsh-bots/client.js')
assert.equal(registrations.length, 1, 'module registers itself once')
assert.equal(registrations[0].id, '@local/dsh-bots')

// Module table WITHOUT react-dom (shipped parity: only react + slots are needed).
const requireInClient = (name) => {
  if (name === 'react') return React
  throw new Error(`Cannot require '${name}' from the client module table`)
}

const mod = registrations[0].factory(requireInClient)
assert.equal(mod.inject[0], 'slots')

const injected = []
const effects = []
const stubCtx = {
  effect(fn, label) { effects.push([label, fn]); return () => {} },
  slots: {
    inject(slotName, register) { injected.push([slotName, register]) },
    register(options, component) { return { options, component } },
  },
}
mod.apply(stubCtx)
assert.equal(effects.length, 1, 'stylesheet registered via ctx.effect')
assert.equal(injected.length, 2, 'apply injects sidebar.panellist + main')
assert.equal(injected[0][0], 'sidebar.panellist')
assert.equal(injected[1][0], 'main')

const [panelSlot, panelRegister] = injected[0]
assert.equal(panelSlot, 'sidebar.panellist')
const panel = panelRegister()
assert.equal(panel.options.id, 'dsh-bots')
const iconEl = panel.component({ size: 18 })
assert.equal(iconEl.type, 'svg', 'panel icon renders an svg')

const [mainSlot, mainRegister] = injected[1]
assert.equal(mainSlot, 'main')
const page = mainRegister()
assert.equal(page.options.key, 'dsh-bots', 'main page key matches panel id')
const pageEl = page.component()
assert.ok(pageEl && (typeof pageEl.type === 'function' || typeof pageEl.type === 'string'), 'page renders')

console.log('CLIENT MODULE OK: sidebar panel + main page registered, both render')
