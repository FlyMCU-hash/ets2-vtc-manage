<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { publicGet, request } from '@/kernel/http'
import { storage } from '@/kernel/storage'
import { itemsOf, textOf } from '@/kernel/types'

type Row = Record<string, unknown>
const members = ref<Row[]>([])
const players = ref<Row[]>([])
const servers = ref<Row[]>([])
const query = ref('')
const error = ref('')
let timer = 0

const serverName = (id: unknown) => {
  const found = servers.value.find((item) => `${item.id ?? item.serverId}` === `${id}`)
  return found ? textOf(found, 'name', 'serverName') : id ? `服务器 ${id}` : '未知服务器'
}

const rows = computed(() => {
  const byTmp = new Map(players.value.map((player) => [textOf(player, 'tmpId'), player]))
  const online: Row[] = []
  for (const member of members.value) {
    const player = byTmp.get(textOf(member, 'tmpId'))
    if (!player) continue
    online.push({
      ...member,
      gameName: textOf(player, 'name'),
      server: serverName(player.serverId),
    })
  }
  return online
})

const visible = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = rows.value.filter((row) => {
    if (!q) return true
    return [row.number, row.tmpId, row.name, row.role, row.server].join(' ').toLowerCase().includes(q)
  })
  const groups = new Map<string, Row[]>()
  for (const row of list) {
    const key = `${row.server}`
    const bucket = groups.get(key) || []
    bucket.push(row)
    groups.set(key, bucket)
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
})

const topServers = computed(() => visible.value.slice(0, 3).map(([name, list]) => `${name} ${list.length}`).join(' · '))

onMounted(() => {
  void refresh()
  timer = window.setInterval(() => void refresh(), 30000)
})
onUnmounted(() => window.clearInterval(timer))

async function refresh() {
  error.value = ''
  try {
    const [memberData, serverData, mapPlayers] = await Promise.all([
      request('/api/client/members'),
      loadServers(),
      loadPlayers(),
    ])
    members.value = itemsOf(memberData) as Row[]
    servers.value = serverData
    players.value = mapPlayers
  } catch (err) {
    error.value = `${err}`
  }
}

async function loadServers() {
  if (storage.adminToken()) {
    try {
      const data = await request('/api/servers', { admin: true })
      const list = normalizeServers(data)
      if (list.length) return list
    } catch {
      /* 改走公开服务器列表 */
    }
  }
  return normalizeServers(await publicGet(storage.settings().serversUrl))
}

async function loadPlayers() {
  const serversUrl = storage.settings().serversUrl
  const url = serversUrl.replace(/\/server\/list\/?$/i, '/map/playerList')
  return normalizePlayers(await publicGet(url))
}

function normalizeServers(payload: unknown) {
  const bag = payload as Record<string, unknown>
  const list = Array.isArray(payload) ? payload : bag.data || bag.items || bag.response || []
  return (Array.isArray(list) ? list : []).map((raw) => {
    const row = raw as Row
    return {
      id: row.serverId ?? row.id,
      name: textOf(row, 'serverName', 'name', 'shortName'),
    }
  }).filter((row) => row.name)
}

function normalizePlayers(payload: unknown) {
  const bag = payload as Record<string, unknown>
  const list = Array.isArray(payload) ? payload : bag.Data || bag.data || []
  return (Array.isArray(list) ? list : []).map((raw) => {
    const row = raw as Row
    return {
      tmpId: `${row.MpId ?? row.mpId ?? row.tmpId ?? ''}`.trim(),
      name: textOf(row, 'Name', 'name'),
      serverId: row.ServerId ?? row.serverId ?? 0,
    }
  }).filter((row) => row.tmpId)
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>在线成员</h1>
    </div>
    <button class="btn-ghost" @click="refresh">刷新</button>
  </header>
  <div class="stats">
    <div class="card stat"><span class="muted">车队在线</span><b>{{ rows.length }}</b></div>
    <div class="card stat"><span class="muted">在队总人数</span><b>{{ members.length }}</b></div>
    <div class="card stat"><span class="muted">地图玩家</span><b>{{ players.length }}</b></div>
  </div>
  <p v-if="topServers" class="muted">人数较多：{{ topServers }}</p>
  <label class="field"><span>搜索</span><input v-model="query" placeholder="昵称、TMP、编号、职位、服务器" /></label>
  <p v-if="error" class="error">{{ error }}</p>
  <section v-for="[server, list] in visible" :key="server" style="margin-bottom: 16px">
    <h2>{{ server }} · {{ list.length }}</h2>
    <div class="grid mini">
      <article v-for="row in list" :key="String(row.tmpId)" class="card mini">
        <strong>{{ row.name }}</strong>
        <p><span class="pill">编号 {{ row.number || '—' }}</span></p>
        <p>{{ row.role || '未填写职位' }}</p>
        <p class="muted">TMP {{ row.tmpId }} · {{ row.score ?? 0 }} 积分</p>
      </article>
    </div>
  </section>
  <p v-if="!error && !visible.length" class="muted">当前没有对上的在线成员。</p>
</template>
