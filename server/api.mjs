import { createServer } from 'node:http'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile, unlink, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const root = path.dirname(fileURLToPath(import.meta.url))
loadEnv(path.join(root, '.env'))
loadEnv(path.join(root, '..', '.env'))

const PERMS = ['members', 'points', 'activities', 'store', 'dlc', 'monitor', 'settings']
const env = (key, fallback = '') => process.env[key]?.trim() || fallback
const port = Number(env('PORT', '3000')) || 3000
const bind = env('BIND', '0.0.0.0')
const uploadRoot = path.resolve(root, env('UPLOAD_ROOT', './uploads') || './uploads')
const maxBytes = (Number(env('UPLOAD_MAX_MB', '50')) || 50) * 1024 * 1024
const clientName = env('CLIENT_NAME', '车队中心')
const ossPrefix = env('OSS_PREFIX', 'activities').replace(/^\/+|\/+$/g, '')
const ossExpires = Number(env('OSS_SIGN_EXPIRES', '1800')) || 1800
const ossReady = Boolean(env('OSS_ACCESS_KEY_ID') && env('OSS_ACCESS_KEY_SECRET') && env('OSS_BUCKET') && env('OSS_REGION'))
let ossClient = null

const pool = mysql.createPool({
  host: env('DB_HOST', '127.0.0.1'),
  port: Number(env('DB_PORT', '3306')) || 3306,
  user: env('DB_USER', 'fleet'),
  password: env('DB_PASSWORD', ''),
  database: env('DB_NAME', 'fleet_center'),
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 8,
  dateStrings: true,
})

const MEMBER_SQL = `SELECT id, number, tmp_id, name, password_hash, qq, role, score,
  IFNULL(DATE_FORMAT(join_date, '%Y-%m-%d'), '') AS join_date,
  IFNULL(DATE_FORMAT(leave_date, '%Y-%m-%d'), '') AS leave_date,
  is_admin, is_super, IFNULL(permissions, '') AS permissions, IFNULL(steam_id, '') AS steam_id
  FROM center_members`

const server = createServer(async (req, res) => {
  setCors(res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    const method = (req.method || 'GET').toUpperCase()
    const pathname = url.pathname.replace(/\/$/, '') || '/'
    const token = header(req, 'x-client-token')
    const adminToken = header(req, 'x-admin-token')
    const host = header(req, 'x-forwarded-for').split(',')[0].trim() || req.socket.remoteAddress || ''
    if (method === 'GET') {
      const file = activityFilePath(pathname)
      if (file) {
        await sendFile(res, token, file.id, file.name)
        return
      }
    }
    const body = await readBody(req)
    const result = await route({ method, pathname, query: url.searchParams, body, token, adminToken, host })
    sendJson(res, result)
  } catch (error) {
    sendJson(res, fail(500, error instanceof Error ? error.message : '服务器错误'))
  }
})

server.listen(port, bind, () => {
  const store = ossReady ? `阿里云 OSS ${env('OSS_BUCKET')}/${ossPrefix}` : `本机目录 ${uploadRoot}`
  console.log(`车队中心接口已监听 ${bind}:${port}，活动存档：${store}`)
})

async function route(ctx) {
  const { method, pathname, query, body, token, adminToken, host } = ctx
  if (pathname === '/api/client/ping' && method === 'GET') {
    await pool.query('SELECT 1')
    return done({ message: '车队中心在线', service: 'peak-client' })
  }
  if (pathname === '/api/map/config' && method === 'GET') return mapConfig()
  if (pathname === '/api/client/login' && method === 'POST') return login(body, false, host)
  if (pathname === '/api/login' && method === 'POST') return login(body, true, host)
  if (pathname === '/api/client/logout' && method === 'POST') return logout(token)
  if (pathname === '/api/client/me' && method === 'GET') return me(token)
  if (pathname === '/api/client/password' && method === 'PUT') return changePassword(token, body)

  if (pathname.startsWith('/api/client/')) {
    const member = await clientOf(token)
    if (member.error) return member.error
    if (pathname === '/api/client/activities') return listActivities()
    const activityFiles = pathname.match(/^\/api\/client\/activities\/(\d+)\/files$/)
    if (activityFiles && method === 'GET') return listFiles(Number(activityFiles[1]))
    if (pathname === '/api/client/map-dlcs') return listDlc('1', false)
    if (pathname === '/api/client/members') return listMembers(true)
    if (pathname === '/api/client/store' && method === 'GET') {
      return done({ score: member.score, items: await products(true) })
    }
    if (pathname === '/api/client/store/redeem' && method === 'POST') return redeem(member, body)
    if (pathname === '/api/client/redeems') return listRedeems(member.id)
    return fail(404, '接口不存在')
  }

  const admin = await adminOf(adminToken)
  if (admin.error) return admin.error
  return adminRoute(admin, method, pathname, query, body)
}

