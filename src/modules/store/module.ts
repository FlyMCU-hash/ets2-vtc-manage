import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'store',
  title: '积分商店',
  group: '商城管理',
  order: 60,
  icon: 'shop',
  load: () => import('./Page.vue'),
}
export default mod
