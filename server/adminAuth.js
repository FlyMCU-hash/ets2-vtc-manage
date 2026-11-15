/**
 * 后台管理员鉴权（供浏览器 Session 之外的桌面端使用）
 * Header: X-Admin-Token
 */
const crypto = require("crypto");

const tokens = new Map();
const TTL_MS = 8 * 60 * 60 * 1000;

function issueAdminToken(user) {
  const token = crypto.randomBytes(32).toString("hex");
  tokens.set(token, {
    user,
    expiresAt: Date.now() + TTL_MS,
  });
  return token;
}

function revokeAdminToken(token) {
  if (token) tokens.delete(token);
}

function getAdminTokenFromReq(req) {
  const header = String(req.get("x-admin-token") || "").trim();
  if (header) return header;
  const auth = String(req.get("authorization") || "");
  const m = auth.match(/^AdminBearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

function resolveAdminSession(token) {
  const key = String(token || "").trim();
  if (!key) return null;
  const sess = tokens.get(key);
  if (!sess || sess.expiresAt < Date.now()) {
    tokens.delete(key);
    return null;
  }
  return sess;
}

/** 挂到 req.session.user，兼容现有 requireAuth 路由 */
function attachAdminTokenUser(req) {
  const token = getAdminTokenFromReq(req);
  const sess = resolveAdminSession(token);
  if (!sess) return null;
  if (!req.session) req.session = {};
  req.session.user = sess.user;
  req.session.lastActiveAt = Date.now();
  req.adminToken = token;
  return sess.user;
}

function buildAdminUserFromMember(member) {
  return {
    id: member.id,
    username: member.tmpId,
    name: member.name,
    role: member.isSuper ? "super" : "admin",
    tmpId: member.tmpId,
    number: member.number,
    isSuper: Boolean(member.isSuper),
    permissions: member.permissions || {},
  };
}

module.exports = {
  issueAdminToken,
  revokeAdminToken,
  getAdminTokenFromReq,
  attachAdminTokenUser,
  buildAdminUserFromMember,
};
