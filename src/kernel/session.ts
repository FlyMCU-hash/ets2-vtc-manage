import { defineStore } from 'pinia'
import { bindUnauthorized, request } from './http'
import { recordLog } from './oplog'
import { isManager, normalizeUser } from './perms'
import { storage } from './storage'
import { asUser, readSettings, type AppSettings, type MemberUser } from './types'
import { setWindowMode } from './native'

export const useSession = defineStore('session', {
  state: () => ({
    booting: true,
    user: null as MemberUser | null,
    staged: null as MemberUser | null,
    settings: storage.settings(),
    tab: 'home',
    collapsed: storage.navCollapsed(),
    justLoggedIn: false,
  }),
  actions: {
    async boot() {
      this.justLoggedIn = false
      this.applyTheme(this.settings.theme)
      this.applyAppearance()
      bindUnauthorized(() => {
        this.user = null
        this.staged = null
        void setWindowMode('login')
      })
      if (!storage.token()) {
        this.booting = false
        this.user = null
        await setWindowMode('login')
        return
      }
      try {
        await this.refreshMe()
      } catch {
        storage.clearSession()
        this.user = null
        await setWindowMode('login')
      } finally {
        this.booting = false
      }
    },
    async refreshMe() {
      const data = await request<Record<string, unknown>>('/api/client/me')
      const adminToken = data.adminToken ? `${data.adminToken}` : storage.adminToken()
      const adminUser =
        data.adminUser && typeof data.adminUser === 'object'
          ? (data.adminUser as Record<string, unknown>)
          : null
      const user = normalizeUser(asUser(data.user), adminToken, adminUser)
      storage.setSession(storage.token(), user, adminToken)
      this.user = user
      await setWindowMode(isManager(user) ? 'admin' : 'member')
    },
    async login(tmpId: string, password: string) {
      const data = await request<Record<string, unknown>>('/api/client/login', {
        method: 'POST',
        body: { tmpId, password },
      })
      const token = `${data.token ?? ''}`
      let adminToken = data.adminToken ? `${data.adminToken}` : ''
      let adminUser =
        data.adminUser && typeof data.adminUser === 'object'
          ? (data.adminUser as Record<string, unknown>)
          : null
      if (!adminToken) {
        try {
          const admin = await request<Record<string, unknown>>('/api/login', {
            method: 'POST',
            body: { username: tmpId, password },
          })
          if (admin.token && admin.user) {
            adminToken = `${admin.token}`
            adminUser = admin.user as Record<string, unknown>
          }
        } catch {
          adminToken = ''
        }
      }
      const user = normalizeUser(asUser(data.user), adminToken, adminUser)
      storage.setSession(token, user, adminToken)
      storage.remember(tmpId, password, user.name)
      this.staged = user
      recordLog('登录成功', `TMP ${tmpId}`, user)
    },
    async enter() {
      const user = this.staged
      if (!user) return
      this.staged = null
      this.justLoggedIn = true
      await setWindowMode(isManager(user) ? 'admin' : 'member')
      this.user = user
    },
    async logout() {
      const current = this.user
      await setWindowMode('login')
      try {
        await request('/api/client/logout', { method: 'POST', body: {} })
      } catch {
        /* 退出以本地会话为准 */
      }
      recordLog('退出登录', '', current)
      storage.clearSession()
      this.user = null
      this.justLoggedIn = false
      this.tab = 'home'
    },
    async saveSettings(next: AppSettings) {
      this.settings = storage.saveSettings(readSettings(next))
      this.applyTheme(this.settings.theme)
      this.applyAppearance()
      recordLog('保存平台设置', '')
    },
    setTheme(theme: 'light' | 'dark') {
      this.settings = storage.saveSettings({ ...this.settings, theme })
      this.applyTheme(theme)
    },
    applyTheme(theme: 'light' | 'dark') {
      document.documentElement.dataset.theme = theme
    },
    applyAppearance() {
      const root = document.documentElement
      const color = this.settings?.backgroundColor || ''
      const image = this.settings?.backgroundImage || ''
      if (color || image) root.dataset.appearance = 'custom'
      else delete root.dataset.appearance
      if (color) root.style.setProperty('--app-bg', color)
      else root.style.removeProperty('--app-bg')
      if (image) root.style.setProperty('--app-image', `url("${image}")`)
      else root.style.removeProperty('--app-image')
      for (const node of [document.body, document.getElementById('app')]) {
        if (!(node instanceof HTMLElement)) continue
        node.style.backgroundColor = ''
        node.style.backgroundImage = ''
        node.style.backgroundSize = ''
        node.style.backgroundPosition = ''
        node.style.backgroundRepeat = ''
        node.style.backgroundAttachment = ''
      }
    },
    toggleNav() {
      this.collapsed = !this.collapsed
      storage.setNavCollapsed(this.collapsed)
    },
    openTab(id: string) {
      this.tab = id
    },
  },
})
