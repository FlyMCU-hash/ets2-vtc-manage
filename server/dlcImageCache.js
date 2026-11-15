/**
 * DLC 封面本地缓存：首次下载到磁盘，之后优先读本地；
 * 定期 / 手动刷新时用 ETag、Last-Modified 或内容哈希对比，仅在变更时覆盖。
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const CACHE_DIR = path.join(__dirname, "uploads", "dlc");
const META_PATH = path.join(__dirname, "data", "dlc-image-cache.json");
const PUBLIC_PREFIX = "/media/dlc";
/** 距上次校验超过此时长才主动探测远端（毫秒） */
const REVALIDATE_AFTER_MS = Number(process.env.DLC_IMAGE_REVALIDATE_MS || 6 * 60 * 60 * 1000);
const FETCH_TIMEOUT_MS = 15000;
const CONCURRENCY = 4;

let meta = null;
let syncing = null;

function ensureDirs() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const dataDir = path.dirname(META_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function loadMeta() {
  if (meta) return meta;
  ensureDirs();
  if (!fs.existsSync(META_PATH)) {
    meta = {};
    return meta;
  }
  try {
    meta = JSON.parse(fs.readFileSync(META_PATH, "utf8")) || {};
  } catch {
    meta = {};
  }
  return meta;
}

function saveMeta() {
  ensureDirs();
  fs.writeFileSync(META_PATH, JSON.stringify(meta || {}, null, 2), "utf8");
}

function extFromUrlOrType(url, contentType) {
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("png")) return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("gif")) return ".gif";
  if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
  const m = String(url || "").match(/\.(jpe?g|png|webp|gif)(?:\?|$)/i);
  return m ? `.${m[1].toLowerCase().replace("jpeg", "jpg")}` : ".jpg";
}

function localPath(appId, ext = ".jpg") {
  return path.join(CACHE_DIR, `${Number(appId)}${ext}`);
}

function findLocalFile(appId) {
  const id = Number(appId);
  if (!Number.isFinite(id)) return null;
  const record = loadMeta()[id];
  if (record?.file) {
    const full = path.join(CACHE_DIR, record.file);
    if (fs.existsSync(full)) return full;
  }
  for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
    const full = localPath(id, ext);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function publicUrl(appId) {
  const id = Number(appId);
  const record = loadMeta()[id];
  const full = findLocalFile(id);
  if (!full) return "";
  const file = path.basename(full);
  const v = (record?.sha256 || "").slice(0, 12) || String(record?.updatedAt || Date.now());
  return `${PUBLIC_PREFIX}/${file}?v=${encodeURIComponent(v)}`;
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function fetchWithTimeout(url, options = {}) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": "PeakFleetDLCCache/1.0",
      ...(options.headers || {}),
    },
  });
}

/** 旧版 .../apps/{id}/header.jpg 失效时，从 Steam Store API 取当前 header_image */
async function resolveSteamHeaderUrl(appId) {
  const id = Number(appId);
  if (!Number.isFinite(id)) return "";
  try {
    const res = await fetchWithTimeout(
      `https://store.steampowered.com/api/appdetails?appids=${id}&filters=basic`
    );
    if (!res.ok) return "";
    const json = await res.json();
    const entry = json?.[String(id)];
    if (!entry?.success || !entry?.data?.header_image) return "";
    return String(entry.data.header_image).trim();
  } catch {
    return "";
  }
}

