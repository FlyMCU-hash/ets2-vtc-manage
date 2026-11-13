<script setup lang="ts">
defineProps<{ name: string }>()

const paths: Record<string, string> = {
  home: 'M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-5H10v5H5a1 1 0 0 1-1-1z',
  deploy: 'M12 4v10m0 0 4-4m-4 4-4-4M5 18h14',
  online: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3 19c.4-2.4 2.4-4 5-4s4.6 1.6 5 4m1-4c1.8 0 3.4.9 4.2 2.4',
  servers: 'M4 6h16v4H4zm0 8h16v4H4z',
  toolbox: 'M4 8h16v11H4zM9 8V6h6v2',
  member: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm-7 8a7 7 0 0 1 14 0',
  points: 'M12 3 14.5 8.5 20 9.2l-4 4 1 5.8L12 16.5 7 19l1-5.8-4-4 5.5-.7z',
  activity: 'M5 5h14v14H5zM8 3v4M16 3v4M5 9h14',
  check: 'M5 12.5 9 16.5 19 7',
  shop: 'M4 8h16l-1.2 11H5.2zM8 8V6a4 4 0 0 1 8 0v2',
  box: 'M4 7h16v12H4zM4 11h16',
  truck: 'M3 16V8h11v8m0-5h4l3 3v2h-7M7 18a2 2 0 1 0 0.01 0M17 18a2 2 0 1 0 0.01 0',
  user: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm-6 8a6 6 0 0 1 12 0',
  radar: 'M12 12h.01M8.5 15.5a5 5 0 0 1 0-7M5 18a9 9 0 0 1 0-12M15.5 8.5a5 5 0 0 1 0 7M19 6a9 9 0 0 1 0 12',
  lock: 'M8 10V8a4 4 0 0 1 8 0v2M6 10h12v9H6z',
  plus: 'M12 5v14M5 12h14',
  gear: 'M12 8a4 4 0 1 0 0.01 0M4 12h2m12 0h2M12 4v2m0 12v2M6.2 6.2l1.4 1.4m8.8 8.8 1.4 1.4m0-11.6-1.4 1.4M7.6 16.4 6.2 17.8',
  log: 'M6 5h12v14H6zM9 9h6M9 13h6M9 17h3',
  info: 'M12 8h.01M11 12h1v5h1M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
}
</script>

<template>
  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path :d="paths[name] || paths.info" />
  </svg>
</template>
