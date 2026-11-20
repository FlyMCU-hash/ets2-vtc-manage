<script setup lang="ts">
import { nextTick, onErrorCaptured, ref, shallowRef, watch, type Component } from 'vue'

const props = defineProps<{
  moduleId: string
  loader: () => Promise<{ default: object }>
}>()

const failed = ref(false)
const message = ref('')
const attempt = ref(0)
const view = shallowRef<Component | null>(null)
let token = 0

function report(error: unknown) {
  failed.value = true
  view.value = null
  const text = error instanceof Error ? error.message : `${error ?? ''}`
  message.value = text.replace(/^Error:\s*/, '').trim() || '请检查网络后重试'
  console.error(`[模块 ${props.moduleId}]`, error)
}

async function mount() {
  const current = ++token
  failed.value = false
  message.value = ''
  view.value = null
  try {
    const loaded = await props.loader()
    if (current !== token) return
    view.value = loaded.default as Component
  } catch (error) {
    if (current !== token) return
    report(error)
  }
}

function retry() {
  attempt.value += 1
  void mount()
}

onErrorCaptured((error) => {
  failed.value = true
  view.value = null
  nextTick(() => report(error))
  return false
})

watch(
  () => props.moduleId,
  () => {
    attempt.value = 0
    void mount()
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="failed" class="module-error">
    <strong>该模块加载失败</strong>
    <p>{{ message }}</p>
    <button class="btn" type="button" @click="retry">重试</button>
  </div>
  <component :is="view" v-else-if="view" :key="attempt" />
</template>
