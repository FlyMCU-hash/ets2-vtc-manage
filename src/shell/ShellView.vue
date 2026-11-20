<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { request } from '@/kernel/http'
import { groupOrder, modules } from '@/kernel/modules'
import { canAccess, isManager } from '@/kernel/perms'
import { useSession } from '@/kernel/session'
import { fail, ok } from '@/kernel/toast'
import { itemsOf } from '@/kernel/types'
import { isDesktop } from '@/kernel/native'
import { checkAppUpdate } from '@/kernel/update'
import logoUrl from '../../logo.ico'
import Icon from './Icon.vue'
import ModuleHost from './ModuleHost.vue'

const session = useSession()

const visible = computed(() =>
  modules.filter((mod) => {
    if (mod.overlay) return false
    if (mod.local && !isDesktop()) return false
    if (mod.managerOnly && !isManager(session.user)) return false
    return !mod.permission || canAccess(session.user, mod.permission)
  }),
)

const overlays = computed(() => modules.filter((mod) => mod.overlay && isDesktop()))

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

const checkingUpdate = ref(false)
const updateLabel = ref('检查更新')

async function checkUpdate() {
  if (checkingUpdate.value) return
  checkingUpdate.value = true
  updateLabel.value = '检查中…'
  try {
    const updating = await checkAppUpdate((text) => {
      updateLabel.value = text
    }, true)
    if (updating) {
      updateLabel.value = '安装完成'
      ok('更新已安装，请重新打开软件')
      return
    }
    updateLabel.value = '检查更新'
    ok('已是最新版本')
  } catch (error) {
    updateLabel.value = '检查更新'
    fail(error)
  } finally {
    checkingUpdate.value = false
  }
}

const current = computed(() => visible.value.find((mod) => mod.id === session.tab) || visible.value[0])

const navRef = ref<HTMLElement | null>(null)
let navRaf = 0

function applyNavMagnet(clientY: number) {
  const nav = navRef.value
  if (!nav) return
  const navRect = nav.getBoundingClientRect()
  nav.style.setProperty('--sweep-y', `${clientY - navRect.top}px`)
  const buttons = nav.querySelectorAll<HTMLElement>('.nav button')
  const range = 130
  const maxScale = 1.1
  buttons.forEach((btn) => {
    const rect = btn.getBoundingClientRect()
    const center = rect.top + rect.height / 2
    const dist = Math.abs(center - clientY)
    const t = dist < range ? 1 - dist / range : 0
    btn.style.setProperty('--nav-scale', (1 + (maxScale - 1) * t).toFixed(3))
    btn.style.setProperty('--nav-glow', t.toFixed(3))
  })
}

function onNavMove(e: MouseEvent) {
  cancelAnimationFrame(navRaf)
  navRaf = requestAnimationFrame(() => applyNavMagnet(e.clientY))
}

function resetNavMagnet() {
  cancelAnimationFrame(navRaf)
  const nav = navRef.value
  if (!nav) return
  nav.style.setProperty('--sweep-y', '-9999px')
  nav.querySelectorAll<HTMLElement>('.nav button').forEach((btn) => {
    btn.style.setProperty('--nav-scale', '1')
    btn.style.setProperty('--nav-glow', '0')
  })
}

onMounted(() => {
  const nav = navRef.value
  nav?.addEventListener('mousemove', onNavMove)
  nav?.addEventListener('mouseleave', resetNavMagnet)
})
onUnmounted(() => {
  const nav = navRef.value
  nav?.removeEventListener('mousemove', onNavMove)
  nav?.removeEventListener('mouseleave', resetNavMagnet)
})
</script>

<template>
  <div class="shell">
    <aside class="side" :class="{ collapsed: session.collapsed }">
      <div class="side-head">
        <img class="brand-logo" :src="logoUrl" alt="" />
        <strong v-if="!session.collapsed">Peak 车队中心</strong>
      </div>
      <nav class="nav" ref="navRef">
        <div class="nav-sweep" aria-hidden="true"></div>
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
          <button v-if="isDesktop()" class="btn-ghost" :disabled="checkingUpdate" @click="checkUpdate">{{ updateLabel }}</button>
          <button class="theme-toggle" role="switch"
            :aria-checked="session.settings.theme === 'dark'"
            :aria-label="session.settings.theme === 'dark' ? '切换到白天' : '切换到黑夜'"
            :title="session.settings.theme === 'dark' ? '黑夜模式' : '白天模式'"
            @click="session.setTheme(session.settings.theme === 'dark' ? 'light' : 'dark')">
            <span class="track">
              <span class="track-sun">☀️</span>
              <span class="track-moon">🌙</span>
              <span class="knob">
                <span class="knob-sun">☀️</span>
                <span class="knob-moon">🌙</span>
              </span>
            </span>
          </button>
        </div>
      </header>
      <div class="content">
        <KeepAlive :max="12">
          <ModuleHost v-if="current" :key="current.id" :module-id="current.id" :loader="current.load" />
        </KeepAlive>
      </div>
    </section>
    <ModuleHost v-for="mod in overlays" :key="mod.id" :module-id="mod.id" :loader="mod.load" />
  </div>
</template>