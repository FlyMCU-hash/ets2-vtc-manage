import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'my-redeems',
  title: '我的兑换',
  group: '商城管理',
  order: 61,
  icon: 'box',
  load: () => import('./Page.vue'),
}
export default mod
