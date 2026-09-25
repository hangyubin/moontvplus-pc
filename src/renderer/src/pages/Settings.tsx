/**
 * 设置页面
 * - 视频过滤开关(预告片 / 18禁)
 * - 主题切换
 */
import { useState, useEffect } from 'react'
import {
  getCustomVideoSource,
  setCustomVideoSource,
  getCustomLiveSource,
  setCustomLiveSource,
  getCustomMusicSource,
  setCustomMusicSource,
} from '../lib/customSource'
import { useStore } from '../lib/store'
import { getBaseUrl } from '../lib/auth'
import { clearCustomVideoSitesCache, clearCustomStreamResolveCache, refreshCustomApiSites } from '../lib/api'
import { clearSearchCache } from '../lib/searchCache'
import { clearHomeCache } from '../lib/homeCache'
import { clearImageCache } from '../lib/image'
import { toast } from '../components/Toast'

export default function Settings() {
  const { auth, serverConfig, login, logout } = useStore()
  const [hideTrailers, setHideTrailers] = useState(true)
  const [blockNSFW, setBlockNSFW] = useState(true)
  const [customVideo, setCustomVideo] = useState('')
  const [customLive, setCustomLive] = useState('')
  const [customMusicUrl, setCustomMusicUrl] = useState('')
  const [customMusicToken, setCustomMusicToken] = useState('')
  const [customMusicUsername, setCustomMusicUsername] = useState('')

  // 服务器配置(本地输入框状态,与 store 同步初始化)
  const [serverUrl, setServerUrl] = useState('')
  const [serverUser, setServerUser] = useState('')
  const [serverPass, setServerPass] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [serverMsg, setServerMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const serverConnected = !!auth?.username

  useEffect(() => {
    setHideTrailers(localStorage.getItem('search_hideTrailers') !== '0')
    setBlockNSFW(localStorage.getItem('search_blockNSFW') !== '0')
    setCustomVideo(getCustomVideoSource())
    setCustomLive(getCustomLiveSource())
    const m = getCustomMusicSource()
    setCustomMusicUrl(m.url)
    setCustomMusicToken(m.token)
    setCustomMusicUsername(m.username)
    setServerUrl(getBaseUrl())
    setServerUser(auth?.username || '')
  }, [auth])

  // 一次性保存所有自定义源
  const saveCustomSources = () => {
    setCustomVideoSource(customVideo)
    setCustomLiveSource(customLive)
    setCustomMusicSource(customMusicUrl, customMusicToken, customMusicUsername)
    // 视频 URL 可能变化,清掉源列表 / 中转页流解析 / 搜索详情内存缓存,
    // 防止旧源的源列表、share 映射、搜索结果串到新配置或与服务器模式混淆
    clearCustomVideoSitesCache()
    clearCustomStreamResolveCache()
    clearSearchCache()
    // 换源/切换模式:清空首页数据缓存与图片磁盘缓存,返回首页后重新拉取
    clearHomeCache()
    void clearImageCache()
    const parts: string[] = []
    if (customVideo.trim()) parts.push('视频')
    if (customLive.trim()) parts.push('直播')
    if (customMusicUrl.trim()) parts.push('音乐')
    toast.success(parts.length ? `已保存(${parts.join('/')}启用),首页将重新加载` : '已保存(全部禁用),首页将重新加载')
  }

  // 强制刷新视频源列表(清缓存重新拉取)
  const [refreshingSites, setRefreshingSites] = useState(false)
  const handleRefreshSites = async () => {
    if (!customVideo.trim()) {
      toast.error('请先填写视频点播源 URL')
      return
    }
    setCustomVideoSource(customVideo)
    setRefreshingSites(true)
    try {
      const n = await refreshCustomApiSites()
      if (n > 0) {
        clearHomeCache()
        void clearImageCache()
        toast.success(`源列表已刷新,共 ${n} 个源,首页将重新加载`)
      } else {
        toast.error('刷新失败,请检查 URL 或网络')
      }
    } catch {
      toast.error('刷新失败,请检查 URL 或网络')
    } finally {
      setRefreshingSites(false)
    }
  }

  const handleConnect = async () => {
    if (!serverUrl.trim()) {
      setServerMsg({ type: 'err', text: '请填写服务器地址' })
      return
    }
    setConnecting(true)
    setServerMsg(null)
    try {
      await login(serverUrl.trim(), serverUser.trim(), serverPass)
      setServerMsg({ type: 'ok', text: '已连接到服务器' })
      toast.success('已连接到服务器,首页将重新加载')
      setServerPass('')
    } catch (e: any) {
      const msg = e?.message || '连接失败'
      setServerMsg({ type: 'err', text: msg })
      toast.error(`连接失败:${msg}`)
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    await logout()
    setServerUrl('')
    setServerUser('')
    setServerPass('')
    setServerMsg({ type: 'ok', text: '已断开服务器连接' })
    toast.info('已断开服务器连接,首页将重新加载')
  }

  const toggleTrailers = () => {
    const v = !hideTrailers
    setHideTrailers(v)
    localStorage.setItem('search_hideTrailers', v ? '1' : '0')
    toast.success(v ? '已开启预告片过滤' : '已关闭预告片过滤')
  }

  const toggleNSFW = () => {
    const v = !blockNSFW
    setBlockNSFW(v)
    localStorage.setItem('search_blockNSFW', v ? '1' : '0')
    toast.success(v ? '已开启18禁内容过滤' : '已关闭18禁内容过滤')
  }

  return (
    <div className="p-8 max-w-2xl mx-auto animate-fadeIn">
      {/* 页面标题 */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-[var(--color-text-primary)] mb-1">设置</h2>
        <p className="text-sm text-[var(--color-text-tertiary)]">
          个性化你的观影体验
        </p>
      </div>

      {/* ============ 服务器配置 ============ */}
      <section className="mb-8">
        <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-tertiary)] mb-1 uppercase tracking-wider">
          <span className="section-bar" />
          服务器配置
        </h3>
        <p className="text-xs text-[var(--color-text-tertiary)] mb-4">
          连接到 moontvplus 服务器以使用观看历史、收藏、首页推荐等功能;留空字段并断开后,仅靠下方「自定义源」使用
        </p>
        <div
          className="space-y-4 p-5 rounded-lg"
          style={{
            background: 'var(--color-card-bg)',
            border: '1px solid var(--color-border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-[var(--color-text-primary)]">服务器地址</label>
              {serverConnected && (
                <span className="badge text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
                  已连接{serverConfig?.SiteName ? ` · ${serverConfig.SiteName}` : ''}
                </span>
              )}
            </div>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://your-server.example.com"
              spellCheck={false}
              className="input-field w-full text-xs"
              style={{ background: 'var(--color-bg-secondary)' }}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--color-text-primary)] block mb-2">用户名</label>
            <input
              type="text"
              value={serverUser}
              onChange={(e) => setServerUser(e.target.value)}
              placeholder="账号(可选,匿名服务器留空)"
              spellCheck={false}
              autoComplete="off"
              className="input-field w-full text-xs"
              style={{ background: 'var(--color-bg-secondary)' }}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--color-text-primary)] block mb-2">密码</label>
            <input
              type="password"
              value={serverPass}
              onChange={(e) => setServerPass(e.target.value)}
              placeholder="密码(留空表示不修改)"
              spellCheck={false}
              autoComplete="off"
              className="input-field w-full text-xs"
              style={{ background: 'var(--color-bg-secondary)' }}
            />
          </div>
          {serverMsg && (
            <p
              className={`text-xs ${serverMsg.type === 'ok' ? 'text-[var(--color-primary)]' : 'text-red-400'}`}
            >
              · {serverMsg.text}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="px-4 py-2 text-xs font-medium rounded-md text-white transition-colors disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))' }}
            >
              {connecting ? '连接中...' : serverConnected ? '重新连接' : '连接服务器'}
            </button>
            {serverConnected && (
              <button
                onClick={handleDisconnect}
                className="px-4 py-2 text-xs font-medium rounded-md border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-overlay)] transition-colors"
              >
                断开连接
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ============ 自定义源 ============ */}
      <section className="mb-8">
        <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-tertiary)] mb-1 uppercase tracking-wider">
          <span className="section-bar" />
          自定义源
        </h3>
        <p className="text-xs text-[var(--color-text-tertiary)] mb-4">
          填写以下任一源将脱离 moontvplus 服务器使用对应自定义源;留空则回退到服务器
        </p>
        <div
          className="space-y-5 p-5 rounded-lg"
          style={{
            background: 'var(--color-card-bg)',
            border: '1px solid var(--color-border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {/* 视频点播源 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                视频点播源
              </label>
              {customVideo.trim() && (
                <span
                  className="badge text-xs font-medium"
                  style={{ color: 'var(--color-primary)' }}
                >
                  已启用
                </span>
              )}
            </div>
            <input
              type="text"
              value={customVideo}
              onChange={(e) => setCustomVideo(e.target.value)}
              placeholder="https://pz.v88.qzz.io?format=0&source=full"
              spellCheck={false}
              className="input-field w-full text-xs"
              style={{ background: 'var(--color-bg-secondary)' }}
            />
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1.5">
              聚合 CMS 源列表 URL(返回 JSON,含 api_site 字段)。每个源按苹果 CMS API 直接调用
            </p>
          </div>

          {/* 直播源 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                直播源
              </label>
              {customLive.trim() && (
                <span
                  className="badge text-xs font-medium"
                  style={{ color: 'var(--color-primary)' }}
                >
                  已启用
                </span>
              )}
            </div>
            <input
              type="text"
              value={customLive}
              onChange={(e) => setCustomLive(e.target.value)}
              placeholder="http://192.168.2.253:5000/iptv"
              spellCheck={false}
              className="input-field w-full text-xs"
              style={{ background: 'var(--color-bg-secondary)' }}
            />
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1.5">
              标准 M3U 播放列表 URL(#EXTM3U 格式),客户端直接解析并播放
            </p>
          </div>

          {/* 音乐源 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                音乐源
              </label>
              {customMusicUrl.trim() && (
                <span
                  className="badge text-xs font-medium"
                  style={{ color: 'var(--color-primary)' }}
                >
                  已启用
                </span>
              )}
            </div>
            <input
              type="text"
              value={customMusicUrl}
              onChange={(e) => setCustomMusicUrl(e.target.value)}
              placeholder="http://192.168.2.253:9527"
              spellCheck={false}
              className="input-field w-full text-xs"
              style={{ background: 'var(--color-bg-secondary)' }}
            />
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1.5">
              LX Music Web (lxserver) 地址,搜索与播放均走自定义源
            </p>
          </div>

          {/* 音乐源 Token */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                音乐源 Token
              </label>
            </div>
            <input
              type="password"
              value={customMusicToken}
              onChange={(e) => setCustomMusicToken(e.target.value)}
              placeholder="留空则按匿名访问处理"
              spellCheck={false}
              className="input-field w-full text-xs"
              style={{ background: 'var(--color-bg-secondary)' }}
            />
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1.5">
              推荐 lxserver 持久 Token(x-user-token),避免触发频控;匿名访问仅用于只读场景
            </p>
          </div>

          {/* 音乐源用户名 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                音乐源用户名(可选)
              </label>
            </div>
            <input
              type="text"
              value={customMusicUsername}
              onChange={(e) => setCustomMusicUsername(e.target.value)}
              placeholder="配合 Token 使用(x-user-name),匿名可留空"
              spellCheck={false}
              className="input-field w-full text-xs"
              style={{ background: 'var(--color-bg-secondary)' }}
            />
          </div>

          {/* 保存/刷新按钮 */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={saveCustomSources}
              className="px-4 py-2 text-xs font-medium rounded-md text-white transition-colors"
              style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))' }}
            >
              保存自定义源
            </button>
            <button
              onClick={handleRefreshSites}
              disabled={refreshingSites}
              className="px-4 py-2 text-xs font-medium rounded-md border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-overlay)] transition-colors disabled:opacity-60"
            >
              {refreshingSites ? '刷新中...' : '刷新视频源列表'}
            </button>
          </div>
          <p className="text-xs text-[var(--color-text-tertiary)]">
            视频源列表保存后本地持久缓存,重启不再重新拉取;修改 URL 或点「刷新」才更新
          </p>
        </div>
      </section>

      {/* ============ 视频过滤 ============ */}
      <section className="mb-8">
        <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-tertiary)] mb-4 uppercase tracking-wider">
          <span className="section-bar" />
          视频过滤
        </h3>
        <div
          className="space-y-0 rounded-lg"
          style={{
            background: 'var(--color-card-bg)',
            border: '1px solid var(--color-border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {/* 过滤预告片 */}
          <div className="flex items-center justify-between p-5 hover:bg-[var(--color-hover-overlay-subtle)] transition-colors">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--color-text-primary)]">过滤预告片</p>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                隐藏搜索结果中的预告片、花絮、彩蛋
              </p>
            </div>
            <button
              onClick={toggleTrailers}
              className="flex items-center gap-2 transition-colors flex-shrink-0 ml-4"
              title={hideTrailers ? '已开启' : '已关闭'}
            >
              <span className={`toggle ${hideTrailers ? 'toggle-on' : 'toggle-off'}`}>
                <span className={`toggle-knob ${hideTrailers ? 'toggle-knob-on' : 'toggle-knob-off'}`} />
              </span>
            </button>
          </div>

          <div className="border-t border-[var(--color-border-subtle)]" />

          {/* 18禁过滤 */}
          <div className="flex items-center justify-between p-5 hover:bg-[var(--color-hover-overlay-subtle)] transition-colors">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--color-text-primary)]">18禁内容过滤</p>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                隐藏成人内容、伦理片等不适宜内容
              </p>
            </div>
            <button
              onClick={toggleNSFW}
              className="flex items-center gap-2 transition-colors flex-shrink-0 ml-4"
              title={blockNSFW ? '已开启' : '已关闭'}
            >
              <span className={`toggle ${blockNSFW ? 'toggle-on-red' : 'toggle-off'}`}>
                <span className={`toggle-knob ${blockNSFW ? 'toggle-knob-on' : 'toggle-knob-off'}`} />
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* ============ 关于 ============ */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-tertiary)] mb-4 uppercase tracking-wider">
          <span className="section-bar" />
          关于
        </h3>
        <div
          className="p-6 rounded-lg"
          style={{
            background: 'var(--color-card-bg)',
            border: '1px solid var(--color-border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {/* 应用图标 + 名称 */}
          <div className="flex items-center gap-4 pb-5 mb-5 border-b border-[var(--color-border-subtle)]">
            <div
              className="flex items-center justify-center w-14 h-14 text-3xl flex-shrink-0 animate-pulse-glow rounded-lg"
              style={{
                background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
                boxShadow: '0 4px 20px var(--color-glow-primary)',
              }}
            >
              🎬
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-base font-bold text-[var(--color-text-primary)]">MoonTVPlus</p>
                <span
                  className="badge text-xs font-medium"
                  style={{ color: 'var(--color-primary)' }}
                >
                  v1.1.0
                </span>
              </div>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                一站式聚合影视搜索与播放
              </p>
            </div>
          </div>

          {/* 详细信息 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-tertiary)]">播放引擎</span>
              <span className="text-sm text-[var(--color-text-secondary)]">HLS.js + Artplayer</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-tertiary)]">运行环境</span>
              <span className="text-sm text-[var(--color-text-secondary)]">Electron Desktop</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-tertiary)]">数据存储</span>
              <span className="text-sm text-[var(--color-text-secondary)]">本地 + 云端同步</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
