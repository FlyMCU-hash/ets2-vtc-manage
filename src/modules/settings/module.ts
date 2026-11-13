import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'settings',
  title: '平台设置',
  group: '系统设置',
  order: 90,
  icon: 'gear',
  load: () => import('./Page.vue'),
}
export default mod
