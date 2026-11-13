import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'home',
  title: '首页',
  group: '',
  order: 10,
  icon: 'home',
  load: () => import('./Page.vue'),
}
export default mod
