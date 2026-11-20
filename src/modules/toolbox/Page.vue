<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { native, openLocal } from '@/kernel/native'
import { useSession } from '@/kernel/session'
import { storage } from '@/kernel/storage'
import { fail, ok } from '@/kernel/toast'

type Option = { id: string; label: string }
const session = useSession()
const docs = ref('')
const saveState = ref<Record<string, unknown>>({})
const profileId = ref('')
const saveId = ref('')
const fly = ref<Record<string, unknown>>({})
const backup = ref<Record<string, unknown>>({})
const backupProfile = ref('')
const full = ref<Record<string, unknown>>({})
const fullProfile = ref('')
const chat = ref<Record<string, unknown>>({})
const chatText = ref('')
const chatInterval = ref(60)
const tag = ref<Record<string, unknown>>({})
const tagName = ref('Peak车队')
const fileSummary = computed(() => {
  const files = backup.value.files
  if (!Array.isArray(files)) return ''
  return files
    .map((file) => {
      const row = file as { name?: string; exists?: boolean }
      return `${row.name || ''}${row.exists ? '' : '（缺失）'}`
    })
    .join(' · ')
})
let chatTimer = 0

onMounted(async () => {
  await detect(false)
  await refreshChat()
  chatTimer = window.setInterval(() => void refreshChat(), 3000)
})
onUnmounted(() => window.clearInterval(chatTimer))

async function detect(forceMessage = true) {
  try {
    const detected = await native<Record<string, string>>('detect_ets2_paths', {
      ets2InstallPath: session.settings.ets2InstallPath,
      ets2DocumentsPath: session.settings.ets2DocumentsPath,
    })
    docs.value = detected.ets2DocumentsPath || ''
    if (detected.ets2DocumentsPath || detected.ets2InstallPath) {
      session.settings = storage.saveSettings({
        ...session.settings,
        ets2InstallPath: detected.ets2InstallPath || session.settings.ets2InstallPath,
        ets2DocumentsPath: detected.ets2DocumentsPath || session.settings.ets2DocumentsPath,
      })
    }
    await Promise.all([loadSave(), loadFly(), loadBackup(), loadFull(), loadTag()])
    if (forceMessage) ok(docs.value ? '已重新检测文档目录' : '仍未找到文档目录')
  } catch (error) {
    if (forceMessage) fail(error)
  }
}

function options(raw: unknown): Option[] {
  return Array.isArray(raw) ? raw.map((item) => item as Option) : []
}

