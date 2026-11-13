import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'toolbox',
  title: '工具箱',
  group: '接档器',
  order: 45,
  icon: 'toolbox',
  load: () => import('./Page.vue'),
}
export default mod
