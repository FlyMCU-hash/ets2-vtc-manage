<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { request } from '@/kernel/http'
import { useSession } from '@/kernel/session'
import { fail, ok } from '@/kernel/toast'
import { itemsOf } from '@/kernel/types'

type Product = Record<string, unknown>
const session = useSession()
const score = ref(0)
const items = ref<Product[]>([])
const target = ref<Product | null>(null)
const qq = ref('')
const note = ref('')

onMounted(load)

function priceOf(item: Product) {
  return Number(item.price) || 0
}
function stockOf(item: Product) {
  return Number(item.stock) || 0
}
function canRedeem(item: Product) {
  return stockOf(item) > 0 && score.value >= priceOf(item)
}
function redeemLabel(item: Product) {
  if (stockOf(item) <= 0) return '已兑完'
  if (score.value < priceOf(item)) return '积分不足'
  return '兑换'
}
function openRedeem(item: Product) {
  target.value = item
  qq.value = session.user?.qq || ''
  note.value = ''
}

async function load() {
  try {
    const data = await request<Record<string, unknown>>('/api/client/store')
    score.value = Number(data.score ?? data.myScore ?? session.user?.score ?? 0)
    items.value = itemsOf(data).filter((item) => (item as Product).status !== 'off') as Product[]
  } catch (error) {
    fail(error)
  }
}
async function redeem() {
  if (!target.value) return
  if (!qq.value.trim()) return fail('请填写收货 QQ')
  try {
    const data = await request<Record<string, unknown>>('/api/client/store/redeem', {
      method: 'POST',
      body: {
        productId: target.value.id,
        qq: qq.value.trim(),
        tmpId: session.user?.tmpId,
        note: note.value.trim() || null,
      },
    })
    ok(`${data.message || '兑换成功'}`)
    target.value = null
    note.value = ''
    await session.refreshMe()
    await load()
  } catch (error) {
    fail(error)
  }
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>积分商店</h1>
      <p class="shop-score">当前积分 <b>{{ score }}</b></p>
    </div>
    <button class="btn-ghost" @click="load">刷新</button>
  </header>
  <div v-if="items.length" class="shop-grid">
    <article v-for="item in items" :key="String(item.id)" class="shop-card" :class="{ off: stockOf(item) <= 0 }">
      <h2>{{ item.name }}</h2>
      <p class="shop-meta">
        <b>{{ priceOf(item) }}</b>
        <span>积分</span>
        <em :class="{ low: stockOf(item) <= 0 }">库存 {{ stockOf(item) }}</em>
      </p>
      <p v-if="item.desc" class="muted shop-desc">{{ item.desc }}</p>
      <button class="btn" :disabled="!canRedeem(item)" @click="openRedeem(item)">{{ redeemLabel(item) }}</button>
    </article>
  </div>
  <p v-else class="muted">暂无商品</p>
  <div v-if="target" class="modal-back" @click.self="target = null">
    <div class="modal card">
      <h2>兑换「{{ target.name }}」</h2>
      <p class="muted shop-need">需要 {{ priceOf(target) }} 积分，当前 {{ score }}</p>
      <label class="field"><span>收货 QQ</span><input v-model="qq" /></label>
      <label class="field"><span>备注</span><input v-model="note" /></label>
      <div class="row"><button class="btn-ghost" @click="target = null">取消</button><button class="btn" @click="redeem">确认兑换</button></div>
    </div>
  </div>
</template>
