import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'servers',
  title: '服务器',
  group: '接档器',
  order: 40,
  icon: 'servers',
  load: () => import('./Page.vue'),
}
export default mod
