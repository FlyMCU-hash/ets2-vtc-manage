/**
 * Peak 接档器客户端 API（成员 TMP ID + 密码登录）
 * Header: X-Client-Token 或 Authorization: Bearer <token>
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const activityFiles = require("./activityFiles");
const activityStorage = require("./activityStorage");
const ossStorage = require("./ossStorage");
const db = require("./db");
const adminAuth = require("./adminAuth");
let bizDb = null;
try {
  bizDb = require("./bizDb");
} catch {
  bizDb = null;
}

const tokens = new Map();

function issueToken(user) {
  const token = crypto.randomBytes(32).toString("hex");
  tokens.set(token, {
    user,
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
  });
  return token;
}

function revokeToken(token) {
  if (token) tokens.delete(token);
}

function getTokenFromReq(req) {
  const header = String(req.get("x-client-token") || "").trim();
  if (header) return header;
  const auth = String(req.get("authorization") || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

function revokeTokensForMember(memberId) {
  const id = Number(memberId);
  if (!Number.isFinite(id) || id <= 0) return 0;
  let n = 0;
  for (const [token, session] of tokens.entries()) {
    if (Number(session?.user?.id) === id) {
      tokens.delete(token);
      n += 1;
    }
  }
  return n;
}

async function requireClientAuth(req, res, next) {
  const token = getTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ ok: false, message: "未登录" });
  }
  const session = tokens.get(token);
  if (!session || session.expiresAt < Date.now()) {
    tokens.delete(token);
    return res.status(401).json({ ok: false, message: "登录已过期，请重新登录" });
  }
  try {
    const row = await db.getMemberById(session.user.id);
    if (!row || db.hasLeftTeam(row)) {
      tokens.delete(token);
      return res.status(403).json({ ok: false, message: "该成员已退队，无法登录接档器" });
    }
  } catch (err) {
    console.error("client auth recheck error:", err.message);
    return res.status(500).json({ ok: false, message: "登录校验失败" });
  }
  req.clientUser = session.user;
  req.clientToken = token;
  return next();
}

function formatDateTime(value) {
  let text = String(value || "")
    .trim()
    .replace("T", " ")
    .replace("Z", "");
  if (!text) return "";
  if (text.length >= 16) return text.slice(0, 16);
  return text;
}

/** 角色/昵称为「超级管理员」时提升为管理端（兼容未勾选 is_admin 的账号） */
function elevateClientAdmin(member) {
  const role = String(member?.role || "").trim();
  const name = String(member?.name || "").trim();
  const superRole =
    Boolean(member?.isSuper) || role === "超级管理员" || name === "超级管理员" || role === "super";
  const isAdmin = Boolean(member?.isAdmin || superRole);
  return {
    ...member,
    isAdmin,
    isSuper: Boolean(member?.isSuper || superRole),
    permissions:
      member?.isSuper || superRole
        ? db.defaultPermissions(true)
        : member?.permissions || db.defaultPermissions(isAdmin),
  };
}

function statusLabel(status) {
  if (status === "ongoing") return "进行中";
  if (status === "done") return "已结束";
  return "未开始";
}

