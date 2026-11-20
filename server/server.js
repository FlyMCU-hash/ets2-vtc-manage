// override:true —— 避免 PM2 残留旧 DB_PASSWORD 盖住 .env
// Electron 内嵌时由主进程注入环境变量，不再读 .env 覆盖
if (process.env.PEAK_EMBEDDED !== "1") {
  require("dotenv").config({ override: true });
}
require("./polyfill");
const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const db = require("./db");
const {
  issueAdminToken,
  revokeAdminToken,
  getAdminTokenFromReq,
  attachAdminTokenUser,
} = require("./adminAuth");
const bizDb = require("./bizDb");
const activityFiles = require("./activityFiles");
const activityStorage = require("./activityStorage");
const ossStorage = require("./ossStorage");
const { translateDlcName } = require("./dlcNames");
const { mergeExtraDlcs } = require("./dlcExtra");
const dlcImageCache = require("./dlcImageCache");
const sessionInfo = require("./sessionInfo");
const checkinAuto = require("./checkinAuto");
const { registerOpenApi } = require("./openApi");
const { registerClientApi, revokeTokensForMember } = require("./clientApi");
const evmApi = require("./evmApi");
const opLog = require("./opLog");

const app = express();
const PORT = process.env.PORT || 3000;
console.info("EVM API base:", evmApi.EVM_API_BASE);
const DATA_DIR = path.join(__dirname, "data");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
activityFiles.ensureRoot();
activityStorage.ensureRoot();

function filePath(name) {
  return path.join(DATA_DIR, name);
}

function readJson(name, seed) {
  const fp = filePath(name);
  const fallback = () => {
    const data = structuredClone(seed);
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf8");
    return data;
  };
  if (!fs.existsSync(fp)) return fallback();
  const raw = fs.readFileSync(fp, "utf8").trim();
  if (!raw) return fallback();
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`JSON 损坏，已重置 ${name}:`, err.message);
    return fallback();
  }
}

function writeJson(name, data) {
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), "utf8");
}

function nextId(list) {
  return list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

const POINT_SEED = [];
const CHECKIN_SEED = [];
const REDEEM_SEED = [];
const ONLINE_SEED = [];

const ACTIVITY_SEED = [
  {
    id: 1,
    name: "周末长途活动",
    startDate: "2025-06-08",
    endDate: "2025-06-08",
    location: "卡尔斯鲁厄",
    status: "upcoming",
    content: "集合后统一发车，注意车距。",
  },
];

const STORE_SEED = [
  { id: 1, name: "车队涂装兑换券", price: 50, stock: 20, status: "on", desc: "兑换官方涂装权限" },
  { id: 2, name: "自定义车牌", price: 80, stock: 10, status: "on", desc: "申请车队自定义车牌" },
];

app.use(express.json());
app.use(cookieParser());

const ADMIN_IDLE_MS = 10 * 60 * 1000;

app.use(
  session({
    name: "tmptools.sid",
    secret: process.env.SESSION_SECRET || "tmptools-local-secret",
    resave: false,
    saveUninitialized: false,
    rolling: false,
    // 不设 maxAge：关闭浏览器即清除 Cookie，必须重新登录
    cookie: { httpOnly: true, sameSite: "lax" },
  })
);

// 管理员写操作自动记入操作记录（排除登录成功等）
app.use(opLog.middleware);

function noStore(res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  return res;
}

// 桌面壳加载的就是这个页面。CSP 写在响应头上，tauri.conf.json 里的同名策略才会在远程页面生效。
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://q1.qlogo.cn https://ets2.online",
  "font-src 'self' data:",
  "connect-src 'self' ipc: http://ipc.localhost https://ipc.localhost http://df.peakvtc.cn https://df.peakvtc.cn http://110.42.60.187:9100 https://api.truckersmp.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

function pageHeaders(res) {
  noStore(res);
  res.set("Content-Security-Policy", PAGE_CSP);
  return res;
}

function redirectNoStore(res, url) {
  return noStore(res).redirect(url);
}

function sendHtml(res, filename) {
  return noStore(res).sendFile(path.join(__dirname, "public", filename));
}

// GET /api/me 等若被浏览器/Nginx 缓存，登录页会当成「已登录」跳走，和后台 401 来回刷新
app.use((req, res, next) => {
  const p = String(req.path || "");
  if (p.startsWith("/api/")) noStore(res);
  else if (p === "/" || p === "/login" || p.endsWith(".html")) pageHeaders(res);
  next();
});

function rememberOnline(req) {
  const user = req.session?.user;
  if (!user) return;
  const online = readJson("online.json", ONLINE_SEED);
  const record = {
    id: nextId(online),
    ...sessionInfo.buildSessionRecord(req, user),
    status: "online",
  };
  const sid = record.sessionId;
  const idx = online.findIndex((row) => sid && row.sessionId === sid);
  if (idx >= 0) {
    online[idx] = { ...online[idx], ...record, id: online[idx].id, status: "online" };
  } else {
    for (const row of online) {
      if (String(row.loginName) === String(record.loginName) && row.status !== "offline") {
        row.status = "offline";
      }
    }
    online.unshift(record);
  }
  writeJson("online.json", online.slice(0, 500));
}

function markSessionOffline(sid) {
  try {
    const online = readJson("online.json", ONLINE_SEED);
    let changed = false;
    for (const row of online) {
      if (row.sessionId === sid && row.status !== "offline") {
        row.status = "offline";
        changed = true;
      }
    }
    if (changed) writeJson("online.json", online);
  } catch {
    /* ignore */
  }
}

function expireAdminSession(req, res, message = "登录已过期，请重新登录") {
  const sid = req.sessionID;
  markSessionOffline(sid);
  const reply = () => {
    res.clearCookie("tmptools.sid");
    if (String(req.path || "").startsWith("/api/") || String(req.headers.accept || "").includes("application/json")) {
      return noStore(res).status(401).json({ ok: false, message });
    }
    return redirectNoStore(res, "/login");
  };
  if (!req.session) return reply();
  return req.session.destroy(() => reply());
}

function isAdminIdleExpired(req) {
  if (!req.session || !req.session.user) return false;
  const last = Number(req.session.lastActiveAt || 0);
  if (!last) {
    req.session.lastActiveAt = Date.now();
    return false;
  }
  return Date.now() - last > ADMIN_IDLE_MS;
}

function requireAuth(req, res, next) {
  // Electron / 桌面端：优先走 X-Admin-Token（读写同一 MySQL）
  if (attachAdminTokenUser(req)) {
    return next();
  }

  if (req.session && req.session.user) {
    if (isAdminIdleExpired(req)) {
      return expireAdminSession(req, res, "超过 10 分钟未操作，请重新登录");
    }
    req.session.lastActiveAt = Date.now();
    if (!req.session.onlineRecorded) {
      try {
        rememberOnline(req);
        req.session.onlineRecorded = true;
      } catch (err) {
        console.warn("online session log failed:", err.message);
      }
    }
    return next();
  }
  const isApi =
    String(req.originalUrl || "").startsWith("/api/") ||
    String(req.path || "").startsWith("/api/");
  if (isApi) {
    return noStore(res).status(401).json({ ok: false, message: "未登录" });
  }
  return redirectNoStore(res, "/login");
}

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, message: "请输入账号和密码" });
  }
  try {
    const result = await db.authAdmin(username, password);
    if (result && result.denied === "not_admin") {
      return res.status(403).json({ ok: false, message: "仅管理员可登录后台" });
    }
    if (!result) {
      return res.status(401).json({ ok: false, message: "账号或密码错误" });
    }
    req.session.user = {
      id: result.id,
      username: result.tmpId,
      name: result.name,
      role: result.isSuper ? "super" : "admin",
      tmpId: result.tmpId,
      number: result.number,
      isSuper: Boolean(result.isSuper),
      permissions: result.permissions || db.defaultPermissions(true),
    };
    req.session.lastActiveAt = Date.now();

    try {
      rememberOnline(req);
      req.session.onlineRecorded = true;
    } catch (e) {
      console.warn("online session log failed:", e.message);
    }

    const token = issueAdminToken(req.session.user);
    res.json({ ok: true, user: req.session.user, token });
  } catch (err) {
    console.error("login error:", err.message);
    res.status(500).json({ ok: false, message: "登录服务异常，请检查数据库连接" });
  }
});

app.post("/api/logout", (req, res) => {
  revokeAdminToken(getAdminTokenFromReq(req));
  markSessionOffline(req.sessionID);
  if (!req.session) {
    res.clearCookie("tmptools.sid");
    return res.json({ ok: true });
  }
  req.session.destroy(() => {
    res.clearCookie("tmptools.sid");
    res.json({ ok: true });
  });
});

app.get("/api/me", requireAuth, async (req, res) => {
  try {
    const row = await db.getMemberById(req.session.user.id);
    if (!row) {
      return res.status(401).json({ ok: false, message: "未登录" });
    }
    const mapped = db.mapMember(row);
    req.session.user = {
      ...req.session.user,
      username: mapped.tmpId,
      name: mapped.name,
      tmpId: mapped.tmpId,
      number: mapped.number,
      qq: mapped.qq,
      memberRole: mapped.role,
      role: mapped.isSuper ? "super" : "admin",
      isSuper: mapped.isSuper,
      permissions: mapped.permissions,
    };
    res.json({
      ok: true,
      user: {
        ...req.session.user,
        qq: mapped.qq,
        number: mapped.number,
        memberRole: mapped.role,
      },
    });
  } catch (err) {
    console.error("me error:", err.message);
    res.json({ ok: true, user: req.session.user });
  }
});

