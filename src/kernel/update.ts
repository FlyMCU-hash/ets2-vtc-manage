export async function checkAppUpdate(onStatus: (text: string) => void, reportError = false) {
  if (!('__TAURI_INTERNALS__' in window)) {
    if (reportError) throw new Error('请在桌面端中检查更新')
    return false
  }
  try {
    onStatus('正在检查更新…')
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check({ timeout: 8000 })
    if (!update) return false
    onStatus(`正在下载 ${update.version}…`)
    let received = 0
    let total = 0
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') total = event.data.contentLength || 0
      if (event.event === 'Progress') {
        received += event.data.chunkLength
        if (total > 0) onStatus(`正在下载 ${update.version}… ${Math.min(100, Math.round((received / total) * 100))}%`)
      }
      if (event.event === 'Finished') onStatus('正在安装更新…')
    })
    return true
  } catch (error) {
    if (reportError) throw error
    return false
  }
}
