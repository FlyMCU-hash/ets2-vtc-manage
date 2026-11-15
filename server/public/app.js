const shell = document.getElementById("shell");
const nav = document.getElementById("nav");
const title = document.getElementById("title");
const modal = document.getElementById("modal");
const modalForm = document.getElementById("modalForm");
const modalTitle = document.getElementById("modalTitle");
const modalEyebrow = document.getElementById("modalEyebrow");
const modalDesc = document.getElementById("modalDesc");
const modalFields = document.getElementById("modalFields");
const modalError = document.getElementById("modalError");
const modalSubmit = document.getElementById("modalSubmit");

/** 桌面 EXE 嵌入：从 hash 读取后台 Token，请求时带 X-Admin-Token */
(function bootPeakAdminTokenFromHash() {
  try {
    const raw = String(location.hash || "").replace(/^#/, "");
    const params = new URLSearchParams(raw);
    const token = String(params.get("peakAdminToken") || "").trim();
    if (token) {
      sessionStorage.setItem("peak.adminToken", token);
      history.replaceState(null, "", location.pathname + location.search);
    }
  } catch (_) {}
})();

function getPeakAdminToken() {
  try {
    return String(sessionStorage.getItem("peak.adminToken") || "").trim();
  } catch (_) {
    return "";
  }
}

function peakAdminHeaders(extra = {}) {
  const headers = { ...(extra || {}) };
  const token = getPeakAdminToken();
  if (token) headers["X-Admin-Token"] = token;
  return headers;
}

function notifyExeLogout(reason) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        { type: "peak-admin-logout", reason: reason || "" },
        "*",
      );
    }
  } catch (_) {}
}

const labels = {
  home: "首页",
  members: "成员管理",
  points: "积分管理",
  activities: "设置活动",
  checkins: "签到记录",
  store: "商品管理",
  redeems: "兑换记录",
  dlc: "DLC管理",
  online: "在线用户",
  userSettings: "账号设置",
  customUserSettings: "账号创建",
  settings: "权限管理",
};

/** 若依侧栏图标（内联 SVG path，viewBox 0 0 24 24） */
const NAV_ICON_PATHS = {
  home: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z",
  members: "M12 12a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 12 12zm-7.5 8a7.5 7.5 0 0 1 15 0",
  points: "M12 3v18M7 8.5c1.2-1.4 2.6-2 5-2s3.8.7 5 2M7 15.5c1.2 1.4 2.6 2 5 2s3.8-.7 5-2",
  activities: "M7 4h10v3H7zm0 5h10v11H7zm3 3h4v5h-4z",
  checkins: "M9 12.5 11 14.5 15.5 10M6 4h12a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z",
  store: "M4 8h16l-1.2 11H5.2L4 8zm3-3h10l1 3H6z",
  redeems: "M5 7h14v3H5zm0 5h14v7H5zm3 2.5h5",
  dlc: "M4 7h16v10H4zm3 3h4v4H7zm7-1h3v2h-3zm0 4h3v2h-3z",
  online: "M12 18.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4zM5.5 10.5a9 9 0 0 1 13 0M8 13.2a5.5 5.5 0 0 1 8 0",
  userSettings: "M12 12a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 12 12zm-7 8v-1.2A5.8 5.8 0 0 1 12 13a5.8 5.8 0 0 1 7 5.8V20M18 4l2 2-7.5 7.5H10.5V11.5z",
  customUserSettings: "M12 4a3 3 0 0 1 3 3v1h2.5A1.5 1.5 0 0 1 19 9.5v9A1.5 1.5 0 0 1 17.5 20h-11A1.5 1.5 0 0 1 5 18.5v-9A1.5 1.5 0 0 1 6.5 8H9V7a3 3 0 0 1 3-3z",
  settings: "M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7zM4.5 12l1.6-1.2-.4-2 2-1.1L8.5 5.5h3L12.3 7.7l2 .1.4 2L16.5 12l-1.6 1.2.4 2-2 1.1-.8 2.2h-3l-.8-2.2-2-.1-.4-2z",
  folder: "M4 7h5l2 2h9v9H4z",
  default: "M6 6h12v12H6z",
};

const NAV_GROUP_ICONS = {
  fleet: "members",
  team: "members",
  activity: "activities",
  activityGroup: "activities",
  activities: "activities",
  shop: "store",
  mall: "store",
  store: "store",
  game: "dlc",
  dlc: "dlc",
  system: "settings",
  monitor: "online",
  settings: "settings",
  settingsGroup: "settings",
};

function navIconSvg(id) {
  const key = NAV_ICON_PATHS[id] ? id : NAV_ICON_PATHS[NAV_GROUP_ICONS[id]] ? NAV_GROUP_ICONS[id] : "default";
  const d = NAV_ICON_PATHS[key] || NAV_ICON_PATHS.default;
  return `<span class="nav-btn__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg></span>`;
}

function navChevronSvg() {
  return `<span class="nav-group__chevron" aria-hidden="true"><svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 2.5 8 6 4 9.5"/></svg></span>`;
}

function fillNavButton(btn, id, label) {
  btn.innerHTML = `${navIconSvg(id)}<span class="nav-btn__label">${label}</span>`;
}

let activityServerOptions = [];
let activityServersFetchedAt = 0;
let activityServersLoading = null;
const ACTIVITY_SERVERS_TTL_MS = 5 * 60 * 1000;

function withSelectedServerOption(selected = "") {
  const options = activityServerOptions.slice();
  const sel = String(selected || "").trim();
  if (sel && !options.some(([v]) => v === sel)) {
    options.unshift([sel, sel]);
  }
  return options;
}

/** 后台拉取服务器列表；有缓存时不阻塞弹窗 */
function prefetchActivityServers({ force = false } = {}) {
  const fresh =
    activityServerOptions.length &&
    Date.now() - activityServersFetchedAt < ACTIVITY_SERVERS_TTL_MS;
  if (!force && fresh) return Promise.resolve(activityServerOptions);
  if (activityServersLoading) return activityServersLoading;
  activityServersLoading = api("/api/servers")
    .then((data) => {
      activityServerOptions = (data.items || []).map((s) => [s.name, s.name]);
      activityServersFetchedAt = Date.now();
      return activityServerOptions;
    })
    .catch((err) => {
      console.warn("加载服务器列表失败:", err.message);
      return activityServerOptions;
    })
    .finally(() => {
      activityServersLoading = null;
    });
  return activityServersLoading;
}

function getActivityServerOptionsSync(selected = "") {
  return withSelectedServerOption(selected);
}

async function getActivityServerOptions(selected = "") {
  if (!activityServerOptions.length) {
    await prefetchActivityServers({ force: true });
  } else {
    prefetchActivityServers();
  }
  return withSelectedServerOption(selected);
}

function fillActivityLocationSelect(selected = "") {
  const sel = modalFields.querySelector('select[name="location"]');
  if (!sel) return;
  const options = withSelectedServerOption(selected);
  const selectedValue = String(selected || sel.value || "");
  sel.innerHTML =
    `<option value="" disabled ${selectedValue ? "" : "selected"}>请选择服务器</option>` +
    serverSelectOptionsHtml(options, selectedValue);
}

