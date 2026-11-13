import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'online-users',
  title: '在线用户',
  group: '系统设置',
  order: 80,
  icon: 'radar',
  permission: 'monitor',
  load: () => import('./Page.vue'),
}
export default mod
