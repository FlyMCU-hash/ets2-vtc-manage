<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { request } from '@/kernel/http'
import { storage } from '@/kernel/storage'
import { useSession } from '@/kernel/session'
import logoUrl from '../../logo.ico'

const session = useSession()
const tmpId = ref('')
const password = ref('')
const busy = ref(false)
const done = ref(false)
const ping = ref('检测服务器…')
const online = ref(false)
const errorText = ref('')
const accounts = ref(storage.accounts())
const accountOpen = ref(false)

onMounted(async () => {
  const saved = accounts.value[0]
  if (saved) {
    tmpId.value = saved.tmpId
    password.value = saved.password
  }
  await checkServer()
})

function toggleAccounts() {
  accounts.value = storage.accounts()
  accountOpen.value = !accountOpen.value
}

function pickAccount(item: { tmpId: string; password: string }) {
  tmpId.value = item.tmpId
  password.value = item.password
  accountOpen.value = false
}

function removeAccount(item: { tmpId: string }) {
  storage.forgetAccount(item.tmpId)
  accounts.value = storage.accounts()
  if (tmpId.value === item.tmpId) {
    const next = accounts.value[0]
    tmpId.value = next?.tmpId || ''
    password.value = next?.password || ''
  }
  if (!accounts.value.length) accountOpen.value = false
}

function closeAccounts(event: FocusEvent) {
  const next = event.relatedTarget
  const root = event.currentTarget
  if (!(root instanceof HTMLElement) || !(next instanceof Node) || !root.contains(next)) accountOpen.value = false
}

function applyServer() {
  session.settings = storage.settings()
}

async function checkServer() {
  applyServer()
  ping.value = '检测服务器…'
  online.value = false
  try {
    const data = await request<Record<string, unknown>>('/api/client/ping')
    ping.value = `${data.message || '车队中心在线'}`
    online.value = true
  } catch (error) {
    ping.value = error instanceof Error && error.message ? error.message : '无法连接服务器'
  }
}

async function submit() {
  applyServer()
  errorText.value = ''
  if (!tmpId.value.trim() || !password.value) {
    errorText.value = '请输入 TMP ID 和密码'
    return
  }
  busy.value = true
  try {
    await session.login(tmpId.value.trim(), password.value)
    busy.value = false
    done.value = true
    await nextTick()
    await wait(1100)
    await session.enter()
  } catch (error) {
    busy.value = false
    done.value = false
    errorText.value = error instanceof Error ? error.message.replace(/^Error:\s*/, '') : `${error}`
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
</script>

<template>
  <div class="login">
    <form class="login-card" :class="{ leaving: done }" @submit.prevent="submit">
      <img class="login-logo" :src="logoUrl" alt="" />
      <h1>Peak 车队中心</h1>
      <p class="ping" :class="{ ok: online }"><i></i>{{ ping }}</p>
      <label class="field">
        <span>TMP ID</span>
        <div class="login-id" :class="{ open: accountOpen }" @focusout="closeAccounts">
          <input v-model="tmpId" autocomplete="username" />
          <button v-if="accounts.length" type="button" class="login-id-toggle" aria-label="选择已保存账号" @mousedown.prevent @click="toggleAccounts">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6.5 8 10.5 12 6.5" /></svg>
          </button>
          <ul v-if="accountOpen" class="login-accounts" @mousedown.prevent>
            <li v-for="item in accounts" :key="item.tmpId">
              <button type="button" class="login-account-pick" @click="pickAccount(item)">
                <strong>{{ item.name && item.name !== item.tmpId ? item.name : item.tmpId }}</strong>
                <span v-if="item.name && item.name !== item.tmpId">{{ item.tmpId }}{{ item.password ? '' : ' · 未保存密码' }}</span>
                <span v-else-if="!item.password">未保存密码</span>
              </button>
              <button type="button" class="login-account-remove" aria-label="删除这条记录" @click="removeAccount(item)">×</button>
            </li>
          </ul>
        </div>
      </label>
      <label class="field"><span>密码</span><input v-model="password" type="password" autocomplete="current-password" /></label>
      <p v-if="errorText" class="login-error">{{ errorText }}</p>
      <button class="btn login-submit" :class="{ busy, done }" :disabled="busy || done" type="submit">
        <span v-if="!busy && !done" class="login-submit-label">登录</span>
        <i v-else-if="busy" class="login-spin"></i>
        <svg v-else class="login-check" viewBox="0 0 52 52" aria-hidden="true">
          <path class="login-check-path" d="M14 27 L23 36 L38 18" />
        </svg>
      </button>
    </form>
  </div>
</template>