/** 当前账号自定义资料（昵称 / QQ） */
app.put("/api/me/profile", requireAuth, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const qq = String(req.body?.qq || "").trim();
  if (!name) {
    return res.status(400).json({ ok: false, message: "请填写昵称" });
  }
  if (name.length > 64) {
    return res.status(400).json({ ok: false, message: "昵称过长" });
  }
  if (qq.length > 32) {
    return res.status(400).json({ ok: false, message: "QQ 过长" });
  }
  try {
    const result = await db.updateOwnProfile(req.session.user.id, { name, qq });
    if (result.missing) {
      return res.status(404).json({ ok: false, message: "账号不存在" });
    }
    const mapped = db.mapMember(result.row);
    req.session.user = {
      ...req.session.user,
      name: mapped.name,
      qq: mapped.qq,
    };
    res.json({
      ok: true,
      message: "资料已保存",
      user: {
        id: mapped.id,
        tmpId: mapped.tmpId,
        name: mapped.name,
        qq: mapped.qq,
        number: mapped.number,
        memberRole: mapped.role,
      },
    });
  } catch (err) {
    console.error("update profile:", err.message);
    res.status(500).json({ ok: false, message: "保存资料失败" });
  }
});

/** 当前管理员修改登录密码 */
app.put("/api/me/password", requireAuth, async (req, res) => {
  const oldPassword = String(req.body?.oldPassword || "");
  const newPassword = String(req.body?.newPassword || "").trim();
  const confirmPassword = String(req.body?.confirmPassword || "").trim();
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ ok: false, message: "请填写原密码和新密码" });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ ok: false, message: "两次输入的新密码不一致" });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ ok: false, message: "新密码至少 4 位" });
  }
  try {
    const result = await db.changePassword(req.session.user.id, oldPassword, newPassword);
    if (result.missing) {
      return res.status(404).json({ ok: false, message: "账号不存在" });
    }
    if (result.badOld) {
      return res.status(400).json({ ok: false, message: "原密码不正确" });
    }
    if (result.weak) {
      return res.status(400).json({ ok: false, message: "新密码至少 4 位" });
    }
    res.json({ ok: true, message: "密码已更新" });
  } catch (err) {
    console.error("change password:", err.message);
    res.status(500).json({ ok: false, message: "修改密码失败" });
  }
});

const ALL_MENUS = [
  { id: "home", label: "首页" },
  {
    id: "fleet",
    label: "车队管理",
    children: [
      { id: "memberAdd", label: "新增成员", perm: "members" },
      { id: "members", label: "成员管理", perm: "members" },
      { id: "points", label: "积分管理", perm: "points" },
    ],
  },
  {
    id: "activityGroup",
    label: "活动管理",
    children: [
      { id: "activities", label: "设置活动", perm: "activities" },
      { id: "checkins", label: "签到记录", perm: "activities" },
    ],
  },
  {
    id: "mall",
    label: "商城管理",
    children: [
      { id: "store", label: "商品管理", perm: "store" },
      { id: "redeems", label: "兑换记录", perm: "store" },
    ],
  },
  {
    id: "game",
    label: "游戏内容",
    children: [{ id: "dlc", label: "DLC管理", perm: "dlc" }],
  },
  {
    id: "settingsGroup",
    label: "设置",
    children: [
      { id: "customUserSettings", label: "账号创建", perm: "settings" },
      { id: "userSettings", label: "账号设置", perm: "settings" },
      { id: "online", label: "在线用户", perm: "monitor" },
      { id: "settings", label: "权限管理", perm: "settings" },
      { id: "opLog", label: "操作记录" },
    ],
  },
];

function menusForUser(user) {
  if (!user) return [{ id: "home", label: "首页" }];
  const isSuper = user.isSuper || user.role === "super";
  const perms = user.permissions || {};

  const result = [];
  for (const m of ALL_MENUS) {
    if (m.children?.length) {
      const children = m.children
        .filter((c) => isSuper || !c.perm || perms[c.perm])
        .map(({ id, label }) => ({ id, label }));
      if (!children.length) continue;
      result.push({ id: m.id, label: m.label, children });
      continue;
    }
    if (!isSuper && m.perm && !perms[m.perm]) continue;
    result.push({ id: m.id, label: m.label });
  }
  return result;
}

app.get("/api/dashboard", requireAuth, async (req, res) => {
  try {
    const members = await db.listMembers();
    const activities = await bizDb.listActivities();
    const store = await bizDb.listProducts();
    res.json({
      ok: true,
      menus: menusForUser(req.session.user),
      permissionDefs: db.PERMISSION_DEFS,
      stats: {
        members: members.length,
        activities: activities.length,
        products: store.length,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("dashboard error:", err.message);
    res.status(500).json({ ok: false, message: "读取仪表盘失败" });
  }
});

/* ---------- 权限设置 ---------- */
app.get("/api/permissions", requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    if (!user?.isSuper && user?.permissions?.settings === false) {
      return res.status(403).json({ ok: false, message: "无权限访问设置" });
    }
    const admins = await db.listAdmins();
    res.json({
      ok: true,
      defs: db.PERMISSION_DEFS,
      admins,
    });
  } catch (err) {
    console.error("permissions list error:", err.message);
    res.status(500).json({ ok: false, message: "读取权限失败" });
  }
});

/* ---------- 操作记录 ---------- */
app.get("/api/oplog", requireAuth, (req, res) => {
  try {
    const keyword = String(req.query.keyword || req.query.q || "");
    const items = opLog.list({ keyword }).map((e) => ({
      ...e,
      timeText: opLog.formatTime(e.time),
    }));
    res.json({ ok: true, items, total: items.length });
  } catch (err) {
    console.error("oplog list error:", err.message);
    res.status(500).json({ ok: false, message: "读取操作记录失败" });
  }
});

app.delete("/api/oplog", requireAuth, (req, res) => {
  try {
    const user = req.session.user;
    if (!user?.isSuper && user?.role !== "super") {
      return res.status(403).json({ ok: false, message: "仅超级管理员可清空操作记录" });
    }
    opLog.clear();
    res.json({ ok: true });
  } catch (err) {
    console.error("oplog clear error:", err.message);
    res.status(500).json({ ok: false, message: "清空失败" });
  }
});

app.put("/api/permissions/:id", requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    if (!user?.isSuper && user?.permissions?.settings === false) {
      return res.status(403).json({ ok: false, message: "无权限修改权限设置" });
    }
    const result = await db.updateAdminPermissions(
      Number(req.params.id),
      req.body?.permissions || {}
    );
    if (!result) return res.status(404).json({ ok: false, message: "管理员不存在" });
    if (result.isSuper) {
      return res.status(403).json({ ok: false, message: "超级管理员权限不可修改" });
    }
    if (result.notAdmin) {
      return res.status(400).json({ ok: false, message: "该账号不是管理员" });
    }
    res.json({ ok: true, item: result });
  } catch (err) {
    console.error("permissions update error:", err.message);
    res.status(500).json({ ok: false, message: "保存权限失败" });
  }
});

function normalizeRole(role) {
  let text = String(role || "").trim();
  if (!text) return "司机";
  // 去掉损坏的 emoji 占位 ?
  text = text.replace(/^\?+\s*/, "").replace(/\s*\?+$/, "");

  // 保留 emoji 图标，去掉英文副标题（| 或 / English）
  const emojiRe =
    /\p{Extended_Pictographic}(?:\u{FE0F})?(?:\u{200D}\p{Extended_Pictographic}(?:\u{FE0F})?)*/gu;
  const marks = text.match(emojiRe) || [];
  let core = text.replace(emojiRe, " ").replace(/\s+/g, " ").trim();

  const pipe = core.indexOf("|");
  if (pipe >= 0) core = core.slice(0, pipe).trim();
  const slashEn = core.search(/\s*\/\s*[A-Za-z]/);
  if (slashEn >= 0) core = core.slice(0, slashEn).trim();
  core = core.replace(/\s+/g, " ").trim();
  if (!core) return "司机";

  if (!marks.length) return core;
  if (marks.length === 1) return `${marks[0]} ${core}`;
  return `${marks[0]} ${core} ${marks[marks.length - 1]}`;
}

function toDateOnly(value) {
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
  const m = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m || m[1].startsWith("0000-00-00")) return "";
  return m[1];
}

