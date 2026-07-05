/**
 * 图片 URL 处理工具
 *
 * 在 Electron PC 客户端中,图片防盗链问题由主进程统一解决:
 * 1. onBeforeSendHeaders:为豆瓣等图片请求注入 Referer
 * 2. onHeadersReceived:注入 CORS 头,允许跨域加载
 *
 * 因此渲染进程直接使用原始 URL 即可,无需走服务端 /api/image-proxy
 * (该接口需要认证,而 <img> 标签无法携带 Authorization 头)
 */

/**
 * 处理图片 URL
 * PC 客户端:直接返回原始 URL,防盗链由主进程注入 Referer 解决
 */
export function processImageUrl(url: string | undefined | null): string {
  if (!url) return ''
  return url
}

/**
 * 图片加载失败时的兜底代理 URL(保留接口,当前返回空)
 */
export function fallbackProxyUrl(url: string | undefined | null): string {
  return ''
}