function toDateOnly(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(dateText, days) {
  const d = new Date(`${toDateOnly(dateText)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 活动固定：当天 19:00 开始，结束日 00:00（凌晨）结束 */
function applyFixedActivityTimes(body) {
  const startDay = toDateOnly(body.startDate);
  if (!startDay) return body;
  let endDay = toDateOnly(body.endDate);
  if (!endDay || endDay <= startDay) endDay = addDays(startDay, 1);
  body.startDate = `${startDay} 19:00`;
  body.endDate = `${endDay} 00:00`;
  return body;
}

function formatDateTime(value) {
  if (!value) return "—";
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    return `${text.slice(0, 10)} ${text.slice(11, 16)}`;
  }
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return text.replace("T", " ");
  return d.toLocaleString("zh-CN", { hour12: false });
}

let modalMode = null;
let editingId = null;
let nextMemberUid = 1;
let memberItemsCache = [];
let memberFilterBound = false;
let memberPage = 1;
const MEMBER_PAGE_SIZE = 20;

function redirectToLogin(reason = "登录已过期，请重新登录") {
  try {
    sessionStorage.removeItem("peak.adminToken");
  } catch (_) {}
  const embedded = Boolean(window.parent && window.parent !== window);
  notifyExeLogout(reason);
  if (embedded) return;
  try {
    sessionStorage.setItem("peak.auth.bounce", "1");
    sessionStorage.setItem("peak.login.notice", reason);
  } catch (_) {}
  location.replace("/login.html");
}

const ADMIN_IDLE_MS = 10 * 60 * 1000;
function startAdminIdleWatch() {
  let timer = 0;
  let lastTouch = 0;
  const kick = () => {
    fetch("/api/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: peakAdminHeaders(),
    }).catch(() => {});
    redirectToLogin("超过 10 分钟未操作，请重新登录");
  };
  const bump = () => {
    clearTimeout(timer);
    timer = setTimeout(kick, ADMIN_IDLE_MS);
    const now = Date.now();
    if (now - lastTouch > 60 * 1000) {
      lastTouch = now;
      fetch("/api/me", {
        credentials: "same-origin",
        cache: "no-store",
        headers: peakAdminHeaders(),
      }).then((res) => {
        if (res.status === 401) kick();
      }).catch(() => {});
    }
  };
  ["click", "keydown", "scroll", "touchstart"].forEach((ev) => {
    document.addEventListener(ev, bump, { passive: true });
  });
  bump();
}

function showToast(message, type = "success", ms = 2600) {
  const host = document.getElementById("toastHost");
  if (!host || !message) return;
  const el = document.createElement("div");
  el.className = `toast${type === "error" ? " toast--error" : type === "info" ? " toast--info" : ""}`;
  el.textContent = String(message);
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-show"));
  setTimeout(() => {
    el.classList.remove("is-show");
    setTimeout(() => el.remove(), 220);
  }, Math.max(1200, Number(ms) || 2600));
}

async function api(url, options = {}) {
  const headers = peakAdminHeaders({
    "Content-Type": "application/json",
    ...(options.headers || {}),
  });
  // FormData 不能手动带 Content-Type
  if (options.body instanceof FormData) {
    delete headers["Content-Type"];
  }
  const res = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    redirectToLogin(data.message === "未登录" ? "登录已过期，请重新登录后再上传存档" : (data.message || "未登录"));
    throw new Error("登录已过期，请重新登录");
  }
  if (!res.ok || data.ok === false) {
    const detail = data.detail ? `（${data.detail}）` : "";
    throw new Error((data.message || "请求失败") + detail);
  }
  return data;
}

const NAV_VIEW_KEY = "peak.nav.view";
const MENU_CACHE_KEY = "peak.nav.menus";

const DEFAULT_MENUS = [
  { id: "home", label: "首页" },
  {
    id: "fleet",
    label: "车队管理",
    children: [
      { id: "members", label: "成员管理", perm: "members" },
      { id: "points", label: "积分管理", perm: "points" },
    ],
  },
  {
    id: "activityGroup",
    label: "活动管理",
    children: [
      { id: "activities", label: "设置活动", perm: "activities" },
      { id: "checkins", label: "签到记录", perm: "activities" },
    ],
  },
  {
    id: "mall",
    label: "商城管理",
    children: [
      { id: "store", label: "商品管理", perm: "store" },
      { id: "redeems", label: "兑换记录", perm: "store" },
    ],
  },
  {
    id: "game",
    label: "游戏内容",
    children: [{ id: "dlc", label: "DLC管理", perm: "dlc" }],
  },
  {
    id: "settingsGroup",
    label: "设置",
    children: [
      { id: "customUserSettings", label: "账号创建", perm: "settings" },
      { id: "userSettings", label: "账号设置", perm: "settings" },
      { id: "online", label: "在线用户", perm: "monitor" },
      { id: "settings", label: "权限管理", perm: "settings" },
    ],
  },
];

function readCachedMenus() {
  try {
    const raw = localStorage.getItem(MENU_CACHE_KEY);
    const menus = raw ? JSON.parse(raw) : null;
    if (Array.isArray(menus) && menus.length) return menus;
  } catch (_) {}
  return DEFAULT_MENUS;
}

function cacheMenus(menus) {
  try {
    localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(menus));
  } catch (_) {}
}

function menusFromUser(user) {
  if (!user) return [{ id: "home", label: "首页" }];
  const isSuper = user.isSuper || user.role === "super";
  const perms = user.permissions || {};
  const result = [];
  for (const m of DEFAULT_MENUS) {
    if (m.children?.length) {
      const children = m.children
        .filter((c) => isSuper || !c.perm || perms[c.perm])
        .map(({ id, label }) => ({ id, label }));
      if (!children.length) continue;
      result.push({ id: m.id, label: m.label, children });
      continue;
    }
    if (!isSuper && m.perm && !perms[m.perm]) continue;
    result.push({ id: m.id, label: m.label });
  }
  return result.length ? result : [{ id: "home", label: "首页" }];
}

/** 在异步 boot 前先恢复上次页面，避免 F5 时首页闪一下 */
(function earlyRestoreView() {
  const id = localStorage.getItem(NAV_VIEW_KEY) || "home";
  document.querySelectorAll(".view").forEach((el) => {
    el.hidden = el.dataset.view !== id;
  });
  if (title) title.textContent = labels[id] || id;
  document.documentElement.classList.remove("booting");
  paintMenus(readCachedMenus(), { activate: false });
})();

function collectMenuViewIds(menus) {
  const ids = [];
  for (const item of menus || []) {
    if (item.children?.length) {
      for (const child of item.children) ids.push(child.id);
    } else if (item.id) {
      ids.push(item.id);
    }
  }
  return ids;
}

function syncNavActive(id) {
  nav.querySelectorAll(".nav-btn[data-id]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.id === id);
  });
}

function showView(id) {
  document.querySelectorAll(".view").forEach((el) => {
    el.hidden = el.dataset.view !== id;
  });
  syncNavActive(id);
  title.textContent = labels[id] || id;
  localStorage.setItem(NAV_VIEW_KEY, id);
  if (window.matchMedia("(max-width: 860px)").matches) {
    shell.classList.remove("is-open");
  }
  if (id === "members") loadMembers();
  if (id === "points") loadPoints();
  if (id === "activities") loadActivities();
  if (id === "checkins") loadCheckins();
  if (id === "store") loadStore();
  if (id === "redeems") loadRedeems();
  if (id === "dlc") loadDlc();
  if (id === "online") loadOnline();
  if (id === "userSettings") loadUserSettings();
  if (id === "customUserSettings") loadCustomUserSettings();
  if (id === "settings") loadPermissions();
}

function bindHomeStatCards(availableIds) {
  const allow = new Set(availableIds || []);
  document.querySelectorAll(".card--link[data-jump]").forEach((card) => {
    const target = card.dataset.jump;
    const ok = allow.has(target);
    card.disabled = !ok;
    card.title = ok ? `进入${labels[target] || target}` : "无访问权限";
    card.onclick = () => {
      if (!ok) return;
      showView(target);
    };
  });
}

function paintMenus(menus, { activate = true } = {}) {
  nav.innerHTML = "";
  const available = collectMenuViewIds(menus);
  const savedView = localStorage.getItem(NAV_VIEW_KEY);
  let firstViewId = available.includes("home") ? "home" : available[0] || "home";
  const openGroupsKey = "peak.nav.openGroups";
  let openGroups = {};
  try {
    openGroups = JSON.parse(localStorage.getItem(openGroupsKey) || "{}") || {};
  } catch (_) {
    openGroups = {};
  }

  (menus || []).forEach((item) => {
    if (item.children?.length) {
      const groupId = String(item.id || item.label || "");
      const group = document.createElement("div");
      const shouldOpen = openGroups[groupId] !== false;
      group.className = shouldOpen ? "nav-group is-open" : "nav-group";
      group.dataset.group = groupId;

      const label = document.createElement("button");
      label.type = "button";
      label.className = "nav-group__label";
      const groupIconId = NAV_GROUP_ICONS[groupId] || item.children[0]?.id || "folder";
      label.innerHTML = `${navIconSvg(groupIconId)}<span class="nav-btn__label">${item.label}</span>${navChevronSvg()}`;
      label.addEventListener("click", () => {
        const open = group.classList.toggle("is-open");
        openGroups[groupId] = open;
        try {
          localStorage.setItem(openGroupsKey, JSON.stringify(openGroups));
        } catch (_) {}
      });

      const sub = document.createElement("div");
      sub.className = "nav-group__sub";
      item.children.forEach((child) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "nav-btn nav-btn--sub";
        btn.dataset.id = child.id;
        fillNavButton(btn, child.id, child.label);
        btn.addEventListener("click", () => showView(child.id));
        sub.appendChild(btn);
        labels[child.id] = child.label;
      });

      group.appendChild(label);
      group.appendChild(sub);
      nav.appendChild(group);
      return;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nav-btn";
    btn.dataset.id = item.id;
    fillNavButton(btn, item.id, item.label);
    btn.addEventListener("click", () => showView(item.id));
    nav.appendChild(btn);
    labels[item.id] = item.label;
  });

  if (!activate) return;
  const restoreId = savedView && available.includes(savedView) ? savedView : firstViewId;
  showView(restoreId);
}

function renderMenus(menus) {
  const list = menus && menus.length ? menus : [{ id: "home", label: "首页" }];
  cacheMenus(list);
  paintMenus(list, { activate: true });
}

function statusText(status) {
  const map = {
    upcoming: "未开始",
    ongoing: "进行中",
    done: "已结束",
    on: "上架",
    off: "下架",
  };
  return map[status] || status || "—";
}

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

function activityStatusByTime(startDate, endDate) {
  const start = parseActivityTime(startDate, false);
  const endSource = endDate || startDate || "";
  const end = parseActivityTime(endSource, /^\d{4}-\d{2}-\d{2}$/.test(endSource.trim()));
  const now = Date.now();
  if (!Number.isFinite(start)) return "upcoming";
  if (now < start) return "upcoming";
  if (Number.isFinite(end) && now >= end) return "done";
  return "ongoing";
}

function activityStatusLabel(item) {
  return statusText(activityStatusByTime(item.startDate, item.endDate));
}

const modalMeta = {
  "member-add": { eyebrow: "成员管理", desc: "", submit: "新增成员" },
  "member-edit": { eyebrow: "成员管理", desc: "更新队员资料与积分相关字段。", submit: "保存修改" },
  "activity-add": { eyebrow: "", desc: "", submit: "确定" },
  "activity-edit": { eyebrow: "", desc: "", submit: "确定" },
  "store-add": { eyebrow: "商品管理", desc: "上架新商品，设置积分价格与库存。", submit: "新增商品" },
  "store-edit": { eyebrow: "商品管理", desc: "修改商品信息、价格或上下架状态。", submit: "保存修改" },
};

function openModal(titleText, fieldsHtml, mode, id = null) {
  modalMode = mode;
  editingId = id;
  const meta = modalMeta[mode] || { eyebrow: "表单", desc: "填写信息后保存", submit: "保存" };
  const isActivity = String(mode).startsWith("activity-");
  modal.classList.toggle("modal--activity", isActivity);
  modalEyebrow.textContent = meta.eyebrow || "";
  modalEyebrow.hidden = !meta.eyebrow;
  modalTitle.textContent = titleText;
  modalDesc.textContent = meta.desc || "";
  modalDesc.hidden = !meta.desc;
  modalSubmit.textContent = meta.submit;
  modalFields.innerHTML = fieldsHtml;
  modalFields.classList.toggle("modal__fields--activity", isActivity);
  modalError.hidden = true;
  modal.showModal();
}

function field(label, name, value = "", type = "text", extra = "", full = false) {
  const cls = full ? "field field--full" : "field";
  return `<label class="${cls}"><span>${label}</span><input name="${name}" type="${type}" value="${value ?? ""}" ${extra} /></label>`;
}

function selectField(label, name, options, value = "", full = false) {
  const list = Array.isArray(options) ? options : [];
  const opts = list.length
    ? list
        .map(([v, t]) => `<option value="${v}" ${String(v) === String(value) ? "selected" : ""}>${t}</option>`)
        .join("")
    : `<option value="" disabled selected>加载中或暂无数据</option>`;
  const cls = full ? "field field--full" : "field";
  return `<label class="${cls}"><span>${label}</span><select name="${name}" ${list.length ? "" : "disabled"}>${opts}</select></label>`;
}

function textareaField(label, name, value = "") {
  return `<label class="field field--full"><span>${label}</span><textarea name="${name}" rows="3">${value ?? ""}</textarea></label>`;
}

function checkboxField(label, name, checked = false) {
  return `<label class="field field--check field--full"><span>${label}</span><input name="${name}" type="checkbox" value="1" ${checked ? "checked" : ""} /></label>`;
}

function memberAccountFields(member = null) {
  const isEdit = Boolean(member);
  return [
    field(
      isEdit ? "登录密码（留空不改）" : "登录密码",
      "password",
      isEdit ? "" : "123456",
      "password",
      `${isEdit ? "" : "required "}autocomplete="new-password"`,
      true
    ),
    checkboxField("设为管理员（可登录后台）", "isAdmin", Boolean(member?.isAdmin)),
  ].join("");
}

/** QQ 头像地址（无 QQ 时返回空） */
function qqAvatarUrl(qq, size = 100) {
  const id = String(qq || "").replace(/\D/g, "");
  if (!id) return "";
  return `https://q1.qlogo.cn/g?b=qq&nk=${id}&s=${size}`;
}

function memberNameCell(m) {
  const name = m.name || "—";
  const avatar = qqAvatarUrl(m.qq, 100);
  if (!avatar) {
    return `<span class="member-name">${name}</span>`;
  }
  return `<span class="member-name-with-avatar">
    <img class="member-avatar" src="${avatar}" alt="" width="28" height="28" loading="lazy"
      onerror="this.style.visibility='hidden'" />
    <span class="member-name">${name}</span>
  </span>`;
}

/* ---------- 成员 ---------- */
function getMemberFilters() {
  return {
    q: (document.getElementById("memberFilterQ")?.value || "").trim().toLowerCase(),
    status: document.getElementById("memberFilterStatus")?.value || "all",
    admin: document.getElementById("memberFilterAdmin")?.value || "all",
    role: document.getElementById("memberFilterRole")?.value || "all",
  };
}

function memberRoleKey(role) {
  return String(role || "")
    .replace(/\p{Extended_Pictographic}(?:\u{FE0F})?(?:\u{200D}\p{Extended_Pictographic}(?:\u{FE0F})?)*/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fillMemberRoleFilter(items) {
  const sel = document.getElementById("memberFilterRole");
  if (!sel) return;
  const prev = sel.value || "all";
  const map = new Map();
  for (const m of items || []) {
    const raw = String(m.role || "").trim();
    if (!raw) continue;
    const key = memberRoleKey(raw) || raw;
    if (!map.has(key)) map.set(key, raw);
  }
  const roles = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-CN"));
  sel.innerHTML =
    `<option value="all">职位：全部</option>` +
    roles
      .map(([key, raw]) => {
        const label = key || raw;
        return `<option value="${String(key).replace(/"/g, "&quot;")}">${label}</option>`;
      })
      .join("");
  const still = [...sel.options].some((o) => o.value === prev);
  sel.value = still ? prev : "all";
}

function isMemberLeft(m) {
  if (m && typeof m.left === "boolean") return m.left;
  const raw = String(m?.leaveDate || "").trim();
  return Boolean(raw) && !raw.startsWith("0000-00-00");
}

function filterMembers(items) {
  const { q, status, admin, role } = getMemberFilters();
  return (items || []).filter((m) => {
    const left = isMemberLeft(m);
    if (status === "active" && left) return false;
    if (status === "left" && !left) return false;
    if (admin === "yes" && !m.isAdmin) return false;
    if (admin === "no" && m.isAdmin) return false;
    if (role !== "all") {
      const key = memberRoleKey(m.role);
      if (key !== role && String(m.role || "").trim() !== role) return false;
    }
    if (!q) return true;
    const hay = [m.number, m.tmpId, m.name, m.steamId, m.qq, m.role]
      .map((x) => String(x ?? "").toLowerCase())
      .join(" ");
    return hay.includes(q);
  });
}

function renderMemberPager(filteredCount, page, pageCount) {
  const pager = document.getElementById("memberPager");
  const info = document.getElementById("memberPageInfo");
  const prev = document.getElementById("memberPagePrev");
  const next = document.getElementById("memberPageNext");
  if (!pager || !info || !prev || !next) return;

  pager.hidden = filteredCount <= MEMBER_PAGE_SIZE;
  info.textContent = `第 ${page} / ${pageCount} 页`;
  prev.disabled = page <= 1;
  next.disabled = page >= pageCount;
}

function renderMemberTable(items) {
  const tbody = document.getElementById("memberTable");
  if (!tbody) return;

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="muted" style="white-space:normal;padding:.9rem .65rem">没有符合条件的成员</td></tr>`;
    return;
  }

  tbody.innerHTML = items
    .map((m) => {
      const left = isMemberLeft(m);
      return `<tr class="${left ? "is-left" : ""}">
        <td>${m.number}</td>
        <td>${m.tmpId}</td>
        <td>${memberNameCell(m)}</td>
        <td>${m.steamId || "—"}</td>
        <td>${m.qq || "—"}</td>
        <td>${m.role || "—"}</td>
        <td>${m.score ?? 0}</td>
        <td>${m.isAdmin ? "是" : "否"}</td>
        <td>${m.joinDate || "—"}</td>
        <td>${left ? m.leaveDate : ""}</td>
        <td class="ops">
          <button type="button" data-edit-member="${m.id}">编辑</button>
          ${
            left
              ? ""
              : `<button type="button" class="danger" data-leave-member="${m.id}">退队</button>`
          }
          <button type="button" class="danger" data-del-member="${m.id}">删除</button>
        </td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll("[data-edit-member]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = memberItemsCache.find((x) => x.id === Number(btn.dataset.editMember));
      if (!m) return;
      const fields = [
        field("UID编号", "number", m.number, "number"),
        field("TMP ID", "tmpId", m.tmpId, "text", "required"),
        `<div class="field field--full"><button type="button" class="btn-sm" id="lookupTmpBtn">从车队拉取资料</button></div>`,
        field("TMP昵称", "name", m.name, "text", "required"),
        field("QQ", "qq", m.qq),
        field("职位", "role", m.role),
        field("积分", "score", m.score, "number"),
        field("入队时间", "joinDate", m.joinDate, "date"),
        memberAccountFields(m),
      ];
      if (isMemberLeft(m)) {
        fields.push(
          `<label class="field field--full"><span>退队时间</span><input type="text" value="${m.leaveDate}" readonly /></label>`,
          `<p class="muted" style="margin:0">已退队成员无法登录接档器。</p>`
        );
      }
      openModal("编辑成员", fields.join(""), "member-edit", m.id);
      bindMemberTmpLookup();
    });
  });

  tbody.querySelectorAll("[data-leave-member]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("确认退队？退队后该成员将无法登录接档器。")) return;
      await api(`/api/members/${btn.dataset.leaveMember}/leave`, { method: "POST" });
      loadMembers();
    });
  });

  tbody.querySelectorAll("[data-del-member]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("确认删除该成员？")) return;
      await api(`/api/members/${btn.dataset.delMember}`, { method: "DELETE" });
      loadMembers();
    });
  });
}

