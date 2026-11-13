import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'redeems',
  title: '兑换记录',
  group: '商城管理',
  order: 63,
  icon: 'truck',
  permission: 'store',
  load: () => import('./Page.vue'),
}
export default mod