function todayLocal() {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function pickSteamId(obj) {
  if (!obj || typeof obj !== "object") return "";
  const raw = obj.steamId ?? obj.steam_id ?? obj.steamID64 ?? obj.steamID ?? "";
  const text = String(raw).trim();
  if (!text || text === "0" || text === "null") return "";
  return text;
}

function evmPlayerSources() {
  return [evmApi.EVM_API_BASE, "https://da.vtcm.link"].filter(Boolean);
}

async function fetchEvmPlayerFrom(base, tmpId) {
  const target = `${String(base).replace(/\/+$/, "")}/player/info?tmpId=${encodeURIComponent(tmpId)}`;
  console.info("TMP 玩家查询:", target);
  const upstream = await evmApi.httpFetch(target, {
    signal: evmApi.makeSignal(10000),
    headers: {
      Accept: "application/json",
      "User-Agent": "PeakFleet/1.0",
    },
  });
  const payload = await upstream.json();
  if (Number(payload.code) !== 200 || !payload.data) {
    throw new Error(payload.msg || "EVM 查询失败");
  }
  const p = payload.data;
  return {
    tmpId: String(p.tmpId ?? tmpId),
    name: p.name || "",
    role: normalizeRole(p.vtcRole),
    avatarUrl: p.avatarUrl || "",
    vtcName: p.vtcName || "",
    vtcId: p.vtcId || null,
    joinDate: toDateOnly(p.vtcJoinTime || p.joinDate),
    steamId: pickSteamId(p),
    source: target,
  };
}

async function fetchOfficialPlayer(tmpId) {
  const upstream = await evmApi.httpFetch(
    `https://api.truckersmp.com/v2/player/${encodeURIComponent(tmpId)}`,
    {
      signal: evmApi.makeSignal(8000),
      headers: { "User-Agent": "PeakFleet/1.0" },
    }
  );
  const payload = await upstream.json();
  if (payload.error || !payload.response) {
    throw new Error("官方 TMP 接口未找到该玩家");
  }
  const p = payload.response;
  const vtc = p.vtc || {};
  let role = "司机";
  let joinDate = "";
  let steamFromMember = "";
  if (vtc.inVTC && vtc.id) {
    try {
      const membersRes = await evmApi.httpFetch(
        `https://api.truckersmp.com/v2/vtc/${vtc.id}/members`,
        { signal: evmApi.makeSignal(8000) }
      );
      const membersPayload = await membersRes.json();
      const list = membersPayload?.response?.members || [];
      const me = list.find((m) => {
        const uid = m.user_id ?? m.user?.id ?? m.tmp_id ?? m.tmpId ?? m.id;
        return String(uid) === String(tmpId);
      });
      if (me?.role) role = normalizeRole(me.role);
      joinDate = toDateOnly(me?.joinDate);
      if (me) steamFromMember = pickSteamId(me);
    } catch {
      /* 职位/入队时间查不到时保留默认 */
    }
  }
  return {
    tmpId: String(p.id ?? tmpId),
    name: p.name || "",
    role,
    avatarUrl: p.avatar || "",
    vtcName: vtc.name || "",
    vtcId: vtc.id || null,
    joinDate,
    steamId: steamFromMember || pickSteamId(p),
    source: "truckersmp",
  };
}

async function lookupTmpPlayer(tmpId) {
  const id = String(tmpId || "").trim();
  if (!id) throw new Error("TMP ID 必填");
  const errors = [];
  let item = null;
  for (const base of evmPlayerSources()) {
    try {
      item = await fetchEvmPlayerFrom(base, id);
      break;
    } catch (err) {
      errors.push(`${base}: ${err.message}`);
      console.warn("TMP lookup 失败:", base, String(err.message || "").slice(0, 160));
    }
  }
  if (!item) {
    try {
      item = await fetchOfficialPlayer(id);
    } catch (err) {
      errors.push(`truckersmp: ${err.message}`);
      const error = new Error("查询 TMP 信息失败，可先手动填写后保存");
      error.detail = errors.join(" | ");
      error.status = 502;
      throw error;
    }
  }
  if (item && item.vtcId && (!item.joinDate || !item.steamId)) {
    try {
      const { map, steamMap } = await fetchVtcJoinMap(item.vtcId);
      if (!item.joinDate) item.joinDate = map.get(String(item.tmpId)) || "";
      if (!item.steamId && steamMap) item.steamId = steamMap.get(String(item.tmpId)) || "";
    } catch {
      /* 入队时间 / Steam ID 补全失败不影响昵称/职位 */
    }
  }
  return item;
}

function mapVtcMembers(list) {
  const joinMap = new Map();
  const steamMap = new Map();
  for (const m of list || []) {
    const uid = m.tmpId ?? m.tmp_id ?? m.userId ?? m.user_id ?? m.user?.id;
    if (uid == null) continue;
    const key = String(uid);
    const join = toDateOnly(m.joinDate ?? m.vtcJoinTime ?? m.join_date);
    const steamId = pickSteamId(m);
    if (join) joinMap.set(key, join);
    if (steamId) steamMap.set(key, steamId);
  }
  return { joinMap, steamMap };
}

async function fetchVtcJoinMap(vtcId) {
  const id = String(vtcId || "").trim();
  if (!id) throw new Error("车队 ID 未知");
  const errors = [];
  for (const base of evmPlayerSources()) {
    try {
      const target = `${String(base).replace(/\/+$/, "")}/vtc/memberAll?vtcId=${encodeURIComponent(id)}`;
      const upstream = await evmApi.httpFetch(target, {
        signal: evmApi.makeSignal(15000),
        headers: { Accept: "application/json", "User-Agent": "PeakFleet/1.0" },
      });
      const payload = await upstream.json();
      if (Number(payload.code) !== 200) {
        throw new Error(payload.msg || "EVM 车队成员查询失败");
      }
      const list = Array.isArray(payload.data) ? payload.data : [];
      const { joinMap, steamMap } = mapVtcMembers(list);
      if (joinMap.size || steamMap.size) {
        if (!steamMap.size) await mergeOfficialSteamIds(id, steamMap, errors);
        return { vtcId: id, map: joinMap, steamMap, source: target };
      }
    } catch (err) {
      errors.push(`${base}: ${err.message}`);
    }
  }
  try {
    const target = `https://api.truckersmp.com/v2/vtc/${encodeURIComponent(id)}/members`;
    const upstream = await evmApi.httpFetch(target, {
      signal: evmApi.makeSignal(15000),
      headers: { "User-Agent": "PeakFleet/1.0" },
    });
    const payload = await upstream.json();
    if (payload.error) throw new Error("官方车队成员查询失败");
    const list = payload?.response?.members || [];
    const { joinMap, steamMap } = mapVtcMembers(list);
    if (joinMap.size || steamMap.size) {
      return { vtcId: id, map: joinMap, steamMap, source: "truckersmp" };
    }
  } catch (err) {
    errors.push(`truckersmp: ${err.message}`);
  }
  throw new Error("无法从车队获取成员入队时间：" + errors.join(" | "));
}

async function backfillMemberSteamIds(members) {
  const missing = (members || []).filter(
    (m) => m.tmpId && !String(m.steamId || "").trim() && String(m.tmpId).toLowerCase() !== "admin"
  );
  if (!missing.length) return members;
  try {
    const sample = missing.find((m) => !m.left) || missing[0];
    const vtcId = await resolveVtcId(sample.tmpId);
    if (!vtcId) return members;
    const { steamMap } = await fetchVtcJoinMap(vtcId);
    for (const m of missing) {
      const steamId = steamMap?.get(String(m.tmpId));
      if (!steamId) continue;
      await db.updateMember(m.id, { steamId });
      m.steamId = steamId;
    }
  } catch (err) {
    console.warn("补全 Steam ID 失败:", err.message);
  }
  return members;
}

async function mergeOfficialSteamIds(vtcId, steamMap, errors) {
  try {
    const target = `https://api.truckersmp.com/v2/vtc/${encodeURIComponent(vtcId)}/members`;
    const upstream = await evmApi.httpFetch(target, {
      signal: evmApi.makeSignal(15000),
      headers: { "User-Agent": "PeakFleet/1.0" },
    });
    const payload = await upstream.json();
    if (payload.error) throw new Error("官方车队成员查询失败");
    const { steamMap: official } = mapVtcMembers(payload?.response?.members || []);
    for (const [key, steamId] of official) steamMap.set(key, steamId);
  } catch (err) {
    if (errors) errors.push(`truckersmp steam: ${err.message}`);
  }
}

async function resolveVtcId(sampleTmpId) {
  const envId = String(process.env.TMP_VTC_ID || "").trim();
  if (envId) return envId;
  if (!sampleTmpId) return "";
  try {
    const player = await lookupTmpPlayer(sampleTmpId);
    return player.vtcId ? String(player.vtcId) : "";
  } catch {
    return "";
  }
}

/* ---------- TMP 玩家信息（代理，多源回退） ---------- */
app.get("/api/tmp-player/:tmpId", requireAuth, async (req, res) => {
  const tmpId = String(req.params.tmpId || "").trim();
  if (!tmpId) {
    return res.status(400).json({ ok: false, message: "TMP ID 必填" });
  }
  try {
    const item = await lookupTmpPlayer(tmpId);
    return res.json({ ok: true, item });
  } catch (err) {
    console.error("TMP player lookup failed:", err.detail || err.message);
    return res.status(err.status || 502).json({
      ok: false,
      message: err.message || "查询 TMP 信息失败，可先手动填写后保存",
      detail: err.detail || "",
    });
  }
});

function parseIsAdmin(value) {
  return value === true || value === 1 || value === "1" || value === "on" || value === "true";
}

/** UID 编号从 1 起递增 */
const UID_START = 1;

function nextUidNumber(members) {
  const maxExisting = (members || []).reduce((max, item) => {
    const n = Number(item.number) || 0;
    return Math.max(max, n);
  }, UID_START - 1);
  return Math.max(UID_START, maxExisting + 1);
}

/* ---------- 成员管理（MySQL） ---------- */
app.get("/api/members", requireAuth, async (req, res) => {
  try {
    let items = (await db.listMembers()).map((m) => ({
      ...m,
      role: normalizeRole(m.role),
    }));
    items = await backfillMemberSteamIds(items);
    res.json({ ok: true, items, nextUid: nextUidNumber(items), uidStart: UID_START });
  } catch (err) {
    console.error("list members error:", err.message);
    res.status(500).json({ ok: false, message: "读取成员失败" });
  }
});

app.post("/api/members", requireAuth, async (req, res) => {
  const { number, tmpId, name, qq, role, score, joinDate, password, isAdmin } = req.body || {};
  if (!tmpId || !name) {
    return res.status(400).json({ ok: false, message: "登录账号和昵称必填" });
  }
  // 新增成员默认密码 123456
  const pwd = String(password || "").trim() || "123456";
  if (String(tmpId).trim().toLowerCase() === "admin") {
    return res.status(400).json({ ok: false, message: "admin 为系统超级管理员账号，不可新增" });
  }
  try {
    const exists = await db.getMemberByTmpId(String(tmpId).trim());
    if (exists) {
      return res.status(400).json({ ok: false, message: "登录账号已存在" });
    }
    const members = await db.listMembers();
    const manual = Number(number);
    const nextNumber =
      Number.isFinite(manual) && manual > 0 ? manual : nextUidNumber(members);
    let join = toDateOnly(joinDate);
    let steamId = "";
    try {
      const player = await lookupTmpPlayer(tmpId);
      if (!join) join = player.joinDate || "";
      steamId = player.steamId || "";
    } catch (err) {
      console.warn("create member: 未能从车队获取资料:", err.message);
    }
    const row = await db.createMember({
      number: nextNumber,
      tmpId,
      name,
      qq,
      role: normalizeRole(role),
      score: score !== undefined && score !== "" ? score : 0,
      joinDate: join || todayLocal(),
      password: pwd,
      isAdmin: parseIsAdmin(isAdmin),
      steamId,
    });
    res.json({ ok: true, item: db.mapMember(row) });
  } catch (err) {
    console.error("create member error:", err.message);
    res.status(500).json({ ok: false, message: "保存成员失败" });
  }
});

/** 从 TruckersMP / EVM 车队同步在队成员的入队时间 */
app.post("/api/members/sync-join-dates", requireAuth, async (req, res) => {
  try {
    const members = await db.listMembers();
    const active = members.filter((m) => !m.left && m.tmpId);
    const sample = active.find((m) => m.tmpId)?.tmpId || "";
    const vtcId = await resolveVtcId(sample);
    if (!vtcId) {
      return res.status(400).json({
        ok: false,
        message: "无法识别车队。请确认成员 TMP ID 仍在 Peak 车队中，或在 .env 设置 TMP_VTC_ID",
      });
    }
    const { map, source } = await fetchVtcJoinMap(vtcId);
    let updated = 0;
    let unchanged = 0;
    let missing = 0;
    for (const m of active) {
      const join = map.get(String(m.tmpId));
      if (!join) {
        missing += 1;
        continue;
      }
      if (toDateOnly(m.joinDate) === join) {
        unchanged += 1;
        continue;
      }
      await db.updateMember(m.id, { joinDate: join });
      updated += 1;
    }
    res.json({
      ok: true,
      vtcId,
      source,
      total: active.length,
      updated,
      unchanged,
      missing,
      message: `已从车队同步入队时间：更新 ${updated} 人，未变 ${unchanged} 人，车队名单中未找到 ${missing} 人`,
    });
  } catch (err) {
    console.error("sync join dates error:", err.message);
    res.status(500).json({ ok: false, message: err.message || "同步入队时间失败" });
  }
});

app.put("/api/members/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { number, tmpId, name, qq, role, score, joinDate, password, isAdmin } = req.body || {};
  try {
    const current = await db.getMemberById(id);
    if (!current) return res.status(404).json({ ok: false, message: "成员不存在" });
    if (db.isSuperMember(current)) {
      return res.status(403).json({ ok: false, message: "超级管理员不可在此修改" });
    }
    if (tmpId) {
      const exists = await db.getMemberByTmpId(String(tmpId).trim());
      if (exists && exists.id !== id) {
        return res.status(400).json({ ok: false, message: "TMP ID 已存在" });
      }
    }
    const row = await db.updateMember(id, {
      number,
      tmpId,
      name,
      qq,
      role: role === undefined ? undefined : normalizeRole(role),
      score,
      joinDate,
      password,
      isAdmin: isAdmin === undefined ? undefined : parseIsAdmin(isAdmin),
    });
    if (row && row.isSuper) {
      return res.status(403).json({ ok: false, message: "超级管理员不可在此修改" });
    }
    res.json({ ok: true, item: db.mapMember(row) });
  } catch (err) {
    console.error("update member error:", err.message);
    res.status(500).json({ ok: false, message: "更新成员失败" });
  }
});

