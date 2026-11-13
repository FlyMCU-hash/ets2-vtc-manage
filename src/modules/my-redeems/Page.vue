<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { request } from '@/kernel/http'
import { fail } from '@/kernel/toast'
import { itemsOf } from '@/kernel/types'

const items = ref<Record<string, unknown>[]>([])
function shipped(row: Record<string, unknown>) {
  return row.shipped === true || row.shipped === 1 || row.shipped === 'shipped' || row.shipStatus === 'shipped'
}
onMounted(async () => {
  try {
    items.value = itemsOf(await request('/api/client/redeems')) as Record<string, unknown>[]
  } catch (error) {
    fail(error)
  }
})
</script>

<template>
  <header class="page-head"><div><h1>我的兑换</h1></div></header>
  <div class="table-wrap">
    <table>
      <thead><tr><th>商品</th><th>积分</th><th>状态</th><th>时间</th></tr></thead>
      <tbody>
        <tr v-for="item in items" :key="String(item.id)">
          <td>{{ item.productName }}</td>
          <td>{{ item.price }}</td>
          <td><span class="pill" :class="{ off: !shipped(item) }">{{ shipped(item) ? '已发货' : '待发货' }}</span></td>
          <td>{{ item.createdAt || '—' }}</td>
        </tr>
        <tr v-if="!items.length"><td colspan="4" class="muted">还没有兑换记录</td></tr>
      </tbody>
    </table>
  </div>
</template>