function applyMemberFilters({ resetPage = true } = {}) {
  const filtered = filterMembers(memberItemsCache);
  const pageCount = Math.max(1, Math.ceil(filtered.length / MEMBER_PAGE_SIZE));
  if (resetPage) memberPage = 1;
  if (memberPage > pageCount) memberPage = pageCount;
  if (memberPage < 1) memberPage = 1;

  const start = (memberPage - 1) * MEMBER_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + MEMBER_PAGE_SIZE);

  renderMemberPager(filtered.length, memberPage, pageCount);
  renderMemberTable(pageItems);
}

function bindMemberFilters() {
  if (memberFilterBound) return;
  const q = document.getElementById("memberFilterQ");
  const status = document.getElementById("memberFilterStatus");
  const admin = document.getElementById("memberFilterAdmin");
  const role = document.getElementById("memberFilterRole");
  const reset = document.getElementById("memberFilterReset");
  const prev = document.getElementById("memberPagePrev");
  const next = document.getElementById("memberPageNext");
  if (!q || !status || !admin || !role || !reset) return;

  let timer = 0;
  q.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => applyMemberFilters({ resetPage: true }), 120);
  });
  status.addEventListener("change", () => applyMemberFilters({ resetPage: true }));
  admin.addEventListener("change", () => applyMemberFilters({ resetPage: true }));
  role.addEventListener("change", () => applyMemberFilters({ resetPage: true }));
  reset.addEventListener("click", () => {
    q.value = "";
    status.value = "active";
    admin.value = "all";
    role.value = "all";
    applyMemberFilters({ resetPage: true });
  });
  prev?.addEventListener("click", () => {
    if (memberPage <= 1) return;
    memberPage -= 1;
    applyMemberFilters({ resetPage: false });
  });
  next?.addEventListener("click", () => {
    memberPage += 1;
    applyMemberFilters({ resetPage: false });
  });
  memberFilterBound = true;
}

async function loadMembers() {
  const data = await api("/api/members");
  nextMemberUid = data.nextUid || 1;
  memberItemsCache = data.items || [];
  fillMemberRoleFilter(memberItemsCache);
  bindMemberFilters();
  applyMemberFilters({ resetPage: true });
}

function bindMemberTmpLookup() {
  const lookupBtn = document.getElementById("lookupTmpBtn");
  const tmpInput = modalForm.querySelector('[name="tmpId"]');
  if (!lookupBtn || !tmpInput) return;

  const lookup = async () => {
    const tmpId = tmpInput.value.trim();
    if (!tmpId) {
      modalError.textContent = "请先填写 TMP ID";
      modalError.hidden = false;
      tmpInput.focus();
      return;
    }
    modalError.hidden = true;
    const prev = lookupBtn.textContent;
    lookupBtn.disabled = true;
    lookupBtn.textContent = "查询中…";
    try {
      const data = await api(`/api/tmp-player/${encodeURIComponent(tmpId)}`);
      const player = data.item || {};
      const nameInput = modalForm.querySelector('[name="name"]');
      const roleInput = modalForm.querySelector('[name="role"]');
      const joinInput = modalForm.querySelector('[name="joinDate"]');
      if (nameInput && player.name) nameInput.value = player.name;
      if (roleInput && player.role) roleInput.value = player.role;
      if (joinInput && player.joinDate) {
        joinInput.value = String(player.joinDate).slice(0, 10);
      } else if (!player.joinDate) {
        modalError.textContent = "已拉取资料，但车队未返回入队时间，请手动填写";
        modalError.hidden = false;
      }
    } catch (err) {
      modalError.textContent = err.message || "自动查询失败，请手动填写 TMP昵称";
      modalError.hidden = false;
    } finally {
      lookupBtn.disabled = false;
      lookupBtn.textContent = prev;
    }
  };

  lookupBtn.addEventListener("click", lookup);
  tmpInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      lookup();
    }
  });
}

function openAddMemberModal() {
  openModal(
    "新增成员",
    [
      // 避免浏览器把 TMP ID 当成账号自动填入 admin
      field(
        "TMP ID",
        "tmpId",
        "",
        "text",
        'required autocomplete="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true"',
        true
      ),
      `<div class="field field--full"><button type="button" class="btn-sm" id="lookupTmpBtn">从车队拉取资料</button></div>`,
      field("UID编号", "number", String(nextMemberUid), "number", 'autocomplete="off"'),
      field("TMP昵称", "name", "", "text", 'required autocomplete="off"', true),
      field("QQ", "qq", "", "text", 'autocomplete="off"'),
      field("职位", "role", "", "text", 'autocomplete="off"'),
      field("入队时间", "joinDate", "", "date", 'autocomplete="off"'),
      memberAccountFields(),
    ].join(""),
    "member-add"
  );
  bindMemberTmpLookup();

  // 浏览器常把「TMP ID + 密码」当成登录表单自动填入 admin；TMP ID 短暂只读防串填，密码保持默认 123456
  const tmpInput = modalForm.querySelector('[name="tmpId"]');
  const pwdInput = modalForm.querySelector('[name="password"]');
  if (tmpInput) {
    tmpInput.value = "";
    tmpInput.setAttribute("readonly", "readonly");
  }
  if (pwdInput) pwdInput.value = "123456";
  setTimeout(() => {
    if (tmpInput) {
      tmpInput.value = "";
      tmpInput.removeAttribute("readonly");
      tmpInput.focus();
    }
    if (pwdInput && !pwdInput.value) pwdInput.value = "123456";
  }, 120);
}

document.getElementById("addMemberBtn").addEventListener("click", async () => {
  try {
    const members = await api("/api/members");
    nextMemberUid = members.nextUid || nextMemberUid;
  } catch (_) {}
  openAddMemberModal();
});

document.getElementById("syncJoinDatesBtn")?.addEventListener("click", async () => {
  if (!confirm("从 TruckersMP 车队同步在队成员的入队时间？已有日期会被车队数据覆盖。")) return;
  const btn = document.getElementById("syncJoinDatesBtn");
  const prev = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "同步中…";
  }
  try {
    const data = await api("/api/members/sync-join-dates", { method: "POST", body: "{}" });
    showToast(data.message || "入队时间已同步");
    loadMembers();
  } catch (err) {
    showToast(err.message || "同步失败", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prev;
    }
  }
});

/* ---------- 积分 ---------- */
async function loadPoints() {
  const data = await api("/api/points");
  const members = (data.members || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  const select = document.getElementById("pointMember");
  select.innerHTML = members
    .map((m) => `<option value="${m.id}">${m.name}（${m.tmpId} · ${m.score}分）</option>`)
    .join("");

  document.getElementById("pointTable").innerHTML = members
    .map(
      (m) => `<tr>
        <td>${m.tmpId}</td>
        <td>${memberNameCell(m)}</td>
        <td><strong>${m.score ?? 0}</strong></td>
      </tr>`
    )
    .join("");
}

document.getElementById("pointForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  await api("/api/points", {
    method: "POST",
    body: JSON.stringify({
      memberId: Number(document.getElementById("pointMember").value),
      delta: Number(document.getElementById("pointDelta").value),
      reason: document.getElementById("pointReason").value.trim(),
    }),
  });
  document.getElementById("pointDelta").value = "";
  document.getElementById("pointReason").value = "";
  loadPoints();
});

/* ---------- 签到记录 ---------- */
function checkinSourceTag(source) {
  if (source === "manual") return `<span class="tag tag-warn">手动签到</span>`;
  if (source === "auto") return `<span class="tag tag-ok">活动签到</span>`;
  return `<span class="tag tag-off">${source || "签到"}</span>`;
}