async function adminRoute(member, method, pathname, query, body) {
  if (pathname === '/api/members/sync-join-dates' && method === 'POST') {
    const denied = need(member, 'members')
    if (denied) return denied
    const [result] = await pool.query(
      'UPDATE center_members SET join_date = DATE(created_at) WHERE join_date IS NULL AND is_super = 0',
    )
    return done({ message: `已同步 ${result.affectedRows} 人的入队日期` })
  }
  if (pathname === '/api/members' && method === 'GET') {
    const denied = need(member, 'members')
    if (denied) return denied
    return listMembers(false)
  }
  if (pathname === '/api/members' && method === 'POST') {
    const denied = need(member, 'members')
    if (denied) return denied
    return createMember(body)
  }
  const memberPath = splitId(pathname, '/api/members/')
  if (memberPath) {
    const denied = need(member, 'members')
    if (denied) return denied
    if (memberPath.tail === 'leave' && method === 'POST') return leaveMember(memberPath.id)
    if (!memberPath.tail && method === 'PUT') return updateMember(memberPath.id, body)
    if (!memberPath.tail && method === 'DELETE') return deleteMember(memberPath.id)
  }
  if (pathname === '/api/points' && method === 'GET') {
    const denied = need(member, 'points')
    if (denied) return denied
    return listMembers(false)
  }
  if (pathname === '/api/points' && method === 'POST') {
    const denied = need(member, 'points')
    if (denied) return denied
    return adjustPoints(body)
  }
  if (pathname === '/api/activities' && method === 'GET') {
    const denied = need(member, 'activities')
    if (denied) return denied
    return listActivities()
  }
  if (pathname === '/api/activities' && method === 'POST') {
    const denied = need(member, 'activities')
    if (denied) return denied
    return saveActivity(null, body)
  }
  const activityPath = splitId(pathname, '/api/activities/')
  if (activityPath) {
    const denied = need(member, 'activities')
    if (denied) return denied
    if (activityPath.tail === 'files' && method === 'GET') return listFiles(activityPath.id)
    if (activityPath.tail === 'files' && method === 'POST') return saveUpload(activityPath.id, body)
    if (activityPath.tail.startsWith('files/') && method === 'DELETE') {
      return deleteFile(activityPath.id, decodeURIComponent(activityPath.tail.slice('files/'.length)))
    }
    if (!activityPath.tail && method === 'PUT') return saveActivity(activityPath.id, body)
    if (!activityPath.tail && method === 'DELETE') return deleteActivity(activityPath.id)
  }
  if (pathname === '/api/checkins/scan' && method === 'POST') {
    const denied = need(member, 'activities')
    if (denied) return denied
    return done({ created: 0, message: '地图扫描尚未接入，请手动创建签到' })
  }
  if (pathname === '/api/checkins' && method === 'GET') {
    const denied = need(member, 'activities')
    if (denied) return denied
    return listCheckins(query.get('activityId') || '')
  }
  if (pathname === '/api/checkins' && method === 'POST') {
    const denied = need(member, 'activities')
    if (denied) return denied
    return createCheckin(body)
  }
  const checkinPath = splitId(pathname, '/api/checkins/')
  if (checkinPath && !checkinPath.tail && method === 'DELETE') {
    const denied = need(member, 'activities')
    if (denied) return denied
    return deleteCheckin(checkinPath.id)
  }
  if (pathname === '/api/store' && method === 'GET') {
    const denied = need(member, 'store')
    if (denied) return denied
    return done({ items: await products(false) })
  }
  if (pathname === '/api/store' && method === 'POST') {
    const denied = need(member, 'store')
    if (denied) return denied
    return saveProduct(null, body)
  }
  const storePath = splitId(pathname, '/api/store/')
  if (storePath && !storePath.tail && method === 'PUT') {
    const denied = need(member, 'store')
    if (denied) return denied
    return saveProduct(storePath.id, body)
  }
  if (storePath && !storePath.tail && method === 'DELETE') {
    const denied = need(member, 'store')
    if (denied) return denied
    return deleteProduct(storePath.id)
  }
  if (pathname === '/api/redeems' && method === 'GET') {
    const denied = need(member, 'store')
    if (denied) return denied
    return listRedeems(null)
  }
  const redeemPath = splitId(pathname, '/api/redeems/')
  if (redeemPath) {
    const denied = need(member, 'store')
    if (denied) return denied
    if (redeemPath.tail === 'ship' && method === 'PUT') return shipRedeem(redeemPath.id, body)
    if (!redeemPath.tail && method === 'DELETE') return deleteRedeem(redeemPath.id)
  }
  if (pathname === '/api/dlc' && method === 'GET') {
    const denied = need(member, 'dlc')
    if (denied) return denied
    return listDlc(query.get('type') || '', query.get('syncImages') === '1')
  }
  if (pathname === '/api/permissions' && method === 'GET') {
    const denied = need(member, 'settings')
    if (denied) return denied
    return listPermissions()
  }
  const permPath = splitId(pathname, '/api/permissions/')
  if (permPath && !permPath.tail && method === 'PUT') {
    const denied = need(member, 'settings')
    if (denied) return denied
    return savePermissions(permPath.id, body)
  }
  if (pathname === '/api/online' && method === 'GET') {
    const denied = need(member, 'monitor')
    if (denied) return denied
    return listOnline()
  }
  const onlinePath = splitId(pathname, '/api/online/')
  if (onlinePath && !onlinePath.tail && method === 'DELETE') {
    const denied = need(member, 'monitor')
    if (denied) return denied
    return kickOnline(onlinePath.id)
  }
  return fail(404, '接口不存在')
}

