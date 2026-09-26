import { app, BrowserWindow, shell, ipcMain, session, screen } from 'electron'
import { join } from 'path'
import fs from 'fs'

let mainWindow: BrowserWindow | null = null

/** 录制会话:recordId → 下载控制器 */
interface RecordingSession {
  controller: AbortController
  filePath: string
  channelName: string
  startTime: number
}
const recordingSessions = new Map<string, RecordingSession>()

/**
 * 自定义视频源播放防盗链表:hostname -> { referer, ua }
 * 渲染层播放某采集源视频前,通过 IPC 注册 m3u8 域名对应的 Referer/UA,
 * 主进程在 onBeforeSendHeaders 中注入,等效服务端代理的防盗链作用
 * (脱离服务器后由客户端直连,CORS 由 onHeadersReceived 注入 *)
 */
const videoHeadersMap = new Map<string, { referer: string; ua: string }>()
/** 最近一次播放的防盗链头,用于跨域名 ts/m4s 分片兜底(同时只播一个视频) */
let lastVideoHeaders: { referer: string; ua: string } | null = null

// 限制 GPU 进程内存并启用部分加速:完全禁用 GPU 会导致软件渲染(慢/耗 CPU),
// 这里改为设置内存上限,既规避沙箱缓存崩溃又保留硬件加速以加快窗口合成
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('disable-software-rasterizer')

// 单实例锁:防止多开导致配置文件竞争和数据损坏
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

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
    // 原子写入:先写临时文件,再重命名,防止崩溃时数据损坏
    const storePath = getStorePath()
    const tmpPath = storePath + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tmpPath, storePath)
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

