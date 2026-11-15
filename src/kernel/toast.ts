import { reactive } from 'vue'

export interface ToastItem {
  id: number
  kind: 'ok' | 'err'
  text: string
}

const state = reactive<{ items: ToastItem[] }>({ items: [] })
let seed = 1

export function toasts() {
  return state.items
}

export function notify(text: unknown, kind: 'ok' | 'err' = 'ok') {
  const id = seed++
  const message = `${text ?? ''}`.replace(/^Error:\s*/, '')
  state.items.push({ id, kind, text: message || (kind === 'err' ? '操作失败' : '完成') })
  window.setTimeout(() => {
    const index = state.items.findIndex((item) => item.id === id)
    if (index >= 0) state.items.splice(index, 1)
  }, message.length > 40 ? 9000 : 3600)
}

export function ok(text: unknown) {
  notify(text, 'ok')
}

export function fail(text: unknown) {
  notify(text, 'err')
}
