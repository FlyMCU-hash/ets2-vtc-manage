<script setup lang="ts">
import { openExternal } from '@/kernel/native'

const links = [
  ['车队主页', 'https://peakvtc.cn', 'Peak 车队站点'],
  ['TruckersMP', 'https://truckersmp.com', '联机平台官网'],
  ['卡车世界', 'https://www.worldoftrucks.com', 'World of Trucks'],
  ['SCS 论坛', 'https://forum.scssoft.com', '游戏官方论坛'],
  ['欧卡工具箱', 'https://ets2.cn', '常用欧卡资料'],
]
</script>

<template>
  <header class="page-head">
    <div>
      <h1>首页</h1>
    </div>
  </header>
  <div class="grid">
    <button v-for="item in links" :key="item[1]" class="link-card" @click="openExternal(item[1])">
      <strong>{{ item[0] }}</strong>
      <p class="muted">{{ item[2] }}</p>
    </button>
  </div>
</template>
