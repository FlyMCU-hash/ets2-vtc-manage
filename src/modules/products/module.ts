import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'products',
  title: '商品管理',
  group: '商城管理',
  order: 62,
  icon: 'box',
  permission: 'store',
  load: () => import('./Page.vue'),
}
export default mod
