<script setup lang="ts">
import { openExternal } from '@/kernel/native'
import { APP_VERSION } from '@/kernel/types'
import logoUrl from '../../../logo.ico'
</script>

<template>
  <div class="fill-page about-page">
    <section class="card about-card">
      <img class="about-logo" :src="logoUrl" alt="" />
      <h1>Peak 车队中心</h1>
      <p class="muted ver">模块化桌面端 · {{ APP_VERSION }}</p>
      <p class="desc">界面按功能模块注册。本机欧卡操作由 Rust 模块完成，账号和车队数据走 Peak 平台。</p>
      <p class="muted tech">技术：Tauri 2、Vue 3、TypeScript、Rust。</p>
      <p class="about-dev">
        <span>开发者 哈士奇-Husky</span>
        <span class="muted">QQ 1247995265</span>
      </p>
      <div class="about-links">
        <button class="btn-ghost" @click="openExternal('https://www.lcayun.com/')">莱卡云</button>
        <button class="btn-ghost" @click="openExternal('https://www.aliyun.com/')">阿里云</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.about-page {
  align-items: center;
  justify-content: center;
}
.about-card {
  width: min(460px, 100%);
  margin: 0;
  padding: 36px 32px 28px;
  text-align: center;
}
.about-logo {
  width: 72px;
  height: 72px;
  margin: 0 auto 6px;
  display: block;
  border-radius: 18px;
  object-fit: cover;
}
.about-card h1 {
  margin: 2px 0 0;
  font-size: 26px;
  letter-spacing: 0.02em;
}
.ver { margin: 8px 0 0; }
.desc { margin: 18px 0 0; line-height: 1.7; }
.tech { margin: 8px 0 0; }
.about-dev {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  margin: 18px 0 0;
  flex-wrap: wrap;
}
.about-links {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
}
</style>
