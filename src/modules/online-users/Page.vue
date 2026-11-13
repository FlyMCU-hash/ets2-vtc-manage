<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { request } from '@/kernel/http'
import { fail, ok } from '@/kernel/toast'
import { itemsOf } from '@/kernel/types'

const items = ref<Record<string, unknown>[]>([])
onMounted(load)
async function load() {
  try {
    items.value = itemsOf(await request('/api/online', { admin: true })) as Record<string, unknown>[]
  } catch (error) {
    fail(error)
  }
}
async function kick(item: Record<string, unknown>) {
  if (!window.confirm(`将「${item.loginName || item.id}」踢下线？`)) return
  try {
    await request(`/api/online/${item.id}`, { admin: true, method: 'DELETE' })
    ok('会话已踢下线')
    await load()
  } catch (error) {
    fail(error)
  }
}
</script>

<template>
  <header class="page-head">
    <div><h1>在线用户</h1></div>
    <button class="btn-ghost" @click="load">刷新</button>
  </header>
  <div class="table-wrap">
    <table>
      <thead><tr><th>登录名</th><th>主机</th><th>位置</th><th>客户端</th><th>登录时间</th><th></th></tr></thead>
      <tbody>
        <tr v-for="item in items" :key="String(item.id)">
          <td>{{ item.loginName || '—' }}</td>
          <td>{{ item.host || '—' }}</td>
          <td>{{ item.location || '—' }}</td>
          <td>{{ item.client || item.browser || '—' }}</td>
          <td>{{ item.loginAt || '—' }}</td>
          <td><button class="btn-danger" @click="kick(item)">踢下线</button></td>
        </tr>
        <tr v-if="!items.length"><td colspan="6" class="muted">暂无会话</td></tr>
      </tbody>
    </table>
  </div>
</template>
