/**
 * 自动打卡：优先拉取 api.pzvtcm.online 在线坐标，判断是否落在活动打卡多边形内，
 * 命中则写入签到记录并增加成员积分。
 */
const evmApi = require("./evmApi");

const MAP_CFG = {
  ets: { div: 1.609055, mx: 70272, my: 76157, maxZoom: 8 },
  promods: { div: 2.598541, mx: 51953, my: 76024, maxZoom: 8 },
};

let fullmapCache = { at: 0, players: [], fallbackUntil: 0, note: "" };
let scanning = null;

function resolveMapType(serverName = "") {
  return /promods/i.test(String(serverName || "")) ? "promods" : "ets";
}

/** 游戏坐标 -> Leaflet CRS.Simple lat/lng（与前端瓦片地图一致） */
function gameToLatLng(x, y, mapType = "ets") {
  const cfg = MAP_CFG[mapType] || MAP_CFG.ets;
  const px = Number(x) / cfg.div + cfg.mx;
  const py = Number(y) / cfg.div + cfg.my;
  const scale = Math.pow(2, cfg.maxZoom);
  return {
    lat: -py / scale,
    lng: px / scale,
  };
}

function pointInPolygon(point, polygon) {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;
  const x = Number(point.lng);
  const y = Number(point.lat);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = Number(polygon[i].lng ?? polygon[i].x);
    const yi = Number(polygon[i].lat ?? polygon[i].y);
    const xj = Number(polygon[j].lng ?? polygon[j].x);
    const yj = Number(polygon[j].lat ?? polygon[j].y);
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) {
      continue;
    }
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function timeToMinutes(text) {
  const raw = String(text || "").trim();
  const m = raw.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?\s*$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** 配置 id 超过有符号 INT 时，按列表顺序收成 1、2、3，避免写入 config_id 溢出 */
function withFittedIds(list) {
  const used = new Set();
  return (Array.isArray(list) ? list : []).map((item) => {
    let id = Math.trunc(Number(item && item.id));
    if (!Number.isFinite(id) || id <= 0 || id > 2147483647 || used.has(id)) {
      id = 1;
      while (used.has(id)) id += 1;
    }
    used.add(id);
    return { ...item, id };
  });
}

/** 活动时间按北京时间理解，不随服务器时区漂移。日期单独写时，结束算到当天 23:59:59。 */
function parseActivityTime(text, asEnd = false) {
  const raw = String(text || "").trim();
  if (!raw) return NaN;
  const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnly) {
    return new Date(`${dateOnly[1]}T${asEnd ? "23:59:59" : "00:00:00"}+08:00`).getTime();
  }
  const dt = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dt) {
    const hh = String(dt[2]).padStart(2, "0");
    return new Date(`${dt[1]}T${hh}:${dt[3]}:${dt[4] || "00"}+08:00`).getTime();
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : NaN;
}

/** 打卡钟点固定按北京时间，不跟服务器所在时区。 */
function chinaMinutes(now = new Date()) {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

function isConfigActiveNow(activity, config, now = new Date()) {
  if (!activity || !config) return false;
  if (String(activity.publishStatus || "") === "draft") return false;
  const start = parseActivityTime(activity.startDate, false);
  const endSource = activity.endDate || activity.startDate || "";
  const end = parseActivityTime(endSource, /^\d{4}-\d{2}-\d{2}$/.test(String(endSource).trim()));
  const ts = now.getTime();
  if (!Number.isFinite(start) || ts < start) return false;
  if (Number.isFinite(end) && ts >= end) return false;

  if (config.type === "all") return true;
  const cur = chinaMinutes(now);
  if (config.type === "range") {
    const s = timeToMinutes(config.startTime);
    const e = timeToMinutes(config.endTime);
    if (s == null || e == null) return true;
    if (e >= s) return cur >= s && cur <= e;
    return cur >= s || cur <= e;
  }
  const fixed = timeToMinutes(config.checkinTime);
  if (fixed == null) return true;
  return cur >= fixed;
}

function inactiveConfigHint(activity) {
  const configs = (activity.checkinConfigs || []).filter(
    (c) => Array.isArray(c.polygon) && c.polygon.length >= 3
  );
  const cfg = configs[0] || {};
  const label = cfg.name || cfg.serverName || "打卡配置";
  const win = `${activity.startDate || "未设置"} ~ ${activity.endDate || activity.startDate || "未设置"}`;
  let rule = "未设置打卡时间";
  if (cfg.type === "range") rule = `每天 ${cfg.startTime || "?"}–${cfg.endTime || "?"}`;
  else if (cfg.checkinTime) rule = `定时 ${cfg.checkinTime} 之后`;
  return `活动「${activity.name || "未命名"}」已有配置「${label}」，但当前不在打卡时间（活动 ${win}，${rule}）`;
}

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[!！]/g, "")
    .replace(/^(ets2|ats|promods)[·•.\-]+/, "");
}

