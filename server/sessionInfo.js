/**
 * 从请求中提取登录会话展示信息（IP / UA / 设备）
 */
function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim();
  const real = req.headers["x-real-ip"];
  if (real) return String(real).trim();
  return req.socket?.remoteAddress || req.ip || "";
}

function parseUa(uaRaw) {
  const ua = String(uaRaw || "");
  let os = "未知";
  if (/Windows NT 10/i.test(ua)) os = "Windows 10 or Win11";
  else if (/Windows NT 6\.3/i.test(ua)) os = "Windows 8.1";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/iPhone/i.test(ua)) os = "iPhone";
  else if (/iPad/i.test(ua)) os = "iPad";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Mac OS X/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "未知";
  if (/Edg\//i.test(ua)) browser = "MSEdge";
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = "Safari";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/MSIE|Trident/i.test(ua)) browser = "IE";

  let deviceType = "PC";
  if (/Mobile|Android|iPhone|iPod/i.test(ua)) deviceType = "Mobile";
  else if (/iPad|Tablet/i.test(ua)) deviceType = "Tablet";

  return { os, browser, deviceType };
}

/** 固定按北京时间格式化，避免服务器 TZ=UTC 显示差 8 小时 */
function formatShanghaiDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  // 个别环境 hour 可能是 "24"
  const hour = String(get("hour")).replace(/^24$/, "00");
  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}:${get("second")}`;
}

function buildSessionRecord(req, user) {
  const ua = req.headers["user-agent"] || "";
  const parsed = parseUa(ua);
  const ip = clientIp(req).replace(/^::ffff:/, "");
  return {
    sessionId: req.sessionID || "",
    loginName: user?.username || user?.tmpId || "",
    userId: user?.id || null,
    name: user?.name || "",
    client: String(ua).slice(0, 80) || "—",
    deviceType: parsed.deviceType,
    department: "Peak 社区",
    host: ip || "—",
    location: "未知",
    os: parsed.os,
    browser: parsed.browser,
    loginAt: formatShanghaiDateTime(),
  };
}

module.exports = {
  clientIp,
  parseUa,
  formatShanghaiDateTime,
  buildSessionRecord,
};
