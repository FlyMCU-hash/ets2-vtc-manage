<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { checkAppUpdate } from '@/kernel/update'
import { useSession } from '@/kernel/session'
import LoginView from '@/shell/LoginView.vue'
import ShellView from '@/shell/ShellView.vue'
import ToastHost from '@/shell/ToastHost.vue'

const session = useSession()
const bootText = ref('正在检查更新…')

onMounted(async () => {
  const updating = await checkAppUpdate((text) => {
    bootText.value = text
  })
  if (updating) return
  bootText.value = '正在核对登录状态…'
  await session.boot()
})
</script>

<template>
  <div v-if="session.booting" class="boot">{{ bootText }}</div>
  <LoginView v-else-if="!session.user" />
  <ShellView v-else />
  <ToastHost />
</template>
