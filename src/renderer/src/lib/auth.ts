/**
 * 认证管理:token 持久化、过期判断、主动刷新
 * 对齐服务端 src/lib/auth.ts 与 src/lib/token-config.ts
 * - Access Token 有效期 4 小时
 * - Refresh Token 有效期 60 天
 * - 剩余 < 10 分钟时主动刷新
 */
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'
import type { AuthInfo, LoginResponse } from '../types'

const ACCESS_TOKEN_AGE = 4 * 60 * 60 * 1000
const REFRESH_TOKEN_AGE = 60 * 24 * 60 * 60 * 1000
const RENEWAL_THRESHOLD = 10 * 60 * 1000

let currentBaseUrl = ''
let currentToken = ''
let currentAuth: AuthInfo | null = null
let refreshPromise: Promise<boolean> | null = null

/** 浏览器开发模式(非 Electron):使用相对 URL + Vite 代理绕过 CORS */
const IS_BROWSER = typeof window !== 'undefined' && !(window as any).app
/** 构造 API URL:浏览器模式返回相对路径(由 Vite 代理转发),Electron 模式拼接 baseUrl */
export function apiUrl(path: string): string {
  return IS_BROWSER ? path : `${currentBaseUrl}${path}`
}

/** 持久化键 */
const STORE_KEY_TOKEN = 'auth_token'
const STORE_KEY_AUTH = 'auth_info'
const STORE_KEY_BASEURL = 'server_base_url'

/** 通过主进程持久化读写 */
async function persist(key: string, value: unknown): Promise<void> {
  try {
    // @ts-ignore app 由 preload 注入
    await window.app.store.set(key, value)
  } catch {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* localStorage 也失败,忽略 */
    }
  }
}

async function load<T>(key: string): Promise<T | null> {
  try {
    // @ts-ignore
    const v = await window.app.store.get(key)
    return (v as T) ?? null
  } catch {
    // 主进程读取失败,降级到 localStorage
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      // JSON.parse 也失败(数据损坏),返回 null
      return null
    }
  }
}

export function getBaseUrl(): string {
  return currentBaseUrl
}

export function setBaseUrl(url: string): void {
  currentBaseUrl = url.replace(/\/+$/, '')
}

export function getToken(): string {
  return currentToken
}

export function getAuth(): AuthInfo | null {
  return currentAuth
}

/** Access Token 是否需要主动刷新(剩余 < 10 分钟) */
export function shouldRefreshToken(): boolean {
  if (!currentAuth?.timestamp) return false
  const elapsed = Date.now() - currentAuth.timestamp
  return elapsed > ACCESS_TOKEN_AGE - RENEWAL_THRESHOLD
}

/** Refresh Token 是否已过期 */
export function isRefreshExpired(): boolean {
  if (!currentAuth?.refreshExpires) return true
  return Date.now() >= currentAuth.refreshExpires
}

/** 启动时从持久化存储恢复登录态 */
export async function restoreAuth(): Promise<boolean> {
  const baseUrl = await load<string>(STORE_KEY_BASEURL)
  if (baseUrl) setBaseUrl(baseUrl)
  const token = await load<string>(STORE_KEY_TOKEN)
  const auth = await load<AuthInfo>(STORE_KEY_AUTH)
  if (token && auth) {
    currentToken = token
    currentAuth = auth
    if (isRefreshExpired()) {
      currentToken = ''
      currentAuth = null
      return false
    }
    return true
  }
  return false
}

/** 登录 */
export async function login(
  baseUrl: string,
  username: string,
  password: string,
  turnstileToken?: string
): Promise<LoginResponse> {
  setBaseUrl(baseUrl)
  const res = await axios.post<LoginResponse>(
    apiUrl('/api/login'),
    {
      username,
      password,
      turnstileToken
    },
    // 服务器不可达时 15 秒超时,避免登录按钮永久转圈
    { timeout: 15000 }
  )
  const data = res.data
  if (data.ok && data.token) {
    currentToken = data.token
    currentAuth = data.auth
    // 登录成功后才持久化 baseUrl 和凭据
    await persist(STORE_KEY_BASEURL, currentBaseUrl)
    await persist(STORE_KEY_TOKEN, currentToken)
    await persist(STORE_KEY_AUTH, currentAuth)
  }
  return data
}

/** 登出 */
export async function logout(): Promise<void> {
  // 捕获会话信息后立即清理本地登录态:
  // 服务器不可达时退出/切换账号也必须立即生效,不能被网络请求阻塞
  const hadSession = !!(currentBaseUrl && currentToken)
  const baseUrl = currentBaseUrl
  const token = currentToken
  currentToken = ''
  currentAuth = null
  await persist(STORE_KEY_TOKEN, '')
  await persist(STORE_KEY_AUTH, null)

  // 尽力通知服务端撤销 token(5 秒超时,后台执行,失败忽略)
  if (hadSession) {
    axios
      .post(`${baseUrl}/api/logout`, null, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000
      })
      .catch(() => {
        /* 服务器不可达,忽略(本地已登出,token 到期后服务端自动失效) */
      })
  }
}

/** 刷新 Access Token(单例防抖) */
export async function refreshToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise
  if (!currentBaseUrl || !currentToken || isRefreshExpired()) return false

  refreshPromise = (async () => {
    try {
      const res = await axios.post<LoginResponse>(
        apiUrl('/api/auth/refresh'),
        null,
        { headers: { Authorization: `Bearer ${currentToken}` } }
      )
      if (res.data.ok && res.data.token) {
        currentToken = res.data.token
        currentAuth = res.data.auth
        await persist(STORE_KEY_TOKEN, currentToken)
        await persist(STORE_KEY_AUTH, currentAuth)
        return true
      }
      return false
    } catch {
      return false
    } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

/** 用 WeakSet 跟踪已重试的请求 config,避免在 config 上添加自定义属性 */
const retriedConfigs = new WeakSet<AxiosRequestConfig>()

/** 创建带认证与自动刷新拦截的 axios 实例 */
export function createApiClient(): AxiosInstance {
  const client = axios.create()
  let isRetrying = false

  client.interceptors.request.use(async (config) => {
    // 浏览器模式不设 baseURL,使用相对路径由 Vite 代理转发
    if (!IS_BROWSER && currentBaseUrl) config.baseURL = currentBaseUrl
    if (currentToken) {
      if (shouldRefreshToken() && !isRetrying) {
        isRetrying = true
        try {
          await refreshToken()
        } finally {
          isRetrying = false
        }
      }
      config.headers = config.headers || {}
      config.headers.Authorization = `Bearer ${currentToken}`
    }
    return config
  })

  client.interceptors.response.use(
    (res) => res,
    async (error) => {
      const original = error.config
      if (
        error.response?.status === 401 &&
        original &&
        !retriedConfigs.has(original) &&
        currentToken &&
        !isRefreshExpired()
      ) {
        retriedConfigs.add(original)
        const ok = await refreshToken()
        if (ok) {
          original.headers = original.headers || {}
          original.headers.Authorization = `Bearer ${currentToken}`
          return client(original)
        }
      }
      return Promise.reject(error)
    }
  )

  return client
}
