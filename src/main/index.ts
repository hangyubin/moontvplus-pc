import { app, BrowserWindow, shell, ipcMain, session, screen } from 'electron'
import { join } from 'path'
import fs from 'fs'

let mainWindow: BrowserWindow | null = null

/** 轻量持久化存储路径(用户数据目录) */
function getStorePath(): string {
  return join(app.getPath('userData'), 'moontvplus-pc-config.json')
}

function readStore(): Record<string, unknown> {
  try {
    const p = getStorePath()
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch (e) {
    console.error('readStore error', e)
  }
  return {}
}

function writeStore(data: Record<string, unknown>): void {
  try {
    fs.writeFileSync(getStorePath(), JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    console.error('writeStore error', e)
  }
}

/** 窗口状态持久化键 */
const WINDOW_STATE_KEY = 'windowState'

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized?: boolean
}

/** 根据屏幕分辨率计算合适的初始窗口大小(不超过屏幕 85%) */
function getDefaultWindowSize(): { width: number; height: number } {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

  // 目标尺寸:1400×880,但不超屏幕 85%
  let width = Math.min(1400, Math.round(screenWidth * 0.85))
  let height = Math.min(880, Math.round(screenHeight * 0.85))

  // 最小尺寸保障
  width = Math.max(width, 1024)
  height = Math.max(height, 680)

  return { width, height }
}

/** 读取上次保存的窗口状态,无效则用默认值 */
function getSavedWindowState(): WindowState {
  const store = readStore()
  const saved = store[WINDOW_STATE_KEY] as WindowState | undefined
  const defaultSize = getDefaultWindowSize()

  if (!saved) {
    return { width: defaultSize.width, height: defaultSize.height }
  }

  // 校验保存的尺寸是否在合理范围内(防止多显示器切换后位置丢失)
  const validWidth = saved.width >= 1024 ? saved.width : defaultSize.width
  const validHeight = saved.height >= 680 ? saved.height : defaultSize.height

  // 如果有 x/y,检查是否在某个显示器范围内
  let x = saved.x
  let y = saved.y
  if (x !== undefined && y !== undefined) {
    const displays = screen.getAllDisplays()
    const visible = displays.some((display) => {
      const { x: dx, y: dy, width: dw, height: dh } = display.bounds
      return x! >= dx && x! < dx + dw && y! >= dy && y! < dy + dh
    })
    if (!visible) {
      x = undefined
      y = undefined
    }
  }

  return {
    width: validWidth,
    height: validHeight,
    x,
    y,
    isMaximized: saved.isMaximized
  }
}

/** 保存窗口状态到持久化存储 */
function saveWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const store = readStore()
  const isMaximized = mainWindow.isMaximized()
  const bounds = mainWindow.getNormalBounds()
  store[WINDOW_STATE_KEY] = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    isMaximized
  }
  writeStore(store)
}

function createWindow(): void {
  const windowState = getSavedWindowState()

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    title: 'MoonTVPlus',
    backgroundColor: '#0a0a14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      // 关闭 webSecurity 允许跨域加载视频流(m3u8/ts)和图片资源
      // Electron 桌面应用从 file:// 加载,需要跨域访问 http 服务器
      webSecurity: false,
      allowRunningInsecureContent: true
    }
  })

  // 恢复最大化状态
  if (windowState.isMaximized) {
    mainWindow.maximize()
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 窗口状态变化时保存(防抖:延迟 500ms 避免频繁写入)
  let saveTimer: NodeJS.Timeout | null = null
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveWindowState()
      saveTimer = null
    }, 500)
  }
  mainWindow.on('resize', scheduleSave)
  mainWindow.on('move', scheduleSave)
  mainWindow.on('maximize', scheduleSave)
  mainWindow.on('unmaximize', scheduleSave)

  // 关闭时同步保存
  mainWindow.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveWindowState()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // 持久化存储 IPC
  ipcMain.handle('store:get', (_e, key: string) => readStore()[key])
  ipcMain.handle('store:set', (_e, key: string, value: unknown) => {
    const data = readStore()
    data[key] = value
    writeStore(data)
    return true
  })
  ipcMain.handle('store:getAll', () => readStore())

  // 为豆瓣图片请求注入 Referer,解决防盗链 403 问题
  // 豆瓣图片域名(img*.doubanio.com)会检查 Referer,缺省返回 403
  const ses = session.defaultSession
  ses.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.doubanio.com/*'] },
    (details, callback) => {
      details.requestHeaders['Referer'] = 'https://movie.douban.com/'
      callback({ requestHeaders: details.requestHeaders })
    }
  )

  // 为资源站图片请求注入通用 Referer(部分资源站也有防盗链)
  ses.webRequest.onBeforeSendHeaders(
    { urls: ['*://*/*'] },
    (details, callback) => {
      // 只对图片请求添加 Referer,不影响 API 请求
      const isImage =
        details.resourceType === 'image' ||
        /\.(jpg|jpeg|png|gif|webp|bmp|ico|svg)(\?|$)/i.test(details.url)
      if (isImage && !details.requestHeaders['Referer']) {
        const url = new URL(details.url)
        details.requestHeaders['Referer'] = `${url.origin}/`
      }
      callback({ requestHeaders: details.requestHeaders })
    }
  )

  // 关键:为所有响应注入 CORS 头,允许 hls.js 用 fetch 加载跨域 m3u8/ts 流
  // Electron 桌面应用中渲染进程从 file:// 加载,跨域请求资源站时
  // 资源站不发 Access-Control-Allow-Origin,hls.js 的 fetch 会被 CORS 阻止
  // 这里在主进程拦截响应头,统一注入 CORS 允许,绕过浏览器同源策略
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {}
    // 移除原有的 CORS 头(避免重复),再统一注入
    delete headers['Access-Control-Allow-Origin']
    delete headers['access-control-allow-origin']
    headers['Access-Control-Allow-Origin'] = ['*']
    // 允许凭证(虽然这里用 *,但部分场景需要)
    headers['Access-Control-Allow-Headers'] = ['*']
    headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS']
    callback({ responseHeaders: headers })
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