function mapConfig() {
  const tile = (name) => ({
    tileUrl: `https://ets2.online/map/${name}/{z}/{x}/{y}.png`,
    fallbackUrl: `https://ets2.online/map/${name}/{z}/{x}/{y}.png`,
    maxZoom: 8,
    minZoom: 2,
    tileSize: 512,
    bounds: { x: 131072, y: 131072 },
  })
  return done({ source: 'ets2map', ets: tile('ets2map_159'), promods: tile('ets2mappromods_158') })
}

async function login(body, adminOnly, host) {
  const tmpId = text(body, adminOnly ? 'username' : 'tmpId') || text(body, 'tmpId')
  const password = text(body, 'password')
  if (!tmpId || !password) return fail(400, '请输入 TMP ID 和密码')
  const member = await memberByTmp(tmpId)
  if (!member) return fail(401, 'TMP ID 或密码错误')
  if (member.leave_date) return fail(403, '该成员已退队，无法登录')
  if (!member.password_hash) return fail(403, '未设置密码，请联系管理员')
  if (!(await verifyPassword(password, member.password_hash))) return fail(401, 'TMP ID 或密码错误')
  if (adminOnly && !(member.is_admin || member.is_super)) return fail(403, '该账号不是管理员')
  const clientToken = await insertSession(member.id, 'client', host)
  const admin = await ensureAdminToken(member, host)
  if (adminOnly) return done({ token: admin.token, user: publicUser(member) })
  return done({ token: clientToken, user: publicUser(member), adminToken: admin.token, adminUser: admin.user })
}

async function logout(token) {
  const member = await clientOf(token)
  if (member.error) return member.error
  await pool.query('DELETE FROM center_sessions WHERE member_id = ?', [member.id])
  return done({})
}

async function me(token) {
  const member = await clientOf(token)
  if (member.error) return member.error
  const admin = await ensureAdminToken(member, '')
  return done({ user: publicUser(member), adminToken: admin.token, adminUser: admin.user })
}

async function changePassword(token, body) {
  const member = await clientOf(token)
  if (member.error) return member.error
  const next = text(body, 'newPassword')
  if (next !== text(body, 'confirmPassword')) return fail(400, '两次输入的新密码不一致')
  if ([...next].length < 6) return fail(400, '新密码至少 6 位')
  if (!(await verifyPassword(text(body, 'oldPassword'), member.password_hash))) return fail(400, '原密码不正确')
  await pool.query('UPDATE center_members SET password_hash = ? WHERE id = ?', [await hashPassword(next), member.id])
  return done({ message: '密码已修改' })
}

async function listMembers(activeOnly) {
  const sql = activeOnly
    ? 'SELECT id FROM center_members WHERE leave_date IS NULL AND is_super = 0 ORDER BY number, id'
    : 'SELECT id FROM center_members WHERE is_super = 0 ORDER BY number, id'
  const [rows] = await pool.query(sql)
  const items = []
  for (const row of rows) {
    const member = await memberById(row.id)
    if (member) items.push(publicUser(member))
  }
  return done({ items, members: items })
}

