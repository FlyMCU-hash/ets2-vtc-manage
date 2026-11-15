/**
 * 活动 / 签到 / 商品 / 兑换 —— MySQL 持久化（peak 库）
 * 前端与 API 仍使用 camelCase 对象，与原 JSON 结构兼容。
 */
const fs = require("fs");
const path = require("path");
const { pool } = require("./db");

const DATA_DIR = path.join(__dirname, "data");

function parseJsonField(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function mapActivity(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || "",
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    location: row.location || "",
    status: row.status || "upcoming",
    content: row.content || "",
    publishStatus: row.publish_status || "official",
    dlcIds: parseJsonField(row.dlc_ids, []),
    checkinConfigs: parseJsonField(row.checkin_configs, []),
  };
}

function mapCheckin(row) {
  if (!row) return null;
  return {
    id: row.id,
    activityId: row.activity_id,
    activityName: row.activity_name || "",
    configId: row.config_id,
    configName: row.config_name || "",
    memberId: row.member_id,
    tmpId: row.tmp_id || "",
    name: row.name || "",
    number: Number(row.number) || 0,
    points: row.points == null ? null : Number(row.points),
    serverName: row.server_name || "",
    note: row.note || "",
    checkedAt: row.checked_at || "",
    operator: row.operator || "",
    source: row.source || "",
    createdAt: row.created_at || "",
  };
}

function mapProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || "",
    price: Number(row.price) || 0,
    stock: Number(row.stock) || 0,
    status: row.status || "on",
    desc: row.desc_text || "",
  };
}

function mapRedeem(row) {
  if (!row) return null;
  const shipStatus = String(row.ship_status || "pending") === "shipped" ? "shipped" : "pending";
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name || "",
    price: Number(row.price) || 0,
    memberId: row.member_id,
    tmpId: row.tmp_id || "",
    name: row.name || "",
    tmpName: row.name || "",
    number: Number(row.number) || 0,
    note: row.note || "",
    operator: row.operator || "",
    source: row.source || "",
    createdAt: row.created_at || "",
    shipStatus,
    // 未发货 = 未完成；已发货 = 已完成
    doneStatus: shipStatus === "shipped" ? "done" : "pending",
    shipStatusText: shipStatus === "shipped" ? "已发货" : "未发货",
    doneStatusText: shipStatus === "shipped" ? "已完成" : "未完成",
  };
}

