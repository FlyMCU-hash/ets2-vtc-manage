import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'about',
  title: '关于',
  group: '系统设置',
  order: 120,
  icon: 'info',
  load: () => import('./Page.vue'),
}
export default mod
