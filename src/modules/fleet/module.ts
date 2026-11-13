import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'fleet',
  title: '在线成员',
  group: '接档器',
  order: 30,
  icon: 'online',
  load: () => import('./Page.vue'),
}
export default mod
