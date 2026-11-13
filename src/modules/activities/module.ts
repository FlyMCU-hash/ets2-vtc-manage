import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'activities',
  title: '活动管理',
  group: '车队管理',
  order: 53,
  icon: 'activity',
  permission: 'activities',
  load: () => import('./Page.vue'),
}
export default mod
