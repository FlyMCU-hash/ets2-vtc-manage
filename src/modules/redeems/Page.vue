<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { request } from '@/kernel/http'
import { fail, ok } from '@/kernel/toast'
import { itemsOf } from '@/kernel/types'

const items = ref<Record<string, unknown>[]>([])
const pendingOnly = ref(false)
function shipped(row: Record<string, unknown>) {
  return row.shipped === true || row.shipped === 1 || row.shipped === 'shipped' || row.shipStatus === 'shipped'
}
const visible = computed(() => items.value.filter((item) => !pendingOnly.value || !shipped(item)))
onMounted(load)
async function load() {
  try {
    items.value = itemsOf(await request('/api/redeems', { admin: true })) as Record<string, unknown>[]
  } catch (error) {
    fail(error)
  }
}
async function ship(item: Record<string, unknown>, shipStatus: string) {
  try {
    await request(`/api/redeems/${item.id}/ship`, { admin: true, method: 'PUT', body: { shipStatus } })
    ok(shipStatus === 'shipped' ? '已标记发货' : '已改回待发货')
    await load()
  } catch (error) {
    fail(error)
  }
}
async function remove(item: Record<string, unknown>) {
  if (!window.confirm('删除这条兑换记录？')) return
  try {
    await request(`/api/redeems/${item.id}`, { admin: true, method: 'DELETE' })
    ok('记录已删除')
    await load()
  } catch (error) {
    fail(error)
  }
}
</script>

<template>
  <header class="page-head">
    <div><h1>兑换记录</h1></div>
    <button class="btn-ghost" @click="pendingOnly = !pendingOnly">{{ pendingOnly ? '查看全部' : '只看待发货' }}</button>
  </header>
  <div class="table-wrap">
    <table>
      <thead><tr><th>成员</th><th>商品</th><th>积分</th><th>状态</th><th>备注</th><th></th></tr></thead>
      <tbody>
        <tr v-for="item in visible" :key="String(item.id)">
          <td>{{ item.name || item.tmpName || item.tmpId }}</td>
          <td>{{ item.productName }}</td>
          <td>{{ item.price }}</td>
          <td>{{ shipped(item) ? '已发货' : '待发货' }}</td>
          <td>{{ item.note || '—' }}</td>
          <td class="row">
            <button v-if="!shipped(item)" class="btn" @click="ship(item, 'shipped')">发货</button>
            <button v-else class="btn-ghost" @click="ship(item, 'pending')">改回待发货</button>
            <button class="btn-danger" @click="remove(item)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
