/* Electron browser-mode harness: load the web page, capture all console
 * messages and page errors, print them, then quit. */
const { app, BrowserWindow } = require('electron')

const target = process.argv[2]
if (!target) {
  console.error('usage: electron page-probe.js <url>')
  app.exit(2)
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  const seen = new Set()
  const log = (kind, args) => {
    const line = `[${kind}] ` + args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
    if (seen.has(line)) return
    seen.add(line)
    console.log(line.slice(0, 500))
  }
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    log(`console${level}`, [message, `${sourceId}:${line}`])
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log('[gone]', JSON.stringify(details))
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.log('[did-fail-load]', code, desc, url)
  })
  win.webContents.on('did-finish-load', () => {
    console.log('[did-finish-load]', win.webContents.getURL())
  })
  win.loadURL(target)
  setTimeout(() => {
    win.webContents.executeJavaScript(`
      (() => {
        const out = { moduleLoaderType: typeof window.__ModuleLoader__, mode: window.__ModuleLoader__ && window.__ModuleLoader__.mode }
        try {
          out.hasDSHBoot = !!globalThis.__DSH_BOOT__
          const g = globalThis.__DSH_BOOT__ || {}
          out.botsEntry = (g.entries || []).find(e => String(e.id).includes('bots')) || null
        } catch (e) { out.bootErr = String(e) }
        return out
      })()
    `).then((r) => {
      console.log('[page-state]', JSON.stringify(r))
      app.exit(0)
    }).catch((e) => {
      console.log('[executeJavaScript failed]', String(e))
      app.exit(1)
    })
  }, 12000)
})
