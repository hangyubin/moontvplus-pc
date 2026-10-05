/**
 * 直播播放诊断面板
 *
 * 每秒采样一次 hls.js / video 实时状态,用于量化区分卡顿类型:
 * - 网络型:前向缓冲跌零、waiting 计数增长、分片下载耗时 > 分片时长
 * - 解码型:缓冲正常但 droppedVideoFrames 持续增长(常见于 HEVC 软解)
 *
 * 面板只读,不影响播放逻辑。
 */
import { useEffect, useState, type MutableRefObject } from 'react'
import type Hls from 'hls.js'
import Icon from '../../components/Icon'

interface LiveDiagPanelProps {
  hlsRef: MutableRefObject<Hls | null>
  diagStatsRef: MutableRefObject<{
    waiting: number
    stalled: number
    playing: number
    netFatal: number
    mediaFatal: number
    fragsLoaded: number
    lastFragMs: number
    maxFragMs: number
    sumFragMs: number
  }>
  onClose: () => void
}

/** 单条诊断行 */
function Row({ label, value, tone = 'normal' }: {
  label: string
  value: string
  tone?: 'normal' | 'good' | 'warn' | 'bad'
}) {
  const color =
    tone === 'good' ? 'text-emerald-400'
    : tone === 'warn' ? 'text-amber-400'
    : tone === 'bad' ? 'text-red-400'
    : 'text-white/90'
  return (
    <div className="flex items-center justify-between gap-3 py-[3px]">
      <span className="text-[11px] text-white/45 flex-shrink-0">{label}</span>
      <span className={`text-[11px] font-mono tabular-nums text-right ${color}`}>{value}</span>
    </div>
  )
}

/** 从 codecs 串中解析视频编码短名 */
function parseVideoCodec(codecs: string): { name: string; hevc: boolean } {
  const v = codecs.split(',')[0]?.trim().toLowerCase() || ''
  if (v.startsWith('avc1') || v.startsWith('h264')) return { name: 'H.264', hevc: false }
  if (v.startsWith('hvc1') || v.startsWith('hev1') || v.includes('hevc') || v.startsWith('h265')) {
    return { name: 'H.265/HEVC', hevc: true }
  }
  if (v.startsWith('vp09') || v.startsWith('vp9')) return { name: 'VP9', hevc: false }
  if (v.startsWith('av01') || v.startsWith('av1')) return { name: 'AV1', hevc: false }
  return { name: v.toUpperCase() || '未知', hevc: v.includes('hvc') }
}

/** 前向缓冲(秒) */
function getBufferAhead(video: HTMLVideoElement): number {
  const ct = video.currentTime
  for (let i = video.buffered.length - 1; i >= 0; i--) {
    if (video.buffered.start(i) <= ct && ct <= video.buffered.end(i)) {
      return video.buffered.end(i) - ct
    }
  }
  // currentTime 不在任何区间时,返回最近一个区间的前向长度(可能为负)
  return video.buffered.length ? video.buffered.end(video.buffered.length - 1) - ct : 0
}