async function downloadAndStore(appId, remoteUrl, prev = {}) {
  const res = await fetchWithTimeout(remoteUrl);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = sha256(buf);
  const etag = res.headers.get("etag") || prev.etag || "";
  const lastModified = res.headers.get("last-modified") || prev.lastModified || "";
  const ext = extFromUrlOrType(remoteUrl, res.headers.get("content-type"));
  const file = `${Number(appId)}${ext}`;
  const full = path.join(CACHE_DIR, file);

  const unchanged = prev.sha256 && prev.sha256 === hash && findLocalFile(appId);
  if (unchanged) {
    loadMeta()[Number(appId)] = {
      ...prev,
      remoteUrl,
      etag: etag || prev.etag,
      lastModified: lastModified || prev.lastModified,
      checkedAt: new Date().toISOString(),
    };
    saveMeta();
    return { changed: false, url: publicUrl(appId) };
  }

  // 清理同 appId 旧扩展名文件
  for (const oldExt of [".jpg", ".jpeg", ".png", ".webp", ".gif"]) {
    const old = localPath(appId, oldExt);
    if (old !== full && fs.existsSync(old)) {
      try {
        fs.unlinkSync(old);
      } catch {
        /* ignore */
      }
    }
  }

  ensureDirs();
  fs.writeFileSync(full, buf);
  loadMeta()[Number(appId)] = {
    remoteUrl,
    file,
    etag,
    lastModified,
    sha256: hash,
    size: buf.length,
    checkedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveMeta();
  return { changed: true, url: publicUrl(appId) };
}

/**
 * 校验并按需更新单张封面。
 * force=true 时忽略「距上次校验时长」直接探测。
 */
async function ensureOne(appId, remoteUrl, { force = false } = {}) {
  const id = Number(appId);
  if (!Number.isFinite(id) || !remoteUrl) return { ok: false, url: "" };

  const record = loadMeta()[id] || {};
  const local = findLocalFile(id);
  const checkedAt = record.checkedAt ? Date.parse(record.checkedAt) : 0;
  const freshEnough =
    local &&
    !force &&
    checkedAt &&
    Date.now() - checkedAt < REVALIDATE_AFTER_MS &&
    record.remoteUrl === remoteUrl;

  if (freshEnough) {
    return { ok: true, url: publicUrl(id), skipped: true };
  }

  // 无本地：直接下载；404 时回退 Steam API 当前 header
  if (!local) {
    try {
      const r = await downloadAndStore(id, remoteUrl, record);
      return { ok: true, url: r.url, changed: r.changed };
    } catch (err) {
      const msg = String(err.message || "");
      if (/HTTP 404/i.test(msg)) {
        const alt = await resolveSteamHeaderUrl(id);
        if (alt && alt !== remoteUrl) {
          try {
            const r = await downloadAndStore(id, alt, record);
            return { ok: true, url: r.url, changed: r.changed, resolved: true };
          } catch (err2) {
            return { ok: false, url: "", error: err2.message };
          }
        }
      }
      return { ok: false, url: "", error: err.message };
    }
  }

  // 有本地：用条件请求探测是否变更
  try {
    const headers = {};
    if (record.etag) headers["If-None-Match"] = record.etag;
    if (record.lastModified) headers["If-Modified-Since"] = record.lastModified;

    let headOk = false;
    try {
      const head = await fetchWithTimeout(remoteUrl, { method: "HEAD", headers });
      if (head.status === 304) {
        loadMeta()[id] = {
          ...record,
          remoteUrl,
          checkedAt: new Date().toISOString(),
        };
        saveMeta();
        return { ok: true, url: publicUrl(id), changed: false };
      }
      if (head.ok) {
        headOk = true;
        const newEtag = head.headers.get("etag") || "";
        const newLm = head.headers.get("last-modified") || "";
        const sameByValidator =
          (record.etag && newEtag && record.etag === newEtag) ||
          (record.lastModified && newLm && record.lastModified === newLm);
        if (sameByValidator) {
          loadMeta()[id] = {
            ...record,
            remoteUrl,
            etag: newEtag || record.etag,
            lastModified: newLm || record.lastModified,
            checkedAt: new Date().toISOString(),
          };
          saveMeta();
          return { ok: true, url: publicUrl(id), changed: false };
        }
      }
    } catch {
      headOk = false;
    }

    // HEAD 不可用或指示可能变更：拉取全文并按哈希对比
    void headOk;
    const r = await downloadAndStore(id, remoteUrl, record);
    return { ok: true, url: r.url, changed: r.changed };
  } catch (err) {
    // 远端失败时仍返回本地
    return { ok: true, url: publicUrl(id), stale: true, error: err.message };
  }
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }
  const n = Math.min(limit, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => run()));
  return results;
}

/**
 * 为 DLC 列表应用本地封面 URL；缺失则下载，到期则后台/同步校验。
 * @param {Array} items
 * @param {{ force?: boolean, waitMissing?: boolean }} options
 */
async function localizeItems(items, options = {}) {
  const force = Boolean(options.force);
  const waitMissing = options.waitMissing !== false;
  const list = Array.isArray(items) ? items : [];

  const missing = [];
  const due = [];
  const allJobs = [];

  for (const item of list) {
    const id = Number(item.appId);
    const remote = item.imageUrl || item.remoteImageUrl || "";
    if (!id || !remote) continue;
    allJobs.push({ appId: id, remoteUrl: remote });
    const local = findLocalFile(id);
    const record = loadMeta()[id] || {};
    const checkedAt = record.checkedAt ? Date.parse(record.checkedAt) : 0;
    const needCheck =
      !checkedAt ||
      Date.now() - checkedAt >= REVALIDATE_AFTER_MS ||
      record.remoteUrl !== remote;
    if (!local) missing.push({ appId: id, remoteUrl: remote });
    else if (needCheck) due.push({ appId: id, remoteUrl: remote });
  }

  if (force && allJobs.length) {
    await mapPool(allJobs, CONCURRENCY, (job) =>
      ensureOne(job.appId, job.remoteUrl, { force: true })
    );
  } else {
    if (waitMissing && missing.length) {
      await mapPool(missing, CONCURRENCY, (job) =>
        ensureOne(job.appId, job.remoteUrl, { force: true })
      );
    } else if (!waitMissing && missing.length) {
      scheduleSync(missing);
    }
    if (due.length) scheduleSync(due);
  }

  return list.map((item) => {
    const id = Number(item.appId);
    const remote = item.imageUrl || "";
    const local = publicUrl(id);
    return {
      ...item,
      remoteImageUrl: remote,
      imageUrl: local || remote,
      imageCached: Boolean(local),
    };
  });
}

function scheduleSync(jobs) {
  if (!jobs.length) return;
  if (syncing) return;
  syncing = mapPool(jobs, CONCURRENCY, (job) => ensureOne(job.appId, job.remoteUrl, { force: false }))
    .then((results) => {
      const changed = results.filter((r) => r && r.changed).length;
      if (changed) console.log(`[DLC封面] 已更新 ${changed} 张`);
    })
    .catch((err) => console.warn("[DLC封面] 后台校验失败:", err.message))
    .finally(() => {
      syncing = null;
    });
}

function getCacheDir() {
  ensureDirs();
  return CACHE_DIR;
}

module.exports = {
  PUBLIC_PREFIX,
  getCacheDir,
  publicUrl,
  findLocalFile,
  ensureOne,
  localizeItems,
  REVALIDATE_AFTER_MS,
};
