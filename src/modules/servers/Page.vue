<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { collectServerPayloads } from '@/kernel/servers'
import { textOf } from '@/kernel/types'

type Feature = { label: string; on: boolean }
type Server = {
  id: string
  name: string
  game: string
  shortName: string
  online: boolean
  players: number
  max: number
  queue: number
  features: Feature[]
}
const items = ref<Server[]>([])
const onlyOnline = ref(false)
const error = ref('')
const visible = computed(() => items.value.filter((item) => !onlyOnline.value || item.online))
const onlineCount = computed(() => items.value.filter((item) => item.online).length)
const playerCount = computed(() => items.value.reduce((sum, item) => sum + item.players, 0))

onMounted(load)

function truthy(value: unknown) {
  return value === true || value === 1 || value === '1' || `${value}`.toLowerCase() === 'true'
}

function flag(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && value !== '') return truthy(value)
  }
  return false
}

async function load() {
  error.value = ''
  try {
    await collectServerPayloads((payload) => {
      const rows = normalize(payload)
      if (rows.length > items.value.length) items.value = rows
    })
    if (!items.value.length) error.value = '读取不到服务器列表'
  } catch (err) {
    error.value = err instanceof Error ? err.message : `${err}`
  }
}

function normalize(payload: unknown): Server[] {
  const bag = payload as Record<string, unknown>
  const list = Array.isArray(payload) ? payload : bag.data || bag.items || bag.response || []
  if (!Array.isArray(list)) return []
  return list.flatMap((raw) => {
    const row = raw as Record<string, unknown>
    const name = textOf(row, 'serverName', 'name', 'shortName')
    if (!name) return []
    const features: Feature[] = [
      { label: '限速', on: flag(row, ['speedLimiter', 'speedlimiter', 'speedLimiterEnable', 'speedlimiterenable']) },
      { label: '碰撞', on: flag(row, ['collisions', 'collisionsEnable', 'collisionsenable']) },
      { label: '小车', on: flag(row, ['carsForPlayers', 'carsforplayers', 'carsEnabled', 'carsenable', 'policeCarEnable', 'policecarenable']) },
      { label: 'AFK', on: flag(row, ['afkEnabled', 'afkenabled', 'afkEnable', 'afkenable']) },
    ]
    if (flag(row, ['promods']) || /promods/i.test(name)) features.push({ label: 'ProMods', on: true })
    if (flag(row, ['event']) || /\bevent\b/i.test(name)) features.push({ label: '活动服', on: true })
    return [{
      id: `${row.serverId ?? row.id ?? name}`,
      name,
      game: textOf(row, 'game'),
      shortName: textOf(row, 'shortName', 'shortname'),
      online: Number(row.isOnline ?? row.online) === 1 || row.isOnline === true || row.online === true,
      players: Number(row.playerCount ?? row.players ?? 0),
      max: Number(row.maxPlayer ?? row.maxplayers ?? 0),
      queue: Number(row.queueCount ?? row.queue ?? 0),
      features,
    }]
  })
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>服务器</h1>
      <p class="muted">在线 {{ onlineCount }} / {{ items.length }} · 玩家 {{ playerCount }}</p>
    </div>
    <div class="row">
      <button class="btn-ghost" @click="onlyOnline = !onlyOnline">{{ onlyOnline ? '全部' : '仅在线' }}</button>
      <button class="btn-ghost" @click="load">刷新</button>
    </div>
  </header>
  <p v-if="error" class="error">{{ error }}</p>
  <div class="grid">
    <article v-for="item in visible" :key="item.id" class="card">
      <div class="row" style="justify-content: space-between; align-items: flex-start">
        <strong>{{ item.name }}</strong>
        <span class="pill" :class="{ off: !item.online }">{{ item.online ? '在线' : '离线' }}</span>
      </div>
      <p class="muted">{{ [item.game, item.shortName].filter(Boolean).join(' · ') }}</p>
      <p>{{ item.players }} / {{ item.max || '—' }} 人</p>
      <div class="meter"><span :style="{ width: `${item.max ? Math.min(100, Math.round(item.players / item.max * 100)) : 0}%` }"></span></div>
      <p class="muted">排队 {{ item.queue }}</p>
      <div class="tags">
        <span v-for="tag in item.features" :key="tag.label" class="pill" :class="{ off: !tag.on }">{{ tag.label }}</span>
      </div>
    </article>
    <p v-if="!visible.length" class="muted">暂无服务器</p>
  </div>
</template>
