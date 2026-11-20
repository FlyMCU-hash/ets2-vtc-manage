import { publicGet, request } from './http'
import { storage } from './storage'
import { OFFICIAL_SERVERS } from './types'

function withTimeout<T>(promise: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('读取服务器超时')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** 管理接口、地图服、TruckersMP 一起读。先返回的先交给 onPayload。 */
export function collectServerPayloads(onPayload: (payload: unknown) => void) {
  const jobs: Promise<unknown>[] = [
    withTimeout(publicGet(OFFICIAL_SERVERS), 8000),
    withTimeout(publicGet(storage.settings().serversUrl), 8000),
  ]
  if (storage.adminToken()) {
    jobs.unshift(withTimeout(request('/api/servers', { admin: true }), 8000))
  }
  return Promise.all(
    jobs.map((job) =>
      job
        .then((payload) => {
          if (payload != null) onPayload(payload)
        })
        .catch(() => null),
    ),
  )
}
