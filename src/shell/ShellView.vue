<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { request } from '@/kernel/http'
import { groupOrder, modules } from '@/kernel/modules'
import { canAccess, isManager } from '@/kernel/perms'
import { useSession } from '@/kernel/session'
import { itemsOf } from '@/kernel/types'
import logoUrl from '../../logo.ico'
import Icon from './Icon.vue'

const session = useSession()
const pageCache = ref<Record<string, ReturnType<typeof defineAsyncComponent>>>({})

const visible = computed(() =>
  modules.filter((mod) => {
    if (mod.overlay) return false
    if (mod.managerOnly && !isManager(session.user)) return false
    return !mod.permission || canAccess(session.user, mod.permission)
  }),
)

const overlays = computed(() => modules.filter((mod) => mod.overlay))

function overlayView(mod: (typeof modules)[number]) {
  pageCache.value[mod.id] ||= defineAsyncComponent(mod.load as never)
  return pageCache.value[mod.id]
}

const groups = computed(() =>
  groupOrder
    .map((label) => ({
      label,
      items: visible.value.filter((mod) => mod.group === label),
    }))
    .filter((group) => group.items.length),
)

watch(
  visible,
  (items) => {
    if (!items.some((mod) => mod.id === session.tab)) session.openTab('home')
  },
  { immediate: true },
)

const qq = ref('')
const avatarFailed = ref('')

function qqNumber(value: unknown) {
  const text = `${value ?? ''}`.replace(/\D/g, '')
  return text.length >= 5 ? text : ''
}

const avatar = computed(() => (qq.value ? `https://q1.qlogo.cn/g?b=qq&nk=${qq.value}&s=100` : ''))
const initial = computed(() => (session.user?.name || session.user?.tmpId || '?').slice(0, 1))

onMounted(async () => {
  session.applyAppearance()
  qq.value = qqNumber(session.user?.qq)
  try {
    const admin = isManager(session.user)
    const data = await request(admin ? '/api/members' : '/api/client/members', { admin })
    const mine = itemsOf(data).find((item) => {
      const row = item as { id?: unknown; tmpId?: unknown }
      return `${row.tmpId ?? ''}` === `${session.user?.tmpId ?? ''}` || Number(row.id) === session.user?.id
    }) as { qq?: unknown } | undefined
    const found = qqNumber(mine?.qq)
    if (found) qq.value = found
  } catch {
    // 名单取不到时，仍用登录资料里的 QQ。
  }
})

const current = computed(() => visible.value.find((mod) => mod.id === session.tab) || visible.value[0])
const view = computed(() => {
  const mod = current.value
  if (!mod) return null
  pageCache.value[mod.id] ||= defineAsyncComponent(mod.load as never)
  return pageCache.value[mod.id]
})
</script>

<template>
  <div class="shell">
    <aside class="side" :class="{ collapsed: session.collapsed }">
      <div class="side-head">
        <img class="brand-logo" :src="logoUrl" alt="" />
        <strong v-if="!session.collapsed">Peak 车队中心</strong>
      </div>
      <nav class="nav">
        <section v-for="group in groups" :key="group.label || 'root'">
          <div v-if="group.label && !session.collapsed" class="group-label">{{ group.label }}</div>
          <button
            v-for="item in group.items"
            :key="item.id"
            :class="{ active: item.id === session.tab }"
            :title="item.title"
            @click="session.openTab(item.id)"
          >
            <Icon :name="item.icon" />
            <span v-if="!session.collapsed">{{ item.title }}</span>
          </button>
        </section>
      </nav>
      <div class="side-foot">
        <div class="side-user">
          <img v-if="avatar && avatarFailed !== avatar" class="user-avatar" :src="avatar" alt="" @error="avatarFailed = avatar" />
          <span v-else class="user-avatar user-avatar-fallback">{{ initial }}</span>
          <div v-if="!session.collapsed" class="user-meta">
            <strong>{{ session.user?.name || '未命名' }}</strong>
            <span>{{ session.user?.tmpId }}</span>
          </div>
        </div>
        <button v-if="!session.collapsed" class="btn-ghost" @click="session.logout()">退出</button>
        <button v-else class="btn-ghost side-logout" title="退出" @click="session.logout()">退出</button>
      </div>
    </aside>
    <section class="main">
      <header class="topbar">
        <button class="btn-ghost" @click="session.toggleNav()">{{ session.collapsed ? '展开' : '收起' }}</button>
        <div class="row">
          <button class="btn-ghost" @click="session.setTheme(session.settings.theme === 'dark' ? 'light' : 'dark')">
            {{ session.settings.theme === 'dark' ? '白天' : '黑夜' }}
          </button>
        </div>
      </header>
      <div class="content">
        <KeepAlive :max="12">
          <component :is="view" v-if="view" :key="session.tab" />
        </KeepAlive>
      </div>
    </section>
    <component v-for="mod in overlays" :key="mod.id" :is="overlayView(mod)" />
  </div>
</template>
