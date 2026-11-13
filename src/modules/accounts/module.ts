import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'accounts',
  title: '账号创建',
  group: '系统设置',
  order: 100,
  icon: 'plus',
  permission: 'settings',
  load: () => import('./Page.vue'),
}
export default mod
