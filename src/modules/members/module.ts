import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'members',
  title: '成员管理',
  group: '车队管理',
  order: 51,
  icon: 'member',
  permission: 'members',
  load: () => import('./Page.vue'),
}
export default mod
