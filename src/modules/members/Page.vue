<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { request } from '@/kernel/http'
import { fail, ok } from '@/kernel/toast'
import { itemsOf } from '@/kernel/types'

type Member = Record<string, unknown>
const items = ref<Member[]>([])
const query = ref('')
const editing = ref<Member | null>(null)
const form = reactive({ name: '', qq: '', role: '', score: '', password: '' })

const visible = computed(() => {
  const q = query.value.trim().toLowerCase()
  return items.value.filter((item) => {
    if (!q) return true
    return [item.number, item.tmpId, item.name, item.role].join(' ').toLowerCase().includes(q)
  })
})

onMounted(load)
async function load() {
  try {
    items.value = itemsOf(await request('/api/members', { admin: true })) as Member[]
  } catch (error) {
    fail(error)
  }
}
function edit(item: Member) {
  editing.value = item
  Object.assign(form, {
    name: `${item.name || ''}`,
    qq: `${item.qq || ''}`,
    role: `${item.role || ''}`,
    score: `${item.score ?? 0}`,
    password: '',
  })
}
async function save() {
  if (!editing.value) return
  try {
    await request(`/api/members/${editing.value.id}`, {
      admin: true,
      method: 'PUT',
      body: {
        name: form.name.trim(),
        qq: form.qq.trim() || null,
        role: form.role.trim() || null,
        score: Number(form.score) || 0,
        ...(form.password.trim() ? { password: form.password.trim() } : {}),
      },
    })
    editing.value = null
    ok('成员信息已更新')
    await load()
  } catch (error) {
    fail(error)
  }
}
async function leave(item: Member) {
  if (!window.confirm(`将「${item.name}」标记为离队？`)) return
  try {
    await request(`/api/members/${item.id}/leave`, { admin: true, method: 'POST', body: {} })
    ok('已标记离队')
    await load()
  } catch (error) {
    fail(error)
  }
}
async function remove(item: Member) {
  if (!window.confirm(`彻底删除「${item.name}」？此操作不可恢复。`)) return
  try {
    await request(`/api/members/${item.id}`, { admin: true, method: 'DELETE' })
    ok('成员已删除')
    await load()
  } catch (error) {
    fail(error)
  }
}
async function syncDates() {
  try {
    const data = await request<Record<string, unknown>>('/api/members/sync-join-dates', { admin: true, method: 'POST', body: {} })
    ok(`${data.message || '入队日期已同步'}`)
    await load()
  } catch (error) {
    fail(error)
  }
}
</script>

<template>
  <div class="fill-page">
    <header class="page-head">
      <div>
        <h1>成员管理</h1>
      </div>
      <div class="row">
        <button class="btn-ghost" @click="syncDates">同步入队日期</button>
        <button class="btn-ghost" @click="load">刷新</button>
      </div>
    </header>
  <label class="field"><span>搜索</span><input v-model="query" placeholder="昵称 / TMP / 编号 / 职位" /></label>
  <div class="table-wrap fit">
    <table>
      <thead><tr><th>编号</th><th>TMP</th><th>昵称</th><th>职位</th><th>QQ</th><th>积分</th><th>入队</th><th></th></tr></thead>
      <tbody>
        <tr v-for="item in visible" :key="String(item.id)" :class="{ 'is-left': item.left }">
          <td>{{ item.number || '—' }}</td><td>{{ item.tmpId }}</td>
          <td>{{ item.name }} <span v-if="item.left" class="pill danger">离队</span></td>
          <td>{{ item.role || '—' }}</td><td>{{ item.qq || '—' }}</td><td>{{ item.score ?? 0 }}</td><td>{{ item.joinDate || '—' }}</td>
          <td class="row">
            <button class="btn-ghost" @click="edit(item)">编辑</button>
            <button v-if="!item.left" class="btn-ghost" @click="leave(item)">离队</button>
            <button class="btn-danger" @click="remove(item)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <div v-if="editing" class="modal-back" @click.self="editing = null">
    <div class="modal card">
      <h2>编辑 {{ editing.name }}</h2>
      <label class="field"><span>昵称</span><input v-model="form.name" /></label>
      <label class="field"><span>QQ</span><input v-model="form.qq" /></label>
      <label class="field"><span>职位</span><input v-model="form.role" /></label>
      <label class="field"><span>积分</span><input v-model="form.score" /></label>
      <label class="field"><span>重置密码（留空不修改）</span><input v-model="form.password" type="password" /></label>
      <div class="row"><button class="btn-ghost" @click="editing = null">取消</button><button class="btn" @click="save">保存</button></div>
    </div>
  </div>
  </div>
</template>
