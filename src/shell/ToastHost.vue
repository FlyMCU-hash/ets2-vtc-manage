<script setup lang="ts">
import { toasts } from '@/kernel/toast'
</script>

<template>
  <div class="toasts">
    <div v-for="item in toasts()" :key="item.id" class="toast" :class="item.kind">{{ item.text }}</div>
  </div>
</template>