async function loadCheckins() {
  const filter = document.getElementById("checkinFilterActivity");
  const sourceFilter = document.getElementById("checkinFilterSource");
  const activityId = filter?.value || "";
  const source = sourceFilter?.value || "";
  const q = activityId ? `/api/checkins?activityId=${encodeURIComponent(activityId)}` : "/api/checkins";
  const data = await api(q);

  const actSel = document.getElementById("checkinActivity");
  const memSel = document.getElementById("checkinMember");
  const prevAct = actSel.value;
  const prevMem = memSel.value;
  const prevFilter = filter.value;

  actSel.innerHTML = (data.activities || [])
    .map((a) => `<option value="${a.id}">${a.name}</option>`)
    .join("") || `<option value="">暂无活动</option>`;
  memSel.innerHTML = (data.members || [])
    .map((m) => `<option value="${m.id}">${m.name}（${m.tmpId}）</option>`)
    .join("") || `<option value="">暂无成员</option>`;

  filter.innerHTML =
    `<option value="">全部活动</option>` +
    (data.activities || []).map((a) => `<option value="${a.id}">${a.name}</option>`).join("");

  if (prevAct && [...actSel.options].some((o) => o.value === prevAct)) actSel.value = prevAct;
  if (prevMem && [...memSel.options].some((o) => o.value === prevMem)) memSel.value = prevMem;
  if (prevFilter && [...filter.options].some((o) => o.value === prevFilter)) filter.value = prevFilter;

  const tbody = document.getElementById("checkinTable");
  const items = (data.items || []).filter((c) => !source || c.source === source);
  tbody.innerHTML = items.length
    ? items
        .map(
          (c) => `<tr>
            <td>${c.activityName || "—"}</td>
            <td>${checkinSourceTag(c.source)}</td>
            <td>${c.configName || "—"}</td>
            <td>${c.number || "—"}</td>
            <td>${c.tmpId || "—"}</td>
            <td>${c.name || "—"}</td>
            <td>${formatDateTime(c.checkedAt)}</td>
            <td class="plus">${c.points != null ? `+${c.points}` : "—"}</td>
            <td>${c.note || "—"}</td>
            <td>${c.operator || "—"}</td>
            <td class="ops">
              <button type="button" class="danger" data-del-checkin="${c.id}">删除</button>
            </td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="11" class="muted">暂无签到记录</td></tr>`;

  tbody.querySelectorAll("[data-del-checkin]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("确认删除该签到记录？")) return;
      await api(`/api/checkins/${btn.dataset.delCheckin}`, { method: "DELETE" });
      loadCheckins();
    });
  });
}

document.getElementById("checkinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const data = await api("/api/checkins", {
      method: "POST",
      body: JSON.stringify({
        activityId: Number(document.getElementById("checkinActivity").value),
        memberId: Number(document.getElementById("checkinMember").value),
        note: document.getElementById("checkinNote").value.trim(),
      }),
    });
    document.getElementById("checkinNote").value = "";
    const pts = Number(data.item?.points);
    showToast(Number.isFinite(pts) && pts > 0 ? `手动签到成功，已计入积分 +${pts}` : "手动签到成功");
    loadCheckins();
  } catch (err) {
    showToast(err.message || "签到失败", "error");
  }
});

document.getElementById("checkinFilterActivity").addEventListener("change", () => loadCheckins());
document.getElementById("checkinFilterSource")?.addEventListener("change", () => loadCheckins());

document.getElementById("checkinScanBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("checkinScanBtn");
  btn.disabled = true;
  try {
    const result = await api("/api/checkins/scan", { method: "POST", body: "{}" });
    const n = result.checked || 0;
    const headline = result.skipped
      ? result.message || "上次扫描仍在进行，请稍后再试"
      : result.message || (n > 0 ? `扫描完成：新打卡 ${n} 人` : "扫描完成：暂无新打卡");
    const lines = [
      headline,
      `地图在线 ${result.scannedPlayers || 0} · 车队在线 ${result.fleetOnline || 0} · 生效配置 ${result.activeConfigs || 0}`,
    ];
    const extra = []
      .concat(Array.isArray(result.hints) ? result.hints : [])
      .concat(Array.isArray(result.errors) ? result.errors : [])
      .filter((line) => line && line !== headline);
    if (extra.length) lines.push("", ...extra.slice(0, 6));
    alert(lines.join("\n"));
    await loadCheckins();
  } catch (err) {
    alert(err.message || "扫描失败");
  } finally {
    btn.disabled = false;
  }
});

/* ---------- 活动 ---------- */
let pendingActivityArchive = null;
let draftCheckinConfigs = [];
let editingCheckinConfigId = null;
let checkinMapPoints = [];
let checkinMapConfig = null;
let checkinLeafletMap = null;
let checkinTileLayer = null;
let checkinPolyLayer = null;
let checkinMarkerLayer = null;
let checkinLocateMarker = null;
let checkinMapReady = false;

const checkinConfigModal = document.getElementById("checkinConfigModal");
const checkinConfigForm = document.getElementById("checkinConfigForm");
const checkinConfigError = document.getElementById("checkinConfigError");

function serverSelectOptionsHtml(servers, selected = "") {
  return (servers || [])
    .map(
      ([v, t]) =>
        `<option value="${v}" ${String(v) === String(selected) ? "selected" : ""}>${t}</option>`
    )
    .join("");
}

function nextCheckinConfigId() {
  return draftCheckinConfigs.reduce((max, item) => {
    const id = Number(item.id) || 0;
    return id > 0 && id <= 2147483647 ? Math.max(max, id) : max;
  }, 0) + 1;
}

function fitDraftCheckinIds(list) {
  const used = new Set();
  return list.map((item) => {
    let id = Math.trunc(Number(item.id));
    if (!Number.isFinite(id) || id <= 0 || id > 2147483647 || used.has(id)) {
      id = 1;
      while (used.has(id)) id += 1;
    }
    used.add(id);
    return { ...item, id };
  });
}

function isAllDayConfig(cfg) {
  const start = String(cfg?.startTime || "").slice(-5);
  const end = String(cfg?.endTime || "").slice(-5);
  return cfg?.type === "all" || (cfg?.type === "range" && start === "00:00" && end === "23:59");
}

function checkinTypeLabel(type, cfg) {
  if (isAllDayConfig(cfg || { type })) return "全天";
  return type === "range" ? "时间范围" : "定时定点";
}

function checkinTimeLabel(cfg) {
  if (isAllDayConfig(cfg)) return "全天";
  if (cfg.type === "range") {
    return `${cfg.startTime || "—"} ~ ${cfg.endTime || "—"}`;
  }
  return cfg.checkinTime || "—";
}

function renderCheckinConfigList() {
  const list = document.getElementById("checkinConfigList");
  if (!list) return;
  if (!draftCheckinConfigs.length) {
    list.innerHTML = `<p class="muted checkin-empty">暂无打卡配置，点击下方新增</p>`;
    return;
  }
  list.innerHTML = draftCheckinConfigs
    .map(
      (cfg) => `<article class="checkin-config-card" data-cfg-id="${cfg.id}">
        <div class="checkin-config-card__main">
          <strong>${cfg.name || cfg.serverName || "未命名配置"}</strong>
          <p class="muted">服务器 ${cfg.serverName || "—"} · ${checkinTypeLabel(cfg.type, cfg)} · 积分 ${cfg.points ?? 0} · ${checkinTimeLabel(cfg)} · 区域点 ${
            Array.isArray(cfg.polygon) ? cfg.polygon.length : 0
          }</p>
        </div>
        <div class="ops">
          <button type="button" data-edit-cfg="${cfg.id}">编辑</button>
          <button type="button" class="danger" data-del-cfg="${cfg.id}">删除</button>
        </div>
      </article>`
    )
    .join("");

  list.querySelectorAll("[data-edit-cfg]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cfg = draftCheckinConfigs.find((x) => String(x.id) === String(btn.dataset.editCfg));
      if (cfg) openCheckinConfigModal(cfg);
    });
  });
  list.querySelectorAll("[data-del-cfg]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("确认删除该打卡配置？")) return;
      draftCheckinConfigs = draftCheckinConfigs.filter(
        (x) => String(x.id) !== String(btn.dataset.delCfg)
      );
      renderCheckinConfigList();
    });
  });
}

function buildActivityFormHtml({ servers, activity = null }) {
  const name = activity?.name || "";
  const date = toDateOnly(activity?.startDate) || "";
  const location = activity?.location || "";
  // 新建默认正式；编辑时沿用原状态（无字段则正式）
  const publish = activity
    ? activity.publishStatus === "draft"
      ? "draft"
      : "official"
    : "official";
  const serverOpts = serverSelectOptionsHtml(servers, location);

  return `
    <div class="activity-form">
      <nav class="activity-tabs" role="tablist">
        <button type="button" class="activity-tab is-active" data-activity-tab="basic">基本信息</button>
        <button type="button" class="activity-tab" data-activity-tab="checkin">打卡配置</button>
      </nav>

      <div class="activity-panel is-active" data-activity-panel="basic">
        <label class="activity-row">
          <span class="activity-label"><em>*</em> 活动名称</span>
          <div class="activity-control activity-control--count">
            <input name="name" type="text" maxlength="100" required placeholder="请输入活动名称" value="${String(name).replace(/"/g, "&quot;")}" id="activityNameInput" />
            <span class="activity-count" id="activityNameCount">${String(name).length} / 100</span>
          </div>
        </label>

        <div class="activity-row activity-row--split">
          <label class="activity-col">
            <span class="activity-label">活动日期</span>
            <input name="activityDate" type="date" required value="${date}" placeholder="请选择活动日期" />
          </label>
          <label class="activity-col">
            <span class="activity-label">服务器名称</span>
            <select name="location" required>
              <option value="" disabled ${location ? "" : "selected"}>请选择服务器</option>
              ${serverOpts}
            </select>
          </label>
        </div>

        <div class="activity-row">
          <span class="activity-label">状态</span>
          <div class="activity-radios">
            <label><input type="radio" name="publishStatus" value="draft" ${publish === "draft" ? "checked" : ""} /> 草稿</label>
            <label><input type="radio" name="publishStatus" value="official" ${publish === "official" ? "checked" : ""} /> 正式</label>
          </div>
        </div>

        <div class="activity-row">
          <span class="activity-label">存档文件</span>
          <div class="activity-control">
            <label class="activity-file-btn">
              选取文件
              <input type="file" id="activityArchiveInput" accept=".zip,application/zip" hidden />
            </label>
            <p class="activity-file-name muted" id="activityArchiveName">未选择文件</p>
            <p class="activity-file-hint">请上传 大小不超过 <strong>30MB</strong> 格式为 <strong>zip</strong> 的文件</p>
          </div>
        </div>
      </div>

      <div class="activity-panel" data-activity-panel="checkin" hidden>
        <div id="checkinConfigList" class="checkin-config-list"></div>
        <button type="button" class="checkin-config-add" id="addCheckinConfigBtn">+ 新增配置</button>
      </div>
    </div>
  `;
}

function syncCheckinTypeUi() {
  const type = checkinConfigForm.querySelector('input[name="cfgType"]:checked')?.value || "fixed";
  document.getElementById("cfgRuleFixed").hidden = type !== "fixed";
  document.getElementById("cfgRuleRange").hidden = type !== "range";
}

async function loadCheckinMapConfig() {
  if (checkinMapConfig) return checkinMapConfig;
  const data = await api("/api/map/config");
  checkinMapConfig = data;
  return data;
}

function resolveCheckinMapType(serverName = "") {
  return /promods/i.test(String(serverName || "")) ? "promods" : "ets";
}

