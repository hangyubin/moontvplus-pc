import { client } from './api'

export interface LiveSource {
  key: string
  name: string
  url: string
  ua?: string
  epg?: string
  proxyMode?: string
  order?: number
}

export interface LiveChannel {
  name: string
  url: string
  tvgId?: string
  tvgLogo?: string
  group?: string
}

export interface LiveEpgProgram {
  start: string
  end: string
  title: string
  desc?: string
}

export async function getLiveSources(): Promise<LiveSource[]> {
  const res = await client.get('/api/live/sources')
  return res.data?.data || []
}

export async function getLiveChannels(source: string): Promise<LiveChannel[]> {
  const res = await client.get('/api/live/channels', { params: { source } })
  return res.data?.data || []
}

export async function getLiveEpg(source: string, tvgId: string): Promise<LiveEpgProgram[]> {
  try {
    const res = await client.get('/api/live/epg', { params: { source, tvgId } })
    return res.data?.data?.programs || []
  } catch {
    return []
  }
}

export async function precheckLive(url: string, source: string): Promise<string> {
  try {
    const res = await client.get('/api/live/precheck', { params: { url, 'moontv-source': source } })
    return res.data?.type || 'm3u8'
  } catch {
    return 'm3u8'
  }
}
