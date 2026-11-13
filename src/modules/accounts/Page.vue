<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { request } from '@/kernel/http'
import { fail, ok } from '@/kernel/toast'
import { itemsOf } from '@/kernel/types'

const ROLE = '自定义账号'

interface Account {
  id: number
  number?: number | string
  tmpId?: string
  name?: string
  qq?: string
  isAdmin?: boolean | number
}

const form = reactive({
  login: '',
  name: '',
  password: '',
  qq: '',
  isAdmin: true,
})
const items = ref<Account[]>([])
const saving = ref(false)

function loginError(login: string) {
  if (!login) return '请填写登录账号'
  if (login.length < 2 || login.length > 64) return '登录账号长度需为 2–64 位'
  if (login.toLowerCase() === 'admin') return 'admin 为系统超级管理员账号，不可新增'
  if (!/^[\w\u4e00-\u9fff.@-]+$/i.test(login)) return '登录账号仅支持字母、数字、下划线和中文，不要含空格'
  return ''
}

async function load() {
  try {
    const data = await request('/api/members', { admin: true })
    items.value = (itemsOf(data) as Account[]).filter((item) => String((item as Account & { role?: string }).role || '') === ROLE)
  } catch (error) {
    fail(error)
  }
}

async function save() {
  const login = form.login.trim()
  const name = form.name.trim()
  const password = form.password
  const problem = loginError(login)
  if (problem) return fail(problem)
  if (!name) return fail('请填写昵称')
  if (password.length < 6) return fail('初始密码至少 6 位')
  saving.value = true
  try {
    await request('/api/members', {
      admin: true,
      method: 'POST',
      body: {
        tmpId: login,
        name,
        password,
        qq: form.qq.trim() || null,
        role: ROLE,
        score: 0,
        isAdmin: form.isAdmin,
      },
    })
    ok(`独立账号「${login}」已创建`)
    form.login = ''
    form.name = ''
    form.password = ''
    form.qq = ''
    form.isAdmin = true
    await load()
  } catch (error) {
    const message = error instanceof Error ? error.message : `${error}`
    fail(message.includes('TMP ID') ? message.replace(/TMP ID/g, '登录账号') : error)
  } finally {
    saving.value = false
  }
}

async function remove(item: Account) {
  if (!window.confirm(`确认删除独立账号「${item.tmpId || item.name}」？`)) return
  try {
    await request(`/api/members/${item.id}`, { admin: true, method: 'DELETE' })
    ok('已删除')
    await load()
  } catch (error) {
    fail(error)
  }
}

onMounted(load)
</script>

<template>
  <header class="page-head form-head">
    <div>
      <h1>账号创建</h1>
    </div>
  </header>
  <div class="card form-card">
    <div class="form-grid">
      <label class="field span-2"><span>登录账号</span><input v-model="form.login" placeholder="字母、数字或中文，2–64 位" @keyup.enter="save" /></label>
      <label class="field"><span>昵称</span><input v-model="form.name" placeholder="显示名称" /></label>
      <label class="field"><span>QQ</span><input v-model="form.qq" placeholder="选填" /></label>
      <label class="field span-2">
        <span>初始密码</span>
        <input v-model="form.password" type="password" placeholder="至少 6 位" @keyup.enter="save" />
      </label>
    </div>
    <div class="form-foot">
      <label class="check-line"><input v-model="form.isAdmin" type="checkbox" /> 设为管理员</label>
      <button class="btn" :disabled="saving" @click="save">{{ saving ? '创建中' : '创建' }}</button>
    </div>
  </div>
  <div class="card form-card account-list">
    <div class="row account-list-head">
      <strong>已有独立账号</strong>
      <button class="btn-ghost" @click="load">刷新</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>编号</th><th>登录账号</th><th>昵称</th><th>QQ</th><th>管理员</th><th></th></tr></thead>
        <tbody>
          <tr v-if="!items.length"><td colspan="6" class="muted">暂无独立账号</td></tr>
          <tr v-for="item in items" :key="item.id">
            <td>{{ item.number || '—' }}</td>
            <td>{{ item.tmpId || '—' }}</td>
            <td>{{ item.name || '—' }}</td>
            <td>{{ item.qq || '—' }}</td>
            <td>{{ item.isAdmin ? '是' : '否' }}</td>
            <td><button class="btn-danger" @click="remove(item)">删除</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.account-list { margin-top: 16px; }
.account-list-head { justify-content: space-between; margin-bottom: 10px; }
</style>