function normalizeStoredMapPoint(p, map) {
  const lat = Number(p.lat ?? p.y);
  const lng = Number(p.lng ?? p.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // 兼容旧版 0~1 归一化点：放到地图中心附近
  if (lat >= 0 && lat <= 1 && lng >= 0 && lng <= 1 && map) {
    const c = map.getCenter();
    return {
      lat: c.lat + (0.5 - lat) * 8000,
      lng: c.lng + (lng - 0.5) * 8000,
    };
  }
  return { lat, lng };
}

function redrawCheckinPolygon() {
  if (!checkinLeafletMap) return;
  if (checkinPolyLayer) {
    checkinLeafletMap.removeLayer(checkinPolyLayer);
    checkinPolyLayer = null;
  }
  if (checkinMarkerLayer) {
    checkinLeafletMap.removeLayer(checkinMarkerLayer);
    checkinMarkerLayer = null;
  }

  const latlngs = checkinMapPoints
    .map((p) => normalizeStoredMapPoint(p, checkinLeafletMap))
    .filter(Boolean)
    .map((p) => [p.lat, p.lng]);
  checkinMapPoints = latlngs.map(([lat, lng]) => ({ lat, lng }));

  checkinMarkerLayer = L.layerGroup().addTo(checkinLeafletMap);
  latlngs.forEach((ll, i) => {
    L.circleMarker(ll, {
      radius: 5,
      color: "#fff",
      weight: 1.5,
      fillColor: "#69b1ff",
      fillOpacity: 1,
    })
      .bindTooltip(String(i + 1), { permanent: false })
      .addTo(checkinMarkerLayer);
  });

  if (latlngs.length >= 3) {
    checkinPolyLayer = L.polygon(latlngs, {
      color: "#409eff",
      weight: 2,
      fillColor: "#409eff",
      fillOpacity: 0.28,
    }).addTo(checkinLeafletMap);
  } else if (latlngs.length === 2) {
    checkinPolyLayer = L.polyline(latlngs, {
      color: "#409eff",
      weight: 2,
    }).addTo(checkinLeafletMap);
  }
}

function fitCheckinMap() {
  if (!checkinLeafletMap || checkinMapPoints.length < 1) return;
  const latlngs = checkinMapPoints.map((p) => [p.lat, p.lng]);
  checkinLeafletMap.fitBounds(latlngs, { padding: [28, 28], maxZoom: 7 });
}

function clearCheckinLocateMarker() {
  if (checkinLocateMarker && checkinLeafletMap) {
    checkinLeafletMap.removeLayer(checkinLocateMarker);
  }
  checkinLocateMarker = null;
}

function showCheckinLocateMarker(lat, lng, label = "") {
  if (!checkinLeafletMap) return;
  clearCheckinLocateMarker();
  checkinLocateMarker = L.circleMarker([lat, lng], {
    radius: 9,
    color: "#fff",
    weight: 2,
    fillColor: "#e67e22",
    fillOpacity: 1,
  }).addTo(checkinLeafletMap);
  if (label) {
    checkinLocateMarker.bindTooltip(label, {
      permanent: true,
      direction: "top",
      offset: [0, -10],
    });
  }
  checkinLeafletMap.invalidateSize();
  const zoom = Math.min(Math.max(checkinLeafletMap.getZoom(), 6), 8);
  if (typeof checkinLeafletMap.flyTo === "function") {
    checkinLeafletMap.flyTo([lat, lng], zoom, { duration: 0.55 });
  } else {
    checkinLeafletMap.setView([lat, lng], zoom);
  }
}

async function locatePlayerByTmpId() {
  const input = document.getElementById("cfgLocateTmpId");
  const btn = document.getElementById("cfgMapLocate");
  const tmpId = String(input?.value || "").trim();
  checkinConfigError.hidden = true;
  if (!tmpId) {
    checkinConfigError.textContent = "请填写 TMP ID";
    checkinConfigError.hidden = false;
    input?.focus();
    return;
  }
  const serverName = document.getElementById("cfgServerName")?.value || "";
  const mapType = resolveCheckinMapType(serverName);
  const prev = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "定位中…";
  }
  try {
    await ensureCheckinLeafletMap();
    if (!checkinLeafletMap) throw new Error("地图尚未就绪");

    const qs = new URLSearchParams({ mapType, serverName });
    const data = await api(`/api/map/player/${encodeURIComponent(tmpId)}?${qs}`);
    const item = data.item || {};
    const lat = Number(item.lat);
    const lng = Number(item.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error("未获取到有效坐标");
    }
    if (item.mapType) {
      setCheckinTileLayer(item.mapType);
    }
    const tip = [item.name || tmpId, item.serverName].filter(Boolean).join(" · ");
    showCheckinLocateMarker(lat, lng, tip);
  } catch (err) {
    checkinConfigError.textContent = err.message || "定位失败";
    checkinConfigError.hidden = false;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prev || "定位到玩家";
    }
  }
}

function setCheckinTileLayer(mapType = "ets") {
  if (!checkinLeafletMap || !checkinMapConfig) return;
  const conf = checkinMapConfig[mapType] || checkinMapConfig.ets;
  if (!conf) return;
  if (checkinTileLayer) {
    checkinLeafletMap.removeLayer(checkinTileLayer);
    checkinTileLayer = null;
  }
  const maxZoom = Number(conf.maxZoom) || 8;
  const minZoom = Number(conf.minZoom) || 2;
  const tileSize = Number(conf.tileSize) || 512;
  const bx = Number(conf.bounds?.x) || 131072;
  const by = Number(conf.bounds?.y) || 131072;
  const bounds = L.latLngBounds(
    checkinLeafletMap.unproject([0, by], maxZoom),
    checkinLeafletMap.unproject([bx, 0], maxZoom)
  );
  checkinLeafletMap.setMaxBounds(bounds);
  let switched = false;
  checkinTileLayer = L.tileLayer(conf.tileUrl, {
    minZoom,
    maxZoom: 10,
    maxNativeZoom: maxZoom,
    tileSize,
    bounds,
    noWrap: true,
  }).addTo(checkinLeafletMap);
  checkinTileLayer.on("tileerror", () => {
    if (switched || !conf.fallbackUrl) return;
    switched = true;
    checkinLeafletMap.removeLayer(checkinTileLayer);
    checkinTileLayer = L.tileLayer(conf.fallbackUrl, {
      minZoom,
      maxZoom: 10,
      maxNativeZoom: maxZoom,
      tileSize,
      bounds,
      noWrap: true,
    }).addTo(checkinLeafletMap);
  });
}

async function ensureCheckinLeafletMap() {
  if (typeof L === "undefined") {
    throw new Error("地图组件加载失败");
  }
  await loadCheckinMapConfig();
  const el = document.getElementById("cfgMap");
  if (!el) return;

  if (!checkinLeafletMap) {
    checkinLeafletMap = L.map(el, {
      crs: L.CRS.Simple,
      attributionControl: false,
      zoomControl: true,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      doubleClickZoom: false,
    });
    checkinLeafletMap.on("click", (e) => {
      checkinMapPoints.push({ lat: e.latlng.lat, lng: e.latlng.lng });
      redrawCheckinPolygon();
    });
    document.getElementById("cfgMapFit")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      fitCheckinMap();
    });
    document.getElementById("cfgMapClear")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      checkinMapPoints = [];
      clearCheckinLocateMarker();
      redrawCheckinPolygon();
    });
    document.getElementById("cfgMapUndo")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      checkinMapPoints.pop();
      redrawCheckinPolygon();
    });
    document.getElementById("cfgServerName")?.addEventListener("change", () => {
      const type = resolveCheckinMapType(document.getElementById("cfgServerName").value);
      setCheckinTileLayer(type);
    });
    checkinMapReady = true;
  }

  const mapType = resolveCheckinMapType(document.getElementById("cfgServerName")?.value || "");
  setCheckinTileLayer(mapType);
  const conf = checkinMapConfig[mapType] || checkinMapConfig.ets;
  const maxZoom = Number(conf.maxZoom) || 8;
  const bx = Number(conf.bounds?.x) || 131072;
  const by = Number(conf.bounds?.y) || 131072;
  const bounds = L.latLngBounds(
    checkinLeafletMap.unproject([0, by], maxZoom),
    checkinLeafletMap.unproject([bx, 0], maxZoom)
  );
  checkinLeafletMap.fitBounds(bounds);
  redrawCheckinPolygon();
  setTimeout(() => {
    checkinLeafletMap.invalidateSize();
    if (checkinMapPoints.length) fitCheckinMap();
    else checkinLeafletMap.fitBounds(bounds);
  }, 80);
}

function fillCheckinServerSelect(selected = "") {
  const sel = document.getElementById("cfgServerName");
  if (!sel) return;
  const options = activityServerOptions.length
    ? activityServerOptions
    : [["", "暂无服务器，请稍后重试"]];
  const selectedValue = String(selected || "");
  const hasSelected = selectedValue && options.some(([v]) => String(v) === selectedValue);
  sel.innerHTML =
    `<option value="" disabled ${selectedValue ? "" : "selected"}>请选择服务器名称</option>` +
    options
      .filter(([v]) => v)
      .map(
        ([v, t]) =>
          `<option value="${v}" ${String(v) === selectedValue ? "selected" : ""}>${t}</option>`
      )
      .join("");
  if (selectedValue && !hasSelected) {
    sel.insertAdjacentHTML(
      "beforeend",
      `<option value="${selectedValue}" selected>${selectedValue}</option>`
    );
  }
}

function openCheckinConfigModal(cfg = null) {
  editingCheckinConfigId = cfg?.id ?? null;
  document.getElementById("checkinConfigTitle").textContent = cfg ? "编辑配置" : "新增配置";
  fillCheckinServerSelect(cfg?.serverName || "");
  prefetchActivityServers().then(() => {
    if (!checkinConfigModal.open) return;
    fillCheckinServerSelect(cfg?.serverName || document.getElementById("cfgServerName")?.value || "");
  });
  document.getElementById("cfgName").value = cfg?.name || "";
  document.getElementById("cfgNameCount").textContent = `${String(cfg?.name || "").length} / 50`;
  document.getElementById("cfgPoints").value = cfg?.points ?? 10;
  const type = cfg?.type === "range" ? "range" : "fixed";
  checkinConfigForm.querySelectorAll('input[name="cfgType"]').forEach((el) => {
    el.checked = el.value === type;
  });
  document.getElementById("cfgCheckinTime").value = cfg?.checkinTime || "";
  document.getElementById("cfgStartTime").value = cfg?.startTime || "";
  document.getElementById("cfgEndTime").value = cfg?.endTime || "";
  checkinMapPoints = Array.isArray(cfg?.polygon)
    ? cfg.polygon
        .map((p) => ({
          lat: Number(p.lat ?? p.y),
          lng: Number(p.lng ?? p.x),
        }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    : [];
  const locateInput = document.getElementById("cfgLocateTmpId");
  if (locateInput) locateInput.value = "";
  clearCheckinLocateMarker();
  checkinConfigError.hidden = true;
  syncCheckinTypeUi();
  checkinConfigModal.showModal();
  requestAnimationFrame(async () => {
    try {
      await ensureCheckinLeafletMap();
    } catch (err) {
      checkinConfigError.textContent = err.message || "地图加载失败";
      checkinConfigError.hidden = false;
    }
  });
}

function closeCheckinConfigModal() {
  checkinConfigModal.close();
  editingCheckinConfigId = null;
}

let checkinLocateUiBound = false;
function bindCheckinLocateUi() {
  if (checkinLocateUiBound) return;
  checkinLocateUiBound = true;
  checkinConfigModal?.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("#cfgMapLocate");
    if (!btn) return;
    ev.preventDefault();
    locatePlayerByTmpId();
  });
  checkinConfigModal?.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    if (ev.target?.id !== "cfgLocateTmpId") return;
    ev.preventDefault();
    locatePlayerByTmpId();
  });
}

function bindCheckinConfigUi() {
  const addBtn = document.getElementById("addCheckinConfigBtn");
  if (addBtn) {
    addBtn.onclick = () => openCheckinConfigModal(null);
  }
  bindCheckinLocateUi();
  renderCheckinConfigList();
}

function bindActivityFormUi() {
  pendingActivityArchive = null;

  const tabs = modalFields.querySelectorAll("[data-activity-tab]");
  const panels = modalFields.querySelectorAll("[data-activity-panel]");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const id = tab.dataset.activityTab;
      tabs.forEach((t) => t.classList.toggle("is-active", t === tab));
      panels.forEach((p) => {
        const on = p.dataset.activityPanel === id;
        p.hidden = !on;
        p.classList.toggle("is-active", on);
      });
    });
  });

  const nameInput = document.getElementById("activityNameInput");
  const nameCount = document.getElementById("activityNameCount");
  if (nameInput && nameCount) {
    nameInput.addEventListener("input", () => {
      nameCount.textContent = `${nameInput.value.length} / 100`;
    });
  }

  const fileInput = document.getElementById("activityArchiveInput");
  const fileName = document.getElementById("activityArchiveName");
  if (fileInput && fileName) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0] || null;
      pendingActivityArchive = null;
      if (!file) {
        fileName.textContent = "未选择文件";
        return;
      }
      const isZip = /\.zip$/i.test(file.name) || file.type === "application/zip";
      if (!isZip) {
        fileInput.value = "";
        fileName.textContent = "未选择文件";
        modalError.textContent = "存档仅支持 zip 格式";
        modalError.hidden = false;
        return;
      }
      if (file.size > 30 * 1024 * 1024) {
        fileInput.value = "";
        fileName.textContent = "未选择文件";
        modalError.textContent = "存档文件不能超过 30MB";
        modalError.hidden = false;
        return;
      }
      modalError.hidden = true;
      pendingActivityArchive = file;
      fileName.textContent = `待上传：${readableArchiveName(file.name)}`;
      fileName.title = file.name;
    });
  }

  bindCheckinConfigUi();
}