async function createMember(body) {
  const tmpId = text(body, 'tmpId')
  const name = text(body, 'name')
  if (!tmpId || !name) return fail(400, 'TMP ID 和昵称不能为空')
  const password = text(body, 'password')
  if (password && [...password].length < 6) return fail(400, '初始密码至少 6 位')
  const requested = numberOf(body, 'number')
  const number = requested > 0 ? requested : await nextNumber()
  try {
    await pool.query(
      `INSERT INTO center_members
       (number, tmp_id, name, password_hash, qq, role, score, join_date, is_admin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        number,
        tmpId,
        name,
        password ? await hashPassword(password) : '',
        text(body, 'qq'),
        text(body, 'role') || '司机',
        numberOf(body, 'score'),
        text(body, 'joinDate') || null,
        body?.isAdmin === true ? 1 : 0,
      ],
    )
  } catch (error) {
    if (String(error?.code || error?.message || '').includes('ER_DUP_ENTRY') || String(error).includes('Duplicate')) {
      return fail(400, '该 TMP ID 已存在')
    }
    throw error
  }
  return done({ message: `「${name}」已创建` })
}

async function updateMember(id, body) {
  const current = await memberById(id)
  if (!current) return fail(404, '成员不存在')
  if (current.is_super) return fail(403, '不能修改超级管理员')
  const password = text(body, 'password')
  if (password && [...password].length < 6) return fail(400, '密码至少 6 位')
  const fields = [text(body, 'name'), text(body, 'qq'), text(body, 'role') || current.role, numberOf(body, 'score')]
  if (password) {
    await pool.query(
      'UPDATE center_members SET name = ?, qq = ?, role = ?, score = ?, password_hash = ? WHERE id = ?',
      [...fields, await hashPassword(password), id],
    )
  } else {
    await pool.query('UPDATE center_members SET name = ?, qq = ?, role = ?, score = ? WHERE id = ?', [...fields, id])
  }
  return done({ message: '成员信息已更新' })
}

async function leaveMember(id) {
  const current = await memberById(id)
  if (!current) return fail(404, '成员不存在')
  if (current.is_super) return fail(403, '不能把超级管理员标记离队')
  await pool.query('UPDATE center_members SET leave_date = CURDATE() WHERE id = ?', [id])
  await pool.query('DELETE FROM center_sessions WHERE member_id = ?', [id])
  return done({ message: '已标记离队' })
}

async function deleteMember(id) {
  const current = await memberById(id)
  if (!current) return fail(404, '成员不存在')
  if (current.is_super) return fail(403, '不能删除超级管理员')
  await pool.query('DELETE FROM center_sessions WHERE member_id = ?', [id])
  await pool.query('DELETE FROM center_members WHERE id = ?', [id])
  return done({ message: '成员已删除' })
}

async function adjustPoints(body) {
  const memberId = numberOf(body, 'memberId')
  const delta = numberOf(body, 'delta')
  if (memberId <= 0 || delta === 0) return fail(400, '请输入非 0 的积分变动')
  if (!(await memberById(memberId))) return fail(404, '成员不存在')
  const reason = text(body, 'reason') || '管理员调整'
  await pool.query('UPDATE center_members SET score = score + ? WHERE id = ?', [delta, memberId])
  await pool.query('INSERT INTO center_point_logs (member_id, delta, reason) VALUES (?, ?, ?)', [memberId, delta, reason])
  return done({ message: '积分已调整' })
}

async function listActivities() {
  const [rows] = await pool.query(
    `SELECT id, name, start_date, end_date, location, status, IFNULL(content, '') AS content,
     IFNULL(dlc_ids, '[]') AS dlc_ids, IFNULL(checkin_configs, '[]') AS checkin_configs
     FROM center_activities ORDER BY id DESC`,
  )
  return done({ items: rows.map(activityJson) })
}

async function saveActivity(id, body) {
  const name = text(body, 'name')
  const start = text(body, 'startDate')
  if (!name || !start) return fail(400, '活动名称和开始时间不能为空')
  const status = ['ongoing', 'done', 'upcoming'].includes(text(body, 'status')) ? text(body, 'status') : 'upcoming'
  const end = text(body, 'endDate') || `${start.slice(0, 10)} 23:59`
  const dlc = JSON.stringify(Array.isArray(body?.dlcIds) ? body.dlcIds : [])
  const configs = JSON.stringify(Array.isArray(body?.checkinConfigs) ? body.checkinConfigs : [])
  const values = [name, start, end, text(body, 'location'), status, text(body, 'content'), dlc, configs]
  if (id) {
    const [result] = await pool.query(
      `UPDATE center_activities
       SET name = ?, start_date = ?, end_date = ?, location = ?, status = ?, content = ?, dlc_ids = ?, checkin_configs = ?
       WHERE id = ?`,
      [...values, id],
    )
    if (!result.affectedRows) return fail(404, '活动不存在')
  } else {
    await pool.query(
      `INSERT INTO center_activities
       (name, start_date, end_date, location, status, content, dlc_ids, checkin_configs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      values,
    )
  }
  return done({ message: '活动已保存' })
}

async function deleteActivity(id) {
  const [files] = await pool.query('SELECT stored_path FROM center_activity_files WHERE activity_id = ?', [id])
  for (const file of files) await removeStored(file.stored_path)
  await rm(path.join(uploadRoot, String(id)), { recursive: true, force: true }).catch(() => undefined)
  await pool.query('DELETE FROM center_activity_files WHERE activity_id = ?', [id])
  await pool.query('DELETE FROM center_checkins WHERE activity_id = ?', [id])
  await pool.query('DELETE FROM center_activities WHERE id = ?', [id])
  return done({ message: '活动已删除' })
}

async function listFiles(activityId) {
  const [rows] = await pool.query(
    'SELECT name, stored_path, size_bytes FROM center_activity_files WHERE activity_id = ? ORDER BY id',
    [activityId],
  )
  const items = []
  for (const row of rows) {
    items.push({
      name: row.name,
      size: Number(row.size_bytes) || 0,
      downloadUrl: await fileUrl(activityId, row.name, row.stored_path),
    })
  }
  return done({ items })
}

async function saveUpload(activityId, body) {
  const files = Array.isArray(body?.files) ? body.files : []
  if (!files.length) return fail(400, '未选择文件')
  const dir = path.join(uploadRoot, String(activityId))
  for (const file of files) {
    const name = path.basename(String(file?.name || 'file.zip'))
    if (!name || name === '.' || name === '..') return fail(400, '文件名无效')
    const bytes = Buffer.from(String(file?.dataBase64 || ''), 'base64')
    if (!bytes.length) return fail(400, `文件 ${name} 内容无效`)
    if (bytes.length > maxBytes) return fail(400, `文件超过 ${Math.round(maxBytes / 1024 / 1024)} MB`)
    const stored = ossReady ? await putOss(activityId, name, bytes) : await putLocal(dir, name, bytes)
    await pool.query(
      `INSERT INTO center_activity_files (activity_id, name, stored_path, size_bytes)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE stored_path = VALUES(stored_path), size_bytes = VALUES(size_bytes)`,
      [activityId, name, stored, bytes.length],
    )
  }
  return done({ message: '存档已上传' })
}

async function deleteFile(activityId, name) {
  const safe = path.basename(name)
  if (!safe || safe.includes('..')) return fail(400, '文件名无效')
  const [rows] = await pool.query(
    'SELECT stored_path FROM center_activity_files WHERE activity_id = ? AND name = ?',
    [activityId, safe],
  )
  if (!rows.length) return fail(404, '存档不存在')
  await removeStored(rows[0].stored_path)
  await pool.query('DELETE FROM center_activity_files WHERE activity_id = ? AND name = ?', [activityId, safe])
  return done({ message: '存档已删除' })
}

async function sendFile(res, token, activityId, name) {
  const member = await clientOf(token)
  if (member.error) {
    sendJson(res, member.error)
    return
  }
  const safe = path.basename(decodeURIComponent(name))
  if (!safe || safe.includes('..')) {
    sendJson(res, fail(400, '文件名无效'))
    return
  }
  const [rows] = await pool.query(
    'SELECT stored_path FROM center_activity_files WHERE activity_id = ? AND name = ?',
    [activityId, safe],
  )
  if (!rows.length) {
    sendJson(res, fail(404, '存档不存在'))
    return
  }
  if (isOssPath(rows[0].stored_path)) {
    const client = await oss()
    const result = await client.get(ossKeyOf(rows[0].stored_path))
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
    res.end(result.content)
    return
  }
  const stored = path.resolve(rows[0].stored_path)
  const dir = path.resolve(uploadRoot, String(activityId))
  const relative = path.relative(dir, stored)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    sendJson(res, fail(403, '存档路径无效'))
    return
  }
  const bytes = await readFile(stored).catch(() => null)
  if (!bytes) {
    sendJson(res, fail(404, '存档文件不存在'))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
  res.end(bytes)
}

async function listCheckins(activityIdText) {
  const activityId = Number(activityIdText) || 0
  const [rows] = await pool.query(
    `SELECT c.id, c.activity_id, IFNULL(a.name, '') AS activity_name, c.member_id,
     IFNULL(m.name, '') AS name, IFNULL(m.tmp_id, '') AS tmp_id, c.points, c.note,
     DATE_FORMAT(c.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM center_checkins c
     LEFT JOIN center_activities a ON a.id = c.activity_id
     LEFT JOIN center_members m ON m.id = c.member_id
     WHERE (? = 0 OR c.activity_id = ?)
     ORDER BY c.id DESC`,
    [activityId, activityId],
  )
  return done({
    items: rows.map((row) => ({
      id: row.id,
      activityId: row.activity_id,
      activityName: row.activity_name,
      memberId: row.member_id,
      name: row.name,
      tmpId: row.tmp_id,
      points: row.points,
      note: row.note,
      createdAt: row.created_at,
    })),
  })
}

async function createCheckin(body) {
  const activityId = numberOf(body, 'activityId')
  const memberId = numberOf(body, 'memberId')
  if (activityId <= 0 || memberId <= 0) return fail(400, '请选择活动和成员')
  const [activities] = await pool.query('SELECT checkin_configs FROM center_activities WHERE id = ?', [activityId])
  if (!activities.length) return fail(404, '活动不存在')
  if (!(await memberById(memberId))) return fail(404, '成员不存在')
  const points = configPoints(activities[0].checkin_configs)
  await pool.query(
    'INSERT INTO center_checkins (activity_id, member_id, points, note, source) VALUES (?, ?, ?, ?, ?)',
    [activityId, memberId, points, text(body, 'note'), 'manual'],
  )
  if (points) {
    await pool.query('UPDATE center_members SET score = score + ? WHERE id = ?', [points, memberId])
    await pool.query('INSERT INTO center_point_logs (member_id, delta, reason) VALUES (?, ?, ?)', [memberId, points, '活动签到'])
  }
  return done({ message: '签到记录已创建', points })
}

async function deleteCheckin(id) {
  const [rows] = await pool.query('SELECT member_id, points FROM center_checkins WHERE id = ?', [id])
  if (!rows.length) return fail(404, '签到不存在')
  const points = Number(rows[0].points) || 0
  await pool.query('DELETE FROM center_checkins WHERE id = ?', [id])
  if (points) {
    await pool.query('UPDATE center_members SET score = score - ? WHERE id = ?', [points, rows[0].member_id])
    await pool.query(
      'INSERT INTO center_point_logs (member_id, delta, reason) VALUES (?, ?, ?)',
      [rows[0].member_id, -points, '删除签到'],
    )
  }
  return done({ message: '签到已删除' })
}

async function products(onlyOn) {
  const sql = onlyOn
    ? "SELECT id, name, price, stock, status, IFNULL(description, '') AS description FROM center_products WHERE status <> 'off' ORDER BY id DESC"
    : "SELECT id, name, price, stock, status, IFNULL(description, '') AS description FROM center_products ORDER BY id DESC"
  const [rows] = await pool.query(sql)
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: row.price,
    stock: row.stock,
    status: row.status,
    desc: row.description,
  }))
}

