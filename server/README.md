# Peak 车队管理平台（Peak_web_tool）

Express + MySQL 的车队后台：左侧导航 + 右侧内容，带 Session 登录。  
成员账号、活动、签到、商城等业务数据落在 MySQL `peak` 库；活动存档优先存阿里云 OSS（未配置则本地/宝塔磁盘）；地图在线与 DLC 数据来自 EVM API。

关联项目：

| 项目 | 作用 |
|------|------|
| 本仓库 `Peak_web_tool` | 网站后台 + 开放 API + 接档器 API |
| `Peak_app_Tool` | WinForms 接档器客户端（调用 `/api/client/*`） |
| `astrbot_plugin_tmp_bot` | 机器人插件（调用 `/api/open/*`，Token 与 `BOT_API_TOKEN` 一致） |

---

## 功能概览

- **后台管理**（仅管理员 / 超级管理员）：成员、积分、活动、签到、商城、DLC、在线会话、权限设置
- **自动打卡**：活动配置打卡多边形后，服务端约每 30 秒拉取地图在线坐标，命中则写签到并加积分
- **活动存档**：优先上传阿里云 OSS（`activities/activity_{id}/`）；未配置 OSS 时落本地目录；活动结束后自动清理
- **接档器 API**：任意在队成员可用 TMP ID + 密码登录，下载存档、查看商店并兑换
- **机器人开放 API**：只读，Token 鉴权，供 AstrBot 等调用

---

## 目录结构（源码备注）

```
Peak_web_tool/
├── server.js              # 入口：路由、Session、后台 API、定时任务
├── db.js                  # 成员表 tmp_members、登录鉴权、权限
├── bizDb.js               # 活动/签到/商品/兑换 MySQL 持久化
├── activityFiles.js       # 本地活动存档目录读写
├── ossStorage.js          # 阿里云 OSS（上传 / 列表 / 删除 / 签名 URL）
├── activityStorage.js     # 存档门面：有 OSS 用 OSS，否则本地
├── checkinAuto.js         # 地图坐标 → 多边形命中 → 自动签到
├── clientApi.js           # 接档器 API（/api/client/*）
├── openApi.js             # 机器人开放 API（/api/open/*）
├── evmApi.js              # EVM 数据源封装（玩家/服务器/DLC）
├── dlcNames.js / dlcExtra.js / dlcImageCache.js  # DLC 名称与封面缓存
├── sessionInfo.js         # 后台登录会话信息（在线用户）
├── polyfill.js            # Node 16 兼容 fetch / AbortSignal.timeout
├── ecosystem.config.js    # PM2 生产启动配置
├── package.json
├── .env                   # 本地配置（勿提交；见下方）
├── sql/
│   ├── init_tmp_members.sql
│   └── init_biz_tables.sql
├── scripts/debug-local.js # 调试开放 API
├── public/                # 前端静态页（login / app）
├── data/                  # 本地 JSON（积分流水、在线会话、DLC 缓存元数据等；业务表空时作一次性导入种子）
└── uploads/
    ├── activities/        # 活动存档（可用 UPLOAD_ROOT 覆盖）
    └── dlc/               # DLC 封面本地缓存
```

### 模块说明（注释级）

| 文件 | 职责 |
|------|------|
| `server.js` | `dotenv` 使用 `override: true`，避免 PM2 残留环境变量盖住 `.env`；注册后台 REST、静态资源、启动时连库并挂定时清理/自动打卡 |
| `db.js` | 连接池；密码 `scrypt(salt:hash)`；`is_super` 超级管理员不在成员列表显示；`permissions` JSON 控制菜单 |
| `bizDb.js` | 前端仍用 camelCase；表空时从 `data/*.json` **导入一次** |
| `activityFiles.js` | 默认根目录 `uploads/activities`；`UPLOAD_ROOT` 可指向宝塔绝对路径 |
| `ossStorage.js` | 读 `OSS_*` 环境变量；Bucket 私有时用 `signatureUrl` 给接档器直连下载 |
| `activityStorage.js` | 上传先落本地再转 OSS（成功后删暂存）；列表项带 `downloadUrl` |
| `checkinAuto.js` | ETS / ProMods 坐标换算与 Leaflet CRS.Simple 一致；草稿活动不打卡 |
| `clientApi.js` | Token 内存 Map，约 8 小时过期；Header `X-Client-Token` 或 `Authorization: Bearer` |
| `openApi.js` | Header `X-Api-Token` / `Authorization: Bearer` / Query `token`；日期按 `Asia/Shanghai` |
| `evmApi.js` | 基址 `EVM_API_BASE`，默认 `https://api.pzvtcm.online` |
| `dlcImageCache.js` | 封面落盘 `uploads/dlc`，对外前缀 `/media/dlc` |