function coreServerName(text) {
  return normName(text).replace(/^\[[a-z0-9]+\]/, "");
}

function serverIdsForName(servers, serverName) {
  const target = normName(serverName);
  const targetCore = coreServerName(serverName);
  if (!target) return new Set();
  const exact = new Set();
  const fuzzy = new Set();
  for (const s of servers || []) {
    const n = normName(s.name);
    const short = normName(s.shortname);
    const nCore = coreServerName(s.name);
    const shortCore = coreServerName(s.shortname);
    const id = Number(s.id);
    if (!Number.isFinite(id)) continue;
    if (n === target || short === target || nCore === targetCore || shortCore === targetCore) {
      exact.add(id);
      continue;
    }
    const names = [n, short, nCore, shortCore].filter((x) => x && x.length >= 4);
    if (
      names.some(
        (x) =>
          x.endsWith(targetCore) ||
          targetCore.endsWith(x) ||
          x.includes(targetCore) ||
          targetCore.includes(x)
      )
    ) {
      fuzzy.add(id);
    }
  }
  return exact.size ? exact : fuzzy;
}

function serverLabel(servers, serverId) {
  const hit = (servers || []).find((s) => Number(s.id) === Number(serverId));
  return hit ? `${hit.name}(#${hit.id})` : `未知服务器(#${serverId})`;
}

function normalizeFullmapPlayers(payload) {
  // ets2map: { Data: [...] }；VTCM: { code, data: [...] }
  const list = Array.isArray(payload?.Data)
    ? payload.Data
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload)
        ? payload
        : [];
  return list
    .map((p) => ({
      name: p.Name || p.name || p.tmpName || "",
      x: Number(p.X ?? p.x ?? p.axisX),
      y: Number(p.Y ?? p.y ?? p.axisY),
      tmpId: String(p.MpId ?? p.mpId ?? p.tmpId ?? p.tmp_id ?? ""),
      serverId: Number(p.ServerId ?? p.serverId),
    }))
    .filter(
      (p) =>
        p.tmpId &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        !(p.x === 0 && p.y === 0)
    );
}

async function pullMap(mapUrl) {
  try {
    console.info("地图在线拉取:", mapUrl);
    const upstream = await evmApi.httpFetch(mapUrl, {
      signal: evmApi.makeSignal(12000),
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 PeakFleetCheckin/1.0",
      },
    });
    if (!upstream.ok) {
      const error = new Error(`地图接口 HTTP ${upstream.status}`);
      error.status = upstream.status;
      return { error };
    }
    const text = await upstream.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return { error: new Error("地图在线数据返回异常") };
    }
    if (payload && (payload.cloudflare_error || payload.status === 429)) {
      const error = new Error(`地图接口限流(${payload.status || 429})`);
      error.status = 429;
      return { error };
    }
    if (payload && payload.code != null && Number(payload.code) !== 200) {
      return { error: new Error(payload.msg || `地图接口错误(${payload.code})`) };
    }
    const hasList =
      Array.isArray(payload?.Data) ||
      Array.isArray(payload?.data) ||
      Array.isArray(payload);
    if (!hasList) return { error: new Error("地图在线数据格式异常") };
    const players = normalizeFullmapPlayers(payload);
    if (!players.length) return { empty: true };
    return { players };
  } catch (err) {
    return { error: err };
  }
}

function rememberPlayers(players, note = "") {
  fullmapCache = {
    at: Date.now(),
    players,
    fallbackUntil: fullmapCache.fallbackUntil || 0,
    note,
  };
  return players;
}

