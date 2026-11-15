require("dotenv").config({ override: true });
const mysql = require("mysql2/promise");
const crypto = require("crypto");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "peak",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "peak",
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
  dateStrings: true,
});

console.info(
  `DB config: ${process.env.DB_USER || "peak"}@${process.env.DB_HOST || "127.0.0.1"}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME || "peak"} pwdLen=${String(process.env.DB_PASSWORD || "").length}`
);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const text = String(stored);
  if (!text.includes(":")) return text === String(password);
  const [salt, hash] = text.split(":");
  if (!salt || !hash) return false;
  const next = crypto.scryptSync(String(password), salt, 64).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(next, "hex"));
  } catch {
    return false;
  }
}

const PERMISSION_DEFS = [
  { key: "members", label: "成员管理", desc: "查看、新增、编辑、退队与删除成员" },
  { key: "points", label: "积分管理", desc: "给成员增减积分并查看流水" },
  { key: "activities", label: "活动管理", desc: "设置活动与查看签到记录" },
  { key: "store", label: "商城管理", desc: "商品管理与兑换记录" },
  { key: "dlc", label: "游戏内容", desc: "DLC 管理与封面缓存" },
  { key: "monitor", label: "在线用户", desc: "设置 → 查看在线用户会话" },
  { key: "settings", label: "账号创建 / 账号设置 / 权限管理", desc: "设置 → 账号创建、账号设置与权限" },
];

function defaultPermissions(enabled = true) {
  const perms = {};
  PERMISSION_DEFS.forEach((p) => {
    perms[p.key] = Boolean(enabled);
  });
  return perms;
}

function parsePermissions(raw, { isSuper = false } = {}) {
  if (isSuper) return defaultPermissions(true);
  let parsed = {};
  if (raw && typeof raw === "object") parsed = raw;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  }
  const perms = defaultPermissions(false);
  PERMISSION_DEFS.forEach((p) => {
    if (parsed[p.key] === undefined) perms[p.key] = true;
    else perms[p.key] = Boolean(parsed[p.key]);
  });
  return perms;
}

/** 规范化日期字段：空值 / 0000-00-00 / Invalid Date 视为未填写 */
function normalizeDateValue(value) {
  if (value == null || value === false) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    if (y <= 0) return "";
    return `${y}-${m}-${d}`;
  }
  const text = String(value).trim();
  if (!text || text.startsWith("0000-00-00")) return "";
  return text;
}

/** 成员管理里已显示退队时间的成员 */
function hasLeftTeam(row) {
  if (!row) return false;
  return Boolean(normalizeDateValue(row.leave_date ?? row.leaveDate));
}

function mapMember(row) {
  if (!row) return null;
  const isSuper = Boolean(row.is_super);
  const leaveDate = normalizeDateValue(row.leave_date);
  const left = Boolean(leaveDate);
  return {
    id: row.id,
    number: row.number,
    tmpId: row.tmp_id,
    name: row.name,
    qq: row.qq || "",
    role: row.role ?? "",
    score: Number(row.score) || 0,
    joinDate: normalizeDateValue(row.join_date) || row.join_date || "",
    leaveDate,
    left,
    canLoginApp: !left,
    isAdmin: Boolean(row.is_admin) || isSuper,
    isSuper,
    steamId: row.steam_id || "",
    permissions: parsePermissions(row.permissions, { isSuper }),
    hasPassword: Boolean(row.password),
  };
}

