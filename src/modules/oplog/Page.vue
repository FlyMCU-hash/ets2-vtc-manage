<script setup lang="ts">
import { computed, ref } from 'vue'
import { clearLogs, formatTime, listLogs } from '@/kernel/oplog'
import { ok } from '@/kernel/toast'

const keyword = ref('')
const tick = ref(0)
const rows = computed(() => {
  tick.value
  return listLogs(keyword.value)
})

function refresh() {
  tick.value++
}
function clearAll() {
  if (!window.confirm('清空只影响本机记录，确定继续？')) return
  clearLogs()
  refresh()
  ok('本机操作记录已清空')
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>操作记录</h1>
    </div>
    <div class="row">
      <button class="btn-ghost" @click="refresh">刷新</button>
      <button class="btn-danger" @click="clearAll">清空</button>
    </div>
  </header>
  <label class="field"><span>搜索</span><input v-model="keyword" placeholder="账号、动作、详情" /></label>
  <div class="table-wrap">
    <table>
      <thead><tr><th>时间</th><th>账号</th><th>动作</th><th>详情</th></tr></thead>
      <tbody>
        <tr v-for="item in rows" :key="item.id">
          <td>{{ formatTime(item.time) }}</td>
          <td>{{ item.account }}</td>
          <td>{{ item.action }}</td>
          <td>{{ item.detail || '—' }}</td>
        </tr>
        <tr v-if="!rows.length"><td colspan="4" class="muted">暂无记录</td></tr>
      </tbody>
    </table>
  </div>
</template>
