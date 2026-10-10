/**
 * 设置页面
 * - 侧边栏导航 + 右侧内容区(各区块始终展开)
 * - 服务器配置 / 自定义源(视频+音乐) / 直播源(多源管理) / 视频过滤 / 关于
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import type { ReactNode, CSSProperties, ChangeEvent } from 'react'
import { version as APP_VERSION } from '../../../../package.json'
import {
  getCustomVideoSource,
  setCustomVideoSource,
  getCustomLiveEpg,
  setCustomLiveEpg,
  getCustomMusicSource,
  setCustomMusicSource,
} from '../lib/customSource'
import {
  getManagedLiveSources,
  addLiveSourceFromUrl,
  addLiveSourceFromLocal,
  updateLiveSource,
  removeLiveSource,
  parseLiveSource,
  readFileAsText,
  type ManagedLiveSource,
} from '../lib/liveSourceManager'
import { clearLiveEpgCache } from '../lib/live'
import { useStore } from '../lib/store'
import { getBaseUrl } from '../lib/auth'
import { clearCustomVideoSitesCache, clearCustomStreamResolveCache, refreshCustomApiSites } from '../lib/api'
import { clearSearchCache } from '../lib/searchCache'
import { clearHomeCache } from '../lib/homeCache'
import { clearImageCache } from '../lib/image'
import { toast } from '../components/Toast'
import Icon from '../components/Icon'

/** 卡片容器样式(统一背景/边框/阴影) */
const cardStyle: CSSProperties = {
  background: 'var(--color-card-bg)',
  border: '1px solid var(--color-border-subtle)',
  boxShadow: 'var(--shadow-card)',
}

/** 侧边栏导航配置 */
const SECTIONS = [
  { id: 'server', label: '服务器配置', icon: 'settings' as const },
  { id: 'custom', label: '自定义源', icon: 'list-plus' as const },
  { id: 'live', label: '直播源', icon: 'tv' as const },
  { id: 'filter', label: '视频过滤', icon: 'film' as const },
  { id: 'about', label: '关于', icon: 'info' as const },
]

/**
 * 表单字段容器:标签行(可带右侧状态 badge)+ 输入控件 + 说明文字
 */
function FormField({
  label,
  status,
  hint,
  children,
}: {
  label: ReactNode
  status?: ReactNode
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-[var(--color-text-primary)]">{label}</label>
        {status && (
          <span className="badge text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
            {status}
          </span>
        )}
      </div>
      {children}
      {hint && <p className="text-xs text-[var(--color-text-tertiary)] mt-1.5">{hint}</p>}
    </div>
  )
}

/** 区块标题:图标 + 标题文字 + section-bar 视觉标识 */
function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="section-bar" />
      <span className="text-[var(--color-text-primary)]">{icon}</span>
      <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{children}</h3>
    </div>
  )
}

