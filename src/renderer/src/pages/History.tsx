/**
 * 观看历史页
 * 单区块布局:全部记录即「继续观看」,横向大卡,按最近播放倒序
 * 支持继续观看、单条删除、清空全部、本地搜索;同一影片只保留最近一条
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, sortedPlayRecords } from '../lib/store'
import { formatRelativeTime, buildPlayUrl, calcProgress } from '../lib/utils'
import Icon from '../components/Icon'
import MediaCard from '../components/MediaCard'
import { parseStorageKey } from '../types'
import type { PlayRecord } from '../types'

/** 标题归一化:去所有空白、转小写,作为去重/搜索键 */
function normalizeTitle(title?: string): string {
  return (title ?? '').replace(/\s+/g, '').toLowerCase()
}

/** 集数文案:多集显示"第X集/共Y集",单集显示"电影" */
function getEpisodeText(record: PlayRecord): string {
  return record.total_episodes > 1
    ? `第${record.index}集/共${record.total_episodes}集`
    : '电影'
}

export default function History() {
  const navigate = useNavigate()
  const { playRecords, removePlayRecord, clearPlayRecords } = useStore()

  const [keyword, setKeyword] = useState('')
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [clearing, setClearing] = useState(false)

  /** 按 save_time 倒序,按归一化标题去重(不同源同一影片只留最近一条) */
  const records = useMemo(() => {
    const seen = new Set<string>()
    const result: Array<[string, PlayRecord]> = []
    for (const entry of sortedPlayRecords(playRecords)) {
      const key = normalizeTitle(entry[1].title)
      if (!key) {
        result.push(entry)
        continue
      }
      if (seen.has(key)) continue
      seen.add(key)
      result.push(entry)
    }
    return result
  }, [playRecords])

  /** 本地搜索:直接过滤同一列表 */
  const visibleRecords = useMemo(() => {
    const kw = normalizeTitle(keyword)
    if (!kw) return records
    return records.filter(([, r]) => normalizeTitle(r.title).includes(kw))
  }, [records, keyword])

  /** 点击卡片继续观看(index 转 0 基) */
  const handleClick = (key: string, record: PlayRecord) => {
    const { source, id } = parseStorageKey(key)
    navigate(buildPlayUrl(source, id, record.title, record.index - 1))
  }

  const handleDelete = async (e: React.MouseEvent, key: string) => {
    e.stopPropagation()
    await removePlayRecord(key)
  }

  const handleConfirmClear = async () => {
    setClearing(true)
    try {
      await clearPlayRecords()
    } catch (e) {
      console.error('清空观看记录失败', e)
    } finally {
      setClearing(false)
      setShowClearDialog(false)
    }
  }

  /* ============ 空状态 ============ */
  if (records.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-[var(--color-text-tertiary)] px-6 animate-fadeIn">
        <div
          className="flex items-center justify-center w-32 h-32 mb-6 text-6xl animate-pulse-glow rounded-lg"
          style={{
            background: 'linear-gradient(135deg, var(--color-hover-overlay) 0%, var(--color-hover-overlay-subtle) 100%)',
            border: '1px solid var(--color-border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          📺
        </div>
        <p className="text-xl font-bold text-[var(--color-text-primary)] mb-2">暂无观看记录</p>
        <p className="text-sm text-[var(--color-text-tertiary)] text-center max-w-sm leading-relaxed">
          去搜索一部影视开始观看吧,观看记录会显示在这里
        </p>
        <button onClick={() => navigate('/')} className="btn-primary mt-8">
          去发现影视
        </button>
      </div>
    )
  }

  return (
    <div className="p-6 animate-fadeIn">
      {/* ============ 页头 ============ */}
      <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
        <div className="flex-shrink-0">
          <h2 className="flex items-center gap-2 text-xl font-bold text-[var(--color-text-primary)]">
            <span className="section-bar" />
            继续观看
          </h2>
          <p className="text-sm text-[var(--color-text-tertiary)] mt-1.5 ml-4">
            共 <span className="text-[var(--color-text-primary)] font-medium">{records.length}</span> 条记录
          </p>
        </div>

        <div className="flex items-center gap-3 flex-1 max-w-md min-w-[260px]">
          <div className="relative group flex-1">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索观看记录..."
              className="input-field search-input-lg w-full pl-10"
            />
            <Icon
              name="search"
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-quaternary)] group-focus-within:text-[var(--color-primary)] transition-colors pointer-events-none"
            />
            {keyword && (
              <button
                onClick={() => setKeyword('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover-overlay)] transition-colors text-xs"
                title="清除搜索"
              >
                ✕
              </button>
            )}
          </div>

          <button
            onClick={() => setShowClearDialog(true)}
            className="flex-shrink-0 btn-ghost px-4 py-2 text-sm text-[var(--color-text-tertiary)] hover:text-red-400"
          >
            清空全部
          </button>
        </div>
      </div>

      {/* ============ 记录列表(横向大卡) ============ */}
      {visibleRecords.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-[var(--color-text-tertiary)]">
          <div
            className="flex items-center justify-center w-16 h-16 mb-4 rounded-lg"
            style={{
              background: 'var(--color-hover-overlay)',
              border: '1px solid var(--color-border-subtle)',
            }}
          >
            <Icon name="search" size={32} strokeWidth={1.5} className="text-[var(--color-text-quaternary)]" />
          </div>
          <p className="text-sm text-[var(--color-text-secondary)]">
            未找到匹配 &ldquo;<span className="text-[var(--color-text-primary)] font-medium">{keyword}</span>&rdquo; 的观看记录
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '16px',
          }}
        >
          {visibleRecords.map(([key, record]) => {
            const progress = calcProgress(record.play_time, record.total_time)
            return (
              <MediaCard
                key={key}
                variant="plain"
                horizontal
                item={{ title: record.title, poster: record.cover }}
                onClick={() => handleClick(key, record)}
                style={{
                  background: 'var(--color-card-bg)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 14,
                }}
                topRight={
                  <button
                    onClick={(e) => handleDelete(e, key)}
                    title="删除记录"
                    className="absolute top-2 right-2 w-7 h-7 bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80 rounded"
                  >
                    ✕
                  </button>
                }
                footer={
                  <div className="flex-1 p-3.5 flex flex-col justify-between min-w-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                        {record.title}
                      </p>
                      <p className="text-xs text-[var(--color-text-tertiary)] mt-1 truncate">
                        {getEpisodeText(record)} · {formatRelativeTime(record.save_time)}
                      </p>
                    </div>
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-xs text-[var(--color-text-quaternary)] mb-1.5">
                        <span>已观看 {Math.round(progress)}%</span>
                      </div>
                      <div className="h-1.5 bg-[var(--color-hover-overlay)] overflow-hidden rounded-full">
                        <div
                          className="h-full progress-bar rounded-full"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                }
              />
            )
          })}
        </div>
      )}

      {/* ============ 清空确认对话框 ============ */}
      {showClearDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn"
          onClick={() => !clearing && setShowClearDialog(false)}
        >
          <div
            className="max-w-sm w-full mx-6 p-6 rounded-lg"
            style={{
              background: 'var(--color-card-bg)',
              border: '1px solid var(--color-border-subtle)',
              boxShadow: 'var(--shadow-lg)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center mb-5">
              <div
                className="w-14 h-14 flex items-center justify-center mb-4"
                style={{ background: 'rgba(220, 38, 38, 0.12)' }}
              >
                <Icon name="alert" size={28} className="text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">清空全部观看记录</h3>
            </div>
            <p className="text-sm text-[var(--color-text-tertiary)] mb-6 text-center leading-relaxed">
              确定要清空全部{' '}
              <span className="text-[var(--color-text-primary)] font-medium">{records.length}</span>{' '}
              条观看记录吗?此操作不可恢复,清空后无法找回。
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowClearDialog(false)}
                disabled={clearing}
                className="btn-ghost px-5 py-2 text-sm disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleConfirmClear}
                disabled={clearing}
                className="px-5 py-2 text-sm text-white transition-colors disabled:opacity-50 flex items-center gap-2 rounded"
                style={{
                  background: clearing ? 'rgba(220, 38, 38, 0.5)' : 'rgb(220, 38, 38)',
                }}
              >
                {clearing && <span className="spinner w-4 h-4 border-2 border-white/30 border-t-white" />}
                {clearing ? '清空中...' : '确认清空'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