async function saveProduct(id, body) {
  const name = text(body, 'name')
  if (!name) return fail(400, '商品名称不能为空')
  const status = text(body, 'status') === 'off' ? 'off' : 'on'
  const values = [name, numberOf(body, 'price'), numberOf(body, 'stock'), status, text(body, 'desc')]
  if (id) {
    const [result] = await pool.query(
      'UPDATE center_products SET name = ?, price = ?, stock = ?, status = ?, description = ? WHERE id = ?',
      [...values, id],
    )
    if (!result.affectedRows) return fail(404, '商品不存在')
  } else {
    await pool.query(
      'INSERT INTO center_products (name, price, stock, status, description) VALUES (?, ?, ?, ?, ?)',
      values,
    )
  }
  return done({ message: '商品已保存' })
}

async function deleteProduct(id) {
  await pool.query('DELETE FROM center_products WHERE id = ?', [id])
  return done({ message: '商品已删除' })
}

async function redeem(member, body) {
  const productId = numberOf(body, 'productId')
  const qq = text(body, 'qq')
  if (!qq) return fail(400, '请填写收货 QQ')
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query(
      'SELECT name, price, stock, status FROM center_products WHERE id = ? FOR UPDATE',
      [productId],
    )
    if (!rows.length) {
      await conn.rollback()
      return fail(404, '商品不存在')
    }
    const product = rows[0]
    if (product.status === 'off') {
      await conn.rollback()
      return fail(400, '商品已下架')
    }
    if (product.stock <= 0) {
      await conn.rollback()
      return fail(400, '库存不足')
    }
    if (member.score < product.price) {
      await conn.rollback()
      return fail(400, '积分不足')
    }
    await conn.query('UPDATE center_products SET stock = stock - 1 WHERE id = ?', [productId])
    await conn.query('UPDATE center_members SET score = score - ? WHERE id = ?', [product.price, member.id])
    await conn.query(
      'INSERT INTO center_redeems (product_id, member_id, product_name, price, qq, note) VALUES (?, ?, ?, ?, ?, ?)',
      [productId, member.id, product.name, product.price, qq, text(body, 'note')],
    )
    await conn.query(
      'INSERT INTO center_point_logs (member_id, delta, reason) VALUES (?, ?, ?)',
      [member.id, -product.price, `兑换 ${product.name}`],
    )
    await conn.commit()
    return done({ message: `已兑换「${product.name}」，扣除 ${product.price} 积分` })
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

async function listRedeems(memberId) {
  const sql = `SELECT r.id, r.product_id, r.product_name, r.price, r.qq, r.note, r.ship_status,
    DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS created_at, m.name, m.tmp_id
    FROM center_redeems r LEFT JOIN center_members m ON m.id = r.member_id`
  const [rows] = memberId
    ? await pool.query(`${sql} WHERE r.member_id = ? ORDER BY r.id DESC`, [memberId])
    : await pool.query(`${sql} ORDER BY r.id DESC`)
  return done({
    items: rows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      price: row.price,
      note: row.note,
      qq: row.qq,
      name: row.name || '',
      tmpId: row.tmp_id || '',
      createdAt: row.created_at,
      shipStatus: row.ship_status,
      shipped: row.ship_status === 'shipped',
    })),
  })
}