---

## 环境要求

- Node.js 16+（建议 18/20）
- MySQL 5.7+ / 8.x（utf8mb4）
- 可选：PM2（宝塔「PM2 管理器」）

---

## 快速启动

```bash
cd Peak_web_tool
cp .env.example .env   # 若无示例文件，按下方自行新建 .env
npm install
npm run build:web      # 构建 Vue 后台（admin-web → admin-web/dist）
npm run dev            # 开发：node --watch server.js
# 或
npm start              # 生产：node server.js
```

浏览器打开：http://localhost:3000/login  

后台为 **Vue3 + Element Plus**（仿 vue-admin-better 布局），源码在 `admin-web/`。  
旧 `/login.html`、`/app.html` 会重定向到 SPA。

本地前后端分离调试：

```bash
npm run dev            # API :3000
npm run dev:web        # Vite :5173（已代理 /api）
```

### npm 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 监听文件变更自动重启 |
| `npm start` | 普通启动 |
| `npm run build:web` | 构建 Vue 管理后台 |
| `npm run dev:web` | Vite 开发服务器（代理到 :3000） |
| `npm run debug:api` | 探测 `/api/open/*`（需先启动服务，且配置了 `BOT_API_TOKEN`） |

### PM2（宝塔）

```bash
cd /www/wwwroot/你的站点目录   # 以实际路径为准
pm2 start ecosystem.config.js
pm2 save
```

进程名：`peak`。改 `.env` 后需 `pm2 restart peak`，并确认未用旧环境变量覆盖密码（`server.js` 已 `override: true`）。

---

## 环境变量（`.env`）

```env
PORT=3000
SESSION_SECRET=请改成随机长字符串

# EVM 数据 API（玩家/地图在线/DLC/服务器）
EVM_API_BASE=https://api.pzvtcm.online

# MySQL（peak 库）
# 本机开发连远程：宝塔需给 peak 用户开放你的公网 IP（或临时 %）
# 与数据库同机部署：DB_HOST=127.0.0.1
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=peak
DB_PASSWORD=你的密码
DB_NAME=peak

# 活动存档根目录（空 = 项目下 uploads/activities）
# 宝塔示例：UPLOAD_ROOT=/www/wwwroot/peak/uploads/activities
# 启用 OSS 后仅作上传暂存，成功写入 OSS 后会删除本地文件
UPLOAD_ROOT=
UPLOAD_MAX_MB=50

# 阿里云 OSS（填齐 AccessKey + Bucket + Region 后启用；留空则继续本地磁盘）
# 控制台创建 RAM 用户 AccessKey，只授本 Bucket 权限；勿提交仓库
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
OSS_BUCKET=peak-tmp
OSS_REGION=oss-cn-shanghai
OSS_PREFIX=activities
OSS_SIGN_EXPIRES=1800

# 机器人开放 API（与 AstrBot 插件同名配置）
BOT_API_TOKEN=请改成强随机串

# 可选：开放 API 调试时 DB 失败则读 data/debug-members.json
# DEBUG_MOCK_MEMBERS=1
# DEBUG_BASE=http://127.0.0.1:3000
```

**备注：**

- `.env` 已在 `.gitignore`，不要提交仓库
- 更新站点时：只覆盖代码与 `public/`，**不要覆盖** `uploads/`、`.env`
- 业务主数据在 MySQL，不再依赖长期维护 `data/*.json`（JSON 仅作种子/流水/缓存元数据）

---

## 数据库

### 初始化

启动时自动：

1. `CREATE TABLE IF NOT EXISTS` 成员表与业务表（缺列会 `ALTER` 补齐）
2. 若无超级管理员：创建 `admin` / `admin123`（`is_super=1`，不出现在成员列表）
3. 业务表为空时，从 `data/activities.json`、`checkins.json`、`store.json`、`redeems.json` 导入一次

也可在宝塔 phpMyAdmin 手动执行：

- `sql/init_tmp_members.sql`
- `sql/init_biz_tables.sql`

### 表一览

