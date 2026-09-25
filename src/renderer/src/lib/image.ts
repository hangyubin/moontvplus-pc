/**
 * 图片 URL 处理 + 图片磁盘缓存
 *
 * 防盗链:由主进程统一注入 Referer 解决,渲染进程直接使用原始 URL。
 *
 * 磁盘缓存:
 * - 使用浏览器 CacheStorage(caches),以图片 URL 为键,有效期 24 小时
 * - Electron 中 fetch 被归类为 xhr,主进程会注入 Access-Control-Allow-Origin:*,
 *   因此跨域图片可读取为 blob 并缓存;首次加载仍直接用原始 URL,不阻塞显示
 * - CacheStorage 不可用(file:// 旧环境/隐私模式)或读取失败时静默回退原始 URL
 * - 切换模式/换源时调用 clearImageCache() 清空
 */

const IMAGE_CACHE_NAME = 'mtvp-images-v1'
/** 图片缓存有效期:24 小时 */
const IMAGE_TTL = 24 * 60 * 60 * 1000
/** 单张图片大小上限 8MB,避免超大图占满磁盘配额 */
const MAX_IMAGE_SIZE = 8 * 1024 * 1024

/**
 * 处理图片 URL
 * PC 客户端:直接返回原始 URL,防盗链由主进程注入 Referer 解决
 */
export function processImageUrl(url: string | undefined | null): string {
  if (!url) return ''
  return url
}

/** 图片加载失败时的兜底代理 URL(保留接口,当前返回空) */
export function fallbackProxyUrl(url: string | undefined | null): string {
  return ''
}

/** 打开图片缓存;环境不支持时返回 null */
async function openImageCache(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined' || !caches) return null
    return await caches.open(IMAGE_CACHE_NAME)
  } catch {
    return null
  }
}

/**
 * 解析最终用于显示的图片地址(缓存优先)。
 * - 命中 24h 内缓存:返回 blob: URL(离线也能显示)
 * - 未命中/过期:后台写入缓存,同时首次直接返回原始 URL 保证即时显示
 * - 任何异常:回退原始 URL
 */
export async function resolveImageUrl(rawUrl: string): Promise<string> {
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) return rawUrl

  const cache = await openImageCache()
  if (!cache) return rawUrl

  try {
    const hit = await cache.match(rawUrl)
    if (hit) {
      const cachedAt = Number(hit.headers.get('x-cache-time') || 0)
      if (cachedAt && Date.now() - cachedAt <= IMAGE_TTL) {
        return URL.createObjectURL(await hit.blob())
      }
      // 已过期,删除后重新拉取
      await cache.delete(rawUrl)
    }

    // 未命中:拉取并写入缓存(Electron 主进程已注入 CORS 头,可正常读取)
    const resp = await fetch(rawUrl, { redirect: 'follow' })
    if (resp.ok) {
      const blob = await resp.blob()
      if (blob.size > 0 && blob.size <= MAX_IMAGE_SIZE) {
        const stored = new Response(blob, {
          headers: {
            'x-cache-time': String(Date.now()),
            'content-type': blob.type || 'image/jpeg'
          }
        })
        // put 失败(配额等)不影响本次显示
        cache.put(rawUrl, stored).catch(() => {})
      }
    }
  } catch {
    // 跨域受限/网络错误等:回退原始 URL,由 <img> 自行加载
  }
  return rawUrl
}

/** 清空图片磁盘缓存(切换模式/换源时调用) */
export async function clearImageCache(): Promise<void> {
  try {
    if (typeof caches === 'undefined' || !caches) return
    await caches.delete(IMAGE_CACHE_NAME)
  } catch {
    // ignore
  }
}
