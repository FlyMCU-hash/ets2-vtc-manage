<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { request } from '@/kernel/http'
import { fail, ok } from '@/kernel/toast'
import { itemsOf } from '@/kernel/types'

const activities = ref<Record<string, unknown>[]>([])
const members = ref<Record<string, unknown>[]>([])
const records = ref<Record<string, unknown>[]>([])
const activityId = ref('all')
const open = ref(false)
const form = ref({ activityId: 0, memberId: 0, note: '' })

onMounted(async () => {
  try {
    activities.value = itemsOf(await request('/api/activities', { admin: true })) as Record<string, unknown>[]
    members.value = itemsOf(await request('/api/members', { admin: true })) as Record<string, unknown>[]
    if (activities.value[0]) form.value.activityId = Number(activities.value[0].id)
    if (members.value[0]) form.value.memberId = Number(members.value[0].id)
  } catch (error) {
    fail(error)
  }
  await load()
})

async function load() {
  try {
    const query = activityId.value === 'all' ? '' : `?activityId=${encodeURIComponent(activityId.value)}`
    const data = await request<Record<string, unknown>>(`/api/checkins${query}`, { admin: true })
    records.value = itemsOf(data) as Record<string, unknown>[]
  } catch (error) {
    fail(error)
  }
}
async function create() {
  try {
    await request('/api/checkins', { admin: true, method: 'POST', body: { ...form.value, note: form.value.note.trim() || null } })
    open.value = false
    ok('签到记录已创建')
    await load()
  } catch (error) {
    fail(error)
  }
}
async function scan() {
  try {
    const data = await request<Record<string, unknown>>('/api/checkins/scan', { admin: true, method: 'POST', body: {} })
    ok(`${data.message || '扫描完成'}（新增 ${data.created ?? 0} 条）`)
    await load()
  } catch (error) {
    fail(error)
  }
}
async function remove(item: Record<string, unknown>) {
  if (!window.confirm('删除这条签到记录？')) return
  try {
    await request(`/api/checkins/${item.id}`, { admin: true, method: 'DELETE' })
    ok('签到已删除')
    await load()
  } catch (error) {
    fail(error)
  }
}
</script>

<template>
  <header class="page-head">
    <div><h1>签到记录</h1></div>
    <div class="row">
      <button class="btn-ghost" @click="scan">扫码补签</button>
      <button class="btn" @click="open = true">创建签到</button>
    </div>
  </header>
  <label class="field"><span>活动</span>
    <select v-model="activityId" @change="load">
      <option value="all">全部活动</option>
      <option v-for="item in activities" :key="String(item.id)" :value="String(item.id)">{{ item.name }}</option>
    </select>
  </label>
  <div class="table-wrap">
    <table>
      <thead><tr><th>活动</th><th>成员</th><th>积分</th><th>备注</th><th>时间</th><th></th></tr></thead>
      <tbody>
        <tr v-for="item in records" :key="String(item.id)">
          <td>{{ item.activityName || item.activityId }}</td>
          <td>{{ item.name || item.tmpId }}</td>
          <td>{{ item.points ?? item.score ?? '—' }}</td>
          <td>{{ item.note || '—' }}</td>
          <td>{{ item.createdAt || item.time || '—' }}</td>
          <td><button class="btn-danger" @click="remove(item)">删除</button></td>
        </tr>
      </tbody>
    </table>
  </div>
  <div v-if="open" class="modal-back" @click.self="open = false">
    <div class="modal card">
      <h2>创建签到</h2>
      <label class="field"><span>活动</span>
        <select v-model.number="form.activityId">
          <option v-for="item in activities" :key="String(item.id)" :value="Number(item.id)">{{ item.name }}</option>
        </select>
      </label>
      <label class="field"><span>成员</span>
        <select v-model.number="form.memberId">
          <option v-for="item in members" :key="String(item.id)" :value="Number(item.id)">{{ item.number }} {{ item.name }}</option>
        </select>
      </label>
      <label class="field"><span>备注</span><input v-model="form.note" /></label>
      <div class="row"><button class="btn-ghost" @click="open = false">取消</button><button class="btn" @click="create">创建</button></div>
    </div>
  </div>
</template>
