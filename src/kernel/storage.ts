import { defaultSettings, readSettings, type AppSettings, type MemberUser } from './types'

const tokenKey = 'peak.center.token'
const adminKey = 'peak.center.adminToken'
const userKey = 'peak.center.user'
const settingsKey = 'peak.center.settings'
const credsKey = 'peak.center.creds'
const logKey = 'peak.center.oplog'
const navKey = 'peak.center.navCollapsed'
const changelogKey = 'peak.center.changelog'

type SavedAccount = { tmpId: string; password: string; name: string }

function readCreds(): { accounts: SavedAccount[]; hidden: string[] } {
  try {
    const raw = read(credsKey)
    if (!raw) return { accounts: [], hidden: [] }
    const data = JSON.parse(raw) as { accounts?: unknown; hidden?: unknown; tmpId?: string; password?: string }
    const source = Array.isArray(data.accounts)
      ? data.accounts
      : data.tmpId
        ? [{ tmpId: data.tmpId, password: data.password || '', name: '' }]
        : []
    return { accounts: normalizeAccounts(source), hidden: normalizeIds(data.hidden) }
  } catch {
    return { accounts: [], hidden: [] }
  }
}

function normalizeIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => `${item ?? ''}`.trim()).filter(Boolean))]
}

function normalizeAccounts(source: unknown[]) {
  const seen = new Set<string>()
  const accounts: SavedAccount[] = []
  for (const item of source) {
    if (!item || typeof item !== 'object') continue
    const row = item as { tmpId?: string; password?: string; name?: string }
    const tmpId = `${row.tmpId ?? ''}`.trim()
    if (!tmpId || seen.has(tmpId)) continue
    seen.add(tmpId)
    accounts.push({ tmpId, password: `${row.password ?? ''}`, name: `${row.name ?? ''}`.trim() })
  }
  return accounts
}

function readAccounts() {
  return readCreds().accounts
}

function writeCreds(accounts: SavedAccount[], hidden: string[]) {
  write(credsKey, JSON.stringify({ accounts, hidden }))
}

function accountsFromLogs(hidden: Set<string>) {
  const seen = new Set<string>()
  const accounts: SavedAccount[] = []
  for (const item of storage.logs() as { account?: string; tmpId?: string }[]) {
    if (!item || typeof item !== 'object') continue
    const tmpId = `${item.tmpId ?? ''}`.trim()
    if (!tmpId || seen.has(tmpId) || hidden.has(tmpId)) continue
    seen.add(tmpId)
    const account = `${item.account ?? ''}`
    const suffix = ` (${tmpId})`
    const name = account.endsWith(suffix) ? account.slice(0, -suffix.length).trim() : ''
    accounts.push({ tmpId, password: '', name: name && name !== tmpId ? name : '' })
  }
  return accounts
}

function read(key: string) {
  return localStorage.getItem(key) || ''
}

function write(key: string, value: string) {
  localStorage.setItem(key, value)
}

export const storage = {
  token: () => read(tokenKey),
  adminToken: () => read(adminKey),
  user(): MemberUser | null {
    try {
      const raw = read(userKey)
      if (!raw) return null
      return JSON.parse(raw) as MemberUser
    } catch {
      return null
    }
  },
  settings(): AppSettings {
    try {
      const raw = read(settingsKey)
      return readSettings(raw ? JSON.parse(raw) : null)
    } catch {
      return defaultSettings()
    }
  },
  saveSettings(next: AppSettings) {
    const cleaned = readSettings(next)
    write(settingsKey, JSON.stringify(cleaned))
    return cleaned
  },
  setSession(token: string, user: MemberUser | null, adminToken?: string) {
    write(tokenKey, token)
    if (user) write(userKey, JSON.stringify(user))
    else localStorage.removeItem(userKey)
    if (adminToken) write(adminKey, adminToken)
    else localStorage.removeItem(adminKey)
  },
  clearSession() {
    localStorage.removeItem(tokenKey)
    localStorage.removeItem(adminKey)
    localStorage.removeItem(userKey)
  },
  accounts() {
    try {
      const { accounts, hidden } = readCreds()
      const hiddenSet = new Set(hidden)
      const saved = accounts.filter((item) => !hiddenSet.has(item.tmpId))
      const known = new Set(saved.map((item) => item.tmpId))
      const named = new Map(accountsFromLogs(hiddenSet).map((item) => [item.tmpId, item.name]))
      return [
        ...saved.map((item) => ({ ...item, name: item.name || named.get(item.tmpId) || '' })),
        ...accountsFromLogs(hiddenSet).filter((item) => !known.has(item.tmpId)),
      ].slice(0, 12)
    } catch {
      return []
    }
  },
  remembered() {
    return this.accounts()[0] || null
  },
  remember(tmpId: string, password: string, name?: string) {
    const id = tmpId.trim()
    if (!id) return
    const { accounts, hidden } = readCreds()
    const previous = accounts.find((item) => item.tmpId === id)
    const next = {
      tmpId: id,
      password,
      name: name?.trim() || previous?.name || '',
    }
    writeCreds([next, ...accounts.filter((item) => item.tmpId !== id)].slice(0, 12), hidden.filter((item) => item !== id))
  },
  forgetAccount(tmpId: string) {
    const id = tmpId.trim()
    const { accounts, hidden } = readCreds()
    writeCreds(
      accounts.filter((item) => item.tmpId !== id),
      [...new Set([...hidden, id])],
    )
  },
  logs() {
    try {
      const raw = read(logKey)
      const list = raw ? JSON.parse(raw) : []
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  },
  saveLogs(list: unknown[]) {
    write(logKey, JSON.stringify(list.slice(0, 500)))
  },
  clearLogs() {
    localStorage.removeItem(logKey)
  },
  navCollapsed() {
    return read(navKey) === '1'
  },
  setNavCollapsed(value: boolean) {
    write(navKey, value ? '1' : '0')
  },
  changelogDismissed(rev: string) {
    return read(changelogKey) === rev
  },
  dismissChangelog(rev: string) {
    write(changelogKey, rev)
  },
}
