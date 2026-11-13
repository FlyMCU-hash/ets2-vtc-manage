import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'changelog',
  title: '更新日志',
  group: '',
  order: 0,
  icon: 'info',
  overlay: true,
  load: () => import('./Page.vue'),
}
export default mod