| 表 | 内容 |
|----|------|
| `tmp_members` | 成员：UID编号、TMP ID、密码、积分、是否管理员、权限等 |
| `peak_activities` | 活动（含 DLC、打卡配置 JSON） |
| `peak_checkins` | 签到记录（同活动+成员唯一） |
| `peak_store_products` | 商城商品 |
| `peak_redeems` | 兑换记录（`ship_status`: pending / shipped） |

### 成员字段（后台新增/编辑）

| 字段 | 库列 | 说明 |
|------|------|------|
| UID编号 | `number` | 车队编号 |
| TMP ID | `tmp_id` | 登录账号（唯一） |
| 姓名 | `name` | 显示名 |
| 密码 | `password` | 加密存储；空则接档器无法登录 |
| QQ | `qq` | 可选 |
| 职务 | `role` | 如司机 |
| 积分 | `score` | 与积分流水联动 |
| 入队/退队 | `join_date` / `leave_date` | 退队后接档器不可登 |
| 是否管理员 | `is_admin` | 仅管理员可进后台 |
| 超级管理员 | `is_super` | 全权限；列表隐藏 |
| 权限 | `permissions` | JSON，见下方权限键 |

### 权限键（`PERMISSION_DEFS`）

`members` / `points` / `activities` / `store` / `dlc` / `monitor` / `settings`

超级管理员忽略权限位，菜单全开。

### 远程访问（本机连宝塔被拒时）

报错形如 `Host 'x.x.x.x' is not allowed`：

1. 宝塔 → 数据库 → `peak` → 权限 / 访问主机  
2. 添加本机公网 IP，或临时 `%`  
3. 云安全组 / 防火墙放行 `3306`  
4. 同机部署请用 `DB_HOST=127.0.0.1`，不必开远程

---

## 登录说明

| 入口 | 账号 | 条件 |
|------|------|------|
| 后台网页 | TMP ID + 密码 | `is_admin` 或 `is_super` |
| 接档器 | TMP ID + 密码 | 在队、已设密码（含普通司机） |
| 开放 API | `BOT_API_TOKEN` | 只读 |

默认超级管理员（仅库空时自动创建）：**admin** / **admin123** —— 上线后请立刻改密。

Session Cookie：`tmptools.sid`，约 8 小时。

---

## 后台菜单

- 首页（仪表盘）
- 车队管理：成员管理、积分管理
- 活动管理：设置活动、签到记录
- 商城管理：商品管理、兑换记录
- 游戏内容：DLC 管理
- 系统监控：在线用户
- 设置：管理员权限（需 settings 权限或超管）

---

## 活动文件存储

### 本地（未配置 OSS）

- 目录规则：`{UPLOAD_ROOT 或 uploads/activities}/activity_{id}/`
- 单文件大小上限：`UPLOAD_MAX_MB`（默认 50）
- 活动状态变为 **已结束** 后：打开活动列表或每 **5 分钟** 定时清理对应文件夹
- 后台与接档器均可列目录 / 下载；上传、删除仅后台

### 阿里云 OSS（推荐）

1. Bucket 示例：`peak-tmp`，地域 `oss-cn-shanghai`（华东2 上海）
2. 建议：**私有读写** + **阻止公共访问**
3. 在 `.env` 填入 `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` / `OSS_BUCKET` / `OSS_REGION`
4. 重启服务后启动日志应出现：`活动文件存储: oss://peak-tmp/activities @ oss-cn-shanghai`
5. 对象路径：`activities/activity_{id}/文件名.zip`
6. 接档器拉文件列表时拿到 `downloadUrl`（签名 URL，默认约 30 分钟有效），直连 OSS 下载，不经网站带宽

未填齐 OSS 变量时自动回退本地磁盘，无需改代码。

---

## 自动打卡（用法备注）

1. 活动 `publishStatus` 非 `draft`
2. 当前时间在活动起止内，且命中某条签到配置的时间（定点或时段）
3. 配置了有效多边形（≥3 点）
4. 成员 TMP ID 出现在 EVM fullmap 在线数据中，且坐标落入多边形

命中后写入 `peak_checkins`（`source` 为自动），并增加成员积分。  
也可在后台手动触发扫描接口 `/api/checkins/scan`。

定时：启动约 8 秒后首次扫描，之后每 30 秒一次。

---

## API 一览

