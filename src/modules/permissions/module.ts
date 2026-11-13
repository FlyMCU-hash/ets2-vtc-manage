import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'permissions',
  title: '权限管理',
  group: '系统设置',
  order: 85,
  icon: 'lock',
  permission: 'settings',
  load: () => import('./Page.vue'),
}
export default mod
