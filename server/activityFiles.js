const path = require("path");
const fs = require("fs");

const DEFAULT_ROOT = path.join(__dirname, "uploads", "activities");

function getUploadRoot() {
  const configured = (process.env.UPLOAD_ROOT || "").trim();
  return configured ? path.resolve(configured) : DEFAULT_ROOT;
}

function ensureRoot() {
  const root = getUploadRoot();
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

function activityDir(activityId) {
  const id = Number(activityId);
  if (!Number.isFinite(id) || id <= 0) throw new Error("无效活动 ID");
  return path.join(ensureRoot(), `activity_${id}`);
}

function ensureActivityDir(activityId) {
  const dir = activityDir(activityId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeName(name) {
  return String(name || "file")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function listFiles(activityId) {
  const dir = activityDir(activityId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => {
      const full = path.join(dir, d.name);
      const stat = fs.statSync(full);
      return {
        name: d.name,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function removeActivityDir(activityId) {
  const dir = activityDir(activityId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

function resolveFile(activityId, fileName) {
  const base = path.basename(String(fileName || ""));
  if (!base || base === "." || base === "..") return null;
  const full = path.join(activityDir(activityId), base);
  const root = activityDir(activityId);
  if (!full.startsWith(root)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return full;
}

function cleanupEndedActivities(activities, statusFn) {
  const removed = [];
  for (const item of activities || []) {
    const status = statusFn ? statusFn(item) : item.status;
    if (status === "done") {
      if (removeActivityDir(item.id)) removed.push(item.id);
    }
  }
  return removed;
}

module.exports = {
  getUploadRoot,
  ensureRoot,
  ensureActivityDir,
  activityDir,
  safeName,
  listFiles,
  removeActivityDir,
  resolveFile,
  cleanupEndedActivities,
};
