import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../lib/store'

export default function Login() {
  const navigate = useNavigate()
  const { login } = useStore()
  const [baseUrl, setBaseUrl] = useState('http://localhost:3000')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!baseUrl.trim() || !password.trim()) {
      setError('请填写服务器地址和密码')
      return
    }
    setLoading(true)
    setError('')
    try {
      await login(baseUrl.trim(), username.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setError((err as Error).message || '登录失败,请检查地址与凭据')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-app-bg)] px-4 relative overflow-hidden">
      {/* 装饰性渐变光晕 */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl" />

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/30 to-purple-600/20 text-3xl mb-4 shadow-lg shadow-primary/10">
            🎬
          </div>
          <h1 className="text-2xl font-bold gradient-text">MoonTVPlus</h1>
          <p className="text-sm text-gray-600 mt-2">PC 客户端 · 观看历史多端同步</p>
        </div>

        {/* 登录表单 */}
        <form onSubmit={handleSubmit} className="glass rounded-2xl p-6 space-y-4 border border-white/[0.06] shadow-2xl">
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">服务器地址</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://你的服务器地址:3000"
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-700 focus:outline-none focus:border-primary/50 focus:bg-white/[0.06] transition-all"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              用户名 <span className="text-gray-700">(站长可留空)</span>
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名"
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-700 focus:outline-none focus:border-primary/50 focus:bg-white/[0.06] transition-all"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-700 focus:outline-none focus:border-primary/50 focus:bg-white/[0.06] transition-all"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-2.5">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 disabled:opacity-50 text-white font-medium py-2.5 rounded-xl transition-all shadow-lg shadow-primary/20"
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-700 mt-6">
          填入你部署的 MoonTVPlus 服务地址与站长账号即可登录
        </p>
      </div>
    </div>
  )
}
