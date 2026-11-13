import type { PeakModule } from '@/kernel/types'

const mod: PeakModule = {
  id: 'member-add',
  title: '新增成员',
  group: '车队管理',
  order: 50,
  icon: 'plus',
  permission: 'members',
  load: () => import('./Page.vue'),
}
export default mod
