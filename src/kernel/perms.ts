import type { MemberUser, PermKey } from './types'
import { PERM_KEYS } from './types'
import { storage } from './storage'

export function isSuperUser(user: MemberUser | null) {
  if (!user) return false
  if (user.isSuper) return true
  if (user.role === 'super' || user.role === '超级管理员') return true
  return user.name.trim() === '超级管理员'
}

export function isManager(user: MemberUser | null) {
  return !!user && (user.isAdmin || isSuperUser(user) || storage.adminToken().length > 0)
}

export function canAccess(user: MemberUser | null, perm?: PermKey) {
  if (!isManager(user)) return false
  if (isSuperUser(user)) return true
  if (!perm) return true
  const permissions = user?.permissions
  if (!permissions || Object.keys(permissions).length === 0) return true
  return permissions[perm] !== false
}

export function normalizeUser(
  user: MemberUser,
  adminToken?: string,
  adminUser?: Record<string, unknown> | null,
): MemberUser {
  const hasToken = !!(adminToken || storage.adminToken())
  let permissions = user.permissions
  if (adminUser && adminUser.permissions && typeof adminUser.permissions === 'object') {
    permissions = Object.fromEntries(
      Object.entries(adminUser.permissions as Record<string, unknown>).map(([key, value]) => [
        key,
        value === true,
      ]),
    ) as MemberUser['permissions']
  }
  const superUser =
    isSuperUser(user) ||
    adminUser?.isSuper === true ||
    adminUser?.role === 'super' ||
    adminUser?.role === '超级管理员'
  const isAdmin = user.isAdmin || !!adminUser || hasToken || superUser
  if (superUser || (isAdmin && (!permissions || Object.keys(permissions).length === 0))) {
    permissions = {
      ...Object.fromEntries(PERM_KEYS.map((key) => [key, true])),
      ...permissions,
    }
  }
  return { ...user, isAdmin, isSuper: superUser, permissions }
}
