<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { request } from '@/kernel/http'
import { fail, ok } from '@/kernel/toast'
import { itemsOf } from '@/kernel/types'

type Product = Record<string, unknown>
const items = ref<Product[]>([])
const open = ref(false)
const editing = ref<number | null>(null)
const form = reactive({ name: '', price: '0', stock: '0', desc: '', status: 'on' })

onMounted(load)
async function load() {
  try {
    items.value = itemsOf(await request('/api/store', { admin: true })) as Product[]
  } catch (error) {
    fail(error)
  }
}
function create() {
  editing.value = null
  Object.assign(form, { name: '', price: '0', stock: '0', desc: '', status: 'on' })
  open.value = true
}
function edit(item: Product) {
  editing.value = Number(item.id)
  Object.assign(form, {
    name: `${item.name || ''}`,
    price: `${item.price ?? 0}`,
    stock: `${item.stock ?? 0}`,
    desc: `${item.desc || ''}`,
    status: item.status === 'off' ? 'off' : 'on',
  })
  open.value = true
}
async function save() {
  if (!form.name.trim()) return fail('商品名称不能为空')
  const body = { name: form.name.trim(), price: Number(form.price) || 0, stock: Number(form.stock) || 0, status: form.status, desc: form.desc.trim() }
  try {
    if (editing.value) await request(`/api/store/${editing.value}`, { admin: true, method: 'PUT', body })
    else await request('/api/store', { admin: true, method: 'POST', body })
    open.value = false
    ok('商品已保存')
    await load()
  } catch (error) {
    fail(error)
  }
}
async function remove(item: Product) {
  if (!window.confirm(`删除商品「${item.name}」？`)) return
  try {
    await request(`/api/store/${item.id}`, { admin: true, method: 'DELETE' })
    ok('商品已删除')
    await load()
  } catch (error) {
    fail(error)
  }
}
</script>

<template>
  <header class="page-head">
    <div><h1>商品管理</h1></div>
    <button class="btn" @click="create">新增商品</button>
  </header>
  <div class="table-wrap">
    <table>
      <thead><tr><th>名称</th><th>积分</th><th>库存</th><th>状态</th><th>说明</th><th></th></tr></thead>
      <tbody>
        <tr v-for="item in items" :key="String(item.id)">
          <td>{{ item.name }}</td><td>{{ item.price }}</td><td>{{ item.stock }}</td>
          <td>{{ item.status === 'off' ? '下架' : '上架' }}</td><td>{{ item.desc || '—' }}</td>
          <td class="row"><button class="btn-ghost" @click="edit(item)">编辑</button><button class="btn-danger" @click="remove(item)">删除</button></td>
        </tr>
      </tbody>
    </table>
  </div>
  <div v-if="open" class="modal-back" @click.self="open = false">
    <div class="modal card">
      <h2>{{ editing ? '编辑商品' : '新增商品' }}</h2>
      <label class="field"><span>名称</span><input v-model="form.name" /></label>
      <label class="field"><span>所需积分</span><input v-model="form.price" /></label>
      <label class="field"><span>库存</span><input v-model="form.stock" /></label>
      <label class="field"><span>说明</span><textarea v-model="form.desc"></textarea></label>
      <label class="field"><span>状态</span>
        <select v-model="form.status"><option value="on">上架</option><option value="off">下架</option></select>
      </label>
      <div class="row"><button class="btn-ghost" @click="open = false">取消</button><button class="btn" @click="save">保存</button></div>
    </div>
  </div>
</template>