async function loadSave() {
  saveState.value = await native('save_edit_status', { docsPath: docs.value, profileId: profileId.value, saveId: saveId.value })
  profileId.value = `${saveState.value.selectedProfileId || ''}`
  saveId.value = `${saveState.value.selectedSaveId || ''}`
}
async function applySave() {
  try {
    const result = await native<Record<string, unknown>>('save_edit_apply', { docsPath: docs.value, profileId: profileId.value, saveId: saveId.value })
    ok(`${result.message}，备份在 ${result.backupPath}`)
    await loadSave()
  } catch (error) {
    fail(error)
  }
}
async function loadFly() {
  fly.value = await native('fly_console_status', { docsPath: docs.value })
}
async function setFly(enabled: boolean) {
  try {
    const result = await native<Record<string, string>>(enabled ? 'fly_console_enable' : 'fly_console_disable', { docsPath: docs.value })
    ok(result.message)
    await loadFly()
  } catch (error) {
    fail(error)
  }
}
async function loadBackup() {
  backup.value = await native('backup_3c_status', { docsPath: docs.value, profileId: backupProfile.value })
  backupProfile.value = `${backup.value.selectedProfileId || ''}`
}
async function runBackup() {
  try {
    const result = await native<Record<string, string>>('backup_3c_run', { docsPath: docs.value, profileId: backupProfile.value })
    ok(result.message)
  } catch (error) {
    fail(error)
  }
}
async function loadFull() {
  full.value = await native('backup_profile_status', { docsPath: docs.value, profileId: fullProfile.value })
  fullProfile.value = `${full.value.selectedProfileId || ''}`
}
async function runFull() {
  try {
    const result = await native<Record<string, string>>('backup_profile_run', { docsPath: docs.value, profileId: fullProfile.value })
    ok(result.message)
  } catch (error) {
    fail(error)
  }
}
async function refreshChat() {
  chat.value = await native('auto_chat_status')
}
async function saveChat() {
  try {
    const result = await native<Record<string, string>>('auto_chat_configure', { text: chatText.value, intervalSecs: Math.max(60, Number(chatInterval.value) || 60) })
    ok(result.message)
    await refreshChat()
  } catch (error) {
    fail(error)
  }
}
async function startChat() {
  try {
    const result = await native<Record<string, string>>('auto_chat_start', { text: chatText.value, intervalSecs: Math.max(60, Number(chatInterval.value) || 60) })
    ok(result.message)
    await refreshChat()
  } catch (error) {
    fail(error)
  }
}
async function stopChat() {
  try {
    const result = await native<Record<string, string>>('auto_chat_stop')
    ok(result.message)
    await refreshChat()
  } catch (error) {
    fail(error)
  }
}
async function loadTag() {
  tag.value = await native('tmp_tag_status')
}
async function applyTag() {
  try {
    const result = await native<Record<string, string>>('tmp_tag_apply', { tagName: tagName.value || 'Peak车队' })
    ok(result.message)
    await loadTag()
  } catch (error) {
    fail(error)
  }
}
async function openBackup(method: string) {
  try {
    const result = await native<Record<string, string>>(method)
    if (result.path) await openLocal(result.path)
  } catch (error) {
    fail(error)
  }
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>工具箱</h1>
    </div>
    <button class="btn-ghost" @click="detect(true)">重新检测</button>
  </header>

  <div class="grid tools">
    <section class="card">
      <h2>飞行模式 / 控制台</h2>
      <p>开发者 {{ fly.developer ? '开' : '关' }} · 控制台 {{ fly.console ? '开' : '关' }}</p>
      <div class="row actions">
        <button class="btn" @click="setFly(true)">开启</button>
        <button class="btn-ghost" @click="setFly(false)">关闭</button>
        <button class="btn-ghost" @click="openBackup('fly_console_open')">打开备份</button>
      </div>
    </section>

    <section class="card">
      <h2>3C 配置备份</h2>
      <select v-model="backupProfile" @change="loadBackup"><option v-for="item in options(backup.profiles)" :key="item.id" :value="item.id">{{ item.label }}</option></select>
      <p class="muted">{{ fileSummary }}</p>
      <div class="row actions">
        <button class="btn" @click="runBackup">备份</button>
        <button class="btn-ghost" @click="openBackup('backup_3c_open')">打开目录</button>
      </div>
    </section>

    <section class="card">
      <h2>完整存档备份</h2>
      <select v-model="fullProfile" @change="loadFull"><option v-for="item in options(full.profiles)" :key="item.id" :value="item.id">{{ item.label }}</option></select>
      <p>文件 {{ full.fileCount || 0 }} · profile.sii {{ full.hasProfile ? '有' : '无' }} · save {{ full.hasSave ? '有' : '无' }}</p>
      <div class="row actions">
        <button class="btn" @click="runFull">备份</button>
        <button class="btn-ghost" @click="openBackup('backup_profile_open')">打开目录</button>
      </div>
    </section>

    <section class="card">
      <h2>存档一键修改</h2>
      <p class="muted">金钱 70000000，经验 575700，技能拉满，解锁城市和经销商，空车库升为大车库。</p>
      <select v-model="profileId" @change="loadSave"><option v-for="item in options(saveState.profiles)" :key="item.id" :value="item.id">{{ item.label }}</option></select>
      <select v-model="saveId" @change="loadSave"><option v-for="item in options(saveState.saves)" :key="item.id" :value="item.id">{{ item.label }}</option></select>
      <p>金钱 {{ saveState.money || '—' }} · 经验 {{ saveState.experience || '—' }} · 技能 {{ saveState.skillsMax ? '已满' : '未满' }}</p>
      <p class="muted">城市 {{ saveState.cities || 0 }} · 经销商 {{ saveState.dealers || 0 }} · 可升级车库 {{ saveState.garagesUpgradeable || 0 }} / {{ saveState.garagesTotal || 0 }}</p>
      <div class="row actions">
        <button class="btn" @click="applySave">写入</button>
        <button class="btn-ghost" @click="openBackup('save_edit_open')">打开备份</button>
      </div>
    </section>

    <section class="card">
      <h2>TMP 车队前缀</h2>
      <p class="muted">使用内置青色。请先退出欧卡和 TruckersMP。</p>
      <label class="field"><span>前缀</span><input v-model="tagName" /></label>
      <div class="row actions">
        <button class="btn" @click="applyTag">写入名字标签</button>
      </div>
    </section>

    <section class="card">
      <h2>挂机自动发言</h2>
      <p class="muted">游戏需已启动。间隔最低 60 秒。快捷键 F10 启动，F11 停止。{{ chat.hotkeys ? '' : '若快捷键无效，说明已被其他程序占用。' }}</p>
      <p>状态：{{ chat.running ? '运行中' : '未启动' }} · 游戏 {{ chat.gameRunning ? '已检测到' : '未检测到' }}</p>
      <label class="field"><span>发言</span><textarea v-model="chatText"></textarea></label>
      <label class="field"><span>间隔（秒）</span><input v-model.number="chatInterval" type="number" min="60" /></label>
      <div class="row actions">
        <button class="btn" :disabled="!chat.gameRunning" @click="startChat">启动</button>
        <button class="btn-ghost" @click="stopChat">停止</button>
        <button class="btn-ghost" @click="saveChat">保存</button>
      </div>
    </section>
  </div>
</template>