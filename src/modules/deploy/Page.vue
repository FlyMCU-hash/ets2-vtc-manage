<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { loadDisableDlcs } from '@/kernel/dlc'
import { request } from '@/kernel/http'
import { native } from '@/kernel/native'
import { useSession } from '@/kernel/session'
import { storage } from '@/kernel/storage'
import { itemsOf, statusLabel, textOf } from '@/kernel/types'

type Activity = Record<string, unknown>
const session = useSession()
const items = ref<Activity[]>([])
const selectedId = ref<number | null>(null)
const status = ref<Record<string, unknown>>({})
const loading = ref(true)
const error = ref('')
const busy = ref(false)
const notice = ref('')
const noticeKind = ref<'ok' | 'err'>('ok')

function showNotice(kind: 'ok' | 'err', text: string) {
  noticeKind.value = kind
  notice.value = text
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, 3000)
}

let noticeTimer = 0

const selected = computed(() => items.value.find((item) => Number(item.id) === selectedId.value) || items.value[0])

function isDeployed(item: Activity) {
  return status.value.deployed === true && Number(status.value.activityId) === Number(item.id)
}

function dlcIdsOf(activity: Activity) {
  const raw = activity.dlcIds
  const list = Array.isArray(raw) ? raw : []
  return list.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
}

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = storage.adminToken()
      ? await request('/api/activities', { admin: true })
      : await request('/api/client/activities?status=all&today=0&singleDay=0')
    items.value = (itemsOf(data) as Activity[]).slice().sort((a, b) =>
      String(a.startDate || '').localeCompare(String(b.startDate || '')),
    )
    status.value = await native('deploy_status')
    const deployed = Number(status.value.activityId)
    if (items.value.some((item) => Number(item.id) === deployed)) selectedId.value = deployed
    else {
      const ongoing = items.value.find((item) => item.status === 'ongoing')
      selectedId.value = Number((ongoing || items.value[0])?.id || 0) || null
    }
  } catch (err) {
    error.value = `${err}`
  } finally {
    loading.value = false
  }
}

async function deploy() {
  const activity = selected.value
  if (!activity) return
  busy.value = true
  try {
    const detected = await native<Record<string, string>>('detect_ets2_paths', {
      ets2InstallPath: session.settings.ets2InstallPath,
      ets2DocumentsPath: session.settings.ets2DocumentsPath,
    })
    const settings = storage.saveSettings({
      ...session.settings,
      ets2InstallPath: detected.ets2InstallPath || session.settings.ets2InstallPath,
      ets2DocumentsPath: detected.ets2DocumentsPath || session.settings.ets2DocumentsPath,
    })
    session.settings = settings
    if (!settings.ets2DocumentsPath) throw new Error('未找到欧卡文档目录，请先到「平台设置」填写')
    const files = itemsOf(await request(`/api/client/activities/${activity.id}/files`)) as Record<string, unknown>[]
    const zip = files.find((file) => textOf(file, 'name').toLowerCase().endsWith('.zip'))
    if (!zip) throw new Error('该活动没有可部署的 zip 存档')
    const raw = textOf(zip, 'downloadUrl', 'url')
    const localPath = raw ? '' : textOf(zip, 'localPath', 'path')
    const downloadUrl = raw.startsWith('http') ? raw : raw ? `${settings.apiBase}${raw.startsWith('/') ? raw : `/${raw}`}` : ''
    await native('deploy_activity', {
      activityId: Number(activity.id),
      activityName: textOf(activity, 'name'),
      fileName: textOf(zip, 'name'),
      localPath,
      downloadUrl,
      apiBase: settings.apiBase,
      token: storage.token(),
      settings: {
        ets2InstallPath: settings.ets2InstallPath,
        ets2DocumentsPath: settings.ets2DocumentsPath,
        disableMapDlcOnDeploy: settings.disableMapDlcOnDeploy,
      },
      keepDlcIds: dlcIdsOf(activity),
      disableDlcs: (await loadDisableDlcs()).flatMap((item) => item.files.map((file) => ({ file, id: item.id }))),
    })
    showNotice('ok', '存档已部署')
    status.value = await native('deploy_status')
  } catch (err) {
    showNotice('err', err instanceof Error ? err.message : `${err}`)
  } finally {
    busy.value = false
  }
}

async function uninstall() {
  busy.value = true
  try {
    await native('uninstall_deploy')
    showNotice('ok', '存档已卸载')
    status.value = await native('deploy_status')
  } catch (err) {
    showNotice('err', err instanceof Error ? err.message : `${err}`)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>存档部署</h1>
    </div>
    <div class="row">
      <button class="btn-ghost" @click="load">刷新</button>
    </div>
  </header>
  <p v-if="notice" class="deploy-banner" :class="noticeKind">{{ notice }}</p>
  <p v-if="status.deployed" class="muted">
    当前已部署：{{ status.activityName }} · {{ status.deployedAt }}
    <button
      v-if="!items.some((item) => isDeployed(item))"
      class="btn-danger"
      :disabled="busy"
      @click="uninstall"
    >卸载存档</button>
  </p>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-else-if="loading" class="muted">正在读取活动…</p>
  <div v-else class="grid wide">
    <article
      v-for="item in items"
      :key="String(item.id)"
      class="card pick"
      :class="{ selected: Number(item.id) === Number(selected?.id) }"
      @click="selectedId = Number(item.id)"
    >
      <div class="row" style="justify-content: space-between; align-items: flex-start">
        <strong>{{ item.name }}</strong>
        <span class="pill">{{ statusLabel(String(item.status || '')) }}</span>
      </div>
      <p class="muted">{{ item.startDate }} ~ {{ item.endDate }}</p>
      <p>{{ item.location || '未填写地点' }}</p>
      <div class="card-actions">
        <button v-if="isDeployed(item)" class="btn-danger" :disabled="busy" @click.stop="uninstall">卸载存档</button>
        <button v-else class="btn" :disabled="busy" @click.stop="selectedId = Number(item.id); deploy()">部署</button>
      </div>
    </article>
    <p v-if="!items.length" class="muted">暂无活动</p>
  </div>
</template>