async function openActivityModal(mode, activity = null) {
  const selectedLocation = activity?.location || "";
  // 有缓存则立刻开弹窗；仅首次无缓存时才短暂等待
  const servers = activityServerOptions.length
    ? getActivityServerOptionsSync(selectedLocation)
    : await getActivityServerOptions(selectedLocation);

  draftCheckinConfigs = fitDraftCheckinIds(
    Array.isArray(activity?.checkinConfigs)
      ? activity.checkinConfigs.map((c, i) => ({
          id: c.id || i + 1,
          name: c.name || c.serverName || "",
          points: Number(c.points) || 0,
          type: c.type === "all" ? "all" : c.type === "range" ? "range" : "fixed",
          checkinTime: c.checkinTime || "",
          startTime: c.startTime || "",
          endTime: c.endTime || "",
          polygon: Array.isArray(c.polygon) ? c.polygon : [],
          serverName: c.serverName || "",
        }))
      : []
  );
  openModal(
    mode === "activity-edit" ? "编辑活动" : "新增活动",
    buildActivityFormHtml({ servers, activity }),
    mode,
    activity?.id || null
  );
  bindActivityFormUi();

  // 编辑时展示已有存档（OSS/本地），避免误以为已选新文件
  if (mode === "activity-edit" && activity?.id) {
    const nameEl = document.getElementById("activityArchiveName");
    try {
      const data = await api(`/api/activities/${activity.id}/files`);
      const first = (data.items || [])[0];
      if (nameEl && first?.name) {
        const label = readableArchiveName(first.name);
        const where = first.storage === "oss" ? "OSS" : "本地";
        nameEl.textContent = `已有存档（${where}）：${label}`;
        nameEl.title = first.name;
      }
    } catch {
      /* ignore */
    }
  }

  // 后台刷新服务器下拉，避免等 TruckersMP 卡住
  prefetchActivityServers().then(() => {
    if (!modal.open) return;
    fillActivityLocationSelect(selectedLocation);
  });
}

async function uploadActivityArchive(activityId, file) {
  if (!activityId || !file) return;
  const fd = new FormData();
  fd.append("files", file);
  const res = await fetch(`/api/activities/${activityId}/files`, {
    method: "POST",
    credentials: "same-origin",
    headers: peakAdminHeaders(),
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    redirectToLogin("登录已过期，请重新登录后再上传存档");
    throw new Error("登录已过期，请重新登录");
  }
  if (!res.ok || data.ok === false) {
    throw new Error(data.message || "存档上传失败");
  }
  const failed = (data.uploaded || []).filter((u) => u && u.error);
  if (failed.length) {
    throw new Error(data.warning || `上传 OSS 失败: ${failed[0].error || "未知错误"}`);
  }
  return data;
}

function readableArchiveName(name) {
  const raw = String(name || "");
  const m = raw.match(/^(?:\d+_)?([0-9a-fA-F]{16,})(\.zip)?$/i);
  if (m && m[1].length % 2 === 0) {
    try {
      const bytes = m[1].match(/.{1,2}/g).map((h) => parseInt(h, 16));
      const text = new TextDecoder("utf-8").decode(Uint8Array.from(bytes));
      if (/[\u4e00-\u9fff]/.test(text)) return `${text}.zip`;
    } catch {
      /* keep */
    }
  }
  return raw;
}

function collectActivityBody(fd) {
  const activityDate = String(fd.get("activityDate") || "").trim();
  const body = {
    name: String(fd.get("name") || "").trim(),
    activityDate,
    startDate: activityDate,
    endDate: "",
    location: String(fd.get("location") || "").trim(),
    publishStatus: String(fd.get("publishStatus") || "official"),
    checkinConfigs: draftCheckinConfigs.map((c) => ({ ...c })),
    content: "",
  };
  applyFixedActivityTimes(body);
  return body;
}

document.getElementById("cfgName")?.addEventListener("input", (e) => {
  document.getElementById("cfgNameCount").textContent = `${e.target.value.length} / 50`;
});
checkinConfigForm?.querySelectorAll('input[name="cfgType"]').forEach((el) => {
  el.addEventListener("change", syncCheckinTypeUi);
});
document.getElementById("checkinConfigClose")?.addEventListener("click", closeCheckinConfigModal);
document.getElementById("checkinConfigCancel")?.addEventListener("click", closeCheckinConfigModal);
checkinConfigModal?.addEventListener("click", (e) => {
  if (e.target === checkinConfigModal) closeCheckinConfigModal();
});
checkinConfigForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  checkinConfigError.hidden = true;
  const serverName = document.getElementById("cfgServerName").value.trim();
  const name = document.getElementById("cfgName").value.trim();
  const points = Number(document.getElementById("cfgPoints").value) || 0;
  const type = checkinConfigForm.querySelector('input[name="cfgType"]:checked')?.value || "fixed";
  const checkinTime = document.getElementById("cfgCheckinTime").value;
  const startTime = document.getElementById("cfgStartTime").value;
  const endTime = document.getElementById("cfgEndTime").value;

  if (!serverName) {
    checkinConfigError.textContent = "请选择服务器ID（服务器名称）";
    checkinConfigError.hidden = false;
    return;
  }
  if (type === "fixed" && !checkinTime) {
    checkinConfigError.textContent = "请选择打卡时间";
    checkinConfigError.hidden = false;
    return;
  }
  if (type === "range" && (!startTime || !endTime)) {
    checkinConfigError.textContent = "请选择起始与结束时间";
    checkinConfigError.hidden = false;
    return;
  }
  if (checkinMapPoints.length < 3) {
    checkinConfigError.textContent = "请在地图上至少标记 3 个点形成打卡区域";
    checkinConfigError.hidden = false;
    return;
  }

  const item = {
    id: editingCheckinConfigId || nextCheckinConfigId(),
    name,
    points,
    type,
    checkinTime: type === "fixed" ? checkinTime : "",
    startTime: type === "range" ? startTime : "",
    endTime: type === "range" ? endTime : "",
    polygon: checkinMapPoints.map((p) => ({ lat: p.lat, lng: p.lng })),
    serverName,
  };

  const idx = draftCheckinConfigs.findIndex((c) => String(c.id) === String(item.id));
  if (idx >= 0) draftCheckinConfigs[idx] = item;
  else draftCheckinConfigs.push(item);

  closeCheckinConfigModal();
  renderCheckinConfigList();
});