### 后台（需 Session 登录）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/login` | `{ username, password }` → Session |
| POST | `/api/logout` | 退出 |
| GET | `/api/me` | 当前用户 |
| GET | `/api/dashboard` | 菜单 + 统计 |
| GET/PUT | `/api/permissions`、`/api/permissions/:id` | 管理员权限 |
| CRUD | `/api/members`、退队 `/leave` | 成员 |
| GET/POST | `/api/points` | 积分流水与加减分 |
| GET | `/api/tmp-player/:tmpId` | 查 EVM 玩家信息 |
| GET | `/api/map/config`、`/api/servers` | 地图 / 服务器列表 |
| CRUD | `/api/activities` | 活动 |
| GET/POST/DELETE | `/api/checkins`、`POST /api/checkins/scan` | 签到 |
| GET/POST/DELETE | `/api/activities/:id/files`… | 活动存档 |
| GET | `/api/dlc` | DLC 列表与封面缓存 |
| CRUD | `/api/store`、`/api/redeems` | 商品与兑换（发货 PUT `.../ship`） |
| GET/DELETE | `/api/online` | 后台在线会话（存 `data/online.json`） |

### 接档器（`clientApi.js`）

桌面客户端见 `Peak_app_Tool`。鉴权 Header：`X-Client-Token`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/client/ping` | 连通测试（无需登录） |
| POST | `/api/client/login` | `{ tmpId, password }` → `token` |
| POST | `/api/client/logout` | 注销 token |
| GET | `/api/client/me` | 当前成员 |
| GET | `/api/client/activities` | 活动列表 |
| GET | `/api/client/activities/:id/files` | 存档列表 |
| GET | `/api/client/activities/:id/files/:name` | 下载存档 |
| GET | `/api/client/store` | 上架商品 |
| POST | `/api/client/store/redeem` 或 `/api/client/redeem` | 积分兑换 |
| GET | `/api/client/redeems` | 本人兑换记录 |
| GET | `/api/client/members` | 在队成员列表 |
| GET | `/api/client/checkins` | 打卡记录（`activityId` / `mine=1`） |
| GET | `/api/client/map-dlcs` | DLC 目录（部署用） |

### 机器人开放 API（`openApi.js`）

鉴权：`X-Api-Token`（或 Bearer / `?token=`），值 = `BOT_API_TOKEN`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/open/health` | 健康检查 |
| GET | `/api/open/activities` | 活动；`status=all\|ongoing\|upcoming\|done`；`today=1` 仅今天 |
| GET | `/api/open/members` | 在队成员（供机器人自行匹配在线） |
| GET | `/api/open/fleet-online` | 成员 TMP ID 与 fullmap 匹配；地图不可用时 `needClientMatch=true` |
| GET | `/api/open/checkins` | 签到；`activityId`、`limit` |

本地探测：

```bash
npm run dev          # 终端 1
npm run debug:api    # 终端 2
```

---

## 部署检查清单

1. 上传代码，保留服务器上的 `.env` 与 `uploads/`
2. `npm install --production`（或含完整依赖）
3. 确认 MySQL 账号、库名、本机/远程主机权限
4. 设置 `SESSION_SECRET`、`BOT_API_TOKEN`、`UPLOAD_ROOT`（若存档不在项目内）
5. `pm2 start ecosystem.config.js` 或宝塔 Node 项目指向 `server.js`
6. 反向代理把域名转到 `PORT`（默认 3000）
7. 用 admin 登录后台改密，再建正式管理员成员
8. 接档器 / 机器人分别配置网站地址与 Token

---

## 常见问题

**登录提示「登录服务异常，请检查数据库连接」**  
看控制台 `DB config:` 与 `MySQL 初始化失败`；核对 `.env` 与宝塔远程主机权限。

**仅管理员可登录后台**  
成员需勾选管理员；普通司机只能用接档器。

**接档器提示未设密码 / 已退队**  
后台给成员设置密码；退队（有 `leave_date`）不可登。

**开放 API 503「未配置 BOT_API_TOKEN」**  
写入 `.env` 后重启进程。

**活动结束后存档还在**  
等最多约 5 分钟定时清理，或打开一次活动列表触发清理。

**DLC 封面不显示**  
确认 `uploads/dlc` 可写，静态路径 `/media/dlc/...` 可访问。

---

## 安全备注

- 生产务必修改默认 `admin` 密码与 `SESSION_SECRET`、`BOT_API_TOKEN`
- 不要把数据库密码打进客户端；接档器只调网站 API
- 开放 API 为只读，仍需保护 Token，勿提交到公开仓库
- 更新文件时勿用整目录覆盖把 `uploads` / `.env` 冲掉
