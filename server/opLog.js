/**
 * 管理员操作记录（服务端持久化，最多 500 条）
 * 只登记有管理员会话的写操作；排除登录成功 / 卸载活动存档 / 保存平台设置
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "oplog.json");
const MAX = 500;

const EXCLUDED_ACTIONS = new Set(["登录成功", "卸载活动存档", "保存平台设置"]);

let cache = null;
let writeTimer = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  if (cache) return cache;
  ensureDir();
  try {
    if (!fs.existsSync(FILE)) {
      cache = [];
      return cache;
    }
    const raw = fs.readFileSync(FILE, "utf8").trim();
    if (!raw) {
      cache = [];
      return cache;
    }
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("opLog load failed:", err.message);
    cache = [];
  }
  return cache;
}

function scheduleSave() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      ensureDir();
      fs.writeFileSync(FILE, JSON.stringify(cache || [], null, 2), "utf8");
    } catch (err) {
      console.warn("opLog save failed:", err.message);
    }
  }, 200);
}

function formatAccount(user) {
  if (!user) return "未登录";
  const name = String(user.name || "").trim();
  const tmpId = String(user.tmpId || user.username || "").trim();
  if (name && tmpId) return `${name} (${tmpId})`;
  if (name) return name;
  if (tmpId) return tmpId;
  if (user.isSuper || user.role === "super") return "超级管理员";
  return "管理员";
}

function isAdminUser(user) {
  if (!user) return false;
  if (user.isSuper || user.role === "super" || user.role === "admin") return true;
  if (user.isAdmin) return true;
  // 带后台权限对象的账号视为管理员
  if (user.permissions && typeof user.permissions === "object") return true;
  return false;
}

function detailFromBody(body, keys = ["name", "tmpId", "title", "id"]) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const parts = [];
  for (const k of keys) {
    const v = body[k];
    if (v != null && String(v).trim() !== "") parts.push(`${k}=${v}`);
  }
  return parts.join(" · ");
}

function describe(method, rawPath, body) {
  const m = String(method || "").toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return null;
  const p = String(rawPath || "").split("?")[0];

  if (p.includes("/login") || p.includes("/logout")) return null;
  if (p.includes("/ping") || /\/me$/.test(p) || /\/me\//.test(p)) return null;
  if (p.includes("/oplog")) return null;
  if (p.startsWith("/api/client")) return null;
  if (p.startsWith("/api/open")) return null;

  // 用户明确要求不记
  if (p.includes("/files") && m === "DELETE" && /uninstall|undeploy|卸载/i.test(JSON.stringify(body || {}))) {
    return null;
  }

  if (p.includes("/password") && m === "PUT") return ["修改密码", ""];
  if (p.includes("/store/redeem") && m === "POST") {
    return ["兑换商品", detailFromBody(body, ["productId", "name", "id"]) || p];
  }
  if (/\/members\/?$/.test(p) && m === "POST") {
    return ["新增成员", detailFromBody(body, ["name", "tmpId", "number"]) || p];
  }
  if (/\/members\/\d+\/leave/.test(p)) return ["成员离队", p];
  if (/\/members\/\d+/.test(p) && m === "PUT") {
    return ["编辑成员", detailFromBody(body, ["name", "tmpId", "id"]) || p];
  }
  if (/\/members\/\d+/.test(p) && m === "DELETE") return ["删除成员", p];
  if (p.includes("/members/sync")) return ["同步成员入队日期", ""];
  if (/\/points\/?$/.test(p) && m === "POST") {
    return ["积分调整", detailFromBody(body, ["tmpId", "name", "score", "delta", "reason"]) || p];
  }
  if (/\/activities\/?$/.test(p) && m === "POST") {
    return ["创建活动", detailFromBody(body, ["name", "title"]) || p];
  }
  if (/\/activities\/\d+/.test(p) && m === "PUT") {
    return ["编辑活动", detailFromBody(body, ["name", "title", "id"]) || p];
  }
  if (/\/activities\/\d+/.test(p) && m === "DELETE") return ["删除活动", p];
  if (p.includes("/files") && m === "POST") return ["上传活动文件", p];
  if (p.includes("/files") && m === "DELETE") return ["删除活动文件", p];
  if (/\/checkins\/?$/.test(p) && m === "POST") {
    return ["登记签到", detailFromBody(body, ["name", "tmpId"]) || p];
  }
  if (p.includes("/checkins/scan")) return ["扫描签到", ""];
  if (p.includes("/checkins/") && m === "DELETE") return ["删除签到", p];
  if (/\/store\/?$/.test(p) && m === "POST") {
    return ["新增商品", detailFromBody(body, ["name"]) || p];
  }
  if (/\/store\/\d+/.test(p) && m === "PUT") {
    return ["编辑商品", detailFromBody(body, ["name", "id"]) || p];
  }
  if (/\/store\/\d+/.test(p) && m === "DELETE") return ["删除商品", p];
  if (p.includes("/redeems/") && p.includes("/ship")) return ["兑换发货", p];
  if (/\/redeems\/\d+/.test(p) && m === "DELETE") return ["删除兑换记录", p];
  if (/\/online\/\d+/.test(p) && m === "DELETE") return ["踢下线", p];
  if (p.includes("/permissions/") && (m === "PUT" || m === "POST")) return ["修改权限", p];
  if (p.includes("/dlc") && m !== "GET") return ["DLC 操作", `${m} ${p}`];
  if (p.includes("/servers") && m !== "GET") return ["服务器配置", `${m} ${p}`];
  if (p.includes("/map/") && m !== "GET") return ["地图配置", `${m} ${p}`];

  return ["接口操作", `${m} ${p}`];
}

function record(action, { detail = "", user = null } = {}) {
  const act = String(action || "").trim();
  if (!act || EXCLUDED_ACTIONS.has(act)) return null;
  if (user && !isAdminUser(user)) return null;

  const entry = {
    id: String(Date.now()) + String(Math.floor(Math.random() * 1000)).padStart(3, "0"),
    account: formatAccount(user),
    tmpId: String(user?.tmpId || user?.username || ""),
    action: act,
    detail: String(detail || ""),
    time: new Date().toISOString(),
  };
  const list = load();
  cache = [entry, ...list].slice(0, MAX);
  scheduleSave();
  return entry;
}

function recordFromRequest(req, { statusCode = 200, payload } = {}) {
  try {
    if (statusCode >= 400) return null;
    if (payload && payload.ok === false) return null;
    const user = req?.session?.user;
    if (!isAdminUser(user)) return null;
    const mapped = describe(req.method, req.originalUrl || req.url || req.path, req.body);
    if (!mapped) return null;
    const [action, detail] = mapped;
    if (EXCLUDED_ACTIONS.has(action)) return null;
    return record(action, { detail, user });
  } catch (err) {
    console.warn("opLog.recordFromRequest:", err.message);
    return null;
  }
}

function list({ keyword = "" } = {}) {
  const all = load();
  const q = String(keyword || "").trim().toLowerCase();
  if (!q) return all.slice();
  return all.filter((e) => {
    const timeText = formatTime(e.time);
    return (
      String(e.account || "").toLowerCase().includes(q) ||
      String(e.tmpId || "").toLowerCase().includes(q) ||
      String(e.action || "").toLowerCase().includes(q) ||
      String(e.detail || "").toLowerCase().includes(q) ||
      timeText.includes(q)
    );
  });
}

function clear() {
  cache = [];
  scheduleSave();
}

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || "");
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function middleware(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    try {
      recordFromRequest(req, { statusCode: res.statusCode || 200, payload });
    } catch (_) {}
    return originalJson(payload);
  };
  next();
}

module.exports = {
  list,
  record,
  recordFromRequest,
  clear,
  formatTime,
  middleware,
  EXCLUDED_ACTIONS,
  isAdminUser,
};
