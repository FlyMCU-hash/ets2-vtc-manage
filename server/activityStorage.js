const fs = require("fs");
const activityFiles = require("./activityFiles");
const ossStorage = require("./ossStorage");

function usingOss() {
  return ossStorage.isEnabled();
}

async function listFiles(activityId) {
  if (usingOss()) {
    try {
      return await ossStorage.listFiles(activityId);
    } catch (err) {
      console.error("OSS list files fallback local:", err.message);
    }
  }
  return activityFiles.listFiles(activityId).map((f) => ({ ...f, storage: "local" }));
}

async function listFilesWithDownloadUrl(activityId) {
  const items = await listFiles(activityId);
  return items.map((f) => {
    const downloadUrl =
      usingOss() && f.storage === "oss"
        ? ossStorage.signDownloadUrl(activityId, f.name)
        : "";
    return {
      name: f.name,
      size: f.size,
      updatedAt: f.updatedAt,
      storage: f.storage || (usingOss() ? "oss" : "local"),
      downloadUrl: downloadUrl || undefined,
    };
  });
}

async function afterLocalUpload(activityId, uploadedFiles) {
  if (!usingOss()) {
    return (uploadedFiles || []).map((f) => ({
      name: f.filename || f.name,
      size: f.size,
      storage: "local",
    }));
  }

  const out = [];
  for (const f of uploadedFiles || []) {
    const name = f.filename || f.name;
    const localPath = f.path;
    try {
      await ossStorage.putFile(activityId, name, localPath, f.mimetype);
      out.push({ name, size: f.size, storage: "oss" });
      // 上传 OSS 成功后删除本地暂存，避免占宝塔磁盘
      try {
        if (localPath && fs.existsSync(localPath)) fs.unlinkSync(localPath);
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.error("OSS put failed, keep local:", name, err.message);
      out.push({ name, size: f.size, storage: "local", error: err.message });
    }
  }
  return out;
}

async function deleteFile(activityId, fileName) {
  let ok = false;
  if (usingOss()) {
    try {
      ok = await ossStorage.deleteFile(activityId, fileName);
    } catch (err) {
      console.error("OSS delete:", err.message);
    }
  }
  const full = activityFiles.resolveFile(activityId, fileName);
  if (full) {
    fs.unlinkSync(full);
    ok = true;
  }
  return ok;
}

async function removeActivityDir(activityId) {
  let removed = false;
  if (usingOss()) {
    try {
      removed = (await ossStorage.removeActivityDir(activityId)) || removed;
    } catch (err) {
      console.error("OSS remove activity:", err.message);
    }
  }
  if (activityFiles.removeActivityDir(activityId)) removed = true;
  return removed;
}

function cleanupEndedActivities(activities, statusFn) {
  const removed = [];
  for (const item of activities || []) {
    const status = statusFn ? statusFn(item) : item.status;
    if (status === "done") {
      // sync cleanup for timer; fire-and-forget async OSS
      const id = item.id;
      Promise.resolve()
        .then(() => removeActivityDir(id))
        .catch((err) => console.error("cleanup activity files:", id, err.message));
      removed.push(id);
    }
  }
  return removed;
}

function describe() {
  return usingOss() ? ossStorage.describe() : `local:${activityFiles.getUploadRoot()}`;
}

module.exports = {
  usingOss,
  listFiles,
  listFilesWithDownloadUrl,
  afterLocalUpload,
  deleteFile,
  removeActivityDir,
  cleanupEndedActivities,
  describe,
  // re-export local helpers still needed by multer
  ensureActivityDir: activityFiles.ensureActivityDir,
  safeName: activityFiles.safeName,
  resolveFile: activityFiles.resolveFile,
  getUploadRoot: activityFiles.getUploadRoot,
  ensureRoot: activityFiles.ensureRoot,
};