async function ensureBizColumn(table, column, definition) {
  const [cols] = await pool.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (!cols.length) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function initBizTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS peak_activities (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL DEFAULT '',
      start_date VARCHAR(32) NOT NULL DEFAULT '',
      end_date VARCHAR(32) NOT NULL DEFAULT '',
      location VARCHAR(128) NOT NULL DEFAULT '',
      status VARCHAR(32) NOT NULL DEFAULT 'upcoming',
      content TEXT NULL,
      publish_status VARCHAR(32) NOT NULL DEFAULT 'official',
      dlc_ids TEXT NULL,
      checkin_configs MEDIUMTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_start (start_date),
      KEY idx_publish (publish_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS peak_checkins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      activity_id INT NOT NULL,
      activity_name VARCHAR(100) NOT NULL DEFAULT '',
      config_id BIGINT NOT NULL DEFAULT 0,
      config_name VARCHAR(50) NOT NULL DEFAULT '',
      member_id INT NOT NULL,
      tmp_id VARCHAR(64) NOT NULL DEFAULT '',
      name VARCHAR(128) NOT NULL DEFAULT '',
      number INT NOT NULL DEFAULT 0,
      points INT NULL,
      server_name VARCHAR(128) NOT NULL DEFAULT '',
      note VARCHAR(255) NOT NULL DEFAULT '',
      checked_at VARCHAR(64) NOT NULL DEFAULT '',
      operator VARCHAR(128) NOT NULL DEFAULT '',
      source VARCHAR(64) NOT NULL DEFAULT '',
      created_at VARCHAR(64) NOT NULL DEFAULT '',
      UNIQUE KEY uk_checkin_once (activity_id, member_id, source, config_id),
      KEY idx_activity (activity_id),
      KEY idx_member (member_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS peak_store_products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(128) NOT NULL DEFAULT '',
      price INT NOT NULL DEFAULT 0,
      stock INT NOT NULL DEFAULT 0,
      status VARCHAR(16) NOT NULL DEFAULT 'on',
      desc_text TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS peak_redeems (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      product_name VARCHAR(128) NOT NULL DEFAULT '',
      price INT NOT NULL DEFAULT 0,
      member_id INT NOT NULL,
      tmp_id VARCHAR(64) NOT NULL DEFAULT '',
      name VARCHAR(128) NOT NULL DEFAULT '',
      number INT NOT NULL DEFAULT 0,
      note VARCHAR(255) NOT NULL DEFAULT '',
      operator VARCHAR(128) NOT NULL DEFAULT '',
      source VARCHAR(64) NOT NULL DEFAULT '',
      ship_status VARCHAR(16) NOT NULL DEFAULT 'pending',
      created_at VARCHAR(64) NOT NULL DEFAULT '',
      KEY idx_member (member_id),
      KEY idx_product (product_id),
      KEY idx_ship (ship_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 兼容已存在的旧表
  await ensureBizColumn(
    "peak_redeems",
    "ship_status",
    "VARCHAR(16) NOT NULL DEFAULT 'pending'"
  );
  await ensureCheckinIndex();
  await ensureDlcTable();
}

async function ensureDlcTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS center_dlcs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name_zh VARCHAR(128) NOT NULL DEFAULT '',
      name_en VARCHAR(128) NOT NULL DEFAULT '',
      kind TINYINT NOT NULL DEFAULT 1,
      price INT NOT NULL DEFAULT 0,
      steam_app_id VARCHAR(32) NOT NULL DEFAULT '',
      cover_url VARCHAR(500) NOT NULL DEFAULT '',
      scs_files TEXT NULL,
      UNIQUE KEY uk_center_dlc_steam (steam_app_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const { EXTRA_DLCS } = require("./dlcExtra");
  const [rows] = await pool.query(
    "SELECT steam_app_id, IFNULL(scs_files, '[]') AS scs_files FROM center_dlcs"
  );
  const knownApps = new Set(rows.map((row) => String(row.steam_app_id || "")));
  const knownFiles = new Set();
  for (const row of rows) {
    for (const file of parseJsonField(row.scs_files, [])) knownFiles.add(String(file));
  }
  for (const item of EXTRA_DLCS) {
    const files = Array.isArray(item.scsFiles) ? item.scsFiles.filter(Boolean) : [];
    const appId = item.appId ? String(item.appId) : "";
    if (!files.length || !appId) continue;
    if (knownApps.has(appId) || files.some((file) => knownFiles.has(file))) continue;
    await pool.query(
      `INSERT IGNORE INTO center_dlcs
        (name_zh, name_en, kind, steam_app_id, cover_url, scs_files)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        item.nameZh || item.name || "",
        item.name || "",
        Number(item.type) || 1,
        appId,
        item.imageUrl || "",
        JSON.stringify(files),
      ]
    );
    knownApps.add(appId);
    for (const file of files) knownFiles.add(file);
  }
}

function mapDlc(row) {
  return {
    id: row.id,
    nameZh: row.name_zh || "",
    nameEn: row.name_en || "",
    name: row.name_zh || row.name_en || "",
    type: Number(row.kind) || 0,
    price: Number(row.price) || 0,
    appId: Number(row.steam_app_id) || row.steam_app_id,
    imageUrl: row.cover_url || "",
    scsFiles: parseJsonField(row.scs_files, []),
  };
}

async function listDlcs(kind) {
  const sql = `SELECT id, name_zh, name_en, kind, price, steam_app_id, cover_url,
    IFNULL(scs_files, '[]') AS scs_files FROM center_dlcs`;
  const [rows] = kind
    ? await pool.query(`${sql} WHERE kind = ? ORDER BY id`, [Number(kind)])
    : await pool.query(`${sql} ORDER BY kind, id`);
  return rows.map(mapDlc);
}

function readLocalJson(name, fallback) {
  try {
    const fp = path.join(DATA_DIR, name);
    if (!fs.existsSync(fp)) return fallback;
    const data = JSON.parse(fs.readFileSync(fp, "utf8"));
    return Array.isArray(data) ? data : fallback;
  } catch {
    return fallback;
  }
}

async function tableCount(table) {
  const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM ${table}`);
  return Number(rows[0].c) || 0;
}

/** 活动签到与手动签到分开记账：同一成员可各有一条 */
async function ensureCheckinIndex() {
  await pool.query(`UPDATE peak_checkins SET config_id = 0 WHERE config_id IS NULL`);
  await pool.query(
    `UPDATE peak_checkins SET source = 'manual' WHERE source IS NULL OR source = ''`
  );
  const [cols] = await pool.query(
    `SELECT DATA_TYPE AS dataType, IS_NULLABLE AS nullable
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'peak_checkins' AND COLUMN_NAME = 'config_id'`
  );
  if (cols[0] && String(cols[0].dataType).toLowerCase() !== "bigint") {
    await pool.query(`ALTER TABLE peak_checkins MODIFY config_id BIGINT NOT NULL DEFAULT 0`);
  }
  const [oldIdx] = await pool.query(
    `SHOW INDEX FROM peak_checkins WHERE Key_name = 'uk_activity_member'`
  );
  if (oldIdx.length) {
    await pool.query(`ALTER TABLE peak_checkins DROP INDEX uk_activity_member`);
  }
  const [nextIdx] = await pool.query(
    `SHOW INDEX FROM peak_checkins WHERE Key_name = 'uk_checkin_once'`
  );
  if (!nextIdx.length) {
    await pool.query(
      `ALTER TABLE peak_checkins
       ADD UNIQUE KEY uk_checkin_once (activity_id, member_id, source, config_id)`
    );
  }
}

async function resetAutoIncrement(table) {
  const [rows] = await pool.query(`SELECT COALESCE(MAX(id), 0) + 1 AS n FROM ${table}`);
  const n = Number(rows[0].n) || 1;
  await pool.query(`ALTER TABLE ${table} AUTO_INCREMENT = ?`, [n]);
}

async function migrateFromJsonIfEmpty() {
  const migrated = [];

  if ((await tableCount("peak_activities")) === 0) {
    const items = readLocalJson("activities.json", []);
    for (const a of items) {
      await pool.query(
        `INSERT INTO peak_activities
          (id, name, start_date, end_date, location, status, content, publish_status, dlc_ids, checkin_configs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Number(a.id) || null,
          String(a.name || "").slice(0, 100),
          a.startDate || "",
          a.endDate || a.startDate || "",
          a.location || "",
          a.status || "upcoming",
          a.content || "",
          a.publishStatus === "draft" ? "draft" : "official",
          JSON.stringify(Array.isArray(a.dlcIds) ? a.dlcIds : []),
          JSON.stringify(Array.isArray(a.checkinConfigs) ? a.checkinConfigs : []),
        ]
      );
    }
    if (items.length) {
      await resetAutoIncrement("peak_activities");
      migrated.push(`activities:${items.length}`);
    }
  }

  if ((await tableCount("peak_checkins")) === 0) {
    const items = readLocalJson("checkins.json", []);
    for (const c of items) {
      await pool.query(
        `INSERT INTO peak_checkins
          (id, activity_id, activity_name, config_id, config_name, member_id, tmp_id, name, number,
           points, server_name, note, checked_at, operator, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Number(c.id) || null,
          Number(c.activityId) || 0,
          c.activityName || "",
          Number(c.configId) || 0,
          c.configName || "",
          Number(c.memberId) || 0,
          String(c.tmpId || ""),
          c.name || "",
          Number(c.number) || 0,
          c.points != null ? Number(c.points) : null,
          c.serverName || "",
          c.note || "",
          c.checkedAt || "",
          c.operator || "",
          c.source || "",
          c.createdAt || c.checkedAt || "",
        ]
      );
    }
    if (items.length) {
      await resetAutoIncrement("peak_checkins");
      migrated.push(`checkins:${items.length}`);
    }
  }

  if ((await tableCount("peak_store_products")) === 0) {
    const items = readLocalJson("store.json", []);
    for (const p of items) {
      await pool.query(
        `INSERT INTO peak_store_products (id, name, price, stock, status, desc_text)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          Number(p.id) || null,
          p.name || "",
          Number(p.price) || 0,
          Number(p.stock) || 0,
          p.status || "on",
          p.desc || "",
        ]
      );
    }
    if (items.length) {
      await resetAutoIncrement("peak_store_products");
      migrated.push(`store:${items.length}`);
    }
  }

  if ((await tableCount("peak_redeems")) === 0) {
    const items = readLocalJson("redeems.json", []);
    for (const r of items) {
      await pool.query(
        `INSERT INTO peak_redeems
          (id, product_id, product_name, price, member_id, tmp_id, name, number, note, operator, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Number(r.id) || null,
          Number(r.productId) || 0,
          r.productName || "",
          Number(r.price) || 0,
          Number(r.memberId) || 0,
          String(r.tmpId || ""),
          r.name || "",
          Number(r.number) || 0,
          r.note || "",
          r.operator || "",
          r.source || "",
          r.createdAt || "",
        ]
      );
    }
    if (items.length) {
      await resetAutoIncrement("peak_redeems");
      migrated.push(`redeems:${items.length}`);
    }
  }

  return migrated;
}

/* ---------- Activities ---------- */
async function listActivities() {
  const [rows] = await pool.query("SELECT * FROM peak_activities ORDER BY id ASC");
  return rows.map(mapActivity);
}

async function getActivityById(id) {
  const [rows] = await pool.query("SELECT * FROM peak_activities WHERE id = ? LIMIT 1", [
    Number(id),
  ]);
  return mapActivity(rows[0]);
}

async function createActivity(data) {
  const [result] = await pool.query(
    `INSERT INTO peak_activities
      (name, start_date, end_date, location, status, content, publish_status, dlc_ids, checkin_configs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(data.name || "").slice(0, 100),
      data.startDate || "",
      data.endDate || data.startDate || "",
      data.location || "",
      data.status || "upcoming",
      data.content || "",
      data.publishStatus === "draft" ? "draft" : "official",
      JSON.stringify(Array.isArray(data.dlcIds) ? data.dlcIds : []),
      JSON.stringify(Array.isArray(data.checkinConfigs) ? data.checkinConfigs : []),
    ]
  );
  return getActivityById(result.insertId);
}

async function updateActivity(id, data) {
  const current = await getActivityById(id);
  if (!current) return null;
  const next = {
    name: data.name !== undefined ? String(data.name).slice(0, 100) : current.name,
    startDate: data.startDate !== undefined ? data.startDate : current.startDate,
    endDate: data.endDate !== undefined ? data.endDate : current.endDate,
    location: data.location !== undefined ? data.location : current.location,
    status: data.status !== undefined ? data.status : current.status,
    content: data.content !== undefined ? data.content : current.content,
    publishStatus:
      data.publishStatus !== undefined
        ? data.publishStatus === "official"
          ? "official"
          : "draft"
        : current.publishStatus || "draft",
    dlcIds: data.dlcIds !== undefined ? data.dlcIds : current.dlcIds || [],
    checkinConfigs:
      data.checkinConfigs !== undefined ? data.checkinConfigs : current.checkinConfigs || [],
  };
  await pool.query(
    `UPDATE peak_activities SET
      name = ?, start_date = ?, end_date = ?, location = ?, status = ?, content = ?,
      publish_status = ?, dlc_ids = ?, checkin_configs = ?
     WHERE id = ?`,
    [
      next.name,
      next.startDate || "",
      next.endDate || "",
      next.location || "",
      next.status || "upcoming",
      next.content || "",
      next.publishStatus,
      JSON.stringify(Array.isArray(next.dlcIds) ? next.dlcIds : []),
      JSON.stringify(Array.isArray(next.checkinConfigs) ? next.checkinConfigs : []),
      Number(id),
    ]
  );
  return getActivityById(id);
}

async function deleteActivity(id) {
  const [result] = await pool.query("DELETE FROM peak_activities WHERE id = ?", [Number(id)]);
  if (result.affectedRows > 0) {
    await pool.query("DELETE FROM peak_checkins WHERE activity_id = ?", [Number(id)]);
  }
  return result.affectedRows > 0;
}

/* ---------- Checkins ---------- */
async function listCheckins({ activityId } = {}) {
  let sql = "SELECT * FROM peak_checkins";
  const params = [];
  if (Number.isFinite(activityId) && activityId > 0) {
    sql += " WHERE activity_id = ?";
    params.push(Number(activityId));
  }
  sql += " ORDER BY checked_at DESC, id DESC";
  const [rows] = await pool.query(sql, params);
  return rows.map(mapCheckin);
}

async function createCheckin(data) {
  const [result] = await pool.query(
    `INSERT INTO peak_checkins
      (activity_id, activity_name, config_id, config_name, member_id, tmp_id, name, number,
       points, server_name, note, checked_at, operator, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(data.activityId) || 0,
      data.activityName || "",
      Number(data.configId) || 0,
      data.configName || "",
      Number(data.memberId) || 0,
      String(data.tmpId || ""),
      data.name || "",
      Number(data.number) || 0,
      data.points != null ? Number(data.points) : null,
      data.serverName || "",
      data.note || "",
      data.checkedAt || new Date().toISOString(),
      data.operator || "",
      data.source || "",
      data.createdAt || data.checkedAt || new Date().toISOString(),
    ]
  );
  const [rows] = await pool.query("SELECT * FROM peak_checkins WHERE id = ? LIMIT 1", [
    result.insertId,
  ]);
  return mapCheckin(rows[0]);
}

async function getCheckinById(id) {
  const [rows] = await pool.query("SELECT * FROM peak_checkins WHERE id = ? LIMIT 1", [Number(id)]);
  return mapCheckin(rows[0]);
}

async function deleteCheckin(id) {
  const [result] = await pool.query("DELETE FROM peak_checkins WHERE id = ?", [Number(id)]);
  return result.affectedRows > 0;
}

async function hasCheckin(activityId, memberId, { source, configId } = {}) {
  let sql = "SELECT id FROM peak_checkins WHERE activity_id = ? AND member_id = ?";
  const params = [Number(activityId), Number(memberId)];
  if (source) {
    sql += " AND source = ?";
    params.push(String(source));
  }
  if (source === "auto") {
    sql += " AND config_id = ?";
    params.push(Number(configId) || 0);
  }
  sql += " LIMIT 1";
  const [rows] = await pool.query(sql, params);
  return rows.length > 0;
}

/** 自动打卡：整表替换写入（兼容旧逻辑；优先单条 createCheckin） */
async function replaceCheckins(items) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM peak_checkins");
    for (const c of items || []) {
      await conn.query(
        `INSERT INTO peak_checkins
          (id, activity_id, activity_name, config_id, config_name, member_id, tmp_id, name, number,
           points, server_name, note, checked_at, operator, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Number(c.id) || null,
          Number(c.activityId) || 0,
          c.activityName || "",
          Number(c.configId) || 0,
          c.configName || "",
          Number(c.memberId) || 0,
          String(c.tmpId || ""),
          c.name || "",
          Number(c.number) || 0,
          c.points != null ? Number(c.points) : null,
          c.serverName || "",
          c.note || "",
          c.checkedAt || "",
          c.operator || "",
          c.source || "",
          c.createdAt || "",
        ]
      );
    }
    await conn.commit();
    await resetAutoIncrement("peak_checkins");
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* ---------- Store ---------- */
async function listProducts() {
  const [rows] = await pool.query("SELECT * FROM peak_store_products ORDER BY id ASC");
  return rows.map(mapProduct);
}

async function getProductById(id) {
  const [rows] = await pool.query(
    "SELECT * FROM peak_store_products WHERE id = ? LIMIT 1",
    [Number(id)]
  );
  return mapProduct(rows[0]);
}

async function createProduct(data) {
  const [result] = await pool.query(
    `INSERT INTO peak_store_products (name, price, stock, status, desc_text)
     VALUES (?, ?, ?, ?, ?)`,
    [
      String(data.name || "").trim(),
      Number(data.price) || 0,
      Number(data.stock) || 0,
      data.status || "on",
      data.desc || "",
    ]
  );
  return getProductById(result.insertId);
}

async function updateProduct(id, data) {
  const current = await getProductById(id);
  if (!current) return null;
  await pool.query(
    `UPDATE peak_store_products SET name = ?, price = ?, stock = ?, status = ?, desc_text = ?
     WHERE id = ?`,
    [
      data.name !== undefined ? String(data.name).trim() : current.name,
      data.price !== undefined ? Number(data.price) : current.price,
      data.stock !== undefined ? Number(data.stock) : current.stock,
      data.status !== undefined ? data.status : current.status,
      data.desc !== undefined ? data.desc : current.desc,
      Number(id),
    ]
  );
  return getProductById(id);
}

async function deleteProduct(id) {
  const [result] = await pool.query("DELETE FROM peak_store_products WHERE id = ?", [
    Number(id),
  ]);
  return result.affectedRows > 0;
}

async function decreaseProductStock(id, by = 1) {
  const [result] = await pool.query(
    "UPDATE peak_store_products SET stock = stock - ? WHERE id = ? AND stock >= ?",
    [Number(by) || 1, Number(id), Number(by) || 1]
  );
  return result.affectedRows > 0;
}

/* ---------- Redeems ---------- */
async function listRedeems({ memberId } = {}) {
  let sql = "SELECT * FROM peak_redeems";
  const params = [];
  if (Number.isFinite(memberId) && memberId > 0) {
    sql += " WHERE member_id = ?";
    params.push(Number(memberId));
  }
  sql += " ORDER BY created_at DESC, id DESC";
  const [rows] = await pool.query(sql, params);
  return rows.map(mapRedeem);
}

async function createRedeem(data) {
  const shipStatus =
    String(data.shipStatus || data.ship_status || "pending") === "shipped"
      ? "shipped"
      : "pending";
  const [result] = await pool.query(
    `INSERT INTO peak_redeems
      (product_id, product_name, price, member_id, tmp_id, name, number, note, operator, source, ship_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(data.productId) || 0,
      data.productName || "",
      Number(data.price) || 0,
      Number(data.memberId) || 0,
      String(data.tmpId || ""),
      data.name || "",
      Number(data.number) || 0,
      data.note || "",
      data.operator || "",
      data.source || "",
      shipStatus,
      data.createdAt || new Date().toISOString(),
    ]
  );
  const [rows] = await pool.query("SELECT * FROM peak_redeems WHERE id = ? LIMIT 1", [
    result.insertId,
  ]);
  return mapRedeem(rows[0]);
}

async function updateRedeemShipStatus(id, shipStatus) {
  const next = String(shipStatus) === "shipped" ? "shipped" : "pending";
  const [result] = await pool.query(
    "UPDATE peak_redeems SET ship_status = ? WHERE id = ?",
    [next, Number(id)]
  );
  if (!result.affectedRows) return null;
  const [rows] = await pool.query("SELECT * FROM peak_redeems WHERE id = ? LIMIT 1", [
    Number(id),
  ]);
  return mapRedeem(rows[0]);
}

async function deleteRedeem(id) {
  const [result] = await pool.query("DELETE FROM peak_redeems WHERE id = ?", [Number(id)]);
  return result.affectedRows > 0;
}

async function initBizDb() {
  await initBizTables();
  const migrated = await migrateFromJsonIfEmpty();
  if (migrated.length) {
    console.log("已从 data/*.json 迁入 MySQL:", migrated.join(", "));
  } else {
    console.log("业务表已就绪（活动/签到/商品/兑换）");
  }
}

module.exports = {
  initBizDb,
  listActivities,
  getActivityById,
  createActivity,
  updateActivity,
  deleteActivity,
  listCheckins,
  getCheckinById,
  createCheckin,
  deleteCheckin,
  hasCheckin,
  replaceCheckins,
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  decreaseProductStock,
  listRedeems,
  createRedeem,
  updateRedeemShipStatus,
  deleteRedeem,
  listDlcs,
};
