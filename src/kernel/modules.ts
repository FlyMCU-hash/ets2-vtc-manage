import { assertPeakModule, MODULE_GROUPS } from './contract'
import type { PeakModule } from './types'

const loaded = import.meta.glob<{ default: PeakModule }>('../modules/*/module.ts', { eager: true })

export const modules: PeakModule[] = Object.entries(loaded)
  .map(([path, file]) => assertPeakModule(file.default, path))
  .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN'))

const seen = new Set<string>()
for (const mod of modules) {
  if (seen.has(mod.id)) throw new Error(`模块 id 重复：${mod.id}`)
  seen.add(mod.id)
}

export const groupOrder = MODULE_GROUPS