app.post("/api/members/:id/leave", requireAuth, async (req, res) => {
  try {
    const result = await db.leaveMember(Number(req.params.id));
    if (!result) return res.status(404).json({ ok: false, message: "成员不存在" });
    if (result.isSuper) {
      return res.status(403).json({ ok: false, message: "超级管理员不可退队" });
    }
    if (result.alreadyLeft) {
      return res.status(400).json({ ok: false, message: "该成员已退队" });
    }
    revokeTokensForMember(result.row && result.row.id);
    res.json({ ok: true, item: db.mapMember(result.row) });
  } catch (err) {
    console.error("leave member error:", err.message);
    res.status(500).json({ ok: false, message: "退队失败" });
  }
});

app.delete("/api/members/:id", requireAuth, async (req, res) => {
  try {
    const ok = await db.deleteMember(Number(req.params.id));
    if (ok && ok.isSuper) {
      return res.status(403).json({ ok: false, message: "超级管理员不可删除" });
    }
    if (!ok) return res.status(404).json({ ok: false, message: "成员不存在" });
    revokeTokensForMember(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    console.error("delete member error:", err.message);
    res.status(500).json({ ok: false, message: "删除成员失败" });
  }
});

async function addMemberScore(memberId, delta, reason, { allowLeft = false } = {}) {
  const change = Number(delta);
  if (!change || Number.isNaN(change)) return null;
  const row = await db.getMemberById(Number(memberId));
  if (!row) {
    const err = new Error("成员不存在");
    err.status = 404;
    throw err;
  }
  if (db.hasLeftTeam(row) && !allowLeft) {
    const err = new Error("已退队成员不可调整积分");
    err.status = 400;
    throw err;
  }
  const nextScore = Number(row.score || 0) + change;
  const updated = await db.updateMember(row.id, { score: nextScore });
  const member = db.mapMember(updated);
  const logs = readJson("points.json", POINT_SEED);
  const item = {
    id: nextId(logs),
    memberId: member.id,
    memberName: member.name,
    delta: change,
    reason: reason || "手动调整",
    createdAt: new Date().toISOString(),
  };
  logs.push(item);
  writeJson("points.json", logs);
  return { member, item };
}

function resolveActivityCheckinReward(activity) {
  const configs = checkinAuto.withFittedIds(
    Array.isArray(activity?.checkinConfigs) ? activity.checkinConfigs : []
  );
  const config =
    configs.find((c) => checkinAuto.isConfigActiveNow(activity, c)) || configs[0] || null;
  const reward = Number(config?.points);
  const points = Number.isFinite(reward) && reward > 0 ? reward : 10;
  return { points, config };
}

/* ---------- 积分管理 ---------- */
app.get("/api/points", requireAuth, async (req, res) => {
  try {
    const logs = readJson("points.json", POINT_SEED);
    const members = await db.listMembers();
    res.json({
      ok: true,
      items: logs.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
      members: members
        .filter((m) => !m.left)
        .map((m) => ({ id: m.id, name: m.name, tmpId: m.tmpId, score: m.score })),
    });
  } catch (err) {
    console.error("points list error:", err.message);
    res.status(500).json({ ok: false, message: "读取积分失败" });
  }
});

app.post("/api/points", requireAuth, async (req, res) => {
  const { memberId, delta, reason } = req.body || {};
  try {
    const change = Number(delta);
    if (!change || Number.isNaN(change)) {
      return res.status(400).json({ ok: false, message: "请输入有效积分变动" });
    }
    const { member, item } = await addMemberScore(
      Number(memberId),
      change,
      reason || "手动调整"
    );
    res.json({ ok: true, item, member });
  } catch (err) {
    console.error("points update error:", err.message);
    if (err.status) return res.status(err.status).json({ ok: false, message: err.message });
    res.status(500).json({ ok: false, message: "调整积分失败" });
  }
});

function activityStatusByTime(startDate, endDate, now = Date.now()) {
  const start = checkinAuto.parseActivityTime(startDate, false);
  const endSource = endDate || startDate || "";
  const end = checkinAuto.parseActivityTime(
    endSource,
    /^\d{4}-\d{2}-\d{2}$/.test(String(endSource).trim())
  );
  const ts = typeof now === "number" ? now : new Date(now).getTime();
  if (!Number.isFinite(start)) return "upcoming";
  if (ts < start) return "upcoming";
  if (Number.isFinite(end) && ts >= end) return "done";
  return "ongoing";
}

function withActivityStatus(item) {
  return {
    ...item,
    status: activityStatusByTime(item.startDate, item.endDate),
  };
}

async function cleanupEndedActivityFiles() {
  try {
    const items = await bizDb.listActivities();
    const removed = activityStorage.cleanupEndedActivities(items, (item) =>
      activityStatusByTime(item.startDate, item.endDate)
    );
    if (removed.length) {
      console.log("已清理结束活动文件目录:", removed.join(", "));
    }
  } catch (err) {
    console.error("清理活动文件失败:", err.message);
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      try {
        cb(null, activityStorage.ensureActivityDir(req.params.id));
      } catch (err) {
        cb(err);
      }
    },
    filename(req, file, cb) {
      // busboy 常把 UTF-8 文件名按 latin1 读入，这里还原中文名
      let raw = String(file.originalname || "file");
      try {
        const decoded = Buffer.from(raw, "latin1").toString("utf8");
        if (decoded && !decoded.includes("\uFFFD")) raw = decoded;
      } catch {
        /* keep raw */
      }
      // 若历史误存为 hex 文件名，尽量还原可读名
      const bare = raw.replace(/\.zip$/i, "");
      if (/^[0-9a-fA-F]{8,}$/.test(bare) && bare.length % 2 === 0) {
        try {
          const fromHex = Buffer.from(bare, "hex").toString("utf8");
          if (fromHex && /[\u4e00-\u9fffA-Za-z]/.test(fromHex)) {
            raw = `${fromHex}.zip`;
          }
        } catch {
          /* keep */
        }
      }
      const base = activityStorage.safeName(raw) || "archive.zip";
      const stamp = Date.now();
      cb(null, `${stamp}_${base}`);
    },
  }),
  limits: { fileSize: Number(process.env.UPLOAD_MAX_MB || 50) * 1024 * 1024 },
});

