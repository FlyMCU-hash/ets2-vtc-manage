import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'

export function isDesktop() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function native<T = Record<string, unknown>>(method: string, payload?: unknown) {
  return invoke<T>('native_call', { method, payload: payload ?? null })
}

export function setWindowMode(mode: 'login' | 'member' | 'admin') {
  return invoke('set_window_mode', { mode }).catch(() => undefined)
}

export async function openExternal(url: string) {
  try {
    await openUrl(url)
  } catch {
    window.open(url, '_blank', 'noopener')
  }
}

export async function openLocal(path: string) {
  await native('open_path', { path })
}
