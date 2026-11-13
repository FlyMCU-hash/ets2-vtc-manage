<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { request } from '@/kernel/http'
import { fail, ok } from '@/kernel/toast'
import { itemsOf } from '@/kernel/types'

type Member = Record<string, unknown>
const items = ref<Member[]>([])
const query = ref('')
const target = ref<Member | null>(null)
const delta = ref('')
const reason = ref('')
const total = computed(() => items.value.reduce((sum, item) => sum + Number(item.score || 0), 0))
const visible = computed(() => {
  const q = query.value.trim().toLowerCase()
  return items.value
    .filter((item) => !q || [item.name, item.tmpId, item.number].join(' ').toLowerCase().includes(q))
    .slice()
    .sort(compareNumber)
})
onMounted(load)
async function load() {
  try {
    const data = await request('/api/members', { admin: true })
    items.value = (itemsOf(data) as Member[]).filter((item) => !item.left)
  } catch (error) {
    fail(error)
  }
}
function rank(item: Member) {
  const text = `${item.number ?? ''}`.trim()
  const value = Number(text)
  return text && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}
function compareNumber(a: Member, b: Member) {
  const diff = rank(a) - rank(b)
  if (diff) return diff
  return `${a.name || ''}`.localeCompare(`${b.name || ''}`, 'zh')
}
function numberText(item: Member) {
  const text = `${item.number ?? ''}`.trim()
  return text || '—'
}
async function adjust() {
  const value = Number(delta.value)
  if (!target.value || !Number.isFinite(value) || value === 0) return fail('请输入非 0 的积分变动')
  try {
    await request('/api/points', {
      admin: true,
      method: 'POST',
      body: { memberId: target.value.id, delta: value, reason: reason.value.trim() || null },
    })
    ok(`「${target.value.name}」积分已${value > 0 ? '增加' : '减少'} ${Math.abs(value)}`)
    target.value = null
    delta.value = ''
    reason.value = ''
    await load()
  } catch (error) {
    fail(error)
  }
}
</script>

<template>
  <div class="fill-page">
    <header class="page-head">
      <div><h1>积分管理</h1><p class="muted">{{ items.length }} 人 · 总积分 {{ total }}</p></div>
      <button class="btn-ghost" @click="load">刷新</button>
    </header>
    <label class="field"><span>搜索</span><input v-model="query" placeholder="昵称 / TMP / 编号" /></label>
    <div class="fill-scroll">
      <div v-if="visible.length" class="grid mini">
        <article v-for="item in visible" :key="String(item.id)" class="card mini">
          <strong>{{ item.name }}</strong>
          <p><span class="pill">编号 {{ numberText(item) }}</span></p>
          <p class="muted">TMP {{ item.tmpId }}</p>
          <p class="point-score">{{ item.score ?? 0 }} <span class="muted">积分</span></p>
          <div class="card-actions">
            <button class="btn-ghost" @click="target = item">调整</button>
          </div>
        </article>
      </div>
      <p v-else class="muted">没有匹配的成员</p>
    </div>
    <div v-if="target" class="modal-back" @click.self="target = null">
      <div class="modal card">
        <h2>调整 {{ target.name }}</h2>
        <p class="muted">正数加分，负数减分。</p>
        <label class="field"><span>变动</span><input v-model="delta" /></label>
        <label class="field"><span>原因</span><input v-model="reason" /></label>
        <div class="row"><button class="btn-ghost" @click="target = null">取消</button><button class="btn" @click="adjust">确定</button></div>
      </div>
    </div>
  </div>
</template>
