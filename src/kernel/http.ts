import { native } from './native'
import { describeWrite, recordLog } from './oplog'
import { storage } from './storage'

export class ApiError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.status = status
  }
}

type RequestOptions = {
  method?: string
  body?: unknown
  admin?: boolean
  form?: FormData
}

let onUnauthorized: (() => void) | null = null

export function bindUnauthorized(handler: () => void) {
  onUnauthorized = handler
}

export async function request<T = Record<string, unknown>>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase()
  return remoteRequest<T>(method, path, options)
}

async function formBody(form: FormData) {
  const files: { name: string; dataBase64: string }[] = []
  for (const value of form.values()) {
    if (!(value instanceof File)) continue
    const bytes = new Uint8Array(await value.arrayBuffer())
    let binary = ''
    const size = 0x8000
    for (let index = 0; index < bytes.length; index += size) {
      binary += String.fromCharCode(...bytes.subarray(index, index + size))
    }
    files.push({ name: value.name, dataBase64: btoa(binary) })
  }
  return { files }
}

async function remoteRequest<T>(method: string, path: string, options: RequestOptions): Promise<T> {
  const base = storage.settings().apiBase.replace(/\/$/, '')
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.admin) {
    const admin = storage.adminToken()
    if (!admin) throw new ApiError('需要管理权限，请使用管理员账号登录', 403)
    headers['X-Admin-Token'] = admin
  } else if (storage.token()) {
    headers['X-Client-Token'] = storage.token()
  }
  try {
    const proxied = await proxyRequest(method, url, headers, options)
    return finish<T>(method, path, options, proxied.status, proxied.body)
  } catch (error) {
    if (!tauriMissing(error)) {
      const message = typeof error === 'string' ? error : error instanceof Error ? error.message : ''
      throw new ApiError(message || '无法连接车队中心')
    }
  }
  const body = options.form ? options.form : options.body !== undefined ? JSON.stringify(options.body) : undefined
  if (!options.form && body !== undefined) headers['Content-Type'] = 'application/json'
  let response: Response
  try {
    response = await fetch(url, { method, headers, body })
  } catch {
    throw new ApiError('无法连接车队中心，请检查服务器地址')
  }
  const text = await response.text()
  let json: Record<string, unknown> = {}
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    json = { message: text || `HTTP ${response.status}` }
  }
  return finish<T>(method, path, options, response.status, json)
}

async function proxyRequest(method: string, url: string, headers: Record<string, string>, options: RequestOptions) {
  const payload: Record<string, unknown> = { method, url, headers }
  if (options.form) payload.files = (await formBody(options.form)).files
  else if (options.body !== undefined) payload.body = JSON.stringify(options.body)
  const result = await native<{ status?: number; body?: Record<string, unknown> }>('api_request', payload)
  return { status: Number(result.status || 0), body: result.body || {} }
}

function finish<T>(method: string, path: string, options: RequestOptions, status: number, json: Record<string, unknown>): T {
  if (!options.admin && (status === 401 || status === 403)) {
    const message = `${json.message ?? ''}`
    if (message.includes('过期') || message === '未登录') {
      storage.clearSession()
      onUnauthorized?.()
    }
  }
  if (status >= 400 || json.ok === false) {
    throw new ApiError(friendly(status, json.message), status)
  }
  const described = describeWrite(method, path, options.body)
  if (described) recordLog(described[0], described[1])
  return json as T
}

function tauriMissing(error: unknown) {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : `${error ?? ''}`
  return message.includes('未知本机能力') || message.includes('__TAURI') || message.includes('invoke')
}

function friendly(status: number, message: unknown) {
  const text = `${message ?? ''}`.trim()
  if (text && !/[<>]/.test(text) && text.length < 180) return text
  if (status === 401 || status === 403) return '无管理权限或登录已过期，请重新登录'
  if (status === 404) return '接口不存在（HTTP 404）'
  if (status >= 500) return `服务器错误（HTTP ${status}）`
  return `请求失败（HTTP ${status}）`
}

export async function publicGet(url: string) {
  try {
    const result = await native<{ status?: number; body?: unknown }>('api_request', {
      method: 'GET',
      url,
      headers: { Accept: 'application/json' },
    })
    if (Number(result.status || 0) >= 400) throw new ApiError(`请求失败（HTTP ${result.status}）`, Number(result.status))
    return result.body
  } catch (error) {
    if (!tauriMissing(error)) throw error instanceof ApiError ? error : new ApiError(`${error}`)
  }
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new ApiError(`请求失败（HTTP ${response.status}）`, response.status)
  return response.json()
}