async function ensureColumn(table, column, definition) {
  const [cols] = await pool.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (!cols.length) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/** 将旧版 260800+ UID 一次性重排为 1,2,3...（失败不影响启动） */
async function migrateLegacyMemberUids() {
  try {
    const [legacy] = await pool.query(
      "SELECT id FROM tmp_members WHERE is_super = 0 AND number >= 260800 LIMIT 1"
    );
    if (!legacy.length) return;

    const [rows] = await pool.query(
      "SELECT id FROM tmp_members WHERE is_super = 0 ORDER BY number ASC, id ASC"
    );
    for (let i = 0; i < rows.length; i += 1) {
      await pool.query("UPDATE tmp_members SET number = ? WHERE id = ?", [i + 1, rows[i].id]);
    }
    console.log(`已将 ${rows.length} 名成员 UID 重排为 1..${rows.length}`);
  } catch (err) {
    console.error("UID 重排失败（已跳过，不影响启动）:", err.message || err);
  }
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tmp_members (
      id INT AUTO_INCREMENT PRIMARY KEY,
      number INT NOT NULL DEFAULT 0,
      tmp_id VARCHAR(64) NOT NULL,
      name VARCHAR(128) NOT NULL DEFAULT '',
      password VARCHAR(255) NOT NULL DEFAULT '',
      qq VARCHAR(64) NOT NULL DEFAULT '',
      role VARCHAR(128) NOT NULL DEFAULT '司机',
      score INT NOT NULL DEFAULT 0,
      join_date DATE NULL,
      leave_date DATE NULL,
      is_admin TINYINT(1) NOT NULL DEFAULT 0,
      is_super TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_tmp_id (tmp_id),
      KEY idx_number (number),
      KEY idx_is_admin (is_admin)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 兼容已存在的旧表
  await ensureColumn("tmp_members", "is_super", "TINYINT(1) NOT NULL DEFAULT 0");
  await ensureColumn("tmp_members", "permissions", "TEXT NULL");
  await ensureColumn("tmp_members", "steam_id", "VARCHAR(32) NOT NULL DEFAULT ''");

  await migrateLegacyMemberUids();

  const [superRows] = await pool.query(
    "SELECT id FROM tmp_members WHERE is_super = 1 LIMIT 1"
  );
  if (!superRows.length) {
    const [adminRows] = await pool.query(
      "SELECT id FROM tmp_members WHERE tmp_id = ? LIMIT 1",
      ["admin"]
    );
    if (adminRows.length) {
      await pool.query(
        "UPDATE tmp_members SET is_super = 1, is_admin = 1, name = ? WHERE id = ?",
        ["超级管理员", adminRows[0].id]
      );
      console.log("已将 admin 设为超级管理员（不在成员列表显示）");
    } else {
      await pool.query(
        `INSERT INTO tmp_members
          (number, tmp_id, name, password, qq, role, score, join_date, is_admin, is_super)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          0,
          "admin",
          "超级管理员",
          hashPassword("admin123"),
          "",
          "超级管理员",
          0,
          new Date().toISOString().slice(0, 10),
          1,
          1,
        ]
      );
      console.log("已初始化超级管理员: TMP ID=admin / 密码=admin123");
    }
  }
}

async function listMembers({ includeSuper = false } = {}) {
  const sql = includeSuper
    ? "SELECT * FROM tmp_members ORDER BY number ASC, id ASC"
    : "SELECT * FROM tmp_members WHERE is_super = 0 ORDER BY number ASC, id ASC";
  const [rows] = await pool.query(sql);
  return rows.map(mapMember);
}

async function getMemberById(id) {
  const [rows] = await pool.query("SELECT * FROM tmp_members WHERE id = ? LIMIT 1", [id]);
  return rows[0] || null;
}

async function getMemberByTmpId(tmpId) {
  const [rows] = await pool.query("SELECT * FROM tmp_members WHERE tmp_id = ? LIMIT 1", [tmpId]);
  return rows[0] || null;
}

async function createMember(data) {
  const password = data.password ? hashPassword(data.password) : "";
  const isAdmin = Boolean(data.isAdmin);
  const permissions = JSON.stringify(
    data.permissions ? parsePermissions(data.permissions) : defaultPermissions(isAdmin)
  );
  const [result] = await pool.query(
    `INSERT INTO tmp_members
      (number, tmp_id, name, password, qq, role, score, join_date, leave_date, is_admin, is_super, permissions, steam_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      Number(data.number) || 0,
      String(data.tmpId).trim(),
      String(data.name || "").trim(),
      password,
      data.qq || "",
      data.role !== undefined && data.role !== null ? String(data.role) : "",
      Number(data.score) || 0,
      data.joinDate || null,
      data.leaveDate || null,
      isAdmin ? 1 : 0,
      permissions,
      String(data.steamId || "").trim(),
    ]
  );
  return getMemberById(result.insertId);
}

async function updateMember(id, data) {
  const current = await getMemberById(id);
  if (!current) return null;
  if (current.is_super) return { isSuper: true, row: current };

  let password = current.password;
  if (data.password !== undefined && String(data.password).trim() !== "") {
    password = hashPassword(data.password);
  }

  const nextAdmin =
    data.isAdmin !== undefined ? (data.isAdmin ? 1 : 0) : current.is_admin;
  let permissions = current.permissions;
  if (data.permissions !== undefined) {
    permissions = JSON.stringify(parsePermissions(data.permissions));
  } else if (data.isAdmin !== undefined && data.isAdmin && !current.permissions) {
    permissions = JSON.stringify(defaultPermissions(true));
  } else if (data.isAdmin !== undefined && !data.isAdmin) {
    permissions = JSON.stringify(defaultPermissions(false));
  }

  await pool.query(
    `UPDATE tmp_members SET
      number = ?, tmp_id = ?, name = ?, password = ?, qq = ?, role = ?,
      score = ?, join_date = ?, leave_date = ?, is_admin = ?, permissions = ?, steam_id = ?
     WHERE id = ?`,
    [
      data.number !== undefined ? Number(data.number) : current.number,
      data.tmpId !== undefined ? String(data.tmpId).trim() : current.tmp_id,
      data.name !== undefined ? String(data.name).trim() : current.name,
      password,
      data.qq !== undefined ? data.qq : current.qq,
      data.role !== undefined ? data.role : current.role,
      data.score !== undefined ? Number(data.score) : current.score,
      data.joinDate !== undefined ? data.joinDate || null : current.join_date,
      data.leaveDate !== undefined ? data.leaveDate || null : current.leave_date,
      nextAdmin,
      permissions,
      data.steamId !== undefined ? String(data.steamId || "").trim() : current.steam_id || "",
      id,
    ]
  );
  return getMemberById(id);
}

async function listAdmins() {
  const [rows] = await pool.query(
    "SELECT * FROM tmp_members WHERE is_admin = 1 AND is_super = 0 ORDER BY number ASC, id ASC"
  );
  return rows.map(mapMember);
}

async function updateAdminPermissions(id, permissions) {
  const current = await getMemberById(id);
  if (!current) return null;
  if (current.is_super) return { isSuper: true, row: current };
  if (!current.is_admin) return { notAdmin: true, row: current };
  const next = parsePermissions(permissions);
  await pool.query("UPDATE tmp_members SET permissions = ? WHERE id = ?", [
    JSON.stringify(next),
    id,
  ]);
  return mapMember(await getMemberById(id));
}

async function updateOwnProfile(id, data) {
  const current = await getMemberById(id);
  if (!current) return { missing: true };
  const name = String(data.name || "").trim();
  const qq = String(data.qq || "").trim();
  await pool.query("UPDATE tmp_members SET name = ?, qq = ? WHERE id = ?", [
    name,
    qq,
    id,
  ]);
  return { ok: true, row: await getMemberById(id) };
}

async function changePassword(id, oldPassword, newPassword) {
  const current = await getMemberById(id);
  if (!current) return { missing: true };
  if (!verifyPassword(oldPassword, current.password)) {
    return { badOld: true };
  }
  const next = String(newPassword || "").trim();
  if (next.length < 4) return { weak: true };
  await pool.query("UPDATE tmp_members SET password = ? WHERE id = ?", [
    hashPassword(next),
    id,
  ]);
  return { ok: true, row: await getMemberById(id) };
}

async function leaveMember(id) {
  const current = await getMemberById(id);
  if (!current) return null;
  if (current.is_super) return { isSuper: true, row: current };
  if (hasLeftTeam(current)) return { alreadyLeft: true, row: current };
  await pool.query("UPDATE tmp_members SET leave_date = ? WHERE id = ?", [
    new Date().toISOString().slice(0, 10),
    id,
  ]);
  return { alreadyLeft: false, row: await getMemberById(id) };
}

async function deleteMember(id) {
  const current = await getMemberById(id);
  if (!current) return false;
  if (current.is_super) return { isSuper: true };
  const [result] = await pool.query(
    "DELETE FROM tmp_members WHERE id = ? AND is_super = 0",
    [id]
  );
  return result.affectedRows > 0;
}

async function authAdmin(tmpId, password) {
  const row = await getMemberByTmpId(String(tmpId).trim());
  if (!row) return null;
  if (!row.is_admin && !row.is_super) return { denied: "not_admin" };
  if (!verifyPassword(password, row.password)) return null;
  return mapMember(row);
}

/** 接档器等客户端：任意在队成员（含管理员）可用 TMP ID + 密码登录；已退队不可登 */
async function authMember(tmpId, password) {
  const row = await getMemberByTmpId(String(tmpId).trim());
  if (!row) return null;
  if (hasLeftTeam(row)) return { denied: "left" };
  if (!row.password) return { denied: "no_password" };
  if (!verifyPassword(password, row.password)) return null;
  return mapMember(row);
}

function isSuperMember(row) {
  return Boolean(row && (row.is_super || row.isSuper));
}

module.exports = {
  pool,
  initDb,
  listMembers,
  listAdmins,
  getMemberById,
  getMemberByTmpId,
  createMember,
  updateMember,
  updateAdminPermissions,
  updateOwnProfile,
  changePassword,
  leaveMember,
  deleteMember,
  authAdmin,
  authMember,
  mapMember,
  hasLeftTeam,
  isSuperMember,
  PERMISSION_DEFS,
  defaultPermissions,
  parsePermissions,
  hashPassword,
  verifyPassword,
};
