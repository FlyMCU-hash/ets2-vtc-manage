<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref } from 'vue'
import { fallbackDisableDlcs, loadDisableDlcs, type DisableDlc } from '@/kernel/dlc'
import { publicGet, request } from '@/kernel/http'
import { fail, ok } from '@/kernel/toast'
import { OFFICIAL_SERVERS, itemsOf, statusLabel, textOf } from '@/kernel/types'

const MapPolygon = defineAsyncComponent(() => import('./MapPolygon.vue'))

type Point = { lat: number; lng: number }
type Checkin = {
  id: number
  name: string
  points: number
  serverName: string
  type: 'fixed' | 'range'
  checkinTime: string
  startTime: string
  endTime: string
  polygon: Point[]
}
type CheckinMode = 'fixed' | 'range' | 'all'
type Activity = {
  id: number
  name: string
  startDate: string
  endDate: string
  location: string
  status: string
  dlcIds: number[] | string
  content: string
  checkinConfigs: Checkin[]
}
const items = ref<Activity[]>([])
const servers = ref<{ name: string; label: string }[]>([])
const dlcs = ref<DisableDlc[]>(fallbackDisableDlcs())
const mapConfig = ref<Record<string, unknown> | null>(null)
const editing = ref<Activity | null>(null)
const creating = ref(false)
const editorTab = ref<'basic' | 'dlc' | 'checkin'>('basic')
const files = ref<Record<string, unknown>[]>([])
const form = ref(blank())
const cfg = ref<Checkin | null>(null)
const cfgMode = ref<CheckinMode>('fixed')
const mapRef = ref<{ fit: () => void; focus: (lat: number, lng: number) => void } | null>(null)
const locateId = ref('')
const locating = ref(false)

function blank() {
  return {
    id: 0,
    name: '',
    startDate: '',
    endDate: '',
    location: '',
    status: 'upcoming',
    dlcIds: [] as number[],
    content: '',
    checkinConfigs: [] as Checkin[],
  }
}

let serversTask: Promise<void> | null = null
let mapTask: Promise<void> | null = null

onMounted(() => {
  load()
  loadDisableDlcs().then((list) => {
    dlcs.value = list
  })
})

function ensureEditorData() {
  serversTask ??= loadServerOptions().catch(() => {
    serversTask = null
  })
  mapTask ??= loadMapConfig().catch(() => {
    mapTask = null
  })
}