async function fetchFullmapPlayers() {
  const now = Date.now();
  if (fullmapCache.players.length && now - fullmapCache.at < 20 * 1000) {
    return fullmapCache.players;
  }

  const evmUrl = evmApi.url("/map/playerList");
  const evm = evmUrl ? await pullMap(evmUrl) : { error: new Error("未配置地图接口") };
  if (evm.players) return rememberPlayers(evm.players, "");

  const evmOkEmpty = Boolean(evm.empty);
  if (now >= (fullmapCache.fallbackUntil || 0)) {
    let fallbackErr = null;
    for (const mapUrl of [
      "https://tracker.ets2map.com/v3/fullmap",
      "http://tracker.ets2map.com/v3/fullmap",
    ]) {
      const got = await pullMap(mapUrl);
      if (got.players) {
        fullmapCache.fallbackUntil = Date.now() + 25 * 1000;
        return rememberPlayers(got.players, "");
      }
      if (got.empty) {
        fullmapCache.fallbackUntil = Date.now() + 20 * 1000;
        return rememberPlayers([], "地图上当前没有在线玩家");
      }
      fallbackErr = got.error || fallbackErr;
      if (got.error && (got.error.status === 429 || /限流/.test(got.error.message || ""))) break;
    }
    const limited = fallbackErr && (fallbackErr.status === 429 || /限流/.test(fallbackErr.message || ""));
    fullmapCache.fallbackUntil = Date.now() + (limited ? 2 * 60 * 1000 : 45 * 1000);
    if (evmOkEmpty) {
      return rememberPlayers(
        [],
        fallbackErr ? "主地图暂无在线玩家，备用地图暂不可用" : "地图上当前没有在线玩家"
      );
    }
    if (fullmapCache.players.length && Date.now() - fullmapCache.at < 3 * 60 * 1000) {
      fullmapCache.note = "地图接口暂时失败，沿用刚才的在线位置";
      return fullmapCache.players;
    }
    const err = fallbackErr || evm.error || new Error("地图在线数据获取失败");
    fullmapCache.note = err.message || "地图在线数据获取失败";
    throw err;
  }

  if (evmOkEmpty) {
    return rememberPlayers([], fullmapCache.note || "地图上当前没有在线玩家");
  }
  if (fullmapCache.players.length) return fullmapCache.players;
  const err = evm.error || new Error(fullmapCache.note || "地图在线数据获取失败");
  throw err;
}

function mapCatalogRow(raw, idKey) {
  const id = Number(raw[idKey] ?? raw.serverId ?? raw.id);
  const name = String(raw.serverName || raw.name || "").trim();
  if (!Number.isFinite(id) || !name) return null;
  return {
    id,
    name,
    shortname: String(raw.shortName || raw.shortname || ""),
  };
}

async function fetchEvmServerCatalog() {
  const { payload } = await evmApi.fetchJson("/server/list", null, 10000);
  const list = Array.isArray(payload.data) ? payload.data : [];
  return list.map((s) => mapCatalogRow(s, "serverId")).filter(Boolean);
}

async function fetchTruckersMpCatalog() {
  const upstream = await evmApi.httpFetch("https://api.truckersmp.com/v2/servers", {
    signal: evmApi.makeSignal(10000),
  });
  const payload = await upstream.json();
  const apiError = payload.error;
  const failed =
    apiError === true ||
    apiError === "true" ||
    (typeof apiError === "string" &&
      apiError.toLowerCase() !== "false" &&
      apiError.trim() !== "");
  const list = Array.isArray(payload.response) ? payload.response : [];
  if (failed && !list.length) return [];
  return list.map((s) => mapCatalogRow(s, "id")).filter(Boolean);
}

let serverCatalogCache = { at: 0, items: [] };

/** 地图服和 TruckersMP 的服务器编号不一样，两套都保留，避免 Arcade 7/8 对不上。 */
async function fetchTmpServers() {
  const now = Date.now();
  if (serverCatalogCache.items.length && now - serverCatalogCache.at < 60 * 1000) {
    return serverCatalogCache.items;
  }
  const [evm, tmp] = await Promise.all([
    fetchEvmServerCatalog().catch((err) => {
      console.warn("EVM 服务器列表失败:", err.message);
      return [];
    }),
    fetchTruckersMpCatalog().catch((err) => {
      console.warn("TruckersMP 服务器列表失败:", err.message);
      return [];
    }),
  ]);
  const items = evm.concat(tmp);
  if (items.length) serverCatalogCache = { at: now, items };
  return items;
}

/**
 * @param {object} deps
 * @param {Function} deps.listActivities
 * @param {Function} deps.listMembers mapped members
 * @param {Function} deps.readCheckins
 * @param {Function} deps.writeCheckins
 * @param {Function} deps.nextId
 * @param {Function} deps.addMemberScore (memberId, delta) => Promise
 */
