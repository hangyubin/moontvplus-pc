/**
 * 直播源管理面板 — URL/本地文件导入、启用开关、有效性检测、删除
 */
import { useEffect, useRef, useState } from 'react'
import Icon from '../../components/Icon'
import { toast } from '../../components/Toast'
import {
  getManagedLiveSources,
  addLiveSourceFromUrl,
  addLiveSourceFromLocal,
  removeLiveSource,
  updateLiveSource,
  parseLiveSource,
  checkSourceHealth,
  readFileAsText,
  isSupportedLiveFile,
  type ManagedLiveSource,
  type SourceHealthReport
} from '../../lib/liveSourceManager'

export interface LiveSourceManagerPanelProps {
  onClose: () => void
  onSourcesChanged: () => void
}

export default function LiveSourceManagerPanel({ onClose, onSourcesChanged }: LiveSourceManagerPanelProps) {
  const [sources, setSources] = useState<ManagedLiveSource[]>([])
  const [importType, setImportType] = useState<'url' | 'local'>('url')
  const [importUrl, setImportUrl] = useState('')
  const [importName, setImportName] = useState('')
  const [importing, setImporting] = useState(false)
  const [healthReport, setHealthReport] = useState<Record<string, SourceHealthReport>>({})
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 加载源列表
  useEffect(() => {
    setSources(getManagedLiveSources())
  }, [])

  const handleAddUrl = async () => {
    if (!importUrl.trim()) return
    setImporting(true)
    try {
      const src = addLiveSourceFromUrl(importName || '未命名', importUrl)
      await parseLiveSource(src.id)
      setSources(getManagedLiveSources())
      setImportUrl('')
      setImportName('')
      toast.success('添加成功')
      onSourcesChanged()
    } catch (e: any) {
      toast.error(e?.message || '添加失败')
    } finally {
      setImporting(false)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!isSupportedLiveFile(file.name)) {
      toast.error('仅支持 .m3u / .m3u8 / .txt 文件')
      return
    }
    setImporting(true)
    try {
      const content = await readFileAsText(file)
      const src = addLiveSourceFromLocal(importName || file.name.replace(/\.[^.]+$/, ''), content)
      await parseLiveSource(src.id)
      setSources(getManagedLiveSources())
      setImportName('')
      toast.success('导入成功')
      onSourcesChanged()
    } catch (e: any) {
      toast.error(e?.message || '导入失败')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRemove = (id: string) => {
    removeLiveSource(id)
    setSources(getManagedLiveSources())
    toast.info('已删除')
    onSourcesChanged()
  }

  const handleToggle = (id: string, enabled: boolean) => {
    updateLiveSource(id, { enabled })
    setSources(getManagedLiveSources())
    onSourcesChanged()
  }

  const handleCheckHealth = async (id: string) => {
    setCheckingId(id)
    try {
      const report = await checkSourceHealth(id, 20, () => {})
      setHealthReport((prev) => ({ ...prev, [id]: report }))
      toast.success(`检测完成: ${report.okCount}/${report.totalUrls} 可用`)
    } catch (e: any) {
      toast.error(e?.message || '检测失败')
    } finally {
      setCheckingId(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[520px] max-h-[80vh] bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <h3 className="text-sm font-medium text-white">直播源管理</h3>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 rounded transition-all">
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* 导入区域 */}
        <div className="px-4 py-3 border-b border-white/[0.06] space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => setImportType('url')}
              className={`flex-1 py-1.5 text-xs rounded transition-all ${importType === 'url' ? 'bg-primary text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
            >
              URL 导入
            </button>
            <button
              onClick={() => setImportType('local')}
              className={`flex-1 py-1.5 text-xs rounded transition-all ${importType === 'local' ? 'bg-primary text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
            >
              本地文件
            </button>
          </div>

          <input
            type="text"
            value={importName}
            onChange={(e) => setImportName(e.target.value)}
            placeholder="源名称(可选)"
            className="w-full px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded text-white placeholder-white/30 focus:outline-none focus:border-primary/50"
          />

          {importType === 'url' ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://example.com/live.m3u"
                className="flex-1 px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded text-white placeholder-white/30 focus:outline-none focus:border-primary/50"
              />
              <button
                onClick={handleAddUrl}
                disabled={importing || !importUrl.trim()}
                className="px-3 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? '导入中' : '添加'}
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".m3u,.m3u8,.txt"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="flex-1 px-3 py-2 text-xs bg-white/5 border border-dashed border-white/20 rounded text-white/60 hover:bg-white/10 hover:text-white transition-all disabled:opacity-50"
              >
                {importing ? '导入中...' : '选择 .m3u / .txt 文件'}
              </button>
            </div>
          )}
        </div>

        {/* 源列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {sources.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/30">
              <Icon name="tv" size={48} strokeWidth={1} className="mb-3" />
              <p className="text-sm">暂无直播源</p>
              <p className="text-xs mt-1">点击上方导入按钮添加</p>
            </div>
          ) : (
            sources.map((src) => (
              <div
                key={src.id}
                className="flex items-center gap-3 p-3 bg-white/[0.03] border border-white/[0.06] rounded-lg hover:bg-white/[0.05] transition-all"
              >
                {/* 启用开关 */}
                <button
                  onClick={() => handleToggle(src.id, !src.enabled)}
                  className={`w-9 h-5 rounded-full transition-all relative flex-shrink-0 ${src.enabled ? 'bg-primary' : 'bg-white/10'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${src.enabled ? 'left-4.5' : 'left-0.5'}`} style={{ left: src.enabled ? '18px' : '2px' }} />
                </button>

                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{src.name}</p>
                  <p className="text-xs text-white/30 truncate mt-0.5">
                    {src.type === 'url' ? src.url : '本地文件'}
                    {src.channelCount !== undefined && ` · ${src.channelCount} 个频道`}
                  </p>
                  {healthReport[src.id] && (
                    <p className="text-xs mt-1">
                      <span className="text-green-400">{healthReport[src.id].okCount} 可用</span>
                      <span className="text-white/20 mx-1">/</span>
                      <span className="text-red-400">{healthReport[src.id].failCount} 失效</span>
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleCheckHealth(src.id)}
                    disabled={checkingId === src.id}
                    className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded transition-all disabled:opacity-50"
                    title="检测有效性"
                  >
                    {checkingId === src.id ? (
                      <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                    ) : (
                      <Icon name="check-circle" size={16} />
                    )}
                  </button>
                  <button
                    onClick={() => handleRemove(src.id)}
                    className="p-1.5 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
                    title="删除"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 底部提示 */}
        <div className="px-4 py-2 border-t border-white/[0.06] text-xs text-white/25">
          支持 M3U/M3U8 播放列表和 TXT 格式(每行一个"频道名,URL")
        </div>
      </div>
    </div>
  )
}