function toPicker(value: string) {
  const text = value.trim().replace(' ', 'T')
  if (!text) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00`
  return text.slice(0, 16)
}

function fromPicker(value: string) {
  const text = value.trim().replace('T', ' ')
  return text.length > 16 ? text.slice(0, 16) : text
}

async function loadServerOptions() {
  try {
    const payload = await publicGet(OFFICIAL_SERVERS)
    const bag = payload as Record<string, unknown>
    const list = Array.isArray(payload) ? payload : bag.response || bag.data || bag.items || []
    const rows = (Array.isArray(list) ? list : []).flatMap((raw) => {
      const row = raw as Record<string, unknown>
      const name = textOf(row, 'name', 'serverName')
      if (!name) return []
      return [{ name, game: textOf(row, 'game') }]
    })
    const counts = new Map<string, number>()
    for (const row of rows) counts.set(row.name, (counts.get(row.name) || 0) + 1)
    servers.value = rows.map((row) => {
      const label = row.game ? `${row.game} · ${row.name}` : row.name
      const duplicated = (counts.get(row.name) || 0) > 1
      return { name: duplicated ? label : row.name, label }
    })
  } catch {
    servers.value = []
  }
}

function dlcIdList(raw: unknown) {
  const source = Array.isArray(raw) ? raw : `${raw || ''}`.split(',')
  return source.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)
}

function toggleDlc(id: number) {
  const list = form.value.dlcIds
  form.value.dlcIds = list.includes(id) ? list.filter((item) => item !== id) : [...list, id]
}

async function loadMapConfig() {
  try {
    mapConfig.value = await request('/api/map/config', { admin: true })
  } catch {
    mapConfig.value = null
  }
}

async function load() {
  try {
    const list = itemsOf(await request('/api/activities', { admin: true })) as Activity[]
    items.value = list.slice().sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')))
  } catch (error) {
    fail(error)
  }
}

function openNew() {
  form.value = blank()
  creating.value = true
  editorTab.value = 'basic'
  editing.value = null
  files.value = []
  archiveNote.value = ''
  archiveNoteKind.value = ''
  editConfig(undefined, 'fixed')
  ensureEditorData()
}
function openEdit(item: Activity) {
  const configs = Array.isArray(item.checkinConfigs) ? item.checkinConfigs : []
  form.value = {
    id: Number(item.id),
    name: `${item.name || ''}`,
    startDate: toPicker(`${item.startDate || ''}`),
    endDate: toPicker(`${item.endDate || ''}`),
    location: `${item.location || ''}`,
    status: `${item.status || 'upcoming'}`,
    dlcIds: dlcIdList(item.dlcIds),
    content: `${item.content || ''}`,
    checkinConfigs: assignConfigIds(configs.map((raw, index) => normalizeConfig(raw as Record<string, unknown>, index))),
  }
  creating.value = true
  editorTab.value = 'basic'
  editing.value = item
  if (form.value.checkinConfigs.length) editConfig(form.value.checkinConfigs[0])
  else editConfig(undefined, 'fixed')
  archiveNote.value = ''
  archiveNoteKind.value = ''
  ensureEditorData()
  void loadFiles()
}
function normalizeConfig(raw: Record<string, unknown>, index: number): Checkin {
  return {
    id: Number(raw.id || index + 1),
    name: `${raw.name || ''}`,
    points: Number(raw.points || 0),
    serverName: `${raw.serverName || ''}`,
    type: raw.type === 'range' ? 'range' : 'fixed',
    checkinTime: clockOf(`${raw.checkinTime || ''}`),
    startTime: clockOf(`${raw.startTime || ''}`),
    endTime: clockOf(`${raw.endTime || ''}`),
    polygon: Array.isArray(raw.polygon) ? (raw.polygon as Point[]) : [],
  }
}
function sameServerName(actual: string, wanted: string) {
  const norm = (value: string) => value.toLowerCase().replace(/\s+/g, '').replace(/^(ets2|ats|promods)[·•.-]+/i, '').replace(/^\[[a-z0-9]+\]/, '')
  const left = norm(actual)
  const right = norm(wanted)
  return left === right || left.endsWith(right) || right.endsWith(left)
}

function clockOf(value: string) {
  const match = value.match(/(\d{2}:\d{2})/)
  return match ? match[1] : ''
}

function nextConfigId() {
  const used = form.value.checkinConfigs
    .map((item) => Number(item.id))
    .filter((id) => Number.isFinite(id) && id > 0 && id <= 2147483647)
  return (used.length ? Math.max(...used) : 0) + 1
}

function assignConfigIds(list: Checkin[]) {
  const used = new Set<number>()
  return list.map((item) => {
    let id = Number(item.id)
    if (!Number.isFinite(id) || id <= 0 || id > 2147483647 || used.has(id)) {
      id = 1
      while (used.has(id)) id += 1
    }
    used.add(id)
    return { ...item, id }
  })
}

function checkinMode(item: Checkin): CheckinMode {
  if (item.type === 'fixed') return 'fixed'
  const start = item.startTime.slice(-5)
  const end = item.endTime.slice(-5)
  if (start === '00:00' && end === '23:59') return 'all'
  return 'range'
}

function editConfig(item?: Checkin, preset?: CheckinMode) {
  const mode = item ? checkinMode(item) : preset || 'fixed'
  cfgMode.value = mode
  if (item) {
    cfg.value = { ...item, polygon: item.polygon.map((point) => ({ ...point })) }
    return
  }
  cfg.value = {
    id: nextConfigId(),
    name: '',
    points: 10,
    serverName: form.value.location,
    type: mode === 'fixed' ? 'fixed' : 'range',
    checkinTime: '19:00',
    startTime: '',
    endTime: '',
    polygon: [],
  }
}
function configSummary(item: Checkin) {
  const mode = checkinMode(item)
  const when = mode === 'fixed'
    ? item.checkinTime.slice(-5) || '未设时间'
    : mode === 'all'
      ? '全天'
      : `${item.startTime.slice(-5) || '?'}–${item.endTime.slice(-5) || '?'}`
  const area = item.polygon.length >= 3 ? `${item.polygon.length} 点` : '未画区域'
  return `${when} · ${item.points || 0} 积分 · ${area}`
}

function editingSavedConfig() {
  return form.value.checkinConfigs.some((item) => item.id === cfg.value?.id)
}

function openSavedConfig(item: Checkin) {
  if (cfg.value?.id === item.id) return
  if (!commitDraft()) return
  const saved = form.value.checkinConfigs.find((row) => row.id === item.id) || item
  editConfig(saved)
}

function startNewConfig() {
  if (!commitDraft()) return
  editConfig(undefined, 'fixed')
}

function removeConfig(item: Checkin) {
  form.value.checkinConfigs = form.value.checkinConfigs.filter((row) => row.id !== item.id)
  if (cfg.value?.id !== item.id) return
  const next = form.value.checkinConfigs[0]
  if (next) editConfig(next)
  else editConfig(undefined, 'fixed')
}

function commitDraft() {
  if (!cfg.value) return true
  const draft = cfg.value
  if (!draft.name.trim() && !draft.polygon.length) return true
  if (draft.polygon.length < 3) {
    fail('打卡区域至少 3 个顶点')
    return false
  }
  const day = fromPicker(form.value.startDate).slice(0, 10)
  const stamp = (time: string) => {
    const text = time.trim()
    if (!text) return ''
    if (text.length > 5) return fromPicker(text)
    return day ? `${day} ${text}` : text
  }
  const saved: Checkin = {
    ...draft,
    name: draft.name.trim() || draft.serverName || '打卡',
    type: cfgMode.value === 'fixed' ? 'fixed' : 'range',
    checkinTime: cfgMode.value === 'fixed' ? stamp(draft.checkinTime) : '',
    startTime: cfgMode.value === 'all' ? stamp('00:00') : cfgMode.value === 'range' ? stamp(draft.startTime) : '',
    endTime: cfgMode.value === 'all' ? stamp('23:59') : cfgMode.value === 'range' ? stamp(draft.endTime) : '',
    polygon: draft.polygon.map((point) => ({ ...point })),
  }
  form.value.checkinConfigs = [...form.value.checkinConfigs.filter((item) => item.id !== saved.id), saved]
  return true
}
async function locatePlayer() {
  const id = locateId.value.trim()
  if (!id) return fail('请先输入 TMP ID')
  locating.value = true
  try {
    const serverName = cfg.value?.serverName || ''
    const mapType = /promods/i.test(serverName) ? 'promods' : 'ets'
    const data = await request<Record<string, unknown>>(`/api/map/player/${encodeURIComponent(id)}?mapType=${mapType}&serverName=${encodeURIComponent(serverName)}`, { admin: true })
    const item = (data.item && typeof data.item === 'object' ? data.item : data) as Record<string, unknown>
    const lat = Number(item.lat)
    const lng = Number(item.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('未获取到坐标')
    mapRef.value?.focus(lat, lng)
    const where = `${item.serverName || ''}`.replace(/\(#\d+\)$/, '').trim()
    const wanted = serverName.trim()
    const same = !where || !wanted || sameServerName(where, wanted)
    ok(same ? `已定位 ${item.name || id}${where ? `，当前在「${where}」` : ''}` : `已定位 ${item.name || id}，当前在「${where}」，打卡配置要求「${wanted}」`)
  } catch (error) {
    fail(error)
  } finally {
    locating.value = false
  }
}
async function save() {
  if (!commitDraft()) return
  const startDate = fromPicker(form.value.startDate)
  const endDate = fromPicker(form.value.endDate) || (startDate ? `${startDate.slice(0, 10)} 23:59` : '')
  if (!form.value.name.trim() || !startDate) return fail('活动名称和开始时间不能为空')
  const body = {
    name: form.value.name.trim(),
    startDate,
    endDate,
    location: form.value.location.trim() || null,
    content: form.value.content.trim() || null,
    status: form.value.status,
    publishStatus: 'official',
    dlcIds: form.value.dlcIds,
    checkinConfigs: form.value.checkinConfigs.map((item) => ({
      ...item,
      checkinTime: fromPicker(item.checkinTime),
      startTime: fromPicker(item.startTime),
      endTime: fromPicker(item.endTime),
    })),
  }
  try {
    if (form.value.id) await request(`/api/activities/${form.value.id}`, { admin: true, method: 'PUT', body })
    else await request('/api/activities', { admin: true, method: 'POST', body })
    ok('活动已保存')
    creating.value = false
    await load()
  } catch (error) {
    fail(error)
  }
}
async function remove(item: Activity) {
  if (!window.confirm(`删除活动「${item.name}」？`)) return
  try {
    await request(`/api/activities/${item.id}`, { admin: true, method: 'DELETE' })
    ok('活动已删除')
    await load()
  } catch (error) {
    fail(error)
  }
}
async function loadFiles() {
  if (!form.value.id) return false
  try {
    files.value = itemsOf(await request(`/api/activities/${form.value.id}/files`, { admin: true })) as Record<string, unknown>[]
    return true
  } catch (error) {
    archiveNote.value = errorText(error)
    archiveNoteKind.value = 'err'
    fail(error)
    return false
  }
}
const archiveOver = ref(false)
const archiveBusy = ref(false)
const archiveNote = ref('')
const archiveNoteKind = ref<'ok' | 'err' | ''>('')
let archiveDepth = 0

function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : `${error ?? ''}`
  return message.replace(/^Error:\s*/, '').trim() || '上传失败'
}

function archiveLabel(file: Record<string, unknown>) {
  return `${file.name || ''}`.replace(/^\d{10,}_/, '')
}

function archiveSize(file: Record<string, unknown>) {
  const size = Number(file.size || 0)
  if (!Number.isFinite(size) || size <= 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function zipFiles(list: FileList | File[]) {
  return Array.from(list).filter((file) => file.name.toLowerCase().endsWith('.zip'))
}
async function sendArchives(list: File[]) {
  const zips = zipFiles(list)
  if (!form.value.id || archiveBusy.value) return
  if (!zips.length) {
    archiveNote.value = '请上传 zip 存档'
    archiveNoteKind.value = 'err'
    return fail('请上传 zip 存档')
  }
  const data = new FormData()
  zips.forEach((file) => data.append('files', file))
  archiveBusy.value = true
  archiveNote.value = `正在上传 ${zips.map((file) => file.name).join('、')}`
  archiveNoteKind.value = ''
  try {
    const before = new Set(files.value.map((file) => `${file.name}`))
    await request(`/api/activities/${form.value.id}/files`, { admin: true, method: 'POST', form: data })
    if (!(await loadFiles())) return
    const added = files.value.filter((file) => !before.has(`${file.name}`))
    if (!added.length) {
      archiveNote.value = '没有看到新存档，请再传一次'
      archiveNoteKind.value = 'err'
      return fail('没有看到新存档，请再传一次')
    }
    archiveNote.value = `上传成功：${added.map(archiveLabel).join('、')}`
    archiveNoteKind.value = 'ok'
    ok('存档已上传')
  } catch (error) {
    archiveNote.value = errorText(error)
    archiveNoteKind.value = 'err'
    fail(error)
  } finally {
    archiveBusy.value = false
  }
}
function upload(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length) return
  void sendArchives(Array.from(input.files)).finally(() => {
    input.value = ''
  })
}
function dragEnter() {
  archiveDepth += 1
  archiveOver.value = true
}
function dragLeave() {
  archiveDepth = Math.max(0, archiveDepth - 1)
  archiveOver.value = archiveDepth > 0
}
function dropArchive(event: DragEvent) {
  archiveDepth = 0
  archiveOver.value = false
  const dropped = event.dataTransfer?.files
  if (dropped?.length) void sendArchives(Array.from(dropped))
}
async function removeFile(file: Record<string, unknown>) {
  if (!window.confirm(`删除存档 ${file.name}？`)) return
  try {
    await request(`/api/activities/${form.value.id}/files/${encodeURIComponent(`${file.name}`)}`, { admin: true, method: 'DELETE' })
    archiveNote.value = `已删除 ${archiveLabel(file)}`
    archiveNoteKind.value = 'ok'
    ok('存档已删除')
    if (!(await loadFiles())) return
  } catch (error) {
    fail(error)
  }
}
</script>

<template>
  <header class="page-head">
    <div><h1>活动管理</h1></div>
    <button class="btn" @click="openNew">新建活动</button>
  </header>
  <div class="grid wide">
    <article v-for="item in items" :key="String(item.id)" class="card">
      <div class="row" style="justify-content: space-between; align-items: flex-start">
        <strong>{{ item.name }}</strong>
        <span class="pill">{{ statusLabel(String(item.status || '')) }}</span>
      </div>
      <p class="muted">{{ item.startDate }} ~ {{ item.endDate }}</p>
      <p>{{ item.location || '未填写地点' }}</p>
      <div class="card-actions">
        <button class="btn-ghost" @click="openEdit(item)">编辑</button>
        <button class="btn-danger" @click="remove(item)">删除</button>
      </div>
    </article>
    <p v-if="!items.length" class="muted">暂无活动</p>
  </div>
  <div v-if="creating" class="modal-back">
    <div class="modal card editor">
      <div class="editor-head">
        <h2>{{ form.id ? '编辑活动' : '新建活动' }}<template v-if="form.name"> · {{ form.name }}</template></h2>
        <button class="editor-x" type="button" @click="creating = false">×</button>
      </div>
      <div class="editor-tabs">
        <button type="button" :class="{ active: editorTab === 'basic' }" @click="editorTab = 'basic'">基本信息</button>
        <button type="button" :class="{ active: editorTab === 'dlc' }" @click="editorTab = 'dlc'">依赖 DLC</button>
        <button type="button" :class="{ active: editorTab === 'checkin' }" @click="editorTab = 'checkin'">打卡配置</button>
      </div>
      <div v-show="editorTab === 'basic'" class="basic-form">
        <label class="field"><span>活动名称</span><input v-model="form.name" /></label>
        <div class="basic-grid">
          <label class="field"><span>开始</span><input v-model="form.startDate" class="picker-field" type="datetime-local" /></label>
          <label class="field"><span>结束</span><input v-model="form.endDate" class="picker-field" type="datetime-local" /></label>
          <label class="field span-2"><span>服务器</span>
            <select v-model="form.location">
              <option value="">请选择服务器</option>
              <option v-if="form.location && !servers.some((server) => server.name === form.location)" :value="form.location">{{ form.location }}</option>
              <option v-for="server in servers" :key="server.name" :value="server.name">{{ server.label }}</option>
            </select>
          </label>
          <div class="field span-2">
            <span>状态</span>
            <div class="status-picks">
              <button type="button" :class="{ on: form.status === 'upcoming' }" @click="form.status = 'upcoming'">未开始</button>
              <button type="button" :class="{ on: form.status === 'ongoing' }" @click="form.status = 'ongoing'">进行中</button>
              <button type="button" :class="{ on: form.status === 'done' }" @click="form.status = 'done'">已结束</button>
            </div>
          </div>
        </div>
        <label class="field"><span>说明</span><textarea v-model="form.content" rows="3"></textarea></label>
        <div v-if="form.id" class="archive">
          <h2>存档文件</h2>
          <label
            class="archive-drop"
            :class="{ over: archiveOver }"
            @dragenter.prevent="dragEnter"
            @dragover.prevent="archiveOver = true"
            @dragleave.prevent="dragLeave"
            @drop.prevent="dropArchive"
          >
            <input type="file" accept=".zip,application/zip" multiple @change="upload" />
            <strong>{{ archiveBusy ? '正在上传…' : '把 zip 拖到这里' }}</strong>
            <span class="muted">{{ archiveBusy ? '请稍等，传完会显示在下面' : '或点击此框选择存档' }}</span>
          </label>
          <p v-if="archiveNote" class="archive-note" :class="archiveNoteKind">{{ archiveNote }}</p>
          <p v-else-if="!files.length" class="muted archive-empty">还没有存档。上传成功后，文件会列在这里。</p>
          <div v-for="file in files" :key="String(file.name)" class="archive-file">
            <span>{{ archiveLabel(file) }}</span>
            <span v-if="archiveSize(file)" class="muted">{{ archiveSize(file) }}</span>
            <button class="btn-danger" type="button" @click="removeFile(file)">删除</button>
          </div>
        </div>
      </div>
      <div v-show="editorTab === 'dlc'">
        <h2>依赖 DLC</h2>
        <p class="muted">勾选的 DLC 在部署存档时会保留。一个都不选，就禁用全部 {{ dlcs.length }} 个。</p>
        <template v-for="kind in ['地图', '客运', '挂车', '货物']" :key="kind">
          <template v-if="dlcs.some((item) => item.kind === kind)">
          <h3 class="area-title">{{ kind }}</h3>
          <div class="dlc-grid">
            <button
              v-for="dlc in dlcs.filter((item) => item.kind === kind)"
              :key="dlc.id"
              type="button"
              class="dlc-card"
              :class="{ on: form.dlcIds.includes(dlc.id) }"
              @click="toggleDlc(dlc.id)"
            >{{ dlc.name }}</button>
          </div>
          </template>
        </template>
        <div class="row editor-save" style="margin-top: 16px"><button class="btn" @click="save">保存活动</button></div>
      </div>
      <div v-if="editorTab === 'checkin' && cfg" class="editor-checkin">
        <div v-if="form.checkinConfigs.length" class="checkin-list">
          <div v-for="item in form.checkinConfigs" :key="item.id" class="checkin-item" :class="{ on: cfg.id === item.id }">
            <button type="button" class="checkin-open" @click="openSavedConfig(item)">
              <strong>{{ item.name || '未命名打卡' }}</strong>
              <span class="muted">{{ configSummary(item) }}</span>
            </button>
            <button type="button" class="btn-danger" @click="removeConfig(item)">删除</button>
          </div>
        </div>
        <button type="button" class="btn-ghost checkin-add" @click="startNewConfig">新增打卡配置</button>
        <h2>{{ editingSavedConfig() ? '编辑打卡配置' : '新增打卡配置' }}</h2>
        <div class="checkin-grid">
          <label class="field"><span>配置名称</span><input v-model="cfg.name" placeholder="配置名称" /></label>
          <label class="field points"><span>积分</span><input v-model.number="cfg.points" /></label>
          <label class="field"><span>服务器</span>
            <select v-model="cfg.serverName">
              <option value="">请选择服务器</option>
              <option v-for="server in servers" :key="server.name" :value="server.name">{{ server.label }}</option>
            </select>
          </label>
          <label class="field type"><span>打卡类型</span>
            <select v-model="cfgMode">
              <option value="fixed">定时定点</option>
              <option value="range">时间范围</option>
              <option value="all">全天</option>
            </select>
          </label>
          <label v-if="cfgMode === 'fixed'" class="field span-2"><span>打卡时间</span><input v-model="cfg.checkinTime" type="time" /></label>
          <template v-else-if="cfgMode === 'range'">
            <label class="field"><span>开始</span><input v-model="cfg.startTime" type="time" /></label>
            <label class="field"><span>结束</span><input v-model="cfg.endTime" type="time" /></label>
          </template>
        </div>
        <h3 class="area-title">打卡区域</h3>
        <div class="map-tools">
          <input v-model="locateId" placeholder="TMP ID" @keyup.enter="locatePlayer" />
          <button type="button" class="btn-ghost" :disabled="locating" @click="locatePlayer">{{ locating ? '定位中' : '定位玩家' }}</button>
          <button type="button" class="btn-ghost" @click="cfg.polygon = cfg.polygon.slice(0, -1)">撤销</button>
          <button type="button" class="btn-ghost" @click="cfg.polygon = []">清空</button>
          <button type="button" class="btn-ghost" @click="mapRef?.fit()">适应</button>
          <span class="pill map-count">{{ cfg.polygon.length }} 点</span>
        </div>
        <p class="muted map-hint">在地图上点击添加顶点，至少 3 点形成打卡多边形。</p>
        <MapPolygon ref="mapRef" :active="editorTab === 'checkin'" :points="cfg.polygon" :server-name="cfg.serverName" :config="mapConfig" @update="cfg.polygon = $event" />
        <div class="checkin-foot">
          <span class="muted">打卡 {{ form.checkinConfigs.length }} 项</span>
          <div class="row">
            <button type="button" class="btn-ghost" @click="creating = false">取消</button>
            <button type="button" class="btn" @click="save">保存活动</button>
          </div>
        </div>
      </div>
      <div v-show="editorTab === 'basic'" class="row editor-save" style="margin-top: 16px"><button class="btn" @click="save">保存活动</button></div>
    </div>
  </div>
</template>
