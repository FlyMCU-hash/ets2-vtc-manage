import { storage } from './storage'
import type { MemberUser } from './types'

export interface OpLogEntry {
  id: string
  account: string
  tmpId: string
  action: string
  detail: string
  time: string
}

export function listLogs(keyword = '') {
  const query = keyword.trim().toLowerCase()
  const items = (storage.logs() as OpLogEntry[]).slice()
  if (!query) return items
  return items.filter((item) =>
    [item.account, item.tmpId, item.action, item.detail, formatTime(item.time)]
      .join(' ')
      .toLowerCase()
      .includes(query),
  )
}

export function recordLog(action: string, detail = '', user?: MemberUser | null) {
  const current = user === undefined ? storage.user() : user
  const account = !current
    ? '未登录'
    : current.name
      ? `${current.name}${current.tmpId ? ` (${current.tmpId})` : ''}`
      : current.tmpId || '未知账号'
  const entry: OpLogEntry = {
    id: `${Date.now()}`,
    account,
    tmpId: current?.tmpId || '',
    action,
    detail,
    time: new Date().toISOString(),
  }
  storage.saveLogs([entry, ...(storage.logs() as OpLogEntry[])])
}

export function clearLogs() {
  storage.clearLogs()
}

export function formatTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function describeWrite(method: string, path: string, body?: unknown) {
  const verb = method.toUpperCase()
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return null
  const clean = path.split('?')[0]
  if (clean.includes('/ping') || clean.endsWith('/me') || clean.includes('/login') || clean.includes('/logout')) {
    return null
  }
  const detail = bodyDetail(body)
  if (clean.includes('/password') && verb === 'PUT') return ['修改密码', '']
  if (clean.includes('/store/redeem')) return ['兑换商品', detail]
  if (/\/members\/?$/.test(clean) && verb === 'POST') return ['新增成员', detail]
  if (/\/members\/\d+$/.test(clean) && verb === 'PUT') return ['编辑成员', detail]
  if (/\/members\/\d+\/leave/.test(clean)) return ['成员离队', clean]
  if (/\/members\/\d+$/.test(clean) && verb === 'DELETE') return ['删除成员', clean]
  if (clean.includes('/members/sync')) return ['同步成员入队日期', '']
  if (/\/points\/?$/.test(clean) && verb === 'POST') return ['积分调整', detail]
  if (/\/activities\/?$/.test(clean) && verb === 'POST') return ['创建活动', detail]
  if (/\/activities\/\d+$/.test(clean) && verb === 'PUT') return ['编辑活动', detail]
  if (/\/activities\/\d+$/.test(clean) && verb === 'DELETE') return ['删除活动', clean]
  if (clean.includes('/files') && verb === 'POST') return ['上传活动文件', clean]
  if (clean.includes('/files') && verb === 'DELETE') return ['删除活动文件', clean]
  if (/\/checkins\/?$/.test(clean) && verb === 'POST') return ['登记签到', detail]
  if (clean.includes('/checkins/scan')) return ['扫描签到', '']
  if (/\/checkins\//.test(clean) && verb === 'DELETE') return ['删除签到', clean]
  if (/\/store\/?$/.test(clean) && verb === 'POST') return ['新增商品', detail]
  if (/\/store\/\d+$/.test(clean) && verb === 'PUT') return ['编辑商品', detail]
  if (/\/store\/\d+$/.test(clean) && verb === 'DELETE') return ['删除商品', clean]
  if (clean.includes('/redeems/') && clean.includes('/ship')) return ['兑换发货', clean]
  if (/\/redeems\/\d+$/.test(clean) && verb === 'DELETE') return ['删除兑换记录', clean]
  if (/\/online\//.test(clean) && verb === 'DELETE') return ['踢下线', clean]
  if (clean.includes('/permissions/')) return ['修改权限', clean]
  if (clean.includes('/dlc')) return ['DLC 操作', `${verb} ${clean}`]
  return ['接口操作', `${verb} ${clean}`]
}

function bodyDetail(body: unknown) {
  if (!body || typeof body !== 'object' || body instanceof FormData) return ''
  const data = body as Record<string, unknown>
  return ['name', 'tmpId', 'title', 'delta', 'reason']
    .filter((key) => data[key] != null && `${data[key]}`.trim())
    .map((key) => `${key}=${data[key]}`)
    .join(' · ')
}
