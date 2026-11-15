/**
 * 统一 EVM 数据源：https://api.pzvtcm.online
 */
const { httpFetch } = require("./polyfill");

const EVM_API_BASE = String(
  process.env.EVM_API_BASE || "https://api.pzvtcm.online"
)
  .trim()
  .replace(/\/+$/, "");

function url(pathname, query) {
  const path = String(pathname || "").startsWith("/")
    ? String(pathname)
    : `/${pathname || ""}`;
  const u = new URL(`${EVM_API_BASE}${path}`);
  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

function makeSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

async function fetchJson(pathname, query, timeoutMs = 10000) {
  const target = url(pathname, query);
  console.info("EVM API 请求:", target);
  const upstream = await httpFetch(target, {
    signal: makeSignal(timeoutMs),
    headers: {
      Accept: "application/json",
      "User-Agent": "PeakFleet/1.0",
    },
  });
  const text = await upstream.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`EVM 返回非 JSON (${upstream.status})`);
  }
  if (!upstream.ok) {
    throw new Error(payload?.msg || `EVM HTTP ${upstream.status}`);
  }
  if (payload && payload.code != null && Number(payload.code) !== 200) {
    throw new Error(payload.msg || `EVM 错误(${payload.code})`);
  }
  return { url: target, payload };
}

module.exports = {
  EVM_API_BASE,
  url,
  fetchJson,
  httpFetch,
  makeSignal,
};