async function shipRedeem(id, body) {
  const status = text(body, 'shipStatus') === 'shipped' ? 'shipped' : 'pending'
  const [result] = await pool.query('UPDATE center_redeems SET ship_status = ? WHERE id = ?', [status, id])
  if (!result.affectedRows) return fail(404, '兑换记录不存在')
  return done({ message: status === 'shipped' ? '已标记发货' : '已改回待发货' })
}

async function deleteRedeem(id) {
  await pool.query('DELETE FROM center_redeems WHERE id = ?', [id])
  return done({ message: '记录已删除' })
}

async function listDlc(kind, sync) {
  const sql = `SELECT id, name_zh, name_en, kind, price, steam_app_id, cover_url, IFNULL(scs_files, '[]') AS scs_files
    FROM center_dlcs`
  const [rows] = kind === '1' || kind === '2' || kind === '3'
    ? await pool.query(`${sql} WHERE kind = ? ORDER BY id`, [Number(kind)])
    : await pool.query(`${sql} ORDER BY id`)
  const payload = {
    items: rows.map((row) => ({
      id: row.id,
      nameZh: row.name_zh,
      nameEn: row.name_en,
      name: row.name_zh,
      type: row.kind,
      price: row.price,
      appId: row.steam_app_id,
      imageUrl: row.cover_url,
      scsFiles: parseJson(row.scs_files, []),
    })),
  }
  if (sync) payload.message = '本地图库没有可同步的远程封面'
  return done(payload)
}