/** 根据屏幕分辨率计算合适的初始窗口大小(不超过屏幕 70%) */
function getDefaultWindowSize(): { width: number; height: number } {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

  // 目标尺寸:960×640,但不超屏幕 70%
  let width = Math.min(960, Math.round(screenWidth * 0.7))
  let height = Math.min(640, Math.round(screenHeight * 0.7))

  // 最小尺寸保障
  width = Math.max(width, 800)
  height = Math.max(height, 540)

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
  const validWidth = saved.width >= 800 ? saved.width : defaultSize.width
  const validHeight = saved.height >= 540 ? saved.height : defaultSize.height

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
    minWidth: 800,
    minHeight: 540,
    resizable: true,
    maximizable: true,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    title: 'MoonTVPlus',
    icon: join(__dirname, '../../build/icon.png'),
    backgroundColor: '#0a0a14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      // 保持 webSecurity 开启(默认值):同源策略、file:// 隔离等保护仍然生效。
      // 跨域的视频流(m3u8/ts)、图片及第三方 API 请求由下方 onHeadersReceived
      // 精确注入 CORS 头解决,无需全局关闭 web 安全策略
    }
  })

  // 恢复最大化状态
  if (windowState.isMaximized) {
    mainWindow.maximize()
  }

  // 通知渲染进程最大化状态变化
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximizeChanged', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximizeChanged', false))

  // 开发环境:打开 DevTools
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  // 生产环境禁用 DevTools 快捷键
  if (app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12' ||
        (input.control && input.shift && input.key.toLowerCase() === 'i')) {
        event.preventDefault()
      }
    })
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // 仅允许 http/https 协议,防止恶意 URL scheme
    try {
      const url = new URL(details.url)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        shell.openExternal(details.url)
      }
    } catch {
      // 无效 URL,忽略
    }
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

  // 窗口控制 IPC
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

  // 注册自定义视频流的防盗链头(渲染层播放前调用)
  ipcMain.handle(
    'media:setVideoHeaders',
    (_e, payload: { url: string; referer?: string; ua?: string }) => {
      try {
        const hostname = new URL(payload.url).hostname.toLowerCase()
        const entry = { referer: payload.referer || '', ua: payload.ua || '' }
        videoHeadersMap.set(hostname, entry)
        lastVideoHeaders = entry
      } catch {
        // url 非法时忽略
      }
      return true
    }
  )

  /* ============ 直播录制 ============
   * 渲染层发起录制请求后,主进程用 fetch 流式下载并写入文件。
   * 使用 webContents.fetch 自动携带已注入的防盗链头(Referer/UA)。
   * 支持 m3u8(仅录制 master playlist 内容)和 flv/mp4 等直链(流式写入)。
   */
  ipcMain.handle(
    'live:startRecording',
    async (_e, payload: { recordId: string; url: string; channelName: string }) => {
      const { recordId, url, channelName } = payload
      if (recordingSessions.has(recordId)) {
        return { ok: false, error: '录制会话已存在' }
      }
      const controller = new AbortController()
      // 保存目录: 用户视频目录/直播录制
      const videosPath = app.getPath('videos')
      const recordDir = join(videosPath, '直播录制')
      try {
        if (!fs.existsSync(recordDir)) fs.mkdirSync(recordDir, { recursive: true })
      } catch (e) {
        return { ok: false, error: `无法创建录制目录: ${(e as Error)?.message}` }
      }
      const safeName = channelName.replace(/[\\/:*?"<>|]/g, '_')
      const ext = url.includes('.flv') ? '.flv' : url.includes('.mp4') ? '.mp4' : '.ts'
      const filePath = join(recordDir, `${safeName}_${Date.now()}${ext}`)
      const session: RecordingSession = { controller, filePath, channelName, startTime: Date.now() }
      recordingSessions.set(recordId, session)

      // 异步启动下载(不阻塞 IPC 返回)
      ;(async () => {
        try {
          const res = await fetch(url, { signal: controller.signal })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          if (!res.body) throw new Error('响应无 body')

          const writer = fs.createWriteStream(filePath, { flags: 'wx' })
          const reader = res.body.getReader()
          let bytes = 0

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) {
              writer.write(Buffer.from(value))
              bytes += value.byteLength
              // 定期向渲染层汇报进度
              if (bytes % (1024 * 512) < 65536) {
                try {
                  mainWindow?.webContents.send('live:recordingProgress', { recordId, bytes, filePath })
                } catch {}
              }
            }
          }
          writer.end()
          mainWindow?.webContents.send('live:recordingComplete', { recordId, filePath, bytes })
        } catch (err: any) {
          if (err?.name === 'AbortError') {
            mainWindow?.webContents.send('live:recordingStopped', { recordId, filePath })
          } else {
            mainWindow?.webContents.send('live:recordingError', {
              recordId,
              error: err?.message || '下载失败',
              filePath
            })
          }
        } finally {
          recordingSessions.delete(recordId)
        }
      })()

      return { ok: true, filePath }
    }
  )

  ipcMain.handle('live:stopRecording', (_e, recordId: string) => {
    const s = recordingSessions.get(recordId)
    if (!s) return { ok: false, error: '录制会话不存在' }
    s.controller.abort()
    return { ok: true, filePath: s.filePath }
  })

  ipcMain.handle('live:getRecordingStatus', (_e, recordId: string) => {
    const s = recordingSessions.get(recordId)
    if (!s) return { recording: false }
    return { recording: true, filePath: s.filePath, startTime: s.startTime, channelName: s.channelName }
  })

  ipcMain.handle('live:listRecordings', () => {
    try {
      const recordDir = join(app.getPath('videos'), '直播录制')
      if (!fs.existsSync(recordDir)) return []
      const files = fs.readdirSync(recordDir).filter((f) => /\.(ts|flv|mp4)$/i.test(f))
      return files.map((f) => ({
        name: f,
        path: join(recordDir, f),
        size: fs.statSync(join(recordDir, f)).size,
        mtime: fs.statSync(join(recordDir, f)).mtimeMs
      })).sort((a, b) => b.mtime - a.mtime)
    } catch {
      return []
    }
  })

  ipcMain.handle('live:openRecordingFolder', () => {
    const recordDir = join(app.getPath('videos'), '直播录制')
    if (!fs.existsSync(recordDir)) fs.mkdirSync(recordDir, { recursive: true })
    shell.openPath(recordDir)
    return recordDir
  })

  // 合并为单个 onBeforeSendHeaders 监听器
  // (Electron 文档:只有最后一个 listener 生效,不能注册多个)
  const ses = session.defaultSession
  ses.webRequest.onBeforeSendHeaders(
    { urls: ['*://*/*'] },
    (details, callback) => {
      try {
        const url = new URL(details.url)
        const hostname = url.hostname.toLowerCase()

        // 豆瓣图片防盗链:注入 movie.douban.com 作为 Referer
        if (hostname.includes('doubanio.com')) {
          details.requestHeaders['Referer'] = 'https://movie.douban.com/'
        } else if (
          // 豆瓣公开榜单 API(/j/search_subjects)直连需浏览器 UA + Referer,否则 403/418
          hostname === 'movie.douban.com' && url.pathname.startsWith('/j/')
        ) {
          details.requestHeaders['Referer'] = 'https://movie.douban.com/'
          details.requestHeaders['User-Agent'] =
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        } else if (
          // 其他图片请求:注入自身 origin 作为 Referer(部分资源站也有防盗链)
          (details.resourceType === 'image' ||
            /\.(jpg|jpeg|png|gif|webp|bmp|ico|svg)(\?|$)/i.test(details.url)) &&
          !details.requestHeaders['Referer']
        ) {
          details.requestHeaders['Referer'] = `${url.origin}/`
        }

        // 音乐源防盗链:<audio> 元素无法设置 Referer,需在主进程注入
        if (details.resourceType === 'media' || /\.(mp3|flac|ape|wav|m4a|aac|ogg|m3u8)(\?|$)/i.test(details.url)) {
          if (hostname.includes('kuwo.cn')) {
            details.requestHeaders['Referer'] = 'http://www.kuwo.cn/'
            details.requestHeaders['Origin'] = 'http://www.kuwo.cn'
          } else if (hostname.includes('qqmusic') || hostname === 'y.qq.com' || hostname.includes('music.qq.com')) {
            details.requestHeaders['Referer'] = 'https://y.qq.com/'
            details.requestHeaders['Origin'] = 'https://y.qq.com'
          } else if (hostname.includes('music.163.com') || hostname.includes('163.com')) {
            details.requestHeaders['Referer'] = 'https://music.163.com/'
            details.requestHeaders['Origin'] = 'https://music.163.com'
          } else if (hostname.includes('kugou') || hostname.includes('kgmusic')) {
            details.requestHeaders['Referer'] = 'https://www.kugou.com/'
            details.requestHeaders['Origin'] = 'https://www.kugou.com'
          } else if (hostname.includes('migu.cn') || hostname.includes('miguvideo')) {
            details.requestHeaders['Referer'] = 'https://music.migu.cn/'
            details.requestHeaders['Origin'] = 'https://music.migu.cn'
          }
        }

        // 自定义视频源防盗链:HLS.js 通过 xhr/fetch 加载 m3u8 与 ts/m4s 分片
        // 按渲染层注册的 hostname 注入对应采集站 Referer/UA,等效服务端代理
        const isHlsPlaylist = /\.m3u8?(\?|$)/i.test(details.url)
        const isHlsSegment = /\.(ts|m4s|mpd|key)(\?|$)/i.test(details.url)
        if (isHlsPlaylist || isHlsSegment) {
          const exact = videoHeadersMap.get(hostname)
          // 主播放表必须精确匹配;分片允许跨域名用最近播放头兜底
          const entry = exact || (isHlsSegment ? lastVideoHeaders : null)
          if (entry) {
            if (entry.referer) details.requestHeaders['Referer'] = entry.referer
            if (entry.ua) details.requestHeaders['User-Agent'] = entry.ua
          }
        }
      } catch {
        // URL 解析失败,不修改 header
      }
      callback({ requestHeaders: details.requestHeaders })
    }
  )

  // 为跨域 XHR/fetch/媒体 响应精确注入 CORS 头(替代全局关闭 webSecurity 的做法):
  // 渲染层需要请求用户自配置的服务端、苹果 CMS 采集源、豆瓣等任意第三方主机,
  // 这些主机不会返回允许本应用的 CORS 头。仅对真正受同源策略约束的请求放行:
  //   - Electron 31 中 fetch 与 XHR 的 resourceType 均为 'xhr';CORS 预检为 OPTIONS
  //   - media: 音乐页用 Web Audio API(createMediaElementSource)做频谱可视化,
  //     跨域音频在 webSecurity 开启且无 ACAO 头时会被静音(tainted),需对
  //     <audio crossOrigin="anonymous"> 的媒体响应注入 ACAO
  //   - 普通 <img>/<video>/<audio> 标签(无 crossOrigin 属性)加载不受 CORS 限制,
  //     注入头不改变其行为
  //   - 应用不使用 Cookie 凭证(HLS 显式 withCredentials=false),ACAO: * 合法有效
  ses.webRequest.onHeadersReceived(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      const corsRelevant =
        details.resourceType === 'xhr' ||
        details.resourceType === 'media' ||
        details.method?.toUpperCase() === 'OPTIONS'
      if (!corsRelevant) {
        callback({ responseHeaders: details.responseHeaders })
        return
      }
      const headers = details.responseHeaders || {}
      delete headers['Access-Control-Allow-Origin']
      delete headers['access-control-allow-origin']
      headers['Access-Control-Allow-Origin'] = ['*']
      headers['Access-Control-Allow-Headers'] = ['*']
      headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS']
      callback({ responseHeaders: headers })
    }
  )

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
