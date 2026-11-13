import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'profile',
  title: '账号设置',
  group: '系统设置',
  order: 70,
  icon: 'user',
  load: () => import('./Page.vue'),
}
export default mod