async function listPermissions() {
  const [rows] = await pool.query(
    'SELECT id FROM center_members WHERE (is_admin = 1 OR is_super = 1) AND leave_date IS NULL ORDER BY is_super DESC, id',
  )
  const admins = []
  for (const row of rows) {
    const member = await memberById(row.id)
    if (member) admins.push(publicUser(member))
  }
  return done({
    defs: [
      { key: 'members', label: '成员' },
      { key: 'points', label: '积分' },
      { key: 'activities', label: '活动' },
      { key: 'store', label: '商城' },
      { key: 'dlc', label: 'DLC' },
      { key: 'monitor', label: '监控' },
      { key: 'settings', label: '设置' },
    ],
    admins,
  })
}

async function savePermissions(id, body) {
  const current = await memberById(id)
  if (!current) return fail(404, '成员不存在')
  if (current.is_super) return fail(403, '不能修改超级管理员的权限')
  await pool.query('UPDATE center_members SET permissions = ?, is_admin = 1 WHERE id = ?', [
    JSON.stringify(body?.permissions && typeof body.permissions === 'object' ? body.permissions : {}),
    id,
  ])
  return done({ message: '权限已更新' })
}

async function listOnline() {
  const [rows] = await pool.query(
    `SELECT s.id, IFNULL(NULLIF(m.name, ''), m.tmp_id) AS login_name, s.host, s.client_name,
     DATE_FORMAT(s.created_at, '%Y-%m-%d %H:%i:%s') AS login_at
     FROM center_sessions s
     LEFT JOIN center_members m ON m.id = s.member_id
     WHERE s.kind = 'client'
     ORDER BY s.id DESC`,
  )
  return done({
    items: rows.map((row) => ({
      id: row.id,
      loginName: row.login_name || '',
      host: row.host || '',
      client: row.client_name || '',
      location: '',
      loginAt: row.login_at,
    })),
  })
}

async function kickOnline(id) {
  await pool.query("DELETE FROM center_sessions WHERE id = ? AND kind = 'client'", [id])
  return done({ message: '会话已踢下线' })
}

async function clientOf(token) {
  return sessionMember(token, false)
}

async function adminOf(token) {
  return sessionMember(token, true)
}

async function sessionMember(token, admin) {
  if (!token) return { error: fail(admin ? 403 : 401, admin ? '需要管理权限，请使用管理员账号登录' : '未登录') }
  const [rows] = await pool.query('SELECT member_id, kind FROM center_sessions WHERE token = ? LIMIT 1', [token])
  if (!rows.length) return { error: fail(401, '登录已过期') }
  if (admin && rows[0].kind !== 'admin') return { error: fail(403, '需要管理权限，请使用管理员账号登录') }
  const member = await memberById(rows[0].member_id)
  if (!member) return { error: fail(401, '登录已过期') }
  if (member.leave_date) return { error: fail(403, '该成员已退队，无法登录') }
  if (admin && !(member.is_admin || member.is_super)) return { error: fail(403, '需要管理权限') }
  return member
}

async function memberById(id) {
  const [rows] = await pool.query(`${MEMBER_SQL} WHERE id = ? LIMIT 1`, [id])
  return rows[0] ? memberFrom(rows[0]) : null
}

async function memberByTmp(tmpId) {
  const [rows] = await pool.query(`${MEMBER_SQL} WHERE tmp_id = ? LIMIT 1`, [tmpId])
  return rows[0] ? memberFrom(rows[0]) : null
}

function memberFrom(row) {
  return {
    ...row,
    is_admin: Boolean(row.is_admin),
    is_super: Boolean(row.is_super),
    permissions: parseJson(row.permissions, {}),
  }
}

function publicUser(member) {
  return {
    id: member.id,
    number: member.number ? member.number : null,
    tmpId: member.tmp_id,
    name: member.name,
    qq: member.qq,
    role: member.role,
    score: member.score,
    joinDate: member.join_date,
    leaveDate: member.leave_date,
    left: Boolean(member.leave_date),
    isAdmin: member.is_admin || member.is_super,
    isSuper: member.is_super,
    steamId: member.steam_id,
    permissions: permissionMap(member),
  }
}

function permissionMap(member) {
  const map = {}
  for (const key of PERMS) {
    map[key] = member.is_super || member.permissions?.[key] !== false
  }
  return map
}

function need(member, perm) {
  if (member.is_super || member.permissions?.[perm] !== false) return null
  return fail(403, '没有这项权限')
}

