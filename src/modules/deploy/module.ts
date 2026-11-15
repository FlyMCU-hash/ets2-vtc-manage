import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'deploy',
  title: '存档部署',
  group: '接档器',
  order: 20,
  icon: 'deploy',
  local: true,
  load: () => import('./Page.vue'),
}
export default mod
