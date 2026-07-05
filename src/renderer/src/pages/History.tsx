/**
 * 观看历史页
 * 展示用户播放记录,支持继续观看、单条删除、清空全部
 */
import { useNavigate } from 'react-router-dom'
import { useStore, sortedPlayRecords } from '../lib/store'
import { clearPlayRecords } from '../lib/api'
import { processImageUrl } from '../lib/image'
import SmartImage from '../components/SmartImage'
import { parseStorageKey } from '../types'
import type { PlayRecord } from '../types'

/**
 * 将时间戳格式化为相对时间字符串
 * 规则:刚刚 / X分钟前 / X小时前 / X天前 / YYYY-MM-DD
 * @param timestamp 毫秒级时间戳
 */
export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return ''
  const now = Date.now()
  const diff = now - timestamp
  const oneMinute = 60 * 1000
  const oneHour = 60 * oneMinute
  const oneDay = 24 * oneHour

  if (diff < oneMinute) {
    return '刚刚'
  }
  if (diff < oneHour) {
    return `${Math.floor(diff / oneMinute)}分钟前`
  }
  if (diff < oneDay) {
    return `${Math.floor(diff / oneHour)}小时前`
  }
  if (diff < 7 * oneDay) {
    return `${Math.floor(diff / oneDay)}天前`
  }
  // 超过 7 天,显示具体日期
  const date = new Date(timestamp)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export default function History() {
  const navigate = useNavigate()
  const { playRecords, removePlayRecord, loadPlayRecords } = useStore()

  // 按 save_time 倒序排列的记录数组
  const allRecords = sortedPlayRecords(playRecords)

  // 按标题去重:同一影片(标题相同)只保留最近播放的一条记录
  // 不同源播放同一影片会产生多条 key=source+id 的记录,合并显示
  const records = (() => {
    const seen = new Set<string>()
    const result: Array<[string, PlayRecord]> = []
    for (const entry of allRecords) {
      const title = entry[1].title?.trim()
      if (!title) {
        result.push(entry)
        continue
      }
      if (seen.has(title)) continue
      seen.add(title)
      result.push(entry)
    }
    return result
  })()

  /** 点击卡片:继续观看,跳转播放页(集数 index 转为 0 基) */
  const handleClick = (key: string, record: PlayRecord) => {
    const { source, id } = parseStorageKey(key)
    navigate(
      `/play?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&title=${encodeURIComponent(record.title)}&index=${record.index - 1}`
    )
  }

  /** 删除单条记录 */
  const handleDelete = async (e: React.MouseEvent, key: string) => {
    e.stopPropagation()
    await removePlayRecord(key)
  }

  /** 清空全部记录(确认后执行) */
  const handleClearAll = async () => {
    if (!window.confirm('确定要清空全部观看记录吗?此操作不可恢复。')) return
    try {
      await clearPlayRecords()
      await loadPlayRecords()
    } catch (e) {
      console.error('清空观看记录失败', e)
    }
  }

  // 空状态
  if (records.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500">
        <div className="text-6xl mb-4">📺</div>
        <p className="text-lg">暂无观看记录</p>
        <p className="text-sm text-gray-600 mt-2">去搜索一部影视开始观看吧</p>
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* 页头:标题 + 清空全部按钮 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">观看历史</h2>
          <p className="text-sm text-gray-500 mt-1">共 {records.length} 条记录</p>
        </div>
        <button
          onClick={handleClearAll}
          className="px-4 py-2 text-sm text-gray-400 hover:text-red-400 border border-white/10 hover:border-red-500/30 rounded-lg transition-colors"
        >
          清空全部
        </button>
      </div>

      {/* 记录卡片网格 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '20px' }}>
        {records.map(([key, record]) => {
          // 播放进度百分比
          const progress =
            record.total_time > 0
              ? Math.min(100, (record.play_time / record.total_time) * 100)
              : 0
          // 集数文案:多集显示"第X集/共Y集",单集显示"电影"
          const episodeText =
            record.total_episodes > 1
              ? `第${record.index}集/共${record.total_episodes}集`
              : '电影'

          return (
            <div
              key={key}
              onClick={() => handleClick(key, record)}
              className="card-hover cursor-pointer bg-card rounded-xl overflow-hidden group relative"
            >
              {/* 封面区 */}
              <div className="relative aspect-[2/3] bg-white/[0.03]">
                <SmartImage
                  src={record.cover}
                  alt={record.title}
                  className="w-full h-full"
                />

                {/* 右上角删除按钮 */}
                <button
                  onClick={(e) => handleDelete(e, key)}
                  title="删除记录"
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80"
                >
                  ✕
                </button>

                {/* 底部进度条 */}
                {progress > 0 && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                    <div
                      className="h-full progress-bar"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
              </div>

              {/* 信息区 */}
              <div className="p-2">
                <p className="text-sm text-white truncate">{record.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{episodeText}</p>
                <p className="text-xs text-gray-600 mt-0.5 truncate">
                  {record.source_name} · {formatRelativeTime(record.save_time)}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