async function insertSession(memberId, kind, host) {
  const token = randomBytes(24).toString('hex')
  await pool.query(
    'INSERT INTO center_sessions (token, member_id, kind, host, client_name) VALUES (?, ?, ?, ?, ?)',
    [token, memberId, kind, host || '', clientName],
  )
  return token
}

async function ensureAdminToken(member, host) {
  if (!(member.is_admin || member.is_super)) return { token: null, user: null }
  const [rows] = await pool.query(
    "SELECT token FROM center_sessions WHERE member_id = ? AND kind = 'admin' ORDER BY id DESC LIMIT 1",
    [member.id],
  )
  const token = rows[0]?.token || (await insertSession(member.id, 'admin', host))
  return { token, user: publicUser(member) }
}

async function nextNumber() {
  const [rows] = await pool.query('SELECT MAX(number) AS max_number FROM center_members WHERE is_super = 0')
  return Number(rows[0]?.max_number || 0) + 1
}

function activityJson(row) {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    location: row.location,
    status: row.status || 'upcoming',
    content: row.content,
    dlcIds: parseJson(row.dlc_ids, []),
    checkinConfigs: parseJson(row.checkin_configs, []),
  }
}

function configPoints(raw) {
  const list = parseJson(raw, [])
  if (!Array.isArray(list)) return 0
  return list.reduce((sum, item) => sum + (Number(item?.points) || 0), 0)
}

async function oss() {
  if (!ossReady) throw new Error('未配置阿里云 OSS')
  if (!ossClient) {
    const OSS = (await import('ali-oss')).default
    ossClient = new OSS({
      region: env('OSS_REGION'),
      accessKeyId: env('OSS_ACCESS_KEY_ID'),
      accessKeySecret: env('OSS_ACCESS_KEY_SECRET'),
      bucket: env('OSS_BUCKET'),
      secure: true,
    })
  }
  return ossClient
}

function objectKey(activityId, name) {
  return [ossPrefix, String(activityId), name].filter(Boolean).join('/')
}

function isOssPath(stored) {
  return String(stored || '').startsWith('oss:')
}

function ossKeyOf(stored) {
  return String(stored).slice(4)
}

async function putOss(activityId, name, bytes) {
  const key = objectKey(activityId, name)
  const client = await oss()
  await client.put(key, bytes)
  return `oss:${key}`
}

async function putLocal(dir, name, bytes) {
  await mkdir(dir, { recursive: true })
  const stored = path.join(dir, name)
  await writeFile(stored, bytes)
  return stored
}

async function removeStored(stored) {
  if (!stored) return
  if (isOssPath(stored)) {
    const client = await oss()
    await client.delete(ossKeyOf(stored)).catch(() => undefined)
    return
  }
  await unlink(stored).catch(() => undefined)
}

async function fileUrl(activityId, name, stored) {
  if (isOssPath(stored)) {
    const client = await oss()
    return client.signatureUrl(ossKeyOf(stored), { expires: ossExpires })
  }
  return `/api/client/activities/${activityId}/files/${encodeURIComponent(name)}`
}

function activityFilePath(pathname) {
  const match = pathname.match(/^\/api\/client\/activities\/(\d+)\/files\/(.+)$/)
  if (!match) return null
  return { id: Number(match[1]), name: match[2] }
}

function splitId(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length)
  const [idText, ...tail] = rest.split('/')
  const id = Number(idText)
  if (!Number.isInteger(id)) return null
  return { id, tail: tail.join('/') }
}

function text(body, key) {
  const value = body?.[key]
  return value == null ? '' : String(value).trim()
}

function numberOf(body, key) {
  const value = Number(body?.[key])
  return Number.isFinite(value) ? Math.trunc(value) : 0
}

function parseJson(raw, fallback) {
  if (raw && typeof raw === 'object') return raw
  try {
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function done(value) {
  return { ok: true, ...value }
}

function fail(status, message) {
  return { ok: false, status, message }
}

function hashPassword(password) {
  const salt = randomBytes(16)
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error)
      else resolve(`scrypt$${salt.toString('hex')}$${key.toString('hex')}`)
    })
  })
}

function verifyPassword(password, stored) {
  const [kind, saltHex, keyHex] = String(stored || '').split('$')
  if (kind !== 'scrypt' || !saltHex || !keyHex) return Promise.resolve(false)
  return new Promise((resolve) => {
    scrypt(password, Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) {
        resolve(false)
        return
      }
      const expected = Buffer.from(keyHex, 'hex')
      resolve(key.length === expected.length && timingSafeEqual(key, expected))
    })
  })
}

function header(req, name) {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 70 * 1024 * 1024) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve({})
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, value) {
  const status = value.ok ? 200 : Number(value.status) || 400
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Client-Token, X-Admin-Token')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
}

function loadEnv(file) {
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return
  }
  for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
      const index = trimmed.indexOf('=')
      const key = trimmed.slice(0, index).trim()
      if (!key || process.env[key]) continue
      process.env[key] = trimmed.slice(index + 1).trim().replace(/^"|"$/g, '')
    }
}
