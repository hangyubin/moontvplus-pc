/**
 * 采集源健康度记忆(localStorage 持久化)
 *
 * 问题:几十个采集源里混有死站,每次搜索都要等它们超时才判死,
 *       拖慢整体完成时间且浪费连接。
 * 策略:连续失败达阈值进入冷却期,搜索时直接跳过;
 *       冷却随失败次数递增(自愈窗口越来越长);成功一次立即复位;
 *       冷却到期自动重新参与搜索,不会永久拉黑。
 */

const STORAGE_KEY = 'mtvp:source:health'
/** 连续失败达到该次数进入冷却 */
const FAIL_THRESHOLD = 3
/** 冷却步长:第 3 次失败起 6h,每多失败一次 +6h */
const COOLDOWN_STEP_MS = 6 * 3600 * 1000
/** 冷却上限 48h */
const COOLDOWN_MAX_MS = 48 * 3600 * 1000
/** 记录保留期:7 天无失败即清理 */
const RECORD_TTL_MS = 7 * 24 * 3600 * 1000

interface SourceHealth {
  /** 连续失败次数(成功即归零并删除记录) */
  fails: number
  /** 最近一次失败时间 */
  lastFailAt: number
}

function readAll(): Record<string, SourceHealth> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const obj = raw ? JSON.parse(raw) : {}
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}

function writeAll(map: Record<string, SourceHealth>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // 写入失败(如空间不足)不影响搜索主流程
  }
}

/** 冷却时长:3 次失败 → 6h,4 → 12h … 封顶 48h */
function cooldownMs(fails: number): number {
  return Math.min((fails - FAIL_THRESHOLD + 1) * COOLDOWN_STEP_MS, COOLDOWN_MAX_MS)
}

/** 该源当前是否处于冷却期(冷却中的死站搜索时跳过) */
export function isSourceCoolingDown(key: string): boolean {
  const h = readAll()[key]
  if (!h || h.fails < FAIL_THRESHOLD) return false
  return Date.now() - h.lastFailAt < cooldownMs(h.fails)
}

/** 记录一次成功:失败计数清零(删除记录即代表健康) */
export function markSourceOk(key: string): void {
  const map = readAll()
  if (map[key]) {
    delete map[key]
    writeAll(map)
  }
}

/** 记录一次失败:连续失败达阈值进入冷却 */
export function markSourceFail(key: string): void {
  const map = readAll()
  const now = Date.now()
  const prev = map[key]
  // 距上次失败超过保留期,视为重新开始计数
  const fails = prev && now - prev.lastFailAt < RECORD_TTL_MS ? prev.fails + 1 : 1
  map[key] = { fails, lastFailAt: now }
  writeAll(map)
}

/** 过滤掉冷却中的源(供搜索入口批量使用);返回 [可用源, 跳过数] */
export function filterHealthySites<T extends { key: string }>(sites: T[]): [T[], number] {
  const map = readAll()
  const now = Date.now()
  const healthy: T[] = []
  let skipped = 0
  for (const s of sites) {
    const h = map[s.key]
    const cooling =
      h && h.fails >= FAIL_THRESHOLD && now - h.lastFailAt < cooldownMs(h.fails)
    if (cooling) skipped++
    else healthy.push(s)
  }
  return [healthy, skipped]
}