export default function Settings() {
  const { auth, serverConfig, login, logout } = useStore()
  const [hideTrailers, setHideTrailers] = useState(true)
  const [blockNSFW, setBlockNSFW] = useState(true)
  const [blockSports, setBlockSports] = useState(true)
  const [customVideo, setCustomVideo] = useState('')
  const [customLiveEpg, setCustomLiveEpgInput] = useState('')
  // 直播源多源管理
  const [managedSources, setManagedSources] = useState<ManagedLiveSource[]>([])
  const [newSrcName, setNewSrcName] = useState('')
  const [newSrcUrl, setNewSrcUrl] = useState('')
  const [parsingId, setParsingId] = useState<string | null>(null)
  const liveFileRef = useRef<HTMLInputElement>(null)
  const [customMusicUrl, setCustomMusicUrl] = useState('')
  const [customMusicToken, setCustomMusicToken] = useState('')
  const [customMusicUsername, setCustomMusicUsername] = useState('')

  // 服务器配置(本地输入框状态,与 store 同步初始化)
  const [serverUrl, setServerUrl] = useState('')
  const [serverUser, setServerUser] = useState('')
  const [serverPass, setServerPass] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [serverMsg, setServerMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // 侧边栏当前激活段
  const [activeSection, setActiveSection] = useState('server')
  const contentRef = useRef<HTMLDivElement>(null)

  const serverConnected = !!auth?.username

  useEffect(() => {
    try { setHideTrailers(localStorage.getItem('search_hideTrailers') !== '0') } catch { /* ignore */ }
    try { setBlockNSFW(localStorage.getItem('search_blockNSFW') !== '0') } catch { /* ignore */ }
    try { setBlockSports(localStorage.getItem('search_blockSports') !== '0') } catch { /* ignore */ }
    setCustomVideo(getCustomVideoSource())
    setCustomLiveEpgInput(getCustomLiveEpg())
    setManagedSources(getManagedLiveSources())
    const m = getCustomMusicSource()
    setCustomMusicUrl(m.url)
    setCustomMusicToken(m.token)
    setCustomMusicUsername(m.username)
    setServerUrl(getBaseUrl())
    setServerUser(auth?.username || '')
  }, [auth])

  // IntersectionObserver:滚动时自动高亮侧边栏对应段
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // 取交叉比最大的段作为激活段
        let maxRatio = 0
        let activeId = activeSection
        for (const entry of entries) {
          if (entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio
            activeId = entry.target.id
          }
        }
        if (maxRatio > 0) setActiveSection(activeId)
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.25, 0.5, 1] }
    )
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])

  // 点击侧边栏:平滑滚动到对应区块
  const handleNavClick = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // 一次性保存所有自定义源
  const saveCustomSources = () => {
    setCustomVideoSource(customVideo)
    setCustomMusicSource(customMusicUrl, customMusicToken, customMusicUsername)
    clearLiveEpgCache()
    clearCustomVideoSitesCache()
    clearCustomStreamResolveCache()
    clearSearchCache()
    clearHomeCache()
    void clearImageCache()
    const parts: string[] = []
    if (customVideo.trim()) parts.push('视频')
    if (customMusicUrl.trim()) parts.push('音乐')
    toast.success(parts.length ? `已保存(${parts.join('/')}启用),首页将重新加载` : '已保存(全部禁用),首页将重新加载')
  }

  /* ============ 直播源多源管理 ============ */

  const reloadManagedSources = useCallback(() => {
    setManagedSources(getManagedLiveSources())
  }, [])

  /** 解析单个源(更新频道数,添加后自动调用) */
  const parseSource = useCallback(async (id: string) => {
    setParsingId(id)
    try {
      const r = await parseLiveSource(id)
      reloadManagedSources()
      toast.success(`解析完成,共 ${r.totalChannels} 个频道`)
    } catch (e: any) {
      reloadManagedSources()
      toast.error(`解析失败:${e?.message || '未知错误'}`)
    } finally {
      setParsingId(null)
    }
  }, [reloadManagedSources])

  /** 添加 URL 直播源 */
  const handleAddSource = () => {
    if (!newSrcUrl.trim()) {
      toast.error('请填写直播源 URL')
      return
    }
    let src: ManagedLiveSource
    try {
      src = addLiveSourceFromUrl(newSrcName, newSrcUrl)
    } catch (e: any) {
      toast.error(e?.message || '添加失败')
      return
    }
    setNewSrcName('')
    setNewSrcUrl('')
    reloadManagedSources()
    void parseSource(src.id)
  }

  /** 导入本地 M3U/TXT 文件 */
  const handleLocalImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await readFileAsText(file)
      const src = addLiveSourceFromLocal(file.name.replace(/\.(m3u8?|txt)$/i, ''), text)
      reloadManagedSources()
      toast.success(`本地源「${src.name}」已添加`)
      void parseSource(src.id)
    } catch (err: any) {
      toast.error(err?.message || '导入失败')
    }
    e.target.value = ''
  }

  /** 启用/停用直播源 */
  const handleToggleSource = (src: ManagedLiveSource) => {
    updateLiveSource(src.id, { enabled: !src.enabled })
    reloadManagedSources()
  }

  /** 删除直播源 */
  const handleRemoveSource = (src: ManagedLiveSource) => {
    removeLiveSource(src.id)
    reloadManagedSources()
    toast.success(`已删除「${src.name}」`)
  }

  /** 保存直播源区块设置(EPG 节目单;源列表的添加/删除/启停实时生效,无需保存) */
  const handleSaveLiveSettings = () => {
    const changed = customLiveEpg !== getCustomLiveEpg()
    if (changed) {
      setCustomLiveEpg(customLiveEpg)
      clearLiveEpgCache()
    }
    toast.success(changed ? '直播源设置已保存,EPG 已更新' : '直播源设置已保存')
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
    try { localStorage.setItem('search_hideTrailers', v ? '1' : '0') } catch { /* ignore */ }
    toast.success(v ? '已开启预告片过滤' : '已关闭预告片过滤')
  }

  const toggleNSFW = () => {
    const v = !blockNSFW
    setBlockNSFW(v)
    try { localStorage.setItem('search_blockNSFW', v ? '1' : '0') } catch { /* ignore */ }
    toast.success(v ? '已开启18禁内容过滤' : '已关闭18禁内容过滤')
  }

  const toggleSports = () => {
    const v = !blockSports
    setBlockSports(v)
    try { localStorage.setItem('search_blockSports', v ? '1' : '0') } catch { /* ignore */ }
    toast.success(v ? '已开启体育内容过滤' : '已关闭体育内容过滤')
  }

  return (
    <div className="p-6 max-w-4xl mx-auto animate-fadeIn">
      {/* 页面标题 */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-[var(--color-text-primary)] mb-1">设置</h2>
        <p className="text-sm text-[var(--color-text-tertiary)]">
          个性化你的观影体验
        </p>
      </div>

      {/* 侧边栏 + 内容区 */}
      <div className="flex gap-6">
        {/* ---- 左侧导航 ---- */}
        <nav className="w-44 flex-shrink-0 sticky top-6 self-start">
          <div className="space-y-1" style={cardStyle} >
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => handleNavClick(s.id)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm cursor-pointer transition-colors w-full text-left ${
                  activeSection === s.id
                    ? 'text-[var(--color-primary)] bg-[var(--color-hover-overlay)] font-medium'
                    : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover-overlay-subtle)]'
                }`}
              >
                <Icon name={s.icon} size={16} />
                {s.label}
              </button>
            ))}
          </div>
        </nav>

        {/* ---- 右侧内容 ---- */}
        <div ref={contentRef} className="flex-1 min-w-0 space-y-8">

          {/* ============ 服务器配置 ============ */}
          <section id="server" className="scroll-mt-6">
            <SectionTitle icon={<Icon name="settings" size={18} />}>服务器配置</SectionTitle>
            <p className="text-xs text-[var(--color-text-tertiary)] mb-4">
              连接到 moontvplus 服务器以使用观看历史、收藏、首页推荐等功能;留空字段并断开后,仅靠下方「自定义源」使用
            </p>
            <div className="space-y-5 p-5 rounded-lg" style={cardStyle}>
              <FormField
                label="服务器地址"
                status={
                  serverConnected
                    ? `已连接${serverConfig?.SiteName ? ` · ${serverConfig.SiteName}` : ''}`
                    : undefined
                }
              >
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="https://your-server.example.com"
                  spellCheck={false}
                  className="input-field w-full"
                />
              </FormField>
              <FormField label="用户名">
                <input
                  type="text"
                  value={serverUser}
                  onChange={(e) => setServerUser(e.target.value)}
                  placeholder="账号(可选,匿名服务器留空)"
                  spellCheck={false}
                  autoComplete="off"
                  className="input-field w-full"
                />
              </FormField>
              <FormField label="密码">
                <input
                  type="password"
                  value={serverPass}
                  onChange={(e) => setServerPass(e.target.value)}
                  placeholder="密码(留空表示不修改)"
                  spellCheck={false}
                  autoComplete="off"
                  className="input-field w-full"
                />
              </FormField>
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
                  className="px-4 py-2 text-sm font-medium rounded-md text-white transition-colors disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))' }}
                >
                  {connecting ? '连接中...' : serverConnected ? '重新连接' : '连接服务器'}
                </button>
                {serverConnected && (
                  <button
                    onClick={handleDisconnect}
                    className="px-4 py-2 text-sm font-medium rounded-md border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-overlay)] transition-colors"
                  >
                    断开连接
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* ============ 自定义源 ============ */}
          <section id="custom" className="scroll-mt-6">
            <SectionTitle icon={<Icon name="list-plus" size={18} />}>自定义源</SectionTitle>
            <p className="text-xs text-[var(--color-text-tertiary)] mb-4">
              填写以下源将脱离 moontvplus 服务器使用对应自定义源;留空则回退到服务器。直播源请在下方「直播源」区块管理
            </p>
            <div className="space-y-5 p-5 rounded-lg" style={cardStyle}>
              {/* 视频点播源 */}
              <FormField
                label="视频点播源"
                status={customVideo.trim() ? '已启用' : undefined}
                hint="聚合 CMS 源列表 URL(返回 JSON,含 api_site 字段)。每个源按苹果 CMS API 直接调用"
              >
                <input
                  type="text"
                  value={customVideo}
                  onChange={(e) => setCustomVideo(e.target.value)}
                  placeholder="https://pz.v88.qzz.io?format=0&source=full"
                  spellCheck={false}
                  className="input-field w-full"
                />
              </FormField>

              {/* 音乐源 */}
              <FormField
                label="音乐源"
                status={customMusicUrl.trim() ? '已启用' : undefined}
                hint="LX Music Web (lxserver) 地址,搜索与播放均走自定义源"
              >
                <input
                  type="text"
                  value={customMusicUrl}
                  onChange={(e) => setCustomMusicUrl(e.target.value)}
                  placeholder="http://192.168.2.253:9527"
                  spellCheck={false}
                  className="input-field w-full"
                />
              </FormField>

              {/* 音乐源 Token */}
              <FormField
                label="音乐源 Token"
                hint="填 lxserver 持久 API Token 或网页登录密码(密码需配合下方用户名,首次请求自动登录换会话)"
              >
                <input
                  type="password"
                  value={customMusicToken}
                  onChange={(e) => setCustomMusicToken(e.target.value)}
                  placeholder="留空则按匿名访问处理"
                  spellCheck={false}
                  className="input-field w-full"
                />
              </FormField>

              {/* 音乐源用户名 */}
              <FormField label="音乐源用户名">
                <input
                  type="text"
                  value={customMusicUsername}
                  onChange={(e) => setCustomMusicUsername(e.target.value)}
                  placeholder="音源脚本挂在具名用户下时必填(如 admin)"
                  spellCheck={false}
                  className="input-field w-full"
                />
              </FormField>

              {/* 保存/刷新按钮 */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={saveCustomSources}
                  className="px-4 py-2 text-sm font-medium rounded-md text-white transition-colors"
                  style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))' }}
                >
                  保存自定义源
                </button>
                <button
                  onClick={handleRefreshSites}
                  disabled={refreshingSites}
                  className="px-4 py-2 text-sm font-medium rounded-md border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-overlay)] transition-colors disabled:opacity-60"
                >
                  {refreshingSites ? '刷新中...' : '刷新视频源列表'}
                </button>
              </div>
              <p className="text-xs text-[var(--color-text-tertiary)]">
                视频源列表保存后本地持久缓存,重启不再重新拉取;修改 URL 或点「刷新」才更新
              </p>
            </div>
          </section>

          {/* ============ 直播源 ============ */}
          <section id="live" className="scroll-mt-6">
            <SectionTitle icon={<Icon name="tv" size={18} />}>直播源</SectionTitle>
            <p className="text-xs text-[var(--color-text-tertiary)] mb-4">
              支持添加多个直播源,可分别启用/停用;启用中的源都会出现在直播页源列表
            </p>
            <div className="space-y-4 p-5 rounded-lg" style={cardStyle}>
              {/* 已添加的源列表 */}
              {managedSources.length === 0 && (
                <p className="text-xs text-[var(--color-text-tertiary)] py-3 text-center">
                  暂无直播源,请在下方添加 URL 或导入本地文件
                </p>
              )}
              {managedSources.map((src) => (
                <div
                  key={src.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-md border border-[var(--color-border-subtle)] hover:bg-[var(--color-hover-overlay-subtle)] transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                        {src.name}
                      </p>
                      {src.type === 'local' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-hover-overlay)] text-[var(--color-text-tertiary)] flex-shrink-0">
                          本地
                        </span>
                      )}
                      {!src.enabled && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-hover-overlay)] text-[var(--color-text-tertiary)] flex-shrink-0">
                          已停用
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 truncate">
                      {src.type === 'url' ? src.url : '本地文件导入'}
                      {src.channelCount != null && ` · ${src.channelCount} 个频道`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => void parseSource(src.id)}
                      disabled={parsingId === src.id}
                      className="text-xs px-2 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-overlay)] transition-colors disabled:opacity-60"
                      title="重新解析频道列表"
                    >
                      {parsingId === src.id ? '解析中...' : '解析'}
                    </button>
                    <button
                      onClick={() => handleToggleSource(src)}
                      className="p-2 transition-colors"
                      title={src.enabled ? '点击停用' : '点击启用'}
                    >
                      <span className={`toggle ${src.enabled ? 'toggle-on' : 'toggle-off'}`}>
                        <span className={`toggle-knob ${src.enabled ? 'toggle-knob-on' : 'toggle-knob-off'}`} />
                      </span>
                    </button>
                    <button
                      onClick={() => handleRemoveSource(src)}
                      className="p-1.5 rounded-md text-[var(--color-text-tertiary)] hover:text-red-400 hover:bg-[var(--color-hover-overlay)] transition-colors"
                      title="删除该直播源"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </div>
              ))}

              {/* 添加表单:第一行 URL+添加(主操作) */}
              <div className="flex items-stretch gap-2 pt-1">
                <input
                  type="text"
                  value={newSrcUrl}
                  onChange={(e) => setNewSrcUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddSource() }}
                  placeholder="M3U 直播源 URL(http:// 或 https://)"
                  spellCheck={false}
                  className="input-field flex-1 min-w-0"
                />
                <button
                  onClick={handleAddSource}
                  className="px-5 text-sm font-medium rounded-lg text-white transition-colors flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))' }}
                >
                  添加
                </button>
              </div>

              {/* 第二行:名称 + 本地导入(次要操作) */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newSrcName}
                  onChange={(e) => setNewSrcName(e.target.value)}
                  placeholder="名称(选填,默认取域名)"
                  title="直播源显示名称,显示在直播页的源列表中;留空自动取 URL 域名"
                  spellCheck={false}
                  className="input-field flex-1 min-w-0"
                />
                <button
                  onClick={() => liveFileRef.current?.click()}
                  className="text-xs px-3 py-2 rounded-lg border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-overlay)] transition-colors flex-shrink-0"
                >
                  导入本地文件
                </button>
                <span className="text-xs text-[var(--color-text-tertiary)] truncate">
                  支持导入本地 .m3u/.m3u8/.txt 直播源文件
                </span>
                <input
                  ref={liveFileRef}
                  type="file"
                  accept=".m3u,.m3u8,.txt"
                  className="hidden"
                  onChange={(e) => void handleLocalImport(e)}
                />
              </div>

              <div className="border-t border-[var(--color-border-subtle)]" />

              {/* XMLTV EPG 节目单(失焦自动保存) */}
              <FormField
                label="XMLTV EPG 节目单"
                status={customLiveEpg.trim() ? '已配置' : undefined}
                hint="XMLTV 格式(.xml/.xml.gz)的节目单地址,用于显示频道当前/下一节目;留空时自动使用 M3U 头部 x-tvg-url"
              >
                <input
                  type="text"
                  value={customLiveEpg}
                  onChange={(e) => setCustomLiveEpgInput(e.target.value)}
                  placeholder="http://example.com/epg.xml(可留空,自动读取 M3U 中的 x-tvg-url)"
                  spellCheck={false}
                  className="input-field w-full"
                />
              </FormField>

              {/* 保存按钮 */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSaveLiveSettings}
                  className="px-4 py-2 text-sm font-medium rounded-md text-white transition-colors"
                  style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))' }}
                >
                  保存
                </button>
                <span className="text-xs text-[var(--color-text-tertiary)] self-center">
                  源列表的添加/删除/启停实时生效;EPG 节目单修改后需点保存
                </span>
              </div>
            </div>
          </section>

          {/* ============ 视频过滤 ============ */}
          <section id="filter" className="scroll-mt-6">
            <SectionTitle icon={<Icon name="film" size={18} />}>视频过滤</SectionTitle>
            <div className="rounded-lg" style={cardStyle}>
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

              <div className="border-t border-[var(--color-border-subtle)]" />

              {/* 体育内容过滤 */}
              <div className="flex items-center justify-between p-5 hover:bg-[var(--color-hover-overlay-subtle)] transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">体育内容过滤</p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                    隐藏体育赛事、解说、电竞等非影视内容
                  </p>
                </div>
                <button
                  onClick={toggleSports}
                  className="flex items-center gap-2 transition-colors flex-shrink-0 ml-4"
                  title={blockSports ? '已开启' : '已关闭'}
                >
                  <span className={`toggle ${blockSports ? 'toggle-on' : 'toggle-off'}`}>
                    <span className={`toggle-knob ${blockSports ? 'toggle-knob-on' : 'toggle-knob-off'}`} />
                  </span>
                </button>
              </div>
            </div>
          </section>

          {/* ============ 关于 ============ */}
          <section id="about" className="scroll-mt-6">
            <SectionTitle icon={<Icon name="info" size={18} />}>关于</SectionTitle>
            <div className="p-6 rounded-lg" style={cardStyle}>
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
                      v{APP_VERSION}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                    一站式聚合影视搜索与播放
                  </p>
                </div>
              </div>

              {/* 详细信息 */}
              <div className="space-y-3.5">
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
      </div>
    </div>
  )
}
