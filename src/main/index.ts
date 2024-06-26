import { electronApp, is } from '@electron-toolkit/utils'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray
} from 'electron'
import { join } from 'path'
import icon from '../../build/icon.png?asset'
import nostrTemplate from '../../resources/nostrTemplate.png?asset'
import { Relay } from './relay'
import { getLocalIpAddress } from './utils'

const relay = new Relay()
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  if (BrowserWindow.getAllWindows().length > 0) {
    mainWindow?.focus()
    return
  }

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.setTitle('Nostr Relay Tray')
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray() {
  const tray = new Tray(nativeImage.createFromPath(nostrTemplate))

  let currentLocalIpAddress = getLocalIpAddress()
  tray.setContextMenu(createMenu(currentLocalIpAddress))

  setInterval(() => {
    const newLocalIpAddress = getLocalIpAddress()
    if (newLocalIpAddress !== currentLocalIpAddress) {
      currentLocalIpAddress = newLocalIpAddress
      tray.setContextMenu(createMenu(currentLocalIpAddress))
    }
  }, 10000)
}

function createMenu(localIpAddress?: string) {
  return Menu.buildFromTemplate([
    {
      label: 'Dashboard',
      type: 'normal',
      click: createWindow
    },
    { type: 'separator' },
    {
      label: `ws://localhost:4869 - Copy`,
      type: 'normal',
      click: () => clipboard.writeText(`ws://localhost:4869`)
    },
    {
      label: `ws://${localIpAddress}:4869 - Copy`,
      type: 'normal',
      click: () => clipboard.writeText(`ws://${localIpAddress}:4869`)
    },
    { type: 'separator' },
    {
      label: 'Quit',
      role: 'quit'
    }
  ])
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.nostr-relay-tray.app')

  await relay.init()

  ipcMain.handle('getTotalEventCount', () => relay.getTotalEventCount())
  ipcMain.handle('getEventStatistics', () => relay.getEventStatistics())
  ipcMain.handle('exportEvents', async () => {
    const { filePath } = await dialog.showSaveDialog({
      title: 'Export Events',
      filters: [{ name: 'jsonl', extensions: ['jsonl'] }],
      defaultPath: 'events.jsonl'
    })
    if (!filePath) return false

    relay.exportEvents(filePath, (progress) => {
      mainWindow?.webContents.send('exportEvents:progress', progress)
    })
    return true
  })
  ipcMain.handle('importEvents', async () => {
    const { filePaths } = await dialog.showOpenDialog({
      title: 'Import Data',
      filters: [{ name: 'jsonl', extensions: ['jsonl'] }],
      properties: ['openFile']
    })
    if (filePaths.length <= 0) return false

    await relay.importEvents(filePaths[0], (progress) => {
      mainWindow?.webContents.send('importEvents:progress', progress)
    })
    return true
  })

  createTray()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Prevent the app from closing when the last window is closed
app.on('window-all-closed', (event) => {
  event.preventDefault()
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
