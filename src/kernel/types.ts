export const APP_VERSION = 'V4.1.1'
export const DEFAULT_API = 'http://df.peakvtc.cn'
export const DEFAULT_SERVERS = 'http://110.42.60.187:9100/server/list'
export const OFFICIAL_SERVERS = 'https://api.truckersmp.com/v2/servers'

export type PermKey =
  | 'members'
  | 'points'
  | 'activities'
  | 'store'
  | 'monitor'
  | 'settings'

export const PERM_KEYS: PermKey[] = [
  'members',
  'points',
  'activities',
  'store',
  'monitor',
  'settings',
]

export interface MemberUser {
  id: number
  tmpId: string
  name: string
  number?: string
  role?: string
  score?: number
  isAdmin: boolean
  isSuper: boolean
  permissions?: Partial<Record<PermKey, boolean>>
  qq?: string
  joinDate?: string
}

export interface AppSettings {
  apiBase: string
  serversUrl: string
  theme: 'light' | 'dark'
  ets2InstallPath: string
  ets2DocumentsPath: string
  disableMapDlcOnDeploy: boolean
  backgroundColor: string
  backgroundImage: string
}

export interface PeakModule {
  id: string
  title: string
  group: string
  order: number
  icon: string
  permission?: PermKey
  managerOnly?: boolean
  overlay?: boolean
  /** 依赖本机欧卡或本机文件，网页端不显示。 */
  local?: boolean
  load: () => Promise<{ default: object }>
}

export function defaultApiBase() {
  if (typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window)) return window.location.origin
  return DEFAULT_API
}

export function defaultSettings(): AppSettings {
  return {
    apiBase: defaultApiBase(),
    serversUrl: DEFAULT_SERVERS,
    theme: 'light',
    ets2InstallPath: '',
    ets2DocumentsPath: '',
    disableMapDlcOnDeploy: true,
    backgroundColor: '',
    backgroundImage: '',
  }
}

export function sanitizeUrl(raw: unknown, fallback: string) {
  const text = `${raw ?? ''}`.trim()
  if (!text || text === 'null' || text === 'undefined') return fallback
  try {
    const url = new URL(text)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback
    if (!url.host) return fallback
    return text.replace(/\/$/, '')
  } catch {
    return fallback
  }
}

export function readSettings(raw: unknown): AppSettings {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    apiBase: sanitizeUrl(data.apiBase, defaultApiBase()),
    serversUrl: sanitizeUrl(data.serversUrl, DEFAULT_SERVERS),
    theme: data.theme === 'dark' ? 'dark' : 'light',
    ets2InstallPath: cleanText(data.ets2InstallPath),
    ets2DocumentsPath: cleanText(data.ets2DocumentsPath),
    disableMapDlcOnDeploy: data.disableMapDlcOnDeploy !== false,
    backgroundColor: cleanColor(data.backgroundColor),
    backgroundImage: cleanImage(data.backgroundImage),
  }
}

export function cleanColor(raw: unknown) {
  const text = `${raw ?? ''}`.trim()
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : ''
}

export function cleanImage(raw: unknown) {
  const text = `${raw ?? ''}`
  if (!text.startsWith('data:image/') || text.length > 1_500_000) return ''
  return text
}

export function cleanText(raw: unknown) {
  const text = `${raw ?? ''}`.trim()
  if (!text || text === 'null' || text === 'undefined') return ''
  return text
}

export function asUser(raw: unknown): MemberUser {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const permissions = data.permissions
  return {
    id: num(data.id),
    tmpId: `${data.tmpId ?? ''}`,
    name: `${data.name ?? ''}`,
    number: data.number == null ? undefined : `${data.number}`,
    role: data.role == null ? undefined : `${data.role}`,
    score: data.score == null ? undefined : Number(data.score),
    isAdmin: data.isAdmin === true,
    isSuper: data.isSuper === true,
    permissions:
      permissions && typeof permissions === 'object'
        ? Object.fromEntries(
            Object.entries(permissions as Record<string, unknown>).map(([key, value]) => [
              key,
              value === true,
            ]),
          )
        : undefined,
    qq: data.qq == null ? undefined : `${data.qq}`,
    joinDate: data.joinDate == null ? undefined : `${data.joinDate}`,
  }
}

export function num(raw: unknown) {
  const value = Number(raw)
  return Number.isFinite(value) ? value : 0
}

export function itemsOf(data: unknown, key = 'items') {
  const bag = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const list = bag[key]
  return Array.isArray(list) ? list.map((item) => (item && typeof item === 'object' ? item : {})) : []
}

export function textOf(row: object, ...keys: string[]) {
  const data = row as Record<string, unknown>
  for (const key of keys) {
    const value = data[key]
    if (value != null && `${value}`.trim()) return `${value}`
  }
  return ''
}

export function statusLabel(status: string) {
  if (status === 'ongoing') return '进行中'
  if (status === 'done') return '已结束'
  return '未开始'
}

export function isSingleDay(startDate?: string, endDate?: string) {
  const startDay = (startDate || '').slice(0, 10)
  if (!startDay) return false
  let endDay = (endDate || startDate || '').slice(0, 10)
  const endText = endDate || ''
  if (/[ T]00:00/.test(endText) && endDay > startDay) {
    const date = new Date(`${endDay}T00:00:00`)
    if (!Number.isNaN(date.getTime())) {
      date.setDate(date.getDate() - 1)
      const month = `${date.getMonth() + 1}`.padStart(2, '0')
      const day = `${date.getDate()}`.padStart(2, '0')
      endDay = `${date.getFullYear()}-${month}-${day}`
    }
  }
  return startDay === endDay
}
