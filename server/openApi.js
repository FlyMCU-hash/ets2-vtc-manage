/**
 * 机器人开放 API（Token 鉴权，只读）
 * Header: X-Api-Token 或 Query: token
 */
const checkinAuto = require("./checkinAuto");

function registerOpenApi(app, deps) {
  const {
    readJson,
    listActivities,
    listCheckins,
    activityStatusByTime,
    listMembers,
  } = deps;

  function getBotToken() {
    return String(process.env.BOT_API_TOKEN || "").trim();
  }

  /** 本地调试：DB 连不上时可用 data/debug-members.json（DEBUG_MOCK_MEMBERS=1） */
  async function safeListMembers() {
    try {
      return await listMembers();
    } catch (err) {
      const mockOn =
        process.env.DEBUG_MOCK_MEMBERS === "1" ||
        process.env.DEBUG_MOCK_MEMBERS === "true";
      if (!mockOn) throw err;
      console.warn("listMembers 失败，使用 debug-members.json:", err.message);
      return readJson("debug-members.json", []);
    }
  }

  function requireBotToken(req, res, next) {
    const expected = getBotToken();
    if (!expected) {
      return res.status(503).json({
        ok: false,
        message: "未配置 BOT_API_TOKEN，请在 .env 中设置后重启",
      });
    }
    const token = String(
      req.get("x-api-token") || req.get("authorization")?.replace(/^Bearer\s+/i, "") || req.query.token || ""
    ).trim();
    if (!token || token !== expected) {
      return res.status(401).json({ ok: false, message: "Token 无效" });
    }
    return next();
  }

  function simplifyConfigs(configs) {
    if (!Array.isArray(configs)) return [];
    return configs.map((c) => ({
      id: c.id,
      name: c.name || "",
      points: Number(c.points) || 0,
      type: c.type === "range" ? "range" : "fixed",
      checkinTime: c.checkinTime || "",
      startTime: c.startTime || "",
      endTime: c.endTime || "",
      serverName: c.serverName || "",
      hasArea: Array.isArray(c.polygon) && c.polygon.length >= 3,
    }));
  }

  function formatOpenDateTime(value) {
    let text = String(value || "")
      .trim()
      .replace("T", " ")
      .replace("Z", "");
    if (!text) return "";
    if (text.length >= 16) return text.slice(0, 16); // YYYY-MM-DD HH:MM
    return text;
  }

  function localToday() {
    // 固定按中国时区算“今天”，避免服务器 TZ=UTC 导致差一天
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

  function activityCoversDay(startDate, endDate, day) {
    const startDay = String(startDate || "").slice(0, 10);
    if (!startDay || !day) return false;
    let endDay = String(endDate || startDate || "").slice(0, 10);
    // 结束为次日 00:00 时，仍算覆盖开始日
    const endText = String(endDate || "");
    if (/[ T]00:00/.test(endText) && endDay > startDay) {
      const d = new Date(`${endDay}T00:00:00+08:00`);
      d.setDate(d.getDate() - 1);
      const pad = (n) => String(n).padStart(2, "0");
      endDay = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    return day >= startDay && day <= endDay;
  }

  /** GET /api/open/activities?status=all|ongoing|upcoming|done&today=1 */
  app.get("/api/open/activities", requireBotToken, async (req, res) => {
    try {
      const statusFilter = String(req.query.status || "all").toLowerCase();
      const todayOnly = req.query.today === "1" || req.query.today === "true";
      const today = localToday();
      const items = ((await listActivities()) || [])
        .filter((a) => {
          const ps = String(a.publishStatus || "official").toLowerCase();
          return ps !== "draft";
        })
        .map((a) => {
          const status = activityStatusByTime(a.startDate, a.endDate);
          const configs = simplifyConfigs(a.checkinConfigs);
          return {
            id: a.id,
            name: a.name,
            startDate: formatOpenDateTime(a.startDate),
            endDate: formatOpenDateTime(a.endDate),
            location: a.location || "",
            status,
            publishStatus: a.publishStatus || "official",
            checkinConfigs: configs,
            autoCheckIn: configs.some((c) => c.hasArea),
          };
        })
        .filter((a) => {
          if (todayOnly) {
            return activityCoversDay(a.startDate, a.endDate, today);
          }
          if (statusFilter === "all") return true;
          return a.status === statusFilter;
        })
        .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));

      res.json({ ok: true, items, total: items.length, today });
    } catch (err) {
      console.error("open activities error:", err.message);
      res.status(500).json({ ok: false, message: "读取活动失败" });
    }
  });

  /** GET /api/open/members — 车队成员列表（供机器人自行匹配在线） */
  app.get("/api/open/members", requireBotToken, async (req, res) => {
    try {
      const members = await safeListMembers();
      const items = (members || [])
        .filter((m) => m && m.tmpId && !m.leaveDate)
        .map((m) => ({
          id: m.id,
          number: m.number,
          tmpId: String(m.tmpId),
          name: m.name,
          score: m.score,
          role: m.role || "",
        }));
      res.json({ ok: true, items, total: items.length });
    } catch (err) {
      console.error("open members error:", err.message);
      res.status(500).json({ ok: false, message: err.message || "读取成员失败" });
    }
  });

  /** GET /api/open/fleet-online — 车队成员库 TMP ID 与 fullmap 匹配 */
  app.get("/api/open/fleet-online", requireBotToken, async (req, res) => {
    try {
      const members = await safeListMembers();
      const activeMembers = (members || []).filter((m) => m && m.tmpId && !m.leaveDate);
      let players = [];
      let mapError = "";
      try {
        players = await checkinAuto.fetchFullmapPlayers();
      } catch (err) {
        mapError = err.message || "地图在线数据获取失败";
        console.warn("open fleet-online fullmap:", mapError);
      }
      const servers = await checkinAuto.fetchTmpServers().catch(() => []);
      const byTmp = new Map(players.map((p) => [String(p.tmpId), p]));
      const online = [];
      for (const m of activeMembers) {
        const p = byTmp.get(String(m.tmpId));
        if (!p) continue;
        online.push({
          id: m.id,
          number: m.number,
          tmpId: m.tmpId,
          name: m.name,
          score: m.score,
          serverId: p.serverId,
          serverName: checkinAuto.serverLabel(servers, p.serverId).replace(/\(#[\d]+\)$/, "").trim() || "",
          x: p.x,
          y: p.y,
        });
      }
      online.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh"));
      const mapBroken = Boolean(mapError) || players.length === 0;
      // 服务器访问不了地图时，仍返回成员总数，并提示机器人走本地匹配
      res.json({
        ok: true,
        totalMembers: activeMembers.length,
        onlineCount: online.length,
        mapPlayers: players.length,
        mapError: mapError || (players.length === 0 ? "地图在线数据为空" : undefined),
        needClientMatch: mapBroken,
        items: online,
      });
    } catch (err) {
      console.error("open fleet-online error:", err.message);
      res.status(500).json({ ok: false, message: err.message || "查询车队在线失败" });
    }
  });

  /** GET /api/open/checkins?activityId=&limit=20 */
  app.get("/api/open/checkins", requireBotToken, async (req, res) => {
    try {
      const activityId = req.query.activityId ? Number(req.query.activityId) : null;
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
      let items =
        (await listCheckins({
          activityId: Number.isFinite(activityId) && activityId > 0 ? activityId : undefined,
        })) || [];
      items = items.slice(0, limit).map((c) => ({
        id: c.id,
        activityId: c.activityId,
        activityName: c.activityName,
        tmpId: c.tmpId,
        name: c.name,
        number: c.number,
        points: c.points ?? null,
        checkedAt: c.checkedAt,
        note: c.note || "",
        source: c.source || "",
      }));
      res.json({ ok: true, items, total: items.length });
    } catch (err) {
      console.error("open checkins error:", err.message);
      res.status(500).json({ ok: false, message: "读取签到失败" });
    }
  });

  app.get("/api/open/health", requireBotToken, (req, res) => {
    res.json({
      ok: true,
      service: "peak-fleet",
      botApi: Boolean(getBotToken()),
      time: new Date().toISOString(),
    });
  });
}

module.exports = { registerOpenApi };
