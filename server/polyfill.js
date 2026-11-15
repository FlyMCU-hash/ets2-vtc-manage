/**
 * Node 16 兼容 HTTP：
 * 1) 优先 undici.fetch
 * 2) 再 global fetch
 * 3) 最后用内置 https/http（无需 npm 包）
 */
const http = require("http");
const https = require("https");
const { URL } = require("url");

let undiciFetch = null;
try {
  const undici = require("undici");
  undiciFetch = undici.fetch;
  if (typeof globalThis.fetch !== "function") {
    globalThis.fetch = undici.fetch;
  }
} catch {
  /* 未安装 undici 时走内置回退 */
}

if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout !== "function") {
  AbortSignal.timeout = function timeout(ms) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), Number(ms) || 0);
    const signal = controller.signal;
    if (typeof signal.addEventListener === "function") {
      signal.addEventListener("abort", () => clearTimeout(id), { once: true });
    }
    return signal;
  };
}

function nodeHttpFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const headers = Object.assign(
      { Accept: "application/json", "User-Agent": "PeakFleet/1.0" },
      options.headers || {}
    );
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "http:" ? 80 : 443),
        path: parsed.pathname + parsed.search,
        method: options.method || "GET",
        headers,
        timeout: 15000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString("utf8");
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode || 0,
            async text() {
              return text;
            },
            async json() {
              return JSON.parse(text);
            },
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("请求超时"));
    });
    req.on("error", reject);
    if (options.signal) {
      const onAbort = () => {
        req.destroy(new Error("请求已中止"));
      };
      if (options.signal.aborted) onAbort();
      else if (typeof options.signal.addEventListener === "function") {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    }
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function httpFetch(url, options = {}) {
  if (typeof undiciFetch === "function") {
    return undiciFetch(url, options);
  }
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch(url, options);
  }
  return nodeHttpFetch(url, options);
}

console.info(
  "HTTP client:",
  undiciFetch ? "undici" : typeof globalThis.fetch === "function" ? "global-fetch" : "node-http"
);

module.exports = { httpFetch };
