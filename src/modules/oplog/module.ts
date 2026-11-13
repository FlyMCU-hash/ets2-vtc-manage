import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'oplog',
  title: '操作记录',
  group: '系统设置',
  order: 110,
  icon: 'log',
  managerOnly: true,
  load: () => import('./Page.vue'),
}
export default mod