export default function LiveDiagPanel({ hlsRef, diagStatsRef, onClose }: LiveDiagPanelProps) {
  const [snap, setSnap] = useState('')

  useEffect(() => {
    const sample = () => {
      const hls = hlsRef.current
      const hlsMedia = hls?.media
      // hls.media 类型为 HTMLMediaElement,播放实际挂在 video 上,先收窄
      const video = (hlsMedia instanceof HTMLVideoElement ? hlsMedia : null) || document.querySelector('video')
      const d = diagStatsRef.current
      if (!video) { setSnap('NO_VIDEO'); return }

      const level = hls ? hls.levels[hls.currentLevel] : null
      const codecRaw = level?.codecs || ''
      const codec = codecRaw ? parseVideoCodec(codecRaw) : null
      const targetDuration = hls?.levels[0]?.details?.targetduration || 0

      let q: { dropped: number; total: number } | null = null
      try {
        const pq = video.getVideoPlaybackQuality()
        q = { dropped: pq.droppedVideoFrames, total: pq.totalVideoFrames }
      } catch { /* 老内核不支持时忽略 */ }

      const buf = getBufferAhead(video)
      const avgFragMs = d.fragsLoaded ? Math.round(d.sumFragMs / d.fragsLoaded) : 0
      // hls.js 1.5+ 暴露实时直播延迟(秒),仅真实直播流才有意义;点播流 details.live=false
      const isLive = hls?.levels.some((lv) => lv.details?.live)
      const latency = isLive ? (hls as unknown as { latency?: number }).latency : undefined

      // 综合状态判定
      const dropRate = q && q.total ? q.dropped / q.total : 0
      const overall =
        buf < 2 || d.waiting > 2 ? ['缓冲不足,卡顿中', 'bad']
        : dropRate > 0.05 ? ['解码丢帧偏高', 'warn']
        : buf < 6 ? ['缓冲偏低', 'warn']
        : ['播放流畅', 'good']

      const lines = [
        `OVERALL\t${overall[0]}\t${overall[1]}`,
        `STATE\t${['未初始化','元数据','有当前数据','有未来数据','有足够数据'][video.readyState] || video.readyState}\tnormal`,
        `CODEC\t${codec ? codec.name : '—'}\t${codec?.hevc ? 'warn' : 'normal'}`,
        `SIZE\t${video.videoWidth}×${video.videoHeight}\tnormal`,
        `BITRATE\t${level ? `${Math.round(level.bitrate / 1000)} kbps` : '—'}\tnormal`,
        `BUFFER\t${buf.toFixed(1)} s\t${buf < 3 ? 'bad' : buf < 8 ? 'warn' : 'good'}`,
        `LATENCY\t${typeof latency === 'number' && isFinite(latency) ? `${latency.toFixed(0)} s` : '—'}\tnormal`,
        `FRAG\t${d.lastFragMs}/${avgFragMs}ms${targetDuration ? ` · 分片${targetDuration}s` : ''}\t${
          targetDuration && d.lastFragMs > targetDuration * 1000 ? 'bad' : d.lastFragMs > 1500 ? 'warn' : 'normal'}`,
        `STALL\twaiting ${d.waiting} · stalled ${d.stalled}\t${d.waiting ? 'warn' : 'normal'}`,
        `DROP\t${q ? `${q.dropped}/${q.total} (${(dropRate * 100).toFixed(1)}%)` : '—'}\t${
          dropRate > 0.05 ? 'bad' : dropRate > 0.01 ? 'warn' : 'good'}`,
        `FATAL\t网络 ${d.netFatal} · 媒体 ${d.mediaFatal}\t${d.netFatal || d.mediaFatal ? 'warn' : 'normal'}`,
      ]
      setSnap(lines.join('\n'))
    }

    sample()
    const t = setInterval(sample, 1000)
    return () => clearInterval(t)
  }, [hlsRef, diagStatsRef])

  const rows = snap === 'NO_VIDEO'
    ? []
    : snap.split('\n').map((line) => {
      const [key, value, tone] = line.split('\t')
      return { key, value, tone: (tone || 'normal') as 'normal' | 'good' | 'warn' | 'bad' }
    })

  const overallRow = rows[0]
  const bodyRows = rows.slice(1)

  return (
    <div className="absolute top-11 right-3 z-40 w-[248px] rounded-lg overflow-hidden shadow-xl shadow-black/50"
      style={{
        background: 'rgba(12,12,18,0.88)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.1)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 h-8 border-b border-white/10">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-white/80">
          <Icon name="activity" size={13} className="text-primary" />
          播放诊断
        </span>
        <button
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 rounded transition-colors"
          aria-label="关闭诊断"
        >
          <Icon name="x" size={13} />
        </button>
      </div>

      <div className="px-3 py-1.5">
        {snap === 'NO_VIDEO' ? (
          <p className="py-4 text-center text-[11px] text-white/40">暂无播放流</p>
        ) : (
          <>
            <Row label="综合状态" value={overallRow.value} tone={overallRow.tone} />
            <div className="h-px bg-white/5 my-1" />
            {bodyRows.map((r) => (
              <Row key={r.key} label={
                r.key === 'STATE' ? '就绪状态'
                : r.key === 'CODEC' ? '视频编码'
                : r.key === 'SIZE' ? '分辨率'
                : r.key === 'BITRATE' ? '码率'
                : r.key === 'BUFFER' ? '前向缓冲'
                : r.key === 'LATENCY' ? '直播延迟'
                : r.key === 'FRAG' ? '分片下载(最近/均)'
                : r.key === 'STALL' ? '卡顿事件'
                : r.key === 'DROP' ? '丢帧(数/率)'
                : '致命错误'
              } value={r.value} tone={r.tone} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
