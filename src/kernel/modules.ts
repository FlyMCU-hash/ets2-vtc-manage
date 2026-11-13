import type { PeakModule } from './types'

const loaded = import.meta.glob<{ default: PeakModule }>('../modules/*/module.ts', { eager: true })

export const modules: PeakModule[] = Object.values(loaded)
  .map((file) => file.default)
  .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN'))

export const groupOrder = ['', '接档器', '车队管理', '商城管理', '系统设置']