/* ---------- ETS2 地图瓦片配置 ---------- */
let mapConfigCache = { at: 0, payload: null };

function collectTileTemplates(node, out = []) {
  if (!node) return out;
  if (typeof node === "string") {
    const s = node.trim();
    if (s.startsWith("http") && s.includes("{z}") && s.includes("{x}") && s.includes("{y}")) {
      out.push(s);
    }
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectTileTemplates(item, out);
    return out;
  }
  if (typeof node === "object") {
    for (const val of Object.values(node)) collectTileTemplates(val, out);
  }
  return out;
}

app.get("/api/map/config", requireAuth, async (req, res) => {
  const now = Date.now();
  if (mapConfigCache.payload && now - mapConfigCache.at < 30 * 60 * 1000) {
    return res.json({ ok: true, ...mapConfigCache.payload, cached: true });
  }

  let etsTile = "https://ets2.online/map/ets2map_159/{z}/{x}/{y}.png";
  let promodsTile = "https://ets2.online/map/ets2mappromods_158/{z}/{x}/{y}.png";
  const fallbackEts = etsTile;
  const fallbackPromods = promodsTile;

  try {
    const upstream = await evmApi.httpFetch("https://tracker.ets2map.com/v3/fullmap", {
      signal: evmApi.makeSignal(10000),
      headers: { "User-Agent": "PeakFleetMap/1.0" },
    });
    const payload = await upstream.json();
    const templates = [...new Set(collectTileTemplates(payload))];
    const etsFromApi = templates.find(
      (u) => /ets/i.test(u) && !/promods/i.test(u)
    );
    const promodsFromApi = templates.find((u) => /promods/i.test(u));
    if (etsFromApi) etsTile = etsFromApi;
    if (promodsFromApi) promodsTile = promodsFromApi;
  } catch (err) {
    console.warn("map config upstream failed:", err.message);
  }

  const payload = {
    source: "ets2map",
    ets: {
      tileUrl: etsTile,
      fallbackUrl: fallbackEts,
      maxZoom: 8,
      minZoom: 2,
      tileSize: 512,
      bounds: { x: 131072, y: 131072 },
    },
    promods: {
      tileUrl: promodsTile,
      fallbackUrl: fallbackPromods,
      maxZoom: 8,
      minZoom: 2,
      tileSize: 512,
      bounds: { x: 131072, y: 131072 },
    },
  };
  mapConfigCache = { at: now, payload };
  res.json({ ok: true, ...payload, cached: false });
});

/** 按 TMP ID 查地图在线坐标，供打卡配置「定位」 */
app.get("/api/map/player/:tmpId", requireAuth, async (req, res) => {
  const tmpId = String(req.params.tmpId || "").trim();
  if (!tmpId) {
    return res.status(400).json({ ok: false, message: "请填写 TMP ID" });
  }
  try {
    const players = await checkinAuto.fetchFullmapPlayers();
    const player = players.find((p) => String(p.tmpId) === tmpId);
    if (!player) {
      return res.status(404).json({
        ok: false,
        message: "该 TMP ID 当前不在线，或不在地图数据中",
      });
    }
    const serverName = String(req.query.serverName || "").trim();
    const mapTypeHint = String(req.query.mapType || "").trim().toLowerCase();
    const mapType =
      mapTypeHint === "ets" || mapTypeHint === "promods"
        ? mapTypeHint
        : checkinAuto.resolveMapType(serverName);
    const pos = checkinAuto.gameToLatLng(player.x, player.y, mapType);
    let serverNameResolved = "";
    try {
      const servers = await checkinAuto.fetchTmpServers();
      serverNameResolved = checkinAuto.serverLabel(servers, player.serverId);
    } catch {
      /* ignore */
    }
    res.json({
      ok: true,
      item: {
        tmpId: player.tmpId,
        name: player.name || "",
        serverId: player.serverId,
        serverName: serverNameResolved,
        x: player.x,
        y: player.y,
        lat: pos.lat,
        lng: pos.lng,
        mapType,
      },
    });
  } catch (err) {
    console.error("map player locate:", err.message);
    res.status(500).json({ ok: false, message: err.message || "查询位置失败" });
  }
});

/* ---------- TruckersMP 服务器列表 ---------- */
let serversCache = { at: 0, items: [] };
let serversRefreshing = null;
const SERVERS_FRESH_MS = 5 * 60 * 1000;

function mapServerRow(raw) {
  const name = String(raw.serverName || raw.name || raw.shortName || raw.shortname || "").trim();
  if (!name) return null;
  return {
    id: raw.serverId ?? raw.id,
    name,
    shortName: raw.shortName || raw.shortname || "",
    shortname: raw.shortName || raw.shortname || "",
    game: raw.game || "",
    online: Boolean(raw.isOnline ?? raw.online),
    players: Number(raw.playerCount ?? raw.players) || 0,
    maxplayers: Number(raw.maxPlayer ?? raw.maxplayers) || 0,
    queue: Number(raw.queueCount ?? raw.queue) || 0,
    speedLimiter: raw.speedLimiter ?? raw.speedlimiter,
    collisions: raw.collisions,
    carsForPlayers: raw.carsForPlayers ?? raw.carsforplayers,
    afkEnabled: raw.afkEnabled ?? raw.afkenabled,
    promods: raw.promods,
    event: raw.event,
  };
}

function rowsOfServerPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const direct = payload.data || payload.response || payload.items;
  if (Array.isArray(direct)) return direct;
  if (direct && typeof direct === "object") {
    const nested = direct.list || direct.items || direct.servers;
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

async function fetchServersFromEvm() {
  const { payload } = await evmApi.fetchJson("/server/list", null, 4000);
  const list = rowsOfServerPayload(payload);
  if (!list.length) throw new Error("EVM 服务器列表为空");
  return list.map(mapServerRow).filter(Boolean);
}

async function fetchServersFromMirror() {
  const upstream = await evmApi.httpFetch("http://110.42.60.187:9100/server/list", {
    signal: evmApi.makeSignal(4000),
    headers: {
      Accept: "application/json",
      "User-Agent": "PeakFleet/1.0",
    },
  });
  const payload = await upstream.json();
  const list = rowsOfServerPayload(payload);
  if (!list.length) throw new Error("镜像服务器列表为空");
  return list.map(mapServerRow).filter(Boolean);
}

async function fetchServersFromTruckersMp() {
  const upstream = await evmApi.httpFetch("https://api.truckersmp.com/v2/servers", {
    signal: evmApi.makeSignal(6000),
  });
  const payload = await upstream.json();
  // TruckersMP 可能返回 boolean false，也可能是字符串 "false"
  const apiError = payload.error;
  const failed =
    apiError === true ||
    apiError === "true" ||
    (typeof apiError === "string" &&
      apiError.toLowerCase() !== "false" &&
      apiError.trim() !== "");
  const list = Array.isArray(payload.response) ? payload.response : [];
  if (failed && !list.length) {
    throw new Error("TruckersMP 服务器接口返回错误");
  }
  return list.map(mapServerRow).filter(Boolean);
}

async function fetchServersFromUpstream() {
  const loads = [fetchServersFromEvm, fetchServersFromMirror, fetchServersFromTruckersMp];
  const lists = await Promise.all(
    loads.map((load) =>
      load().catch((err) => {
        console.warn("服务器列表来源失败:", err.message);
        return [];
      })
    )
  );
  const items = lists.reduce((best, list) => (list.length > best.length ? list : best), []);
  if (!items.length) throw new Error("获取服务器列表失败");
  serversCache = { at: Date.now(), items };
  return items;
}

function refreshServersInBackground() {
  if (serversRefreshing) return serversRefreshing;
  serversRefreshing = fetchServersFromUpstream()
    .catch((err) => {
      console.error("servers refresh error:", err.message);
      return serversCache.items;
    })
    .finally(() => {
      serversRefreshing = null;
    });
  return serversRefreshing;
}

async function loadServerItems() {
  const now = Date.now();
  const fresh = serversCache.items.length && now - serversCache.at < SERVERS_FRESH_MS;
  if (fresh) return { items: serversCache.items, cached: true };
  if (serversCache.items.length) {
    refreshServersInBackground();
    return { items: serversCache.items, cached: true, stale: true };
  }
  return { items: await fetchServersFromUpstream(), cached: false };
}

app.get("/api/servers", requireAuth, async (req, res) => {
  try {
    res.json({ ok: true, ...(await loadServerItems()) });
  } catch (err) {
    console.error("servers list error:", err.message);
    res.status(502).json({ ok: false, message: "获取服务器列表失败" });
  }
});

/* ---------- 活动管理 ---------- */
app.get("/api/activities", requireAuth, async (req, res) => {
  try {
    await cleanupEndedActivityFiles();
    const items = (await bizDb.listActivities()).map(withActivityStatus);
    res.json({ ok: true, items });
  } catch (err) {
    console.error("activities list:", err.message);
    res.status(500).json({ ok: false, message: "读取活动失败" });
  }
});

function normalizeDlcIds(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
}

function normalizeCheckinConfigs(raw) {
  if (!Array.isArray(raw)) return [];
  const mapped = raw
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      // 兼容旧数据：仅有 serverName
      if (!item.type && (item.serverName || item.serverId) && !item.name && !item.polygon) {
        return {
          id: Number(item.id) || index + 1,
          name: String(item.serverName || item.serverId || "").trim(),
          points: 0,
          type: "fixed",
          checkinTime: "",
          startTime: "",
          endTime: "",
          polygon: [],
          serverName: String(item.serverName || item.serverId || "").trim(),
        };
      }
      const polygonSrc = Array.isArray(item.polygon)
        ? item.polygon
        : Array.isArray(item.mapPoints)
          ? item.mapPoints
          : [];
      const polygon = polygonSrc
        .map((p) => {
          const lat = Number(p.lat ?? p.y);
          const lng = Number(p.lng ?? p.x);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return { lat, lng };
        })
        .filter(Boolean);
      return {
        id: Number(item.id) || index + 1,
        name: String(item.name || "").trim().slice(0, 50),
        points: (() => {
          const p = Number(item.points);
          return Number.isFinite(p) ? p : 10;
        })(),
        type: item.type === "range" ? "range" : item.type === "all" ? "all" : "fixed",
        checkinTime: String(item.checkinTime || "").trim(),
        startTime: String(item.startTime || "").trim(),
        endTime: String(item.endTime || "").trim(),
        polygon,
        serverName: String(item.serverName || item.serverId || "").trim(),
      };
    })
    .filter(Boolean);
  return checkinAuto.withFittedIds(mapped);
}

