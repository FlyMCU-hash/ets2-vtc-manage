<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { request } from '@/kernel/http'
import { fail, ok } from '@/kernel/toast'
import { PERM_KEYS, type PermKey } from '@/kernel/types'

const defs = ref<{ key: PermKey; label: string }[]>(
  PERM_KEYS.map((key) => ({ key, label: { members: '成员', points: '积分', activities: '活动', store: '商城', monitor: '监控', settings: '设置' }[key] })),
)
const admins = ref<Record<string, unknown>[]>([])

onMounted(load)
async function load() {
  try {
    const data = await request<Record<string, unknown>>('/api/permissions', { admin: true })
    if (Array.isArray(data.defs) && data.defs.length) {
      defs.value = (data.defs as { key: PermKey; label: string }[]).filter((item) => PERM_KEYS.includes(item.key))
    }
    admins.value = Array.isArray(data.admins) ? (data.admins as Record<string, unknown>[]) : []
  } catch (error) {
    fail(error)
  }
}
function enabled(admin: Record<string, unknown>, key: PermKey) {
  const permissions = (admin.permissions || {}) as Record<string, boolean>
  if (admin.isSuper) return true
  return permissions[key] !== false
}
async function toggle(admin: Record<string, unknown>, key: PermKey) {
  if (admin.isSuper) return
  const current = { ...((admin.permissions || {}) as Record<string, boolean>) }
  current[key] = !enabled(admin, key)
  try {
    await request(`/api/permissions/${admin.id}`, { admin: true, method: 'PUT', body: { permissions: current } })
    ok('权限已更新')
    await load()
  } catch (error) {
    fail(error)
  }
}
</script>

<template>
  <header class="page-head"><div><h1>权限管理</h1></div></header>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>管理员</th>
          <th v-for="item in defs" :key="item.key">{{ item.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="admin in admins" :key="String(admin.id)">
          <td>{{ admin.name || admin.tmpId }} <span v-if="admin.isSuper" class="pill">超级</span></td>
          <td v-for="item in defs" :key="item.key">
            <input type="checkbox" :checked="enabled(admin, item.key)" :disabled="!!admin.isSuper" @change="toggle(admin, item.key)" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
