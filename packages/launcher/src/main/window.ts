import { join } from 'node:path'
import { app, BrowserWindow, screen, shell } from 'electron'
import { clampToWorkArea, WINDOW_TARGET } from './windowSize'

export function createMainWindow(): BrowserWindow {
  // the target size, or as much of it as the primary display leaves beside the taskbar
  const { width, height } = clampToWorkArea(WINDOW_TARGET, screen.getPrimaryDisplay().workAreaSize)
  const win = new BrowserWindow({
    width,
    height,
    resizable: false,
    maximizable: false,
    frame: false,
    show: false,
    backgroundColor: '#ebe7dc',
    title: 'Yufa | ToS Classic',
    // packaged builds get the icon from the exe; in dev, point at buildResources
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // any target=_blank / external navigation goes to the OS browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // test/e2e hook: YUFA_VIEW=settings opens Settings on start (the renderer reads ?view=), for the screenshot smoke
  const view = process.env['YUFA_VIEW']
  const query = view ? { view } : undefined
  if (process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    if (view) url.searchParams.set('view', view)
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }
  return win
}