app.post("/api/activities", requireAuth, async (req, res) => {
  try {
    const {
      name,
      startDate,
      endDate,
      location,
      content,
      publishStatus,
      dlcIds,
      checkinConfigs,
    } = req.body || {};
    if (!name || !startDate) {
      return res.status(400).json({ ok: false, message: "活动名称和活动日期必填" });
    }
    const item = await bizDb.createActivity({
      name: String(name).trim().slice(0, 100),
      startDate,
      endDate: endDate || startDate,
      location: location || "",
      status: activityStatusByTime(startDate, endDate || startDate),
      content: content || "",
      publishStatus: publishStatus === "official" ? "official" : "draft",
      dlcIds: normalizeDlcIds(dlcIds),
      checkinConfigs: normalizeCheckinConfigs(checkinConfigs),
    });
    res.json({ ok: true, item: withActivityStatus(item) });
  } catch (err) {
    console.error("activity create:", err.message);
    res.status(500).json({ ok: false, message: "创建活动失败" });
  }
});

app.put("/api/activities/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    const current = await bizDb.getActivityById(id);
    if (!current) return res.status(404).json({ ok: false, message: "活动不存在" });
    const patch = {
      name:
        body.name !== undefined ? String(body.name).trim().slice(0, 100) : undefined,
      startDate: body.startDate,
      endDate: body.endDate,
      location: body.location,
      content: body.content,
      publishStatus: body.publishStatus,
      dlcIds: body.dlcIds !== undefined ? normalizeDlcIds(body.dlcIds) : undefined,
      checkinConfigs:
        body.checkinConfigs !== undefined
          ? normalizeCheckinConfigs(body.checkinConfigs)
          : undefined,
    };
    const startDate = patch.startDate !== undefined ? patch.startDate : current.startDate;
    const endDate = patch.endDate !== undefined ? patch.endDate : current.endDate;
    patch.status = activityStatusByTime(startDate, endDate);
    const item = await bizDb.updateActivity(id, patch);
    res.json({ ok: true, item: withActivityStatus(item) });
  } catch (err) {
    console.error("activity update:", err.message);
    res.status(500).json({ ok: false, message: "更新活动失败" });
  }
});

app.delete("/api/activities/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ok = await bizDb.deleteActivity(id);
    if (!ok) return res.status(404).json({ ok: false, message: "活动不存在" });
    activityStorage.removeActivityDir(id).catch((err) =>
      console.error("remove activity files:", err.message)
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("activity delete:", err.message);
    res.status(500).json({ ok: false, message: "删除活动失败" });
  }
});

/* ---------- 机器人开放 API ---------- */
registerOpenApi(app, {
  readJson,
  listActivities: () => bizDb.listActivities(),
  listCheckins: (opts) => bizDb.listCheckins(opts),
  activityStatusByTime,
  listMembers: () => db.listMembers(),
});

/* ---------- Peak 接档器客户端 API（成员登录） ---------- */
registerClientApi(app, {
  listServers: () => loadServerItems(),
  listActivities: () => bizDb.listActivities(),
  getActivityById: (id) => bizDb.getActivityById(id),
  listProducts: () => bizDb.listProducts(),
  getProductById: (id) => bizDb.getProductById(id),
  updateProduct: (id, data) => bizDb.updateProduct(id, data),
  decreaseProductStock: (id, by) => bizDb.decreaseProductStock(id, by),
  listRedeems: (opts) => bizDb.listRedeems(opts),
  createRedeem: (data) => bizDb.createRedeem(data),
  activityStatusByTime,
  withActivityStatus,
});

/* ---------- 自动打卡扫描 ---------- */
async function runAutoCheckinScan() {
  return checkinAuto.scanAndCheckin({
    listActivities: () => bizDb.listActivities(),
    listMembers: () => db.listMembers(),
    readCheckins: () => bizDb.listCheckins(),
    createCheckin: (item) => bizDb.createCheckin(item),
    nextId,
    addMemberScore: (memberId, delta) =>
      addMemberScore(memberId, delta, "活动区域自动打卡"),
  });
}

app.post("/api/checkins/scan", requireAuth, async (req, res) => {
  try {
    const result = await checkinAuto.scanAndCheckin({
      listActivities: () => bizDb.listActivities(),
      listMembers: () => db.listMembers(),
      readCheckins: () => bizDb.listCheckins(),
      createCheckin: (item) => bizDb.createCheckin(item),
      nextId,
      addMemberScore: (memberId, delta) =>
        addMemberScore(memberId, delta, "活动区域自动打卡"),
      manual: true,
    });
    if (!result.ok) {
      return res.status(500).json({
        ok: false,
        message: (result.errors && result.errors.join("; ")) || "自动打卡扫描失败",
        ...result,
      });
    }
    res.json({ ok: true, created: result.checked || 0, ...result });
  } catch (err) {
    console.error("auto checkin scan error:", err.message);
    res.status(500).json({ ok: false, message: "自动打卡扫描失败" });
  }
});

/* ---------- 签到记录 ---------- */
app.get("/api/checkins", requireAuth, async (req, res) => {
  try {
    const activityId = req.query.activityId ? Number(req.query.activityId) : null;
    const items = await bizDb.listCheckins({
      activityId: Number.isFinite(activityId) && activityId > 0 ? activityId : undefined,
    });
    const activities = (await bizDb.listActivities()).map(withActivityStatus);
    const members = await db.listMembers();
    res.json({
      ok: true,
      items,
      activities: activities.map((a) => ({
        id: a.id,
        name: a.name,
        startDate: a.startDate,
        status: a.status,
      })),
      members: members.map((m) => ({
        id: m.id,
        tmpId: m.tmpId,
        name: m.name,
        number: m.number,
      })),
    });
  } catch (err) {
    console.error("checkins list error:", err.message);
    res.status(500).json({ ok: false, message: "读取签到记录失败" });
  }
});

