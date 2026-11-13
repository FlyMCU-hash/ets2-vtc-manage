import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'checkins',
  title: '签到记录',
  group: '车队管理',
  order: 54,
  icon: 'check',
  permission: 'activities',
  load: () => import('./Page.vue'),
}
export default mod
