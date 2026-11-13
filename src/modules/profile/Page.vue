<script setup lang="ts">
import { ref } from 'vue'
import { request } from '@/kernel/http'
import { useSession } from '@/kernel/session'
import { fail, ok } from '@/kernel/toast'

const session = useSession()
const oldPassword = ref('')
const nextPassword = ref('')
const confirmPassword = ref('')

async function save() {
  if (nextPassword.value.length < 6) {
    fail('新密码至少 6 位')
    return
  }
  if (nextPassword.value !== confirmPassword.value) {
    fail('两次输入的新密码不一致')
    return
  }
  try {
    await request('/api/client/password', {
      method: 'PUT',
      body: {
        oldPassword: oldPassword.value,
        newPassword: nextPassword.value,
        confirmPassword: confirmPassword.value,
      },
    })
    oldPassword.value = ''
    nextPassword.value = ''
    confirmPassword.value = ''
    ok('密码已修改')
  } catch (error) {
    fail(error)
  }
}
</script>

<template>
  <header class="page-head"><div><h1>账号设置</h1></div></header>
  <div class="card" style="margin-bottom: 16px">
    <p>编号 {{ session.user?.number || '—' }} · TMP {{ session.user?.tmpId }}</p>
    <p>昵称 {{ session.user?.name }} · 职位 {{ session.user?.role || '—' }} · 积分 {{ session.user?.score ?? '—' }}</p>
    <p class="muted">QQ {{ session.user?.qq || '—' }} · 入队 {{ session.user?.joinDate || '—' }}</p>
    <p class="muted">{{ session.user?.isSuper ? '超级管理员' : session.user?.isAdmin ? '管理员' : '普通成员' }}</p>
  </div>
  <div class="card" style="max-width: 480px">
    <h2>修改密码</h2>
    <label class="field"><span>当前密码</span><input v-model="oldPassword" type="password" /></label>
    <label class="field"><span>新密码</span><input v-model="nextPassword" type="password" /></label>
    <label class="field"><span>确认新密码</span><input v-model="confirmPassword" type="password" /></label>
    <button class="btn" @click="save">保存密码</button>
  </div>
</template>