app.post("/api/checkins", requireAuth, async (req, res) => {
  try {
    const { activityId, memberId, note, checkedAt } = req.body || {};
    const aid = Number(activityId);
    const mid = Number(memberId);
    if (!Number.isFinite(aid) || !Number.isFinite(mid)) {
      return res.status(400).json({ ok: false, message: "请选择活动与成员" });
    }
    const activity = await bizDb.getActivityById(aid);
    if (!activity) return res.status(404).json({ ok: false, message: "活动不存在" });
    const row = await db.getMemberById(mid);
    if (!row) return res.status(404).json({ ok: false, message: "成员不存在" });
    const member = db.mapMember(row);

    if (await bizDb.hasCheckin(aid, mid, { source: "manual" })) {
      return res.status(400).json({ ok: false, message: "该成员已在此活动手动签到" });
    }

    const { points, config } = resolveActivityCheckinReward(activity);
    let awarded = 0;
    if (points > 0 && !db.hasLeftTeam(row)) {
      await addMemberScore(mid, points, `活动签到：${activity.name}`);
      awarded = points;
    }

    try {
      const when = checkedAt ? String(checkedAt) : new Date().toISOString();
      const item = await bizDb.createCheckin({
        activityId: aid,
        activityName: activity.name,
        configId: Number(config?.id) || 0,
        configName: config?.name || "",
        memberId: mid,
        tmpId: member.tmpId,
        name: member.name,
        number: member.number,
        points,
        serverName: config?.serverName || activity.location || "",
        note: String(note || "").trim(),
        checkedAt: when,
        operator: req.session.user?.name || req.session.user?.username || "",
        source: "manual",
        createdAt: new Date().toISOString(),
      });
      res.json({ ok: true, item });
    } catch (err) {
      if (awarded) {
        try {
          await addMemberScore(mid, -awarded, `签到失败回滚：${activity.name}`, {
            allowLeft: true,
          });
        } catch (revertErr) {
          console.error("checkin create revert score:", revertErr.message);
        }
      }
      throw err;
    }
  } catch (err) {
    console.error("checkin create error:", err.message);
    if (String(err.message || "").includes("Duplicate")) {
      return res.status(400).json({ ok: false, message: "该成员已在此活动签到" });
    }
    res.status(500).json({ ok: false, message: "签到失败" });
  }
});

app.delete("/api/checkins/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await bizDb.getCheckinById(id);
    if (!row) return res.status(404).json({ ok: false, message: "记录不存在" });
    const removed = await bizDb.deleteCheckin(id);
    if (!removed) return res.status(404).json({ ok: false, message: "记录不存在" });
    const points = Number(row.points) || 0;
    if (points) {
      await addMemberScore(row.memberId, -points, `删除签到：${row.activityName || "活动"}`, {
        allowLeft: true,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("checkin delete:", err.message);
    res.status(500).json({ ok: false, message: "删除签到失败" });
  }
});

/* ---------- 活动文件（本地 / 阿里云 OSS） ---------- */
app.get("/api/activities/:id/files", requireAuth, async (req, res) => {
  try {
    const activity = await bizDb.getActivityById(Number(req.params.id));
    if (!activity) return res.status(404).json({ ok: false, message: "活动不存在" });
    const status = activityStatusByTime(activity.startDate, activity.endDate);
    if (status === "done") {
      await activityStorage.removeActivityDir(activity.id);
      return res.json({ ok: true, items: [], status, message: "活动已结束，文件已清理" });
    }
    const items = await activityStorage.listFilesWithDownloadUrl(activity.id);
    res.json({
      ok: true,
      status,
      storage: activityStorage.describe(),
      root: activityStorage.usingOss() ? activityStorage.describe() : activityStorage.getUploadRoot(),
      folder: `activity_${activity.id}`,
      items,
    });
  } catch (err) {
    console.error("list activity files:", err.message);
    res.status(500).json({ ok: false, message: "读取文件列表失败" });
  }
});

app.post(
  "/api/activities/:id/files",
  requireAuth,
  async (req, res, next) => {
    const activity = await bizDb.getActivityById(Number(req.params.id));
    if (!activity) return res.status(404).json({ ok: false, message: "活动不存在" });
    const status = activityStatusByTime(activity.startDate, activity.endDate);
    if (status === "done") {
      await activityStorage.removeActivityDir(activity.id);
      return res.status(400).json({ ok: false, message: "活动已结束，无法上传" });
    }
    next();
  },
  upload.array("files", 20),
  async (req, res) => {
    try {
      const uploaded = await activityStorage.afterLocalUpload(req.params.id, req.files || []);
      const failed = (uploaded || []).filter((u) => u && u.error);
      if ((req.files || []).length && failed.length === uploaded.length) {
        return res.status(500).json({
          ok: false,
          message: "上传 OSS 失败: " + (failed[0].error || "未知错误"),
          uploaded,
        });
      }
      const items = await activityStorage.listFilesWithDownloadUrl(req.params.id);
      res.json({
        ok: true,
        storage: activityStorage.describe(),
        items,
        uploaded,
        warning: failed.length
          ? `部分文件未上云，已保留本地：${failed.map((f) => f.name).join(", ")}`
          : undefined,
      });
    } catch (err) {
      console.error("upload activity files:", err.message);
      res.status(500).json({ ok: false, message: "上传失败: " + err.message });
    }
  }
);

app.get("/api/activities/:id/files/:name", requireAuth, async (req, res) => {
  const name = req.params.name;
  if (activityStorage.usingOss()) {
    const url = ossStorage.signDownloadUrl(req.params.id, name);
    if (url) return res.redirect(url);
  }
  const full = activityStorage.resolveFile(req.params.id, name);
  if (!full) return res.status(404).json({ ok: false, message: "文件不存在" });
  res.download(full, path.basename(full));
});

app.delete("/api/activities/:id/files/:name", requireAuth, async (req, res) => {
  try {
    const ok = await activityStorage.deleteFile(req.params.id, req.params.name);
    if (!ok) return res.status(404).json({ ok: false, message: "文件不存在" });
    const items = await activityStorage.listFilesWithDownloadUrl(req.params.id);
    res.json({ ok: true, items });
  } catch (err) {
    console.error("delete activity file:", err.message);
    res.status(500).json({ ok: false, message: "删除文件失败" });
  }
});

/* ---------- DLC 展示（地图） ---------- */
app.get("/api/dlc", requireAuth, async (req, res) => {
  // type=all 返回地图 API + 本地补充（挂车/货物等）
  const typeRaw = String(req.query.type || "all");
  const type = typeRaw === "all" ? "all" : Number(typeRaw) || 1;
  const errors = [];
  let apiItems = [];

  try {
    const queryType = type === "all" ? 1 : type;
    const { url: source, payload } = await evmApi.fetchJson(
      "/dlc/list",
      { type: queryType },
      10000
    );
    if (!Array.isArray(payload.data)) {
      throw new Error(payload.msg || "DLC 接口返回异常");
    }
    apiItems = payload.data.map((item) => {
      const names = translateDlcName(item);
      return {
        appId: item.appId,
        name: names.nameZh,
        nameZh: names.nameZh,
        nameEn: names.nameEn,
        type: item.type,
        desc: item.desc || "",
        imageUrl: item.headerImageUrl || item.backgroundImageUrl || "",
        originalPrice: item.originalPrice,
        finalPrice: item.finalPrice,
        discount: item.discount,
        source,
      };
    });
  } catch (err) {
    errors.push(`${evmApi.EVM_API_BASE}/dlc/list: ${err.message}`);
  }

  if (!apiItems.length && errors.length) {
    console.warn("DLC API unavailable, using local extras only:", errors.join(" | "));
  }

  let items = type === "all" || type === 1 ? mergeExtraDlcs(apiItems) : apiItems;
  if (type !== "all" && Number.isFinite(type)) {
    items = items.filter((item) => Number(item.type) === Number(type));
  }

  if (!items.length) {
    return res.status(502).json({ ok: false, message: "获取 DLC 列表失败" });
  }

  const forceImages =
    req.query.syncImages === "1" ||
    req.query.syncImages === "true" ||
    req.query.refreshImages === "1";
  try {
    items = await dlcImageCache.localizeItems(items, { force: forceImages, waitMissing: true });
  } catch (err) {
    console.warn("DLC 封面缓存处理失败:", err.message);
  }

  res.json({ ok: true, type, items, count: items.length, imagesSynced: forceImages });
});

/* ---------- 商店管理 ---------- */
app.get("/api/store", requireAuth, async (req, res) => {
  try {
    const items = await bizDb.listProducts();
    res.json({ ok: true, items });
  } catch (err) {
    console.error("store list:", err.message);
    res.status(500).json({ ok: false, message: "读取商品失败" });
  }
});

app.post("/api/store", requireAuth, async (req, res) => {
  try {
    const { name, price, stock, status, desc } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, message: "商品名称必填" });
    const item = await bizDb.createProduct({
      name: String(name).trim(),
      price: Number(price) || 0,
      stock: Number(stock) || 0,
      status: status || "on",
      desc: desc || "",
    });
    res.json({ ok: true, item });
  } catch (err) {
    console.error("store create:", err.message);
    res.status(500).json({ ok: false, message: "新增商品失败" });
  }
});

app.put("/api/store/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    const item = await bizDb.updateProduct(id, {
      name: body.name !== undefined ? String(body.name).trim() : undefined,
      price: body.price !== undefined ? Number(body.price) : undefined,
      stock: body.stock !== undefined ? Number(body.stock) : undefined,
      status: body.status,
      desc: body.desc,
    });
    if (!item) return res.status(404).json({ ok: false, message: "商品不存在" });
    res.json({ ok: true, item });
  } catch (err) {
    console.error("store update:", err.message);
    res.status(500).json({ ok: false, message: "更新商品失败" });
  }
});

app.delete("/api/store/:id", requireAuth, async (req, res) => {
  try {
    const ok = await bizDb.deleteProduct(Number(req.params.id));
    if (!ok) return res.status(404).json({ ok: false, message: "商品不存在" });
    res.json({ ok: true });
  } catch (err) {
    console.error("store delete:", err.message);
    res.status(500).json({ ok: false, message: "删除商品失败" });
  }
});

