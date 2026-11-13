<script setup lang="ts">
import { reactive, ref } from 'vue'
import { publicGet, request } from '@/kernel/http'
import { native } from '@/kernel/native'
import { storage } from '@/kernel/storage'
import { fail, ok } from '@/kernel/toast'

const props = defineProps<{ requirePassword?: boolean; title?: string }>()
const form = reactive({
  number: '',
  tmpId: '',
  name: '',
  qq: '',
  role: '',
  score: '0',
  joinDate: '',
  password: '',
  isAdmin: false,
})
const looking = ref(false)

async function lookup() {
  const id = form.tmpId.trim()
  if (!id) return fail('请先输入 TMP ID')
  looking.value = true
  try {
    const player = await findPlayer(id)
    if (!player) throw new Error('未查询到该 TMP 玩家')
    const name = `${player.name || player.Name || ''}`.trim()
    if (name) form.name = name
    const role = roleText(player.vtcRole || player.role)
    if (role) form.role = role
    const joined = player.vtcJoinTime || player.joinDate || player.registerTime
    if (joined) form.joinDate = `${joined}`.slice(0, 10)
    ok(role ? `已填入昵称和职位「${role}」` : name ? `已填入昵称「${name}」` : '已查询到 TMP 资料')
  } catch (error) {
    fail(error)
  } finally {
    looking.value = false
  }
}

async function findPlayer(id: string) {
  try {
    const base = storage.settings().serversUrl.replace(/\/server\/list\/?$/i, '')
    const data = await publicGet(`${base}/player/info?tmpId=${encodeURIComponent(id)}`)
    const bag = data as Record<string, unknown>
    const raw = bag.data
    if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  } catch {
    /* 改走官方玩家资料 */
  }
  try {
    const data = await request<Record<string, unknown>>(`/api/tmp-player/${encodeURIComponent(id)}`, { admin: true })
    const raw = data.player || data.item || data.data
    if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  } catch {
    /* 改走本机查询 */
  }
  const data = await native<Record<string, unknown>>('tmp_lookup', { tmpId: id })
  const player = data.player
  return player && typeof player === 'object' ? player as Record<string, unknown> : null
}

function roleText(raw: unknown) {
  let text = `${raw ?? ''}`.trim()
  if (!text || text === 'null') return ''
  const slash = text.search(/\s*\/\s*[A-Za-z]/)
  if (slash >= 0) text = text.slice(0, slash).trim()
  const pipe = text.indexOf('|')
  if (pipe >= 0) text = text.slice(0, pipe).trim()
  return text
}

async function save() {
  if (!form.tmpId.trim() || !form.name.trim()) return fail('TMP ID 和昵称不能为空')
  if (props.requirePassword && form.password.trim().length < 6) return fail('初始密码至少 6 位')
  try {
    await request('/api/members', {
      admin: true,
      method: 'POST',
      body: {
        number: form.number.trim() || null,
        tmpId: form.tmpId.trim(),
        name: form.name.trim(),
        qq: form.qq.trim() || null,
        role: form.role.trim() || null,
        score: Number(form.score) || 0,
        joinDate: form.joinDate || null,
        password: form.password.trim() || null,
        isAdmin: form.isAdmin,
      },
    })
    ok(`「${form.name.trim()}」已创建`)
    Object.assign(form, { number: '', tmpId: '', name: '', qq: '', role: '', score: '0', joinDate: '', password: '', isAdmin: false })
  } catch (error) {
    fail(error)
  }
}
</script>

<template>
  <header class="page-head form-head">
    <div>
      <h1>{{ title || '新增成员' }}</h1>
    </div>
  </header>
  <div class="card form-card">
    <div class="form-grid">
      <label class="field"><span>编号</span><input v-model="form.number" placeholder="留空则自动分配" /></label>
      <label class="field"><span>职位</span><input v-model="form.role" placeholder="查询 TMP 后自动填入" /></label>
      <label class="field span-2">
        <span>TMP ID</span>
        <div class="lookup">
          <input v-model="form.tmpId" placeholder="输入后可查询昵称" @keyup.enter="lookup" />
          <button class="btn-ghost" :disabled="looking" @click="lookup">{{ looking ? '查询中' : '查询' }}</button>
        </div>
      </label>
      <label class="field"><span>昵称</span><input v-model="form.name" placeholder="查询后自动填入" /></label>
      <label class="field"><span>QQ</span><input v-model="form.qq" placeholder="选填" /></label>
      <label class="field"><span>初始积分</span><input v-model="form.score" /></label>
      <label class="field"><span>入队日期</span><input v-model="form.joinDate" type="date" /></label>
      <label class="field span-2">
        <span>初始密码</span>
        <input v-model="form.password" type="password" :placeholder="requirePassword ? '至少 6 位' : '可留空'" />
      </label>
    </div>
    <div class="form-foot">
      <label class="check-line"><input v-model="form.isAdmin" type="checkbox" /> 设为管理员</label>
      <button class="btn" @click="save">创建</button>
    </div>
  </div>
</template>
