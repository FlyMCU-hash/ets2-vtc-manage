const OSS = require("ali-oss");

let client = null;

function isEnabled() {
  return Boolean(
    String(process.env.OSS_ACCESS_KEY_ID || "").trim() &&
      String(process.env.OSS_ACCESS_KEY_SECRET || "").trim() &&
      String(process.env.OSS_BUCKET || "").trim() &&
      String(process.env.OSS_REGION || process.env.OSS_ENDPOINT || "").trim()
  );
}

function getPrefix() {
  const raw = String(process.env.OSS_PREFIX || "activities").trim().replace(/^\/+|\/+$/g, "");
  return raw || "activities";
}

function getClient() {
  if (!isEnabled()) return null;
  if (client) return client;

  const region = String(process.env.OSS_REGION || "").trim();
  const endpoint = String(process.env.OSS_ENDPOINT || "").trim();
  const bucket = String(process.env.OSS_BUCKET || "").trim();
  const accessKeyId = String(process.env.OSS_ACCESS_KEY_ID || "").trim();
  const accessKeySecret = String(process.env.OSS_ACCESS_KEY_SECRET || "").trim();

  const opts = {
    accessKeyId,
    accessKeySecret,
    bucket,
    secure: true,
    timeout: Number(process.env.OSS_TIMEOUT_MS || 120000),
  };

  // 优先用 region（如 oss-cn-shanghai）；也可直接给 endpoint
  if (region) {
    opts.region = region.startsWith("oss-") ? region : `oss-${region}`;
  } else if (endpoint) {
    opts.endpoint = endpoint.replace(/^https?:\/\//, "");
  }

  client = new OSS(opts);
  return client;
}

function objectKey(activityId, fileName) {
  const id = Number(activityId);
  const name = String(fileName || "").replace(/^\/+/, "");
  return `${getPrefix()}/activity_${id}/${name}`;
}

function activityPrefix(activityId) {
  return `${getPrefix()}/activity_${Number(activityId)}/`;
}

async function listFiles(activityId) {
  const c = getClient();
  if (!c) return [];
  const prefix = activityPrefix(activityId);
  const items = [];
  let marker = null;
  do {
    const result = await c.list({
      prefix,
      marker: marker || undefined,
      "max-keys": 200,
    });
    for (const obj of result.objects || []) {
      const name = String(obj.name || "").slice(prefix.length);
      if (!name || name.endsWith("/")) continue;
      items.push({
        name,
        size: Number(obj.size) || 0,
        updatedAt: obj.lastModified
          ? new Date(obj.lastModified).toISOString()
          : new Date().toISOString(),
        storage: "oss",
        key: obj.name,
      });
    }
    marker = result.isTruncated ? result.nextMarker : null;
  } while (marker);

  items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return items;
}

async function putFile(activityId, fileName, localPath, contentType) {
  const c = getClient();
  if (!c) throw new Error("OSS 未配置");
  const key = objectKey(activityId, fileName);
  const result = await c.put(key, localPath, {
    headers: contentType ? { "Content-Type": contentType } : undefined,
  });
  return {
    name: fileName,
    key,
    url: result.url || "",
    size: 0,
    storage: "oss",
  };
}

async function putBuffer(activityId, fileName, buffer, contentType) {
  const c = getClient();
  if (!c) throw new Error("OSS 未配置");
  const key = objectKey(activityId, fileName);
  const result = await c.put(key, buffer, {
    headers: contentType ? { "Content-Type": contentType } : undefined,
  });
  return { name: fileName, key, url: result.url || "", storage: "oss" };
}

async function deleteFile(activityId, fileName) {
  const c = getClient();
  if (!c) return false;
  const key = objectKey(activityId, fileName);
  await c.delete(key);
  return true;
}

async function removeActivityDir(activityId) {
  const c = getClient();
  if (!c) return false;
  const prefix = activityPrefix(activityId);
  let marker = null;
  let removed = 0;
  do {
    const result = await c.list({
      prefix,
      marker: marker || undefined,
      "max-keys": 200,
    });
    const objects = (result.objects || []).map((o) => o.name).filter(Boolean);
    if (objects.length) {
      await c.deleteMulti(objects, { quiet: true });
      removed += objects.length;
    }
    marker = result.isTruncated ? result.nextMarker : null;
  } while (marker);
  return removed > 0;
}

function signDownloadUrl(activityId, fileName, expiresSec) {
  const c = getClient();
  if (!c) return "";
  const key = objectKey(activityId, fileName);
  const expires = Number(expiresSec || process.env.OSS_SIGN_EXPIRES || 1800);
  return c.signatureUrl(key, {
    expires: Number.isFinite(expires) && expires > 0 ? expires : 1800,
    method: "GET",
  });
}

function describe() {
  if (!isEnabled()) return "未启用（本地磁盘）";
  const region = process.env.OSS_REGION || process.env.OSS_ENDPOINT || "";
  return `oss://${process.env.OSS_BUCKET}/${getPrefix()} @ ${region}`;
}

module.exports = {
  isEnabled,
  getClient,
  getPrefix,
  objectKey,
  listFiles,
  putFile,
  putBuffer,
  deleteFile,
  removeActivityDir,
  signDownloadUrl,
  describe,
};
