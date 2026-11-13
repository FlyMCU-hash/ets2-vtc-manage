<script setup lang="ts">
import { onMounted } from 'vue'
import { useSession } from '@/kernel/session'
import LoginView from '@/shell/LoginView.vue'
import ShellView from '@/shell/ShellView.vue'
import ToastHost from '@/shell/ToastHost.vue'

const session = useSession()
onMounted(() => session.boot())
</script>

<template>
  <div v-if="session.booting" class="boot">正在核对登录状态…</div>
  <LoginView v-else-if="!session.user" />
  <ShellView v-else />
  <ToastHost />
</template>
