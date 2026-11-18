import assert from 'node:assert'
import fs from 'node:fs'

const code = fs.readFileSync('/Users/vivi/code/projects/dsh/dsh-my-bots/dsh-bots/client.js', 'utf8')

// The exact failure mode from the Desktop log: executing the script body twice
// in the same global scope must not hit top-level lexical redeclaration.
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  Fragment: 'Fragment',
}
const registrations = []
globalThis.window = {
  __ModuleLoader__: {
    load(registration) { registrations.push(registration) },
  },
}

const run = new Function(code)
run() // first execution (e.g. the application combo)
run() // second execution (e.g. the one-resource fallback URL)

assert.equal(registrations.length, 2, 'registered on both executions')
assert.equal(registrations[0].id, '@local/dsh-bots')

// materialize twice with a react-only require table
for (const reg of registrations) {
  const plugin = reg.factory((spec) => {
    if (spec === 'react') return React
    throw new Error(`require("${spec}") missed the module table`)
  })
  assert.equal(plugin.inject[0], 'slots')
  assert.equal(typeof plugin.apply, 'function')
}
console.log('RE-EXECUTABLE OK: double execution registers twice, factory materializes cleanly')