async function loadActivities() {
  prefetchActivityServers();
  const data = await api("/api/activities");
  const tbody = document.getElementById("activityTable");
  tbody.innerHTML = data.items
    .map(
      (a) => `<tr>
        <td>${a.name}</td>
        <td>${formatDateTime(a.startDate)}</td>
        <td>${formatDateTime(a.endDate)}</td>
        <td>${a.location || "—"}</td>
        <td>${activityStatusLabel(a)}</td>
        <td class="ops">
          <button type="button" data-files-activity="${a.id}">文件</button>
          <button type="button" data-edit-activity="${a.id}">编辑</button>
          <button type="button" class="danger" data-del-activity="${a.id}">删除</button>
        </td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll("[data-edit-activity]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const a = data.items.find((x) => x.id === Number(btn.dataset.editActivity));
      if (!a) return;
      await openActivityModal("activity-edit", a);
    });
  });

  tbody.querySelectorAll("[data-files-activity]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const a = data.items.find((x) => x.id === Number(btn.dataset.filesActivity));
      if (!a) return;
      openActivityFiles(a);
    });
  });

  tbody.querySelectorAll("[data-del-activity]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("确认删除该活动？")) return;
      await api(`/api/activities/${btn.dataset.delActivity}`, { method: "DELETE" });
      loadActivities();
    });
  });
}

function formatSize(size) {
  const n = Number(size) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

let filesActivityId = null;
const filesModal = document.getElementById("filesModal");
const filesTable = document.getElementById("filesTable");
const filesError = document.getElementById("filesError");
const filesInput = document.getElementById("filesInput");

async function refreshActivityFiles() {
  if (!filesActivityId) return;
  const data = await api(`/api/activities/${filesActivityId}/files`);
  const ended = data.status === "done";
  document.getElementById("filesUploadBtn").disabled = ended;
  filesInput.disabled = ended;
  filesTable.innerHTML = (data.items || [])
    .map(
      (f) => `<tr>
        <td>${f.name}</td>
        <td>${formatSize(f.size)}</td>
        <td class="ops">
          <a class="ops-link" href="/api/activities/${filesActivityId}/files/${encodeURIComponent(f.name)}" target="_blank" rel="noopener">下载</a>
          ${
            ended
              ? ""
              : `<button type="button" class="danger" data-del-file="${f.name.replace(/"/g, "&quot;")}">删除</button>`
          }
        </td>
      </tr>`
    )
    .join("");
  if (!data.items?.length) {
    filesTable.innerHTML = `<tr><td colspan="3" class="muted">${
      ended ? "活动已结束，文件存档已清理" : "暂无文件"
    }</td></tr>`;
  }
  filesTable.querySelectorAll("[data-del-file]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("确认删除该文件？")) return;
      await api(
        `/api/activities/${filesActivityId}/files/${encodeURIComponent(btn.dataset.delFile)}`,
        { method: "DELETE" }
      );
      refreshActivityFiles();
    });
  });
}

async function openActivityFiles(activity) {
  filesActivityId = activity.id;
  filesError.hidden = true;
  filesInput.value = "";
  document.getElementById("filesTitle").textContent = activity.name || "活动文件";
  document.getElementById("filesDesc").textContent =
    `文件夹 activity_${activity.id} · 结束后自动删除存档`;
  filesModal.showModal();
  try {
    await refreshActivityFiles();
  } catch (err) {
    filesError.textContent = err.message || "读取文件失败";
    filesError.hidden = false;
  }
}

function closeFilesModal() {
  filesModal.close();
  filesActivityId = null;
}

document.getElementById("filesClose").addEventListener("click", closeFilesModal);
document.getElementById("filesCancel").addEventListener("click", closeFilesModal);
filesModal.addEventListener("click", (e) => {
  if (e.target === filesModal) closeFilesModal();
});

document.getElementById("filesUploadBtn").addEventListener("click", async () => {
  if (!filesActivityId) return;
  const list = filesInput.files;
  if (!list?.length) {
    filesError.textContent = "请先选择文件";
    filesError.hidden = false;
    return;
  }
  filesError.hidden = true;
  const btn = document.getElementById("filesUploadBtn");
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "上传中…";
  try {
    const fd = new FormData();
    Array.from(list).forEach((file) => fd.append("files", file));
    const res = await fetch(`/api/activities/${filesActivityId}/files`, {
      method: "POST",
      credentials: "same-origin",
      headers: peakAdminHeaders(),
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      redirectToLogin("登录已过期，请重新登录后再上传存档");
      throw new Error("登录已过期，请重新登录");
    }
    if (!res.ok || data.ok === false) throw new Error(data.message || "上传失败");
    const failed = (data.uploaded || []).filter((u) => u && u.error);
    if (failed.length) throw new Error(data.warning || failed[0].error || "上传 OSS 失败");
    filesInput.value = "";
    await refreshActivityFiles();
    showToast("存档已成功上传到 OSS");
  } catch (err) {
    filesError.textContent = err.message || "上传失败";
    filesError.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
});

document.getElementById("addActivityBtn").addEventListener("click", async () => {
  await openActivityModal("activity-add");
});

/* ---------- 商店 ---------- */
async function loadStore() {
  const data = await api("/api/store");
  const grid = document.getElementById("storeGrid");
  const items = data.items || [];
  if (!items.length) {
    grid.innerHTML = `<p class="muted">暂无商品，点击右上角新增。</p>`;
    return;
  }

  grid.innerHTML = items
    .map((p) => {
      const on = String(p.status || "on") === "on";
      return `<article class="store-card${on ? "" : " is-off"}">
        <div class="store-card__media">
          <img src="/img/logo.jpg" alt="${p.name || "商品"}" loading="lazy" />
          <span class="store-card__badge ${on ? "is-on" : "is-off"}">${statusText(p.status)}</span>
        </div>
        <div class="store-card__body">
          <h3>${p.name || "未命名商品"}</h3>
          <p>${p.desc || "暂无说明"}</p>
          <div class="store-card__meta">
            <span class="store-card__price">${Number(p.price) || 0} 积分</span>
            <span>库存 ${Number(p.stock) || 0}</span>
          </div>
          <div class="store-card__actions">
            <button type="button" class="btn-sm" data-edit-store="${p.id}">编辑</button>
            <button type="button" class="btn-sm danger" data-del-store="${p.id}">删除</button>
          </div>
        </div>
      </article>`;
    })
    .join("");

  grid.querySelectorAll("[data-edit-store]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = items.find((x) => x.id === Number(btn.dataset.editStore));
      if (!p) return;
      openModal(
        "编辑商品",
        [
          field("名称", "name", p.name, "text", "required", true),
          field("价格", "price", p.price, "number", "required"),
          field("库存", "stock", p.stock, "number"),
          selectField(
            "状态",
            "status",
            [
              ["on", "上架"],
              ["off", "下架"],
            ],
            p.status,
            true
          ),
          textareaField("说明", "desc", p.desc),
        ].join(""),
        "store-edit",
        p.id
      );
    });
  });

  grid.querySelectorAll("[data-del-store]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("确认删除该商品？")) return;
      await api(`/api/store/${btn.dataset.delStore}`, { method: "DELETE" });
      loadStore();
    });
  });
}

document.getElementById("addStoreBtn").addEventListener("click", () => {
  openModal(
    "新增商品",
    [
      field("名称", "name", "", "text", "required", true),
      field("价格", "price", "0", "number", "required"),
      field("库存", "stock", "0", "number"),
      selectField(
        "状态",
        "status",
        [
          ["on", "上架"],
          ["off", "下架"],
        ],
        "on",
        true
      ),
      textareaField("说明", "desc"),
    ].join(""),
    "store-add"
  );
});

/* ---------- 兑换记录（仅列表，后台不提供手工兑换表单） ---------- */
async function loadRedeems() {
  const data = await api("/api/redeems");
  const tbody = document.getElementById("redeemTable");
  const items = data.items || [];
  tbody.innerHTML = items.length
    ? items
        .map((r) => {
          const shipped = String(r.shipStatus || "") === "shipped";
          const tmpName = r.tmpName || r.name || "—";
          return `<tr class="${shipped ? "" : "is-pending-ship"}">
            <td>${r.productName || "—"}</td>
            <td>${r.price ?? "—"}</td>
            <td><strong>${tmpName}</strong></td>
            <td>${r.tmpId || "—"}</td>
            <td>${r.number || "—"}</td>
            <td><span class="tag ${shipped ? "tag-ok" : "tag-warn"}">${
              r.shipStatusText || (shipped ? "已发货" : "未发货")
            }</span></td>
            <td><span class="tag ${shipped ? "tag-ok" : "tag-warn"}">${
              r.doneStatusText || (shipped ? "已完成" : "未完成")
            }</span></td>
            <td>${formatDateTime(r.createdAt)}</td>
            <td>${r.note || "—"}</td>
            <td>${r.operator || "—"}</td>
            <td class="ops">
              ${
                shipped
                  ? `<button type="button" data-ship-redeem="${r.id}" data-ship-status="pending">标为未发货</button>`
                  : `<button type="button" data-ship-redeem="${r.id}" data-ship-status="shipped">确认发货</button>`
              }
              <button type="button" class="danger" data-del-redeem="${r.id}">删除</button>
            </td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="11" class="muted">暂无兑换记录</td></tr>`;

  tbody.querySelectorAll("[data-ship-redeem]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const status = btn.dataset.shipStatus;
      const tip =
        status === "shipped"
          ? "确认已发货？状态将变为「已完成」。"
          : "确认改回未发货？状态将变为「未完成」。";
      if (!confirm(tip)) return;
      await api(`/api/redeems/${btn.dataset.shipRedeem}/ship`, {
        method: "PUT",
        body: JSON.stringify({ shipStatus: status }),
      });
      loadRedeems();
    });
  });

  tbody.querySelectorAll("[data-del-redeem]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("确认删除该兑换记录？（不退回积分/库存）")) return;
      await api(`/api/redeems/${btn.dataset.delRedeem}`, { method: "DELETE" });
      loadRedeems();
    });
  });
}

/* ---------- 在线用户 ---------- */
async function loadOnline() {
  const host = document.getElementById("onlineHost").value.trim();
  const loginName = document.getElementById("onlineName").value.trim();
  const qs = new URLSearchParams();
  if (host) qs.set("host", host);
  if (loginName) qs.set("loginName", loginName);
  let data;
  try {
    data = await api(`/api/online?${qs.toString()}`);
  } catch (err) {
    showToast(err.message || "读取在线用户失败", "error");
    return;
  }
  const items = data.items || [];
  document.getElementById("onlineTotal").textContent = `共 ${items.length} 条`;
  const tbody = document.getElementById("onlineTable");
  tbody.innerHTML = items.length
    ? items
        .map(
          (row, i) => `<tr>
            <td>${i + 1}</td>
            <td title="${row.sessionId || ""}">${String(row.sessionId || "—").slice(0, 18)}${
              String(row.sessionId || "").length > 18 ? "…" : ""
            }</td>
            <td>${row.loginName || "—"}</td>
            <td title="${row.client || ""}">${String(row.client || "—").slice(0, 24)}${
              String(row.client || "").length > 24 ? "…" : ""
            }</td>
            <td>${row.deviceType || "—"}</td>
            <td>${row.department || "Peak 社区"}</td>
            <td>${row.host || "—"}</td>
            <td>${row.location || "未知"}</td>
            <td>${row.os || "—"}</td>
            <td>${row.browser || "—"}</td>
            <td>${row.loginAt || "—"}</td>
            <td class="ops">
              <button type="button" class="danger" data-del-online="${row.id}">删除</button>
            </td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="12" class="muted">暂无在线用户</td></tr>`;

  tbody.querySelectorAll("[data-del-online]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("确认删除该会话记录？")) return;
      await api(`/api/online/${btn.dataset.delOnline}`, { method: "DELETE" });
      loadOnline();
    });
  });
}

document.getElementById("onlineFilterForm").addEventListener("submit", (e) => {
  e.preventDefault();
  loadOnline();
});
document.getElementById("onlineResetBtn").addEventListener("click", () => {
  document.getElementById("onlineHost").value = "";
  document.getElementById("onlineName").value = "";
  loadOnline();
});
document.getElementById("refreshOnlineBtn").addEventListener("click", () => loadOnline());

/* ---------- DLC 管理 ---------- */
const DLC_SECTIONS = [
  { type: 1, title: "地图 DLC" },
  { type: 2, title: "货物包 DLC" },
  { type: 3, title: "挂车包 DLC" },
];

function formatDlcPrice(cents) {
  if (cents === undefined || cents === null || cents === "") return "";
  const n = Number(cents);
  if (!Number.isFinite(n)) return "";
  return `¥${(n / 100).toFixed(2)}`;
}

function inferDlcType(item) {
  const t = Number(item?.type);
  if (t === 1 || t === 2 || t === 3) return t;
  const n = `${item?.nameZh || ""} ${item?.nameEn || item?.name || ""}`;
  if (/挂车包|Trailer Pack/i.test(n)) return 3;
  if (/货物|Cargo Pack|Machinery|Forest Machinery/i.test(n)) return 2;
  return 1;
}

function renderDlcCard(item) {
  const title = item.nameZh || item.name || "未命名 DLC";
  const en = item.nameEn && item.nameEn !== title ? item.nameEn : "";
  return `<article class="dlc-card">
    <div class="dlc-card__media">
      ${
        item.imageUrl
          ? `<img src="${item.imageUrl}" alt="${title}" loading="lazy" />`
          : `<div class="dlc-card__placeholder">无封面</div>`
      }
    </div>
    <div class="dlc-card__body">
      <h3>${title}</h3>
      ${en ? `<p class="dlc-card__en">${en}</p>` : ""}
      <p>${item.desc || "暂无简介"}</p>
      <div class="dlc-card__meta">
        <span>AppID ${item.appId || "—"}</span>
        <span>${formatDlcPrice(item.finalPrice) || "—"}</span>
      </div>
    </div>
  </article>`;
}

async function loadDlc({ syncImages = false } = {}) {
  const root = document.getElementById("dlcSections");
  const err = document.getElementById("dlcError");
  err.hidden = true;
  root.innerHTML = `<p class="muted">${
    syncImages ? "正在校验并更新封面缓存…" : "正在加载 DLC…"
  }</p>`;
  try {
    const q = syncImages ? "/api/dlc?type=all&syncImages=1" : "/api/dlc?type=all";
    const data = await api(q);
    const items = data.items || [];
    if (!items.length) {
      root.innerHTML = `<p class="muted">暂无 DLC 数据</p>`;
      return;
    }

    const grouped = { 1: [], 2: [], 3: [], other: [] };
    for (const item of items) {
      const t = inferDlcType(item);
      if (grouped[t]) grouped[t].push(item);
      else grouped.other.push(item);
    }

    const sectionsHtml = DLC_SECTIONS.map(({ type, title }) => {
      const list = grouped[type] || [];
      if (!list.length) return "";
      return `<section class="dlc-section">
        <div class="dlc-section__head">
          <h3 class="dlc-section__title">${title}</h3>
          <span class="dlc-section__count">${list.length}</span>
        </div>
        <div class="dlc-grid">${list.map(renderDlcCard).join("")}</div>
      </section>`;
    }).join("");

    const otherHtml = grouped.other.length
      ? `<section class="dlc-section">
          <div class="dlc-section__head">
            <h3 class="dlc-section__title">其他 DLC</h3>
            <span class="dlc-section__count">${grouped.other.length}</span>
          </div>
          <div class="dlc-grid">${grouped.other.map(renderDlcCard).join("")}</div>
        </section>`
      : "";

    root.innerHTML = sectionsHtml + otherHtml || `<p class="muted">暂无 DLC 数据</p>`;

    if (syncImages) {
      const cachedCount = items.filter((i) => i.imageCached).length;
      console.info(`[DLC] 封面缓存 ${cachedCount}/${items.length}`);
    }
  } catch (e) {
    root.innerHTML = "";
    err.textContent = e.message || "加载 DLC 失败";
    err.hidden = false;
  }
}

document.getElementById("refreshDlcBtn").addEventListener("click", () =>
  loadDlc({ syncImages: true })
);

/* ---------- 弹窗提交 ---------- */
function closeModal() {
  modal.close();
}
document.getElementById("modalCancel").addEventListener("click", closeModal);
document.getElementById("modalClose").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

modalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  modalError.hidden = true;
  const fd = new FormData(modalForm);
  const body = Object.fromEntries(fd.entries());
  if (modalMode === "member-add" || modalMode === "member-edit") {
    body.isAdmin = fd.get("isAdmin") === "1";
    if (modalMode === "member-add") {
      if (!String(body.password || "").trim()) body.password = "123456";
    } else if (!body.password) {
      delete body.password;
    }
  }

  const submitBtn = document.getElementById("modalSubmit");
  const prevBtnText = submitBtn ? submitBtn.textContent : "";
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent =
      pendingActivityArchive && (modalMode === "activity-add" || modalMode === "activity-edit")
        ? "上传 OSS 中…"
        : "保存中…";
  }

  try {
    if (modalMode === "member-add") {
      await api("/api/members", { method: "POST", body: JSON.stringify(body) });
      loadMembers();
      showToast("成员已保存");
    } else if (modalMode === "member-edit") {
      await api(`/api/members/${editingId}`, { method: "PUT", body: JSON.stringify(body) });
      loadMembers();
      showToast("成员已保存");
    } else if (modalMode === "activity-add") {
      const activityBody = collectActivityBody(fd);
      if (!activityBody.name) throw new Error("请输入活动名称");
      if (!activityBody.activityDate) throw new Error("请选择活动日期");
      if (!activityBody.location) throw new Error("请选择服务器");
      if (submitBtn) submitBtn.textContent = "保存活动中…";
      const created = await api("/api/activities", {
        method: "POST",
        body: JSON.stringify(activityBody),
      });
      let uploadedOk = false;
      if (pendingActivityArchive && created.item?.id) {
        if (submitBtn) submitBtn.textContent = "上传 OSS 中…";
        await uploadActivityArchive(created.item.id, pendingActivityArchive);
        uploadedOk = true;
      }
      pendingActivityArchive = null;
      loadActivities();
      showToast(uploadedOk ? "活动已保存，存档已成功上传到 OSS" : "活动已保存");
    } else if (modalMode === "activity-edit") {
      const activityBody = collectActivityBody(fd);
      if (!activityBody.name) throw new Error("请输入活动名称");
      if (!activityBody.activityDate) throw new Error("请选择活动日期");
      if (!activityBody.location) throw new Error("请选择服务器");
      if (submitBtn) submitBtn.textContent = "保存活动中…";
      await api(`/api/activities/${editingId}`, {
        method: "PUT",
        body: JSON.stringify(activityBody),
      });
      let uploadedOk = false;
      if (pendingActivityArchive) {
        if (submitBtn) submitBtn.textContent = "上传 OSS 中…";
        await uploadActivityArchive(editingId, pendingActivityArchive);
        uploadedOk = true;
      }
      pendingActivityArchive = null;
      loadActivities();
      showToast(uploadedOk ? "活动已保存，存档已成功上传到 OSS" : "活动已保存");
    } else if (modalMode === "store-add") {
      await api("/api/store", { method: "POST", body: JSON.stringify(body) });
      loadStore();
      showToast("商品已保存");
    } else if (modalMode === "store-edit") {
      await api(`/api/store/${editingId}`, { method: "PUT", body: JSON.stringify(body) });
      loadStore();
      showToast("商品已保存");
    }
    modal.close();
  } catch (err) {
    modalError.textContent = err.message || "保存失败";
    modalError.hidden = false;
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = prevBtnText || "确定";
    }
  }
});

async function boot() {
  const me = await api("/api/me");
  const user = me.user || {};
  const displayName = user.name || user.username || "管理员";
  document.getElementById("userName").textContent = displayName;
  const roleText = user.isSuper || user.role === "super" ? "超级管理员" : "管理员";
  document.getElementById("userMeta").textContent = `@${user.username || "—"} · ${roleText}`;
  document.getElementById("avatar").textContent = String(displayName).slice(0, 1).toUpperCase();

  const userMenus = menusFromUser(user);
  paintMenus(userMenus, { activate: false });

  try {
    const dash = await api("/api/dashboard");
    const menus = dash.menus && dash.menus.length ? dash.menus : userMenus;
    renderMenus(menus);
    document.getElementById("statMembers").textContent = dash.stats?.members ?? "—";
    document.getElementById("statActivities").textContent = dash.stats?.activities ?? "—";
    document.getElementById("statProducts").textContent = dash.stats?.products ?? "—";
    bindHomeStatCards(collectMenuViewIds(menus));
  } catch (err) {
    renderMenus(userMenus);
    bindHomeStatCards(collectMenuViewIds(userMenus));
    console.error(err);
  }
  prefetchActivityServers();
  startAdminIdleWatch();
}

document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } catch (_) {}
  try {
    sessionStorage.removeItem("peak.adminToken");
  } catch (_) {}
  notifyExeLogout("已退出登录");
  if (window.parent && window.parent !== window) return;
  location.replace("/login.html");
});

document.getElementById("toggleBtn").addEventListener("click", () => {
  if (window.matchMedia("(max-width: 860px)").matches) {
    shell.classList.toggle("is-open");
  } else {
    shell.classList.toggle("is-collapsed");
  }
});

document.getElementById("shellBackdrop")?.addEventListener("click", () => {
  shell.classList.remove("is-open");
});

window.matchMedia("(max-width: 860px)").addEventListener("change", (e) => {
  if (!e.matches) shell.classList.remove("is-open");
});

async function loadUserSettings() {
  const err = document.getElementById("accountPasswordError");
  const ok = document.getElementById("accountPasswordOk");
  if (err) err.hidden = true;
  if (ok) ok.hidden = true;
  try {
    const me = await api("/api/me");
    const user = me.user || {};
    document.getElementById("accountTmpId").textContent = user.tmpId || user.username || "—";
    document.getElementById("accountName").textContent = user.name || "—";
    document.getElementById("accountRole").textContent = user.isSuper
      ? "超级管理员"
      : user.role === "super"
        ? "超级管理员"
        : "管理员";
  } catch (e) {
    document.getElementById("accountTmpId").textContent = "—";
    document.getElementById("accountName").textContent = "—";
    document.getElementById("accountRole").textContent = "—";
  }
}

document.getElementById("accountPasswordForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("accountPasswordError");
  const ok = document.getElementById("accountPasswordOk");
  const btn = document.getElementById("accountPasswordSubmit");
  err.hidden = true;
  ok.hidden = true;
  const oldPassword = document.getElementById("accountOldPassword").value;
  const newPassword = document.getElementById("accountNewPassword").value;
  const confirmPassword = document.getElementById("accountConfirmPassword").value;
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "保存中…";
  try {
    await api("/api/me/password", {
      method: "PUT",
      body: JSON.stringify({ oldPassword, newPassword, confirmPassword }),
    });
    document.getElementById("accountOldPassword").value = "";
    document.getElementById("accountNewPassword").value = "";
    document.getElementById("accountConfirmPassword").value = "";
    ok.hidden = false;
  } catch (ex) {
    err.textContent = ex.message || "修改失败";
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
});

async function loadCustomUserSettings() {
  const err = document.getElementById("customAccountError");
  const ok = document.getElementById("customAccountOk");
  if (err) err.hidden = true;
  if (ok) ok.hidden = true;
  const tbody = document.getElementById("customAccountTable");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="muted">加载中…</td></tr>`;
  try {
    const data = await api("/api/members");
    const items = (data.items || []).filter((m) => String(m.role || "") === "自定义账号");
    tbody.innerHTML = items.length
      ? items
          .map(
            (m) => `<tr>
              <td>${m.number ?? "—"}</td>
              <td>${m.tmpId || "—"}</td>
              <td>${m.name || "—"}</td>
              <td>${m.qq || "—"}</td>
              <td>${m.isAdmin ? "是" : "否"}</td>
              <td class="ops">
                <button type="button" class="danger" data-del-custom="${m.id}">删除</button>
              </td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="6" class="muted">暂无自定义账号</td></tr>`;

    tbody.querySelectorAll("[data-del-custom]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("确认删除该自定义账号？")) return;
        await api(`/api/members/${btn.dataset.delCustom}`, { method: "DELETE" });
        loadCustomUserSettings();
      });
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">${e.message || "加载失败"}</td></tr>`;
  }
}

function normalizeCustomLogin(raw) {
  return String(raw || "").trim();
}

function validateCustomLogin(login) {
  if (!login) return "请填写登录账号";
  if (login.length < 2 || login.length > 64) return "登录账号长度需为 2–64 位";
  if (login.toLowerCase() === "admin") return "admin 为系统超级管理员账号，不可新增";
  // 允许字母数字下划线中横线与常见中文，不要求是 TMP 数字 ID
  if (!/^[\w\u4e00-\u9fff.@-]+$/i.test(login)) {
    return "登录账号仅支持字母、数字、下划线、中文等，勿含空格";
  }
  return "";
}

document.getElementById("customAccountForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("customAccountError");
  const ok = document.getElementById("customAccountOk");
  const btn = document.getElementById("customAccountSubmit");
  err.hidden = true;
  ok.hidden = true;
  const login = normalizeCustomLogin(document.getElementById("customLogin").value);
  const name = document.getElementById("customName").value.trim();
  const password = document.getElementById("customPassword").value;
  const qq = document.getElementById("customQq").value.trim();
  const isAdmin = document.getElementById("customIsAdmin").checked;
  const loginErr = validateCustomLogin(login);
  if (loginErr) {
    err.textContent = loginErr;
    err.hidden = false;
    return;
  }
  if (!name || !password) {
    err.textContent = "请填写昵称和密码";
    err.hidden = false;
    return;
  }
  if (password.length < 4) {
    err.textContent = "密码至少 4 位";
    err.hidden = false;
    return;
  }
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "创建中…";
  try {
    const members = await api("/api/members");
    const nextNumber =
      (members.items || []).reduce((max, m) => Math.max(max, Number(m.number) || 0), 0) + 1;
    await api("/api/members", {
      method: "POST",
      body: JSON.stringify({
        number: nextNumber,
        tmpId: login,
        name,
        password,
        qq,
        role: "自定义账号",
        score: 0,
        isAdmin: isAdmin ? 1 : 0,
      }),
    });
    document.getElementById("customLogin").value = "";
    document.getElementById("customName").value = "";
    document.getElementById("customPassword").value = "";
    document.getElementById("customQq").value = "";
    document.getElementById("customIsAdmin").checked = true;
    ok.hidden = false;
    loadCustomUserSettings();
  } catch (ex) {
    const msg = String(ex.message || "创建失败");
    err.textContent = msg.includes("TMP ID") ? msg.replace(/TMP ID/g, "登录账号") : msg;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
});

async function loadPermissions() {
  const box = document.getElementById("permList");
  const empty = document.getElementById("permEmpty");
  try {
    const data = await api("/api/permissions");
    const defs = data.defs || [];
    const admins = data.admins || [];
    empty.hidden = admins.length > 0;
    box.innerHTML = admins
      .map((admin) => {
        const checks = defs
          .map((def) => {
            const on = admin.permissions?.[def.key] !== false;
            return `<label class="perm-item" title="${def.desc}">
              <input type="checkbox" data-perm="${def.key}" ${on ? "checked" : ""} />
              <strong>${def.label}</strong>
              <span class="perm-desc">${def.desc}</span>
            </label>`;
          })
          .join("");
        return `<article class="perm-card" data-admin-id="${admin.id}">
          <div class="perm-card__top">
            <div class="perm-card__head">
              <h4>${admin.name || admin.tmpId}</h4>
              <p class="perm-card__meta">UID编号 ${admin.number} · TMP ID ${admin.tmpId} · ${admin.role || "管理员"}</p>
            </div>
            <div class="perm-card__actions">
              <button type="button" class="btn-sm" data-save-perm="${admin.id}">保存权限</button>
            </div>
          </div>
          <div class="perm-grid">${checks}</div>
        </article>`;
      })
      .join("");

    box.querySelectorAll("[data-save-perm]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.savePerm;
        const card = box.querySelector(`[data-admin-id="${id}"]`);
        const permissions = {};
        card.querySelectorAll("[data-perm]").forEach((input) => {
          permissions[input.dataset.perm] = input.checked;
        });
        const prev = btn.textContent;
        btn.disabled = true;
        btn.textContent = "保存中…";
        try {
          await api(`/api/permissions/${id}`, {
            method: "PUT",
            body: JSON.stringify({ permissions }),
          });
          btn.textContent = "已保存";
          setTimeout(() => {
            btn.textContent = prev;
            btn.disabled = false;
          }, 900);
        } catch (err) {
          alert(err.message || "保存失败");
          btn.textContent = prev;
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    empty.hidden = false;
    empty.textContent = err.message || "读取权限失败";
    box.innerHTML = "";
  }
}

boot().catch(console.error);