/* ---------- 兑换记录 ---------- */
app.get("/api/redeems", requireAuth, async (req, res) => {
  try {
    let items = await bizDb.listRedeems();
    const products = (await bizDb.listProducts()).filter((p) => p.status !== "off");
    const members = await db.listMembers();
    const byId = new Map(members.map((m) => [Number(m.id), m]));
    const byTmp = new Map(members.map((m) => [String(m.tmpId), m]));
    // 列表优先展示当前成员库中的 TMP 名称
    items = items.map((r) => {
      const m = byId.get(Number(r.memberId)) || byTmp.get(String(r.tmpId));
      const tmpName = (m && m.name) || r.tmpName || r.name || "";
      return { ...r, name: tmpName, tmpName };
    });
    res.json({
      ok: true,
      items,
      products: products.map((p) => ({ id: p.id, name: p.name, price: p.price, stock: p.stock })),
      members: members.map((m) => ({
        id: m.id,
        tmpId: m.tmpId,
        name: m.name,
        score: m.score,
        number: m.number,
      })),
    });
  } catch (err) {
    console.error("redeems list:", err.message);
    res.status(500).json({ ok: false, message: "读取兑换记录失败" });
  }
});

app.post("/api/redeems", requireAuth, async (req, res) => {
  try {
    const { productId, memberId, note } = req.body || {};
    const pid = Number(productId);
    const mid = Number(memberId);
    if (!Number.isFinite(pid) || !Number.isFinite(mid)) {
      return res.status(400).json({ ok: false, message: "请选择商品与成员" });
    }
    const product = await bizDb.getProductById(pid);
    if (!product) return res.status(404).json({ ok: false, message: "商品不存在" });
    if (product.status === "off") {
      return res.status(400).json({ ok: false, message: "商品已下架" });
    }
    if (Number(product.stock) <= 0) {
      return res.status(400).json({ ok: false, message: "库存不足" });
    }
    const row = await db.getMemberById(mid);
    if (!row) return res.status(404).json({ ok: false, message: "成员不存在" });
    const member = db.mapMember(row);
    const price = Number(product.price) || 0;
    if (Number(member.score) < price) {
      return res.status(400).json({ ok: false, message: "积分不足" });
    }

    const stockOk = await bizDb.decreaseProductStock(pid, 1);
    if (!stockOk) return res.status(400).json({ ok: false, message: "库存不足" });
    await db.updateMember(mid, { score: Number(member.score) - price });

    const item = await bizDb.createRedeem({
      productId: pid,
      productName: product.name,
      price,
      memberId: mid,
      tmpId: member.tmpId,
      name: member.name,
      number: member.number,
      note: String(note || "").trim(),
      operator: req.session.user?.name || req.session.user?.username || "",
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true, item });
  } catch (err) {
    console.error("redeem create:", err.message);
    res.status(500).json({ ok: false, message: "兑换失败" });
  }
});

app.put("/api/redeems/:id/ship", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body?.shipStatus || req.body?.status || "").trim();
    if (status !== "shipped" && status !== "pending") {
      return res.status(400).json({ ok: false, message: "发货状态无效（pending/shipped）" });
    }
    const item = await bizDb.updateRedeemShipStatus(id, status);
    if (!item) return res.status(404).json({ ok: false, message: "记录不存在" });
    res.json({ ok: true, item });
  } catch (err) {
    console.error("redeem ship update:", err.message);
    res.status(500).json({ ok: false, message: "更新发货状态失败" });
  }
});

app.delete("/api/redeems/:id", requireAuth, async (req, res) => {
  try {
    const ok = await bizDb.deleteRedeem(Number(req.params.id));
    if (!ok) return res.status(404).json({ ok: false, message: "记录不存在" });
    res.json({ ok: true });
  } catch (err) {
    console.error("redeem delete:", err.message);
    res.status(500).json({ ok: false, message: "删除兑换记录失败" });
  }
});

/* ---------- 在线用户 ---------- */
app.get("/api/online", requireAuth, (req, res) => {
  const hostQ = String(req.query.host || "").trim().toLowerCase();
  const nameQ = String(req.query.loginName || "").trim().toLowerCase();
  let items;
  try {
    items = readJson("online.json", ONLINE_SEED);
  } catch (err) {
    console.warn("read online.json failed:", err.message);
    items = [];
  }
  if (hostQ) items = items.filter((r) => String(r.host || "").toLowerCase().includes(hostQ));
  if (nameQ) {
    items = items.filter((r) => String(r.loginName || "").toLowerCase().includes(nameQ));
  }
  // 默认只看在线；传 all=1 看全部
  if (req.query.all !== "1") {
    items = items.filter((r) => r.status !== "offline");
  }
  res.json({ ok: true, items, total: items.length });
});

app.delete("/api/online/:id", requireAuth, (req, res) => {
  const items = readJson("online.json", ONLINE_SEED);
  const id = Number(req.params.id);
  const idx = items.findIndex((r) => r.id === id);
  if (idx < 0) return res.status(404).json({ ok: false, message: "记录不存在" });
  items.splice(idx, 1);
  writeJson("online.json", items);
  res.json({ ok: true });
});

app.use(
  dlcImageCache.PUBLIC_PREFIX,
  express.static(dlcImageCache.getCacheDir(), {
    maxAge: "7d",
    etag: true,
    fallthrough: false,
  })
);

/** PEAK_API_ONLY=1：只提供 /api/* 给 EXE，关闭浏览器 WEB 页面 */
const API_ONLY =
  process.env.PEAK_API_ONLY === "1" ||
  process.env.PEAK_API_ONLY === "true" ||
  process.env.PEAK_API_ONLY === "yes";

function rejectBrowserUi(res) {
  return noStore(res).status(403).json({
    ok: false,
    message: "浏览器 WEB 后台已停用，请使用 Peak 车队平台桌面端",
    client: "peak-center",
  });
}

// 前端静态页：项目根目录 dist/（部署无需上传 admin-web）
const adminWebDist = path.join(__dirname, "dist");
const adminWebIndex = path.join(adminWebDist, "index.html");

function sendSpa(res) {
  if (!fs.existsSync(adminWebIndex)) {
    return noStore(res).status(503).send(
      "Vue 后台尚未构建：请确保项目根目录存在 dist/index.html"
    );
  }
  return pageHeaders(res).sendFile(adminWebIndex);
}

if (API_ONLY) {
  app.get(["/login.html", "/app.html", "/login", "/"], (_req, res) => rejectBrowserUi(res));
  console.info("PEAK_API_ONLY=1：浏览器 WEB 页面已关闭，仅保留 API 供 EXE 使用");
} else {
  // 旧入口重定向到 Vue SPA
  app.get("/login.html", (_req, res) => redirectNoStore(res, "/login"));
  app.get("/app.html", (_req, res) => redirectNoStore(res, "/"));

  // 带 hash 的脚本和样式可以长期缓存。index.html 仍由 pageHeaders 禁止缓存。
  app.use(
    "/assets",
    express.static(path.join(adminWebDist, "assets"), {
      immutable: true,
      maxAge: "365d",
      fallthrough: false,
    })
  );
  app.use(express.static(adminWebDist, { index: false, maxAge: 0 }));
}

app.use(express.static(path.join(__dirname, "public")));

if (!API_ONLY) {
  // SPA History fallback：非 API / 非已有静态文件
  app.get("/login", (_req, res) => sendSpa(res));
  app.get("/", (_req, res) => sendSpa(res));
  // 不用 app.get("*")，避免部分 Express/path-to-regexp 启动即崩
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const p = String(req.path || "");
    if (p.startsWith("/api/") || p.startsWith("/media/")) return next();
    if (path.extname(p)) return next();
    return sendSpa(res);
  });
}

async function startServer(options = {}) {
  const host = options.host || process.env.LISTEN_HOST || "0.0.0.0";
  const port = Number(options.port || process.env.PORT || PORT || 3000);

  if (typeof db.ensurePool === "function") {
    db.ensurePool();
  }

  let dbOk = false;
  let dbError = "";
  try {
    await db.initDb();
    await bizDb.initBizDb();
    dbOk = true;
    console.log(
      `MySQL 已连接: ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME}`
    );
  } catch (err) {
    dbError = err.message || String(err);
    console.error("MySQL 初始化失败:", dbError);
    console.error("请检查宝塔数据库账号、远程访问权限与数据库配置");
  }

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const url = `http://127.0.0.1:${port}`;
      console.log(`Peak 后端已启动: ${url}`);
      if (API_ONLY) {
        console.log("模式: API_ONLY（专供 EXE，浏览器 WEB 已关闭）");
      } else {
        console.log("管理员网页登录: /login （Vue Admin）");
      }
      console.log("EXE 成员 API: /api/client/*");
      console.log("EXE 管理 API: /api/* + X-Admin-Token");
      console.log("活动文件存储:", activityStorage.describe());
      console.log("DLC 封面缓存:", dlcImageCache.getCacheDir());
      cleanupEndedActivityFiles();
      setInterval(cleanupEndedActivityFiles, 5 * 60 * 1000);
      const scanOnce = () => {
        runAutoCheckinScan()
          .then((r) => {
            if (r && r.checked > 0) {
              console.log(`自动打卡完成: ${r.checked} 人`, r.matched || []);
            }
          })
          .catch((err) => console.error("自动打卡扫描失败:", err.message));
      };
      setTimeout(scanOnce, 8 * 1000);
      setInterval(scanOnce, 30 * 1000);
      refreshServersInBackground();
      resolve({ app, server, host, port, url, dbOk, dbError });
    });
    server.on("error", reject);
  });
}

module.exports = { app, startServer };

if (require.main === module) {
  startServer().catch((err) => {
    console.error("服务启动失败:", err.message || err);
    process.exit(1);
  });
}