async function scanAndCheckin(deps) {
  const manual = Boolean(deps && deps.manual);
  if (scanning) {
    if (!manual) {
      return { ok: true, skipped: true, checked: 0, message: "上次扫描仍在进行" };
    }
    try {
      await scanning;
    } catch {
      /* 上一轮失败不影响这次手动扫描 */
    }
  }
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  scanning = gate;
  try {
    return await runScan(deps);
  } finally {
    if (scanning === gate) scanning = null;
    release();
  }
}

async function runScan(deps) {
  const result = {
    ok: true,
    checked: 0,
    scannedPlayers: 0,
    fleetOnline: 0,
    activeActivities: 0,
    activeConfigs: 0,
    matched: [],
    skippedDetail: {
      wrongServer: 0,
      outsideArea: 0,
      alreadyChecked: 0,
    },
    hints: [],
    errors: [],
  };
  try {
    const allActivities = (await Promise.resolve(deps.listActivities())) || [];
    const activities = allActivities.filter((a) => {
      if (String(a.publishStatus || "") === "draft") return false;
      const configs = Array.isArray(a.checkinConfigs) ? a.checkinConfigs : [];
      return configs.some((c) => Array.isArray(c.polygon) && c.polygon.length >= 3);
    });
    if (!activities.length) {
      const hasDraftOnly = allActivities.some(
        (a) =>
          String(a.publishStatus || "") === "draft" &&
          Array.isArray(a.checkinConfigs) &&
          a.checkinConfigs.some((c) => Array.isArray(c.polygon) && c.polygon.length >= 3)
      );
      result.hints.push(
        hasDraftOnly
          ? "有打卡区域的活动仍是草稿，请改为「正式」后再扫描"
          : "没有可扫描的正式活动（需配置地图打卡区域）"
      );
      return result;
    }

    const now = new Date();
    const runnable = [];
    for (const activity of activities) {
      const configs = withFittedIds(activity.checkinConfigs || []).filter(
        (c) =>
          Array.isArray(c.polygon) &&
          c.polygon.length >= 3 &&
          isConfigActiveNow(activity, c, now)
      );
      if (!configs.length) {
        const hasPoly = (activity.checkinConfigs || []).some(
          (c) => Array.isArray(c.polygon) && c.polygon.length >= 3
        );
        if (hasPoly) result.hints.push(inactiveConfigHint(activity));
        continue;
      }
      runnable.push({ activity, configs });
    }
    result.activeActivities = runnable.length;
    result.activeConfigs = runnable.reduce((n, item) => n + item.configs.length, 0);
    if (!runnable.length) {
      result.message = result.hints[0] || "暂无生效中的打卡配置";
      return result;
    }

    let players = [];
    try {
      players = await fetchFullmapPlayers();
    } catch (err) {
      const reason = err.message || "地图在线数据获取失败";
      result.hints.unshift(
        `打卡配置有效（${result.activeConfigs} 条），但地图在线数据获取失败：${reason}`
      );
      result.message = result.hints[0];
      console.warn("自动打卡地图拉取失败:", reason);
      return result;
    }
    if (fullmapCache.note) result.hints.push(fullmapCache.note);
    const [servers, members] = await Promise.all([
      fetchTmpServers(),
      Promise.resolve(deps.listMembers()),
    ]);
    result.scannedPlayers = players.length;
    const memberByTmp = new Map(
      (members || [])
        .filter((m) => m && m.tmpId && !m.leaveDate)
        .map((m) => [String(m.tmpId), m])
    );

    const onlineMemberPlayers = [];
    for (const p of players) {
      const member = memberByTmp.get(String(p.tmpId));
      if (member) onlineMemberPlayers.push({ player: p, member });
    }
    result.fleetOnline = onlineMemberPlayers.length;

    let checkins = (await Promise.resolve(deps.readCheckins())) || [];
    const nowIso = now.toISOString();
    const hintSamples = [];
    const createdLocal = [];

    for (const { activity, configs } of runnable) {
      for (const config of configs) {
        const mapType = resolveMapType(config.serverName || activity.location);
        const wantServer = config.serverName || activity.location || "";
        const serverIds = serverIdsForName(servers, wantServer);
        if (wantServer && !serverIds.size && servers.length) {
          result.hints.push(`未匹配到服务器「${wantServer}」，请检查打卡配置里的服务器名称`);
        }
        const reward = Number(config.points);
        const points = Number.isFinite(reward) && reward > 0 ? reward : 10;

        for (const { player, member } of onlineMemberPlayers) {
          const already = checkins.find(
            (c) =>
              Number(c.activityId) === Number(activity.id) &&
              Number(c.memberId) === Number(member.id) &&
              String(c.source || "auto") === "auto" &&
              Number(c.configId || 0) === Number(config.id || 0)
          );
          if (already) {
            result.skippedDetail.alreadyChecked += 1;
            continue;
          }

          if (serverIds.size && !serverIds.has(Number(player.serverId))) {
            result.skippedDetail.wrongServer += 1;
            if (hintSamples.length < 5) {
              hintSamples.push(
                `${member.name}(${member.tmpId}) 在线于 ${serverLabel(servers, player.serverId)}，配置要求「${wantServer}」`
              );
            }
            continue;
          }

          const pos = gameToLatLng(player.x, player.y, mapType);
          if (!pointInPolygon(pos, config.polygon)) {
            result.skippedDetail.outsideArea += 1;
            if (hintSamples.length < 5) {
              hintSamples.push(
                `${member.name}(${member.tmpId}) 在目标服务器上，但不在打卡区域内`
              );
            }
            continue;
          }

          try {
            const item = {
              activityId: activity.id,
              activityName: activity.name,
              configId: Number(config.id) || 0,
              configName: config.name || "",
              memberId: member.id,
              tmpId: member.tmpId,
              name: member.name,
              number: member.number,
              points,
              serverName: config.serverName || activity.location || "",
              note: "地图区域自动打卡",
              checkedAt: nowIso,
              operator: "系统自动打卡",
              source: "auto",
              createdAt: nowIso,
            };
            if (typeof deps.createCheckin === "function") {
              const saved = await deps.createCheckin(item);
              checkins.push(saved || item);
            } else {
              item.id = deps.nextId(checkins);
              checkins.push(item);
              createdLocal.push(item);
            }
            await deps.addMemberScore(member.id, points);
            result.checked += 1;
            result.matched.push({
              tmpId: member.tmpId,
              name: member.name,
              activityId: activity.id,
              points,
            });
          } catch (err) {
            const msg = String(err.message || err.code || "");
            if (/duplicate|uk_checkin_once/i.test(msg)) {
              result.skippedDetail.alreadyChecked += 1;
              continue;
            }
            result.errors.push(`${member.tmpId}: ${msg}`);
          }
        }
      }
    }

    if (createdLocal.length && typeof deps.writeCheckins === "function") {
      await Promise.resolve(deps.writeCheckins(checkins));
    } else if (result.checked === 0) {
      if (!result.fleetOnline) {
        if (result.scannedPlayers > 0) {
          result.hints.push("地图有在线玩家，但没有车队成员（只认成员列表里的 TMP ID）");
        } else if (!result.hints.some((h) => /在线玩家|地图/.test(h))) {
          result.hints.push("地图上当前没有在线玩家");
        }
      }
      if (result.skippedDetail.wrongServer > 0) {
        result.hints.push(
          `有 ${result.skippedDetail.wrongServer} 人次因服务器不符被跳过（需与打卡配置服务器一致）`
        );
      }
      if (result.skippedDetail.outsideArea > 0) {
        result.hints.push(
          `有 ${result.skippedDetail.outsideArea} 人次在目标服务器但不在框内`
        );
      }
      if (result.skippedDetail.alreadyChecked > 0) {
        result.hints.push(`有 ${result.skippedDetail.alreadyChecked} 人次已打过卡`);
      }
      if (result.errors.length) {
        result.hints.push(`有 ${result.errors.length} 人次写入失败：${result.errors[0]}`);
      }
      result.hints.push(...hintSamples);
    }
    result.message =
      result.checked > 0
        ? `新打卡 ${result.checked} 人`
        : result.hints[0] || "暂无新打卡";
    return result;
  } catch (err) {
    result.hints.unshift(err.message || "自动打卡扫描失败");
    result.message = result.hints[0];
    console.warn("自动打卡扫描失败:", result.message);
    return result;
  }
}

module.exports = {
  scanAndCheckin,
  gameToLatLng,
  pointInPolygon,
  isConfigActiveNow,
  parseActivityTime,
  withFittedIds,
  resolveMapType,
  fetchFullmapPlayers,
  fetchTmpServers,
  serverLabel,
  serverIdsForName,
};
