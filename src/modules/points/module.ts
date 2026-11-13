import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'points',
  title: '积分管理',
  group: '车队管理',
  order: 52,
  icon: 'points',
  permission: 'points',
  load: () => import('./Page.vue'),
}
export default mod
