import { PERM_KEYS, type PeakModule, type PermKey } from './types'

export const MODULE_GROUPS = ['', '接档器', '车队管理', '商城管理', '系统设置']

export function assertPeakModule(raw: unknown, source: string): PeakModule {
  if (!raw || typeof raw !== 'object') throw new Error(`${source}: 模块导出无效`)
  const data = raw as Record<string, unknown>
  const missing = ['id', 'title', 'icon', 'load'].filter((key) => {
    const value = data[key]
    return value == null || value === ''
  })
  if (!('group' in data)) missing.push('group')
  if (!('order' in data)) missing.push('order')
  if (missing.length) throw new Error(`${source}: 缺少字段 ${missing.join('、')}`)

  if (typeof data.id !== 'string') throw new Error(`${source}: 字段 id 类型错误`)
  if (typeof data.title !== 'string') throw new Error(`${source}: 字段 title 类型错误`)
  if (typeof data.icon !== 'string') throw new Error(`${source}: 字段 icon 类型错误`)
  if (typeof data.group !== 'string' || !MODULE_GROUPS.includes(data.group)) {
    throw new Error(`${source}: 字段 group 无效`)
  }
  if (typeof data.order !== 'number' || !Number.isFinite(data.order)) {
    throw new Error(`${source}: 字段 order 类型错误`)
  }
  if (typeof data.load !== 'function') throw new Error(`${source}: 字段 load 类型错误`)
  if (data.permission != null && (typeof data.permission !== 'string' || !PERM_KEYS.includes(data.permission as PermKey))) {
    throw new Error(`${source}: 字段 permission 无效`)
  }
  for (const key of ['managerOnly', 'overlay', 'local'] as const) {
    if (data[key] != null && typeof data[key] !== 'boolean') {
      throw new Error(`${source}: 字段 ${key} 类型错误`)
    }
  }
  return data as unknown as PeakModule
}