function registerClientApi(app, deps = {}) {
  const activityStatusByTime = deps.activityStatusByTime;
  const withActivityStatus =
    deps.withActivityStatus ||
    ((item) => ({
      ...item,
      status: activityStatusByTime
        ? activityStatusByTime(item.startDate, item.endDate)
        : item.status,
    }));

  // 优先用注入的 deps；否则直接走 bizDb（便于只更新 clientApi.js 也能兑换）
  const listActivities =
    deps.listActivities || (() => bizDb.listActivities());
  const getActivityById =
    deps.getActivityById || ((id) => bizDb.getActivityById(id));
  const listProducts = deps.listProducts || (() => bizDb.listProducts());
  const getProductById =
    deps.getProductById || ((id) => bizDb.getProductById(id));
  const decreaseProductStock =
    deps.decreaseProductStock || ((id, by) => bizDb.decreaseProductStock(id, by));
  const listRedeems = deps.listRedeems || ((opts) => bizDb.listRedeems(opts));
  const createRedeem = deps.createRedeem || ((data) => bizDb.createRedeem(data));

  if (!bizDb && !deps.listProducts) {
    console.error(
      "clientApi: 未找到 bizDb，且未注入 listProducts。商店/兑换接口将不可用，请上传 bizDb.js 并重启。"
    );
  }

  function ensureBiz(res) {
    if (!bizDb && typeof deps.listProducts !== "function") {
      res.status(503).json({
        ok: false,
        message: "商店服务未就绪：请上传 bizDb.js / clientApi.js 后重启网站",
      });
      return false;
    }
    return true;
  }

  /** POST /api/client/login */
  app.post("/api/client/login", async (req, res) => {
    const tmpId = String(req.body?.tmpId || req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!tmpId || !password) {
      return res.status(400).json({ ok: false, message: "请输入 TMP ID 和密码" });
    }
    try {
      const result = await db.authMember(tmpId, password);
      if (result && result.denied === "left") {
        return res.status(403).json({ ok: false, message: "该成员已退队，无法登录接档器" });
      }
      if (result && result.denied === "no_password") {
        return res.status(403).json({ ok: false, message: "未设置密码，请联系管理员" });
      }
      if (!result) {
        return res.status(401).json({ ok: false, message: "TMP ID 或密码错误" });
      }
      const elevated = elevateClientAdmin(result);
      const user = {
        id: elevated.id,
        tmpId: elevated.tmpId,
        name: elevated.name,
        number: elevated.number,
        role: elevated.role || "",
        score: elevated.score || 0,
        isAdmin: Boolean(elevated.isAdmin),
        isSuper: Boolean(elevated.isSuper),
        permissions: elevated.permissions,
        qq: elevated.qq || "",
        joinDate: elevated.joinDate || "",
      };
      const token = issueToken(user);

      // 管理员同时下发后台 Token，供桌面端调用与网页相同的管理接口
      let adminToken = null;
      let adminUser = null;
      if (elevated.isAdmin || elevated.isSuper) {
        adminUser = adminAuth.buildAdminUserFromMember(elevated);
        adminToken = adminAuth.issueAdminToken(adminUser);
      }

      res.json({ ok: true, token, user, adminToken, adminUser });
    } catch (err) {
      console.error("client login error:", err.message);
      res.status(500).json({ ok: false, message: "登录服务异常，请检查数据库连接" });
    }
  });

  app.post("/api/client/logout", requireClientAuth, (req, res) => {
    const adminToken = adminAuth.getAdminTokenFromReq(req);
    if (adminToken) adminAuth.revokeAdminToken(adminToken);
    revokeToken(req.clientToken);
    res.json({ ok: true });
  });

  app.get("/api/client/me", requireClientAuth, async (req, res) => {
    try {
      const row = await db.getMemberById(req.clientUser.id);
      if (!row || db.hasLeftTeam(row)) {
        revokeToken(req.clientToken);
        return res.status(403).json({ ok: false, message: "该成员已退队，无法登录接档器" });
      }
      const member = elevateClientAdmin(db.mapMember(row));
      const user = {
        id: member.id,
        tmpId: member.tmpId,
        name: member.name,
        number: member.number,
        role: member.role || "",
        score: member.score || 0,
        isAdmin: Boolean(member.isAdmin),
        isSuper: Boolean(member.isSuper),
        permissions: member.permissions,
        qq: member.qq || "",
        joinDate: member.joinDate || "",
      };
      // 刷新 token 内缓存
      const session = tokens.get(req.clientToken);
      if (session) session.user = user;

      let adminToken = null;
      let adminUser = null;
      if (member.isAdmin || member.isSuper) {
        adminUser = adminAuth.buildAdminUserFromMember(member);
        adminToken = adminAuth.issueAdminToken(adminUser);
      }
      res.json({ ok: true, user, adminToken, adminUser });
    } catch (err) {
      console.error("client me error:", err.message);
      res.status(500).json({ ok: false, message: "读取成员信息失败" });
    }
  });

  /** PUT /api/client/password — 成员修改密码（写入 tmp_members） */
  app.put("/api/client/password", requireClientAuth, async (req, res) => {
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
      const result = await db.changePassword(req.clientUser.id, oldPassword, newPassword);
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
      console.error("client change password:", err.message);
      res.status(500).json({ ok: false, message: "修改密码失败" });
    }
  });

  function localToday() {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    } catch {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
  }

  /** 单日活动：结束为次日 00:00 时仍算开始日当天 */
  function isSingleDayActivity(startDate, endDate) {
    const startDay = String(startDate || "").slice(0, 10);
    if (!startDay) return false;
    let endDay = String(endDate || startDate || "").slice(0, 10);
    const endText = String(endDate || "");
    if (/[ T]00:00/.test(endText) && endDay > startDay) {
      const d = new Date(`${endDay}T00:00:00+08:00`);
      d.setDate(d.getDate() - 1);
      const pad = (n) => String(n).padStart(2, "0");
      endDay = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    return startDay === endDay;
  }

  function activityCoversDay(startDate, endDate, day) {
    const startDay = String(startDate || "").slice(0, 10);
    if (!startDay || !day) return false;
    let endDay = String(endDate || startDate || "").slice(0, 10);
    const endText = String(endDate || "");
    if (/[ T]00:00/.test(endText) && endDay > startDay) {
      const d = new Date(`${endDay}T00:00:00+08:00`);
      d.setDate(d.getDate() - 1);
      const pad = (n) => String(n).padStart(2, "0");
      endDay = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    return day >= startDay && day <= endDay;
  }

  app.get("/api/client/servers", requireClientAuth, async (req, res) => {
    try {
      const result = await deps.listServers();
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error("client servers:", err.message);
      res.status(502).json({ ok: false, message: "获取服务器列表失败" });
    }
  });

  /**
   * GET /api/client/activities
   * ?status=all|ongoing|upcoming|done
   * ?today=1 仅今日覆盖的活动（接档器默认）
   * ?singleDay=1 仅单日活动（排除跨多日）
   */
  app.get("/api/client/activities", requireClientAuth, async (req, res) => {
    try {
      const statusFilter = String(req.query.status || "all").toLowerCase();
      // 接档器：today=1 仅今日；默认同时限制单日活动（排除跨多日）
      const todayOnly = req.query.today === "1" || req.query.today === "true";
      const singleDayOnly =
        req.query.singleDay === "1" ||
        req.query.singleDay === "true" ||
        req.query.singleDay === undefined;
      const today = localToday();

      const items = ((await listActivities()) || [])
        .filter((a) => {
          const ps = String(a.publishStatus || "official").toLowerCase();
          return ps !== "draft";
        })
        .filter((a) => {
          if (singleDayOnly && !isSingleDayActivity(a.startDate, a.endDate)) return false;
          if (todayOnly && !activityCoversDay(a.startDate, a.endDate, today)) return false;
          return true;
        })
        .map((a) => {
          const full = withActivityStatus(a);
          const status = full.status;
          return {
            id: full.id,
            name: full.name,
            startDate: formatDateTime(full.startDate),
            endDate: formatDateTime(full.endDate),
            location: full.location || "",
            status,
            statusText: statusLabel(status),
            content: full.content || "",
            publishStatus: full.publishStatus || "official",
            dlcIds: Array.isArray(full.dlcIds)
              ? full.dlcIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
              : [],
            checkinConfigs: Array.isArray(full.checkinConfigs)
              ? full.checkinConfigs.map((c) => ({
                  id: c.id,
                  name: c.name || "",
                  points: Number(c.points) || 0,
                  serverName: c.serverName || "",
                  type: c.type || "fixed",
                }))
              : [],
          };
        })
        .filter((a) => {
          if (statusFilter === "all") return true;
          return a.status === statusFilter;
        })
        // 近期活动：按开始时间升序（最近要开始的在前）
        .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));

      res.json({ ok: true, items, total: items.length, today });
    } catch (err) {
      console.error("client activities error:", err.message);
      res.status(500).json({ ok: false, message: "读取活动失败" });
    }
  });

  async function clientDlcs(kind) {
    if (bizDb && typeof bizDb.listDlcs === "function") {
      const items = await bizDb.listDlcs(kind);
      if (items.length) return items;
    }
    const extra = require("./dlcExtra");
    const list = typeof extra.listWebDlcsForClient === "function" ? extra.listWebDlcsForClient() : [];
    return kind ? list.filter((item) => Number(item.type) === Number(kind)) : list;
  }

  /**
   * GET /api/client/dlcs
   * 部署禁用目录：读 center_dlcs。勾选保留的不禁用，表里有 scs 的才禁用。
   */
  app.get("/api/client/dlcs", requireClientAuth, async (req, res) => {
    try {
      const items = await clientDlcs();
      res.json({ ok: true, items, total: items.length });
    } catch (err) {
      console.error("client dlcs error:", err.message);
      res.status(500).json({ ok: false, message: "读取 DLC 目录失败" });
    }
  });

  /**
   * GET /api/client/map-dlcs
   * 接档器用：网站 DLC 目录全部条目（地图+货物+挂车，含 scs 文件名，部署时禁用）
   */
  app.get("/api/client/map-dlcs", requireClientAuth, async (req, res) => {
    try {
      const items = await clientDlcs();
      res.json({ ok: true, items, total: items.length });
    } catch (err) {
      console.error("client map-dlcs error:", err.message);
      res.status(500).json({ ok: false, message: "读取 DLC 目录失败" });
    }
  });

  /** GET /api/client/activities/:id/files */
  app.get("/api/client/activities/:id/files", requireClientAuth, async (req, res) => {
    try {
      const activity = await getActivityById(Number(req.params.id));
      if (!activity) return res.status(404).json({ ok: false, message: "活动不存在" });
      const status = activityStatusByTime(activity.startDate, activity.endDate);
      if (status === "done") {
        return res.json({
          ok: true,
          items: [],
          status,
          message: "活动已结束，存档已清理",
        });
      }
      const items = await activityStorage.listFilesWithDownloadUrl(activity.id);
      res.json({
        ok: true,
        status,
        activityId: activity.id,
        activityName: activity.name,
        storage: activityStorage.describe(),
        items,
      });
    } catch (err) {
      console.error("client list files error:", err.message);
      res.status(500).json({ ok: false, message: "读取存档列表失败" });
    }
  });

  /** GET /api/client/activities/:id/files/:name — 下载存档（OSS 时 302 到签名 URL） */
  app.get("/api/client/activities/:id/files/:name", requireClientAuth, async (req, res) => {
    const activity = await getActivityById(Number(req.params.id));
    if (!activity) return res.status(404).json({ ok: false, message: "活动不存在" });
    const status = activityStatusByTime(activity.startDate, activity.endDate);
    if (status === "done") {
      return res.status(400).json({ ok: false, message: "活动已结束，存档已清理" });
    }
    const name = req.params.name;
    if (activityStorage.usingOss()) {
      const url = ossStorage.signDownloadUrl(req.params.id, name);
      if (url) return res.redirect(url);
      return res.status(404).json({ ok: false, message: "文件不存在" });
    }
    const full = activityFiles.resolveFile(req.params.id, name);
    if (!full) return res.status(404).json({ ok: false, message: "文件不存在" });
    res.download(full, require("path").basename(full));
  });

  /** GET /api/client/store */
  app.get("/api/client/store", requireClientAuth, async (req, res) => {
    try {
      // 积分以数据库为准，刷新 token 缓存
      const row = await db.getMemberById(req.clientUser.id);
      const myScore = row ? Number(row.score) || 0 : Number(req.clientUser.score) || 0;
      if (row) {
        const session = tokens.get(req.clientToken);
        if (session) {
          session.user = { ...session.user, score: myScore, name: row.name };
          req.clientUser = session.user;
        }
      }

      const items = ((await listProducts()) || [])
        .filter((p) => String(p.status || "on") === "on")
        .map((p) => ({
          id: p.id,
          name: p.name,
          price: Number(p.price) || 0,
          stock: Number(p.stock) || 0,
          status: p.status || "on",
          desc: p.desc || "",
          imageUrl: "/img/logo.jpg",
        }));
      res.json({
        ok: true,
        items,
        total: items.length,
        myScore,
      });
    } catch (err) {
      console.error("client store error:", err.message);
      res.status(500).json({ ok: false, message: "读取商店失败" });
    }
  });

  /**
   * POST /api/client/store/redeem
   * 兼容别名：POST /api/client/redeem
   * body: { productId, note? }
   */
  async function handleRedeem(req, res) {
    try {
      if (!ensureBiz(res)) return;
      const pid = Number(req.body?.productId);
      const contactQq = String(req.body?.qq || "").trim();
      const contactTmpId = String(req.body?.tmpId || "").trim();
      if (!Number.isFinite(pid) || pid <= 0) {
        return res.status(400).json({ ok: false, message: "请选择商品" });
      }
      if (!contactQq) {
        return res.status(400).json({ ok: false, message: "请填写 QQ 号" });
      }
      if (!contactTmpId) {
        return res.status(400).json({ ok: false, message: "请填写 TMP ID" });
      }

      const product = await getProductById(pid);
      if (!product) return res.status(404).json({ ok: false, message: "商品不存在" });
      if (String(product.status || "on") === "off") {
        return res.status(400).json({ ok: false, message: "商品已下架" });
      }
      if (Number(product.stock) <= 0) {
        return res.status(400).json({ ok: false, message: "库存不足" });
      }

      const mid = Number(req.clientUser.id);
      const row = await db.getMemberById(mid);
      if (!row || db.hasLeftTeam(row)) {
        return res.status(403).json({ ok: false, message: "该成员已退队，无法登录接档器" });
      }
      const member = db.mapMember(row);
      const price = Number(product.price) || 0;
      if (Number(member.score) < price) {
        return res.status(400).json({ ok: false, message: "积分不足" });
      }

      const stockOk = await decreaseProductStock(pid, 1);
      if (!stockOk) return res.status(400).json({ ok: false, message: "库存不足" });

      const nextScore = Number(member.score) - price;
      await db.updateMember(mid, { score: nextScore });

      const noteBase = String(req.body?.note || "接档器兑换").trim();
      const note = `${noteBase} | QQ:${contactQq} | TMP:${contactTmpId}`;
      const item = await createRedeem({
        productId: pid,
        productName: product.name,
        price,
        memberId: mid,
        tmpId: member.tmpId,
        name: member.name,
        number: member.number,
        note,
        operator: `client:${member.tmpId}`,
        source: "peak-client",
        createdAt: new Date().toISOString(),
      });

      const session = tokens.get(req.clientToken);
      if (session) {
        session.user = { ...session.user, score: nextScore };
        req.clientUser = session.user;
      }

      const fresh = await getProductById(pid);
      res.json({
        ok: true,
        item,
        myScore: nextScore,
        product: {
          id: product.id,
          name: product.name,
          price,
          stock: fresh ? fresh.stock : Number(product.stock) - 1,
        },
      });
    } catch (err) {
      console.error("client redeem error:", err.message);
      res.status(500).json({ ok: false, message: err.message || "兑换失败" });
    }
  }

  app.post("/api/client/store/redeem", requireClientAuth, handleRedeem);
  app.post("/api/client/redeem", requireClientAuth, handleRedeem);

  /** GET /api/client/redeems — 我的兑换记录 */
  app.get("/api/client/redeems", requireClientAuth, async (req, res) => {
    try {
      const mid = Number(req.clientUser.id);
      const items = ((await listRedeems({ memberId: mid })) || [])
        .slice(0, 50)
        .map((r) => ({
          id: r.id,
          productId: r.productId,
          productName: r.productName,
          price: Number(r.price) || 0,
          note: r.note || "",
          createdAt: r.createdAt || "",
        }));
      res.json({ ok: true, items, total: items.length });
    } catch (err) {
      console.error("client redeems error:", err.message);
      res.status(500).json({ ok: false, message: "读取兑换记录失败" });
    }
  });

  /** GET /api/client/members — 在队成员（接档器只读） */
  app.get("/api/client/members", requireClientAuth, async (req, res) => {
    try {
      const members = await db.listMembers();
      const items = (members || [])
        .filter((m) => m && m.tmpId && !m.leaveDate && !m.left)
        .map((m) => ({
          id: m.id,
          number: m.number,
          tmpId: String(m.tmpId),
          name: m.name || "",
          role: m.role || "",
          score: Number(m.score) || 0,
          joinDate: m.joinDate || "",
        }))
        .sort((a, b) => Number(a.number) - Number(b.number) || String(a.name).localeCompare(String(b.name), "zh"));
      res.json({ ok: true, items, total: items.length });
    } catch (err) {
      console.error("client members error:", err.message);
      res.status(500).json({ ok: false, message: "读取成员失败" });
    }
  });

  /**
   * GET /api/client/checkins
   * ?activityId= 按活动筛选
   * ?mine=1 仅本人
   * ?limit=50
   */
  app.get("/api/client/checkins", requireClientAuth, async (req, res) => {
    try {
      if (!bizDb || typeof bizDb.listCheckins !== "function") {
        return res.status(503).json({ ok: false, message: "打卡服务未就绪" });
      }
      const activityId = req.query.activityId ? Number(req.query.activityId) : null;
      const mineOnly = req.query.mine === "1" || req.query.mine === "true";
      const limit = Math.min(Math.max(Number(req.query.limit) || 80, 1), 200);
      let items =
        (await bizDb.listCheckins({
          activityId: Number.isFinite(activityId) && activityId > 0 ? activityId : undefined,
        })) || [];
      if (mineOnly) {
        const mid = Number(req.clientUser.id);
        const tmpId = String(req.clientUser.tmpId || "");
        items = items.filter(
          (c) => Number(c.memberId) === mid || String(c.tmpId || "") === tmpId,
        );
      }
      items = items.slice(0, limit).map((c) => ({
        id: c.id,
        activityId: c.activityId,
        activityName: c.activityName || "",
        configName: c.configName || "",
        tmpId: c.tmpId || "",
        name: c.name || "",
        number: Number(c.number) || 0,
        points: c.points == null ? null : Number(c.points),
        serverName: c.serverName || "",
        note: c.note || "",
        checkedAt: c.checkedAt || "",
        source: c.source || "",
      }));
      res.json({ ok: true, items, total: items.length });
    } catch (err) {
      console.error("client checkins error:", err.message);
      res.status(500).json({ ok: false, message: "读取打卡记录失败" });
    }
  });

  const updatesDir = path.join(__dirname, "updates");

  function isUpdateFile(name) {
    return name.endsWith(".nsis.zip") || name.endsWith("-setup.exe");
  }

  function safeUpdateName(name) {
    const text = String(name || "").trim();
    if (!text || text.includes("..") || text.includes("/") || text.includes("\\") || !isUpdateFile(text)) {
      return "";
    }
    return text;
  }

  function versionNewer(latest, current) {
    const parse = (value) =>
      String(value || "")
        .replace(/^v/i, "")
        .split(".")
        .map((part) => Number.parseInt(part, 10) || 0);
    const left = parse(latest);
    const right = parse(current);
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const diff = (left[index] || 0) - (right[index] || 0);
      if (diff) return diff > 0;
    }
    return false;
  }

  function updateOrigin(req) {
    const configured = String(process.env.UPDATE_PUBLIC_ORIGIN || "").replace(/\/$/, "");
    if (configured) return configured;
    const proto = String(req.get("x-forwarded-proto") || req.protocol || "http").split(",")[0].trim();
    const host = String(req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
    const hostname = host.replace(/:\d+$/, "");
    if (!host || hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1") {
      return "http://df.peakvtc.cn";
    }
    return `${proto}://${host}`;
  }

  /** 桌面端检查更新，无需登录。没有新版本时返回 204。 */
  app.get("/api/client/update/download/:name", (req, res) => {
    const name = safeUpdateName(decodeURIComponent(req.params.name || ""));
    const file = name ? path.join(updatesDir, name) : "";
    if (!file || !fs.existsSync(file)) {
      return res.status(404).json({ ok: false, message: "更新包不存在" });
    }
    res.download(file, name);
  });

  app.get("/api/client/update/:target/:arch/:version", (req, res) => {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(updatesDir, "latest.json"), "utf8"));
    } catch {
      return res.status(204).end();
    }
    const file = safeUpdateName(manifest.file);
    const signature = String(manifest.signature || "").trim();
    if (!file || !signature || !versionNewer(manifest.version, req.params.version)) {
      return res.status(204).end();
    }
    const origin = updateOrigin(req);
    res.json({
      version: String(manifest.version),
      notes: String(manifest.notes || ""),
      pub_date: manifest.pub_date || new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature,
          url: `${origin}/api/client/update/download/${encodeURIComponent(file)}`,
        },
      },
    });
  });

  /** 健康检查（无需登录）：连通 WEB 服务并探测 MySQL */
  app.get("/api/client/ping", async (req, res) => {
    let dbOk = false;
    let dbName = "";
    let dbHost = "";
    let dbError = "";
    try {
      const info = await db.pingDb();
      dbOk = Boolean(info.ok);
      dbName = info.dbName || "";
      dbHost = info.host || "";
    } catch (err) {
      dbError = err.message || String(err);
    }
    res.json({
      ok: true,
      service: "peak-client",
      time: new Date().toISOString(),
      database: {
        ok: dbOk,
        name: dbName,
        host: dbHost,
        error: dbError || undefined,
      },
    });
  });
}

module.exports = { registerClientApi, revokeTokensForMember };
