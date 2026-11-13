<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { native } from '@/kernel/native'
import { storage } from '@/kernel/storage'
import { useSession } from '@/kernel/session'
import { fail, ok } from '@/kernel/toast'

const session = useSession()
const form = reactive({ ...session.settings })
const busy = ref(false)
const file = ref<HTMLInputElement | null>(null)
const presets = ['#d5ebe6', '#f3e2b8', '#d4e2f8', '#f6d5cc', '#ddd6f5', '#243036']

const previewStyle = computed(() => ({
  backgroundColor: form.backgroundColor || 'var(--bg)',
  backgroundImage: form.backgroundImage ? `url("${form.backgroundImage}")` : 'none',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
}))

function rememberAppearance() {
  session.settings = storage.saveSettings({
    ...session.settings,
    backgroundColor: form.backgroundColor,
    backgroundImage: form.backgroundImage,
    theme: session.settings.theme,
  })
  session.applyAppearance()
}

function setColor(color: string) {
  form.backgroundColor = color ? color.toLowerCase() : ''
  rememberAppearance()
}

function onColor(event: Event) {
  setColor((event.target as HTMLInputElement).value)
}

async function detect() {
  busy.value = true
  try {
    const detected = await native<Record<string, string>>('detect_ets2_paths', {
      ets2InstallPath: form.ets2InstallPath,
      ets2DocumentsPath: form.ets2DocumentsPath,
    })
    form.ets2InstallPath = detected.ets2InstallPath || form.ets2InstallPath
    form.ets2DocumentsPath = detected.ets2DocumentsPath || form.ets2DocumentsPath
    ok(detected.ets2DocumentsPath ? '已检测到本机路径' : '没有检测到文档目录，请手动填写')
  } catch (error) {
    fail(error)
  } finally {
    busy.value = false
  }
}

async function save() {
  await session.saveSettings({ ...form, theme: session.settings.theme })
  ok('平台设置已保存')
}

function pickImage() {
  file.value?.click()
}

function clearImage() {
  form.backgroundImage = ''
  if (file.value) file.value.value = ''
  rememberAppearance()
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0]
  input.value = ''
  if (!picked) return
  if (!picked.type.startsWith('image/')) {
    fail('请选择图片')
    return
  }
  if (picked.size > 12 * 1024 * 1024) {
    fail('图片请小于 12MB')
    return
  }
  try {
    form.backgroundImage = await shrinkImage(picked)
    rememberAppearance()
    ok('背景图片已更换')
  } catch (error) {
    fail(error)
  }
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片无法读取'))
    img.src = url
  })
}

async function shrinkImage(picked: File) {
  const url = URL.createObjectURL(picked)
  try {
    const img = await loadImage(url)
    const max = 1600
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法处理图片')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    let quality = 0.8
    let data = canvas.toDataURL('image/jpeg', quality)
    while (data.length > 1_500_000 && quality > 0.4) {
      quality -= 0.15
      data = canvas.toDataURL('image/jpeg', quality)
    }
    if (data.length > 1_500_000) throw new Error('图片仍然太大，请换一张小一些的')
    return data
  } finally {
    URL.revokeObjectURL(url)
  }
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>平台设置</h1>
    </div>
    <div class="row">
      <button class="btn-ghost" :disabled="busy" @click="detect">自动检测</button>
      <button class="btn" @click="save">保存</button>
    </div>
  </header>
  <div class="card" style="max-width: 720px">
    <label class="field"><span>车队中心地址</span><input v-model="form.apiBase" placeholder="http://df.peakvtc.cn" /></label>
    <label class="field"><span>欧卡 2 安装目录</span><input v-model="form.ets2InstallPath" /></label>
    <label class="field"><span>存档文档目录</span><input v-model="form.ets2DocumentsPath" placeholder="Documents\Euro Truck Simulator 2" /></label>
    <label class="row"><input v-model="form.disableMapDlcOnDeploy" type="checkbox" /> 部署活动时禁用地图 DLC</label>
    <div class="field">
      <span>背景颜色</span>
      <div class="bg-colors">
        <button type="button" class="swatch swatch-default" :class="{ on: !form.backgroundColor }" title="默认" @click="setColor('')">默认</button>
        <button
          v-for="color in presets"
          :key="color"
          type="button"
          class="swatch"
          :class="{ on: form.backgroundColor === color }"
          :style="{ background: color }"
          :title="color"
          @click="setColor(color)"
        ></button>
        <input type="color" :value="form.backgroundColor || '#eef2f4'" aria-label="自选背景颜色" @input="onColor" />
      </div>
    </div>
    <div class="field">
      <span>背景图片</span>
      <div class="bg-preview" :style="previewStyle">{{ form.backgroundImage ? '' : '未设置图片' }}</div>
      <div class="row">
        <button type="button" class="btn-ghost" @click="pickImage">替换图片</button>
        <button v-if="form.backgroundImage" type="button" class="btn-ghost" @click="clearImage">移除图片</button>
      </div>
      <input ref="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden @change="onFile" />
    </div>
  </div>
</template>

<style scoped>
.bg-colors { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.swatch {
  width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--line); padding: 0; background: var(--panel);
}
.swatch-default { width: auto; border-radius: 999px; padding: 0 10px; font-size: 12px; color: var(--muted); }
.swatch.on { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent); }
.bg-colors input[type="color"] { width: 36px; height: 28px; padding: 0; border: 0; background: transparent; }
.bg-preview {
  height: 108px; border: 1px solid var(--line); border-radius: 12px;
  display: grid; place-items: center; color: var(--muted); font-size: 13px;
}
</style>
