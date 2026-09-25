/**
 * 音乐页频谱可视化 hook(Web Audio API + Canvas)
 *
 * 拆为两部分避免与播放器 hook 循环依赖:
 * - useSpectrumCore: AudioContext/Analyser 初始化、颜色偏好、画布尺寸、卸载清理
 * - useSpectrumRender: Canvas 渲染循环(依赖播放器 isPlaying)
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export function useSpectrumCore() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  // 频谱颜色模式:'theme'(跟随主题) | 'rainbow'(彩虹渐变) | hex 色值
  const [spectrumColor, setSpectrumColor] = useState(() => {
    try { return localStorage.getItem('music_spectrumColor') || 'theme' } catch { return 'theme' }
  })
  const spectrumColorRef = useRef(spectrumColor)
  spectrumColorRef.current = spectrumColor

  /* ============ 颜色偏好持久化(重启后保留) ============ */
  useEffect(() => {
    try { localStorage.setItem('music_spectrumColor', spectrumColor) } catch {}
  }, [spectrumColor])

  /* ============ 频谱可视化:初始化 Web Audio API ============ */
  // 在首次播放时创建 AudioContext + AnalyserNode(浏览器限制需用户交互后才能创建)
  // 注意: createMediaElementSource 会接管音频输出,若音频源跨域且无 CORS 头则会被静音
  // 浏览器开发模式下音频 CDN 不支持 CORS,因此跳过可视化(音频正常通过 <audio> 播放)
  // Electron 模式下 webSecurity:false 绕过了 CORS,可视化正常工作
  const initVisualizer = useCallback((audio: HTMLAudioElement | null) => {
    if (audioCtxRef.current) return // 已初始化
    if (!audio) return
    // 浏览器开发模式:跳过 Web Audio API,避免跨域音频被静音
    if (!(window as any).app) {
      console.log('[Music] Browser mode: skipping Web Audio API visualizer (CORS)')
      return
    }
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      const ctx = new AudioCtx()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512 // 256 个频段(fftSize/2),对数映射下低频分辨率更细腻
      analyser.smoothingTimeConstant = 0.62
      const source = ctx.createMediaElementSource(audio)
      source.connect(analyser)
      analyser.connect(ctx.destination)
      audioCtxRef.current = ctx
      analyserRef.current = analyser
      sourceRef.current = source
    } catch {
      // 已连接过或其他错误,忽略
    }
  }, [])

  /* ============ 频谱可视化:Canvas 尺寸自适应 ============ */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      canvas.width = canvas.clientWidth
      canvas.height = canvas.clientHeight
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  /* ============ 组件卸载:清理 Web Audio 资源 ============ */
  useEffect(() => {
    return () => {
      mountedRef.current = false
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (sourceRef.current) { try { sourceRef.current.disconnect() } catch {} }
      if (analyserRef.current) { try { analyserRef.current.disconnect() } catch {} }
      if (audioCtxRef.current) { try { audioCtxRef.current.close() } catch {} }
      audioCtxRef.current = null
      analyserRef.current = null
      sourceRef.current = null
    }
  }, [])

  return {
    canvasRef,
    audioCtxRef,
    analyserRef,
    rafRef,
    mountedRef,
    spectrumColor,
    setSpectrumColor,
    spectrumColorRef,
    initVisualizer
  }
}

export type SpectrumCore = ReturnType<typeof useSpectrumCore>

/* ============ 频谱可视化:Canvas 渲染循环(独立区域) ============ */
export function useSpectrumRender(spectrum: SpectrumCore, isPlaying: boolean) {
  const { canvasRef, analyserRef, rafRef, mountedRef, spectrumColorRef } = spectrum

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    mountedRef.current = true

    const bufferLength = analyserRef.current?.frequencyBinCount ?? 256
    const dataArray = new Uint8Array(bufferLength)
    const barCount = 24 // 柱数减少 → 柱宽自动加粗,画面更干净
    let phase = 0

    // 平滑值
    const smoothVals = new Array(barCount).fill(0)
    // 峰值帽:每根柱子的当前峰值与下落速度(重力加速回落)
    const peaks = new Array(barCount).fill(0)
    const peakVel = new Array(barCount).fill(0)

    // 频谱颜色:'theme' 从 CSS 变量读取, 'rainbow' 按柱位 HSL 渐变, 其他为 hex 色值
    let colorRGB = { r: 229, g: 9, b: 20 }
    let colorTick = 0
    // 单色模式下的位置渐变色:低频深沉偏暖、高频明亮偏冷,形成高低音视觉层次
    let barColors: Array<{ r: number; g: number; b: number }> = new Array(barCount).fill(0).map(() => colorRGB)
    // RGB↔HSL(单色模式按柱位做色相/亮度渐变,高低音区分更明显)
    const rgbToHsl = (r: number, g: number, b: number) => {
      const r1 = r / 255, g1 = g / 255, b1 = b / 255
      const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1)
      const l = (max + min) / 2
      let h = 0, s = 0
      if (max !== min) {
        const d = max - min
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
        if (max === r1) h = (g1 - b1) / d + (g1 < b1 ? 6 : 0)
        else if (max === g1) h = (b1 - r1) / d + 2
        else h = (r1 - g1) / d + 4
        h *= 60
      }
      return { h, s, l }
    }
    const hslToRgb = (h: number, s: number, l: number) => {
      const c = (1 - Math.abs(2 * l - 1)) * s
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
      const m2 = l - c / 2
      let r = 0, g = 0, b = 0
      if (h < 60) { r = c; g = x; b = 0 }
      else if (h < 120) { r = x; g = c; b = 0 }
      else if (h < 180) { r = 0; g = c; b = x }
      else if (h < 240) { r = 0; g = x; b = c }
      else if (h < 300) { r = x; g = 0; b = c }
      else { r = c; g = 0; b = x }
      return { r: Math.round((r + m2) * 255), g: Math.round((g + m2) * 255), b: Math.round((b + m2) * 255) }
    }
    const refreshColor = () => {
      const mode = spectrumColorRef.current
      if (mode === 'rainbow') return // 彩虹模式在绘制时按柱位计算
      if (mode === 'theme') {
        const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()
        const m = /^#?([0-9a-fA-F]{6})$/.exec(raw)
        if (m) {
          const n = parseInt(m[1], 16)
          colorRGB = { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
        }
      } else {
        const m = /^#?([0-9a-fA-F]{6})$/.exec(mode)
        if (m) {
          const n = parseInt(m[1], 16)
          colorRGB = { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
        }
      }
      // 基于更新后的 colorRGB 生成位置渐变 barColors:低频深沉偏暖、高频明亮偏冷
      const base = rgbToHsl(colorRGB.r, colorRGB.g, colorRGB.b)
      barColors = new Array(barCount).fill(0).map((_, i) => {
        const t = i / (barCount - 1) // 0(低频) → 1(高频)
        const hh = (base.h - 10 + t * 24 + 360) % 360 // 色相微移,低偏暖高偏冷
        const ll = Math.max(0.34, Math.min(0.70, base.l - 0.10 + t * 0.26)) // 低沉高亮
        const ss = Math.min(0.95, Math.max(0.5, base.s + 0.08))
        return hslToRgb(hh, ss, ll)
      })
    }
    refreshColor()

    // 彩虹模式:按柱位生成 HSL → RGB(低频红→中频绿→高频紫)
    const hueToRGB = (h: number) => {
      const s = 0.85, l = 0.55
      const c = (1 - Math.abs(2 * l - 1)) * s
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
      const m2 = l - c / 2
      let r = 0, g = 0, b = 0
      if (h < 60) { r = c; g = x; b = 0 }
      else if (h < 120) { r = x; g = c; b = 0 }
      else if (h < 180) { r = 0; g = c; b = x }
      else if (h < 240) { r = 0; g = x; b = c }
      else if (h < 300) { r = x; g = 0; b = c }
      else { r = c; g = 0; b = x }
      return { r: Math.round((r + m2) * 255), g: Math.round((g + m2) * 255), b: Math.round((b + m2) * 255) }
    }
    const rainbowColors = new Array(barCount).fill(0).map((_, i) =>
      hueToRGB(300 - (i / barCount) * 300) // 紫(300°)→ 蓝 → 绿 → 黄 → 红(0°)
    )

    // 频率窗口:起始抬高到约 1kHz(bin 12),跳过低中音稳定区,
    // 24 根柱覆盖约 1kHz~13.6kHz 的灵动区(镲片/齿音/中高频泛音/人声亮度)
    // 用幂次曲线(指数 0.6)替代纯对数:左端柱覆盖更宽 bin 区间,聚合更多能量而灵动;
    // 每根柱强制最少 2 bin 宽,避免单 bin 长期为 0 几乎不动
    const FREQ_LO_RATIO = 0.047
    const FREQ_HI_RATIO = 0.62
    const startBin = Math.max(2, Math.floor(bufferLength * FREQ_LO_RATIO))
    const endBin = Math.min(bufferLength, Math.floor(bufferLength * FREQ_HI_RATIO))
    const span = endBin - startBin
    const bandRanges: Array<[number, number]> = []
    for (let i = 0; i < barCount; i++) {
      const lo = startBin + Math.floor(Math.pow(i / barCount, 0.6) * span)
      const hi = Math.max(lo + 2, startBin + Math.floor(Math.pow((i + 1) / barCount, 0.6) * span))
      bandRanges.push([Math.min(lo, endBin), Math.min(hi, endBin)])
    }

    const render = () => {
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      // 每 40 帧刷新一次颜色(响应主题色或用户切换)
      if (++colorTick >= 40) {
        colorTick = 0
        refreshColor()
      }

      // ====== 采集频谱数据 ======
      const live = isPlaying && analyserRef.current
      if (live) {
        analyserRef.current!.getByteFrequencyData(dataArray)
        phase += 0.06
      } else {
        // 待机呼吸动画(暂停或分析器未初始化时)
        phase += 0.03
        for (let i = 0; i < bufferLength; i++) {
          const wave1 = Math.sin(phase + i * 0.12) * 14
          const wave2 = Math.sin(phase * 0.7 + i * 0.05) * 10
          dataArray[i] = Math.max(0, Math.min(255, 22 + wave1 + wave2))
        }
      }

      // ====== 绘制频谱光柱(从底部向上生长) ======
      const barWidth = w / barCount
      const gap = Math.min(2.5, Math.max(1.5, barWidth * 0.22))
      const actualBarWidth = Math.max(1, barWidth - gap)
      const maxBarH = h * 0.7 // 限制最大高度,避免柱子过高
      const baselineY = h - 2 // 底部基线(留 2px 间距)
      const isRainbow = spectrumColorRef.current === 'rainbow'

      for (let i = 0; i < barCount; i++) {
        // 区间聚合:均值(稳定) + 峰值(抓瞬态),加重峰值让弱信号瞬态也能明显跳动
        const [lo, hi] = bandRanges[i]
        let sum = 0
        let peak = 0
        for (let j = lo; j < hi; j++) {
          const d = dataArray[j]
          sum += d
          if (d > peak) peak = d
        }
        const avg = sum / (hi - lo)
        const drive = avg * 0.4 + peak * 0.6
        const normalized = Math.min(1, Math.pow(drive / 255, 0.68) * 1.5)

        // 平滑:起跳更脆、回落更利落,节奏点更"灵动"
        const prev = smoothVals[i]
        smoothVals[i] =
          normalized > prev ? prev * 0.12 + normalized * 0.88 : prev * 0.58 + normalized * 0.42
        const v = smoothVals[i]

        const barHeight = Math.max(2, v * maxBarH)
        const x = i * barWidth + gap / 2
        const botY = baselineY
        const topY = botY - barHeight

        // 颜色:彩虹按柱位取色,单色模式用位置渐变色(低沉→高亮)
        const { r, g, b } = isRainbow ? rainbowColors[i] : barColors[i]

        // 竖向渐变:底部沉稳,顶端明亮
        const grad = ctx.createLinearGradient(0, botY, 0, topY)
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.5)`)
        grad.addColorStop(0.6, `rgba(${r}, ${g}, ${b}, 0.85)`)
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 1)`)
        ctx.fillStyle = grad

        // 顶部圆角矩形(底部平齐,贴基线)
        const rad = Math.min(actualBarWidth / 2, 2)
        ctx.beginPath()
        ctx.moveTo(x, botY)
        ctx.lineTo(x, topY + rad)
        ctx.quadraticCurveTo(x, topY, x + rad, topY)
        ctx.lineTo(x + actualBarWidth - rad, topY)
        ctx.quadraticCurveTo(x + actualBarWidth, topY, x + actualBarWidth, topY + rad)
        ctx.lineTo(x + actualBarWidth, botY)
        ctx.closePath()
        ctx.fill()

        // ====== 峰值帽:悬停在柱子顶端上方,带重力缓慢下落 ======
        if (v >= peaks[i]) {
          peaks[i] = v
          peakVel[i] = 0
        } else {
          peakVel[i] += 0.0018
          peaks[i] = Math.max(v, peaks[i] - peakVel[i])
        }
        if (peaks[i] > 0.02) {
          const capY = botY - Math.max(2, peaks[i] * maxBarH) - 3
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.6)`
          ctx.fillRect(x, capY, actualBarWidth, 2)
        }
      }

      if (mountedRef.current) rafRef.current = requestAnimationFrame(render)
    }

    render()

    return () => {
      mountedRef.current = false
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [isPlaying])
}
