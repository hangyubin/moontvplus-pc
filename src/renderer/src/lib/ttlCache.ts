/**
 * 通用本地持久缓存(基于 localStorage,带 TTL)
 *
 * 设计:
 * - 缓存信封 { t: 写入时间戳, v: 数据 },读取时按 TTL 判断是否过期
 * - 默认有效期 24 小时:过期视为未命中(由调用方重新拉取)
 * - localStorage 不可用或超配额时静默降级(不影响主流程)
 * - 统一前缀 mtvp:,支持按前缀批量清理(切换模式/换源时使用)
 */

const PREFIX = 'mtvp:'

/** 默认有效期:24 小时 */
export const TTL_24H = 24 * 60 * 60 * 1000

interface CacheEnvelope<T> {
  /** 写入时间戳(ms) */
  t: number
  /** 实际数据 */
  v: T
}

/** 读取缓存;不存在或已过期返回 null */
export function getCached<T>(key: string, ttl: number = TTL_24H): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const env = JSON.parse(raw) as CacheEnvelope<T>
    if (!env || typeof env.t !== 'number') return null
    if (Date.now() - env.t > ttl) {
      localStorage.removeItem(PREFIX + key)
      return null
    }
    return env.v
  } catch {
    return null
  }
}

/** 写入缓存;localStorage 失败(配额/隐私模式)时静默忽略 */
export function setCached<T>(key: string, value: T, ttl: number = TTL_24H): void {
  try {
    const env: CacheEnvelope<T> = { t: Date.now(), v: value }
    localStorage.setItem(PREFIX + key, JSON.stringify(env))
  } catch {
    // 配额不足时尝试清理一次本应用的全部缓存再重试
    try {
      clearByPrefix('')
      localStorage.setItem(PREFIX + key, JSON.stringify({ t: Date.now(), v: value } as CacheEnvelope<T>))
    } catch {
      // 仍然失败则放弃缓存
    }
  }
}

/** 删除单个缓存 */
export function removeCached(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    // ignore
  }
}

/**
 * 按前缀批量清理缓存
 * @param subPrefix 相对业务前缀(不含 mtvp:);传空串清理本应用全部缓存
 */
export function clearByPrefix(subPrefix: string): void {
  try {
    const full = PREFIX + subPrefix
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(full)) keys.push(k)
    }
    for (const k of keys) localStorage.removeItem(k)
  } catch {
    // ignore
  }
}
