# Peak 车队中心

版本 **V4.0.2**。成员用 Windows 桌面程序登录、接档、看在线和用欧卡工具箱；管理员在同一程序里管成员、积分、活动和商城。

业务数据在服务器 MySQL。发给成员的安装包只访问网站接口，程序里没有数据库密码。`.env` 只放在运行接口的机器上，由 `server/api.mjs` 读取。活动存档优先放阿里云 OSS，未配置时落在服务器磁盘。

| 部分 | 作用 |
| --- | --- |
| `server/` | 车队接口。宝塔或本机用 Node 启动，桌面端调用 `/api/*` |
| 仓库根目录 | Tauri 桌面端。打包后的安装包、解压包、调试包在 `发布/` |

桌面端默认连 `http://df.peakvtc.cn`。换了域名后，在客户端「平台设置」里改车队中心地址。

---

## 目录结构

```
ets2-vtc-manage/
├── server/
│   ├── api.mjs            # 接口入口
│   ├── schema.sql         # 建库、建表、初始管理员
│   ├── .env.example       # 环境变量示例，复制为 .env
│   ├── package.json
│   └── uploads/           # 未配置 OSS 时的活动存档（勿提交、更新时勿覆盖）
├── src/                   # 桌面端界面
│   ├── kernel/            # 会话、权限、接口请求、本机调用
│   ├── shell/             # 登录页、主框架
│   └── modules/           # 功能模块，每个目录自带 module.ts 和 Page.vue
├── src-tauri/             # 窗口、托盘、本机欧卡能力
├── scripts/pack.mjs       # 打安装包、解压包、调试包
├── 打包.bat               # 双击打包
└── 发布/                  # 打包产物
```

---

## 环境要求

接口：

- Node.js 18+
- MySQL 5.7+ / 8.x（utf8mb4）
- 可选：PM2，或宝塔「Node 项目」

桌面端打包机：

- Node.js 18+
- Rust
- Windows WebView2

---

## 服务器部署

在服务器上只需要 `server/` 目录。

```bash
cd /www/wwwroot/你的站点目录/server
cp .env.example .env
# 按下一节改 .env，尤其是数据库密码和 DB_NAME
npm install --omit=dev
mysql -u root -p < schema.sql
```

前台试运行：

```bash
node api.mjs
```

看到 `车队中心接口已监听 …` 后，本机访问 `http://127.0.0.1:3000/api/client/ping`，应返回车队中心在线。

### PM2（宝塔）

```bash
cd /www/wwwroot/你的站点目录/server
pm2 start api.mjs --name peak-center
pm2 save
```

改 `.env` 后执行 `pm2 restart peak-center`。也可以在宝塔里把 Node 项目的启动文件指到 `server/api.mjs`。

接口启动时不会自动建表。库要先执行 `schema.sql`。

### 反向代理

宝塔站点反代到接口端口，默认 `3000`。和数据库同机、又走反代时，在 `.env` 写 `BIND=127.0.0.1`，不要把 3000 端口直接暴露到公网。

活动存档经接口上传时，请求体最大约 70MB。Nginx 需要允许至少这个体积，例如 `client_max_body_size 80m;`。单文件上限另由 `UPLOAD_MAX_MB` 控制，默认 50MB。

更新代码时只覆盖 `api.mjs` 和依赖，**不要覆盖** `server/.env` 和 `server/uploads/`。

---

## 环境变量（`server/.env`）

`.env.example` 里的 `SESSION_SECRET`、`EVM_API_BASE`、`BOT_API_TOKEN`、`PEAK_API_ONLY` 当前接口不读取，留着不影响启动。下面这些会生效。

```env
PORT=3000
# 宝塔反代时改为 127.0.0.1；需要本机以外直连时才用 0.0.0.0
BIND=127.0.0.1

# 库名必须是 schema.sql 创建的 fleet_center
# 与数据库同机：DB_HOST=127.0.0.1
# 本机开发连远程：宝塔给该用户开放你的公网 IP
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=fleet
DB_PASSWORD=你的密码
DB_NAME=fleet_center

# 活动存档目录。留空则用 server/uploads
# 宝塔示例：UPLOAD_ROOT=/www/wwwroot/peak/uploads
UPLOAD_ROOT=
UPLOAD_MAX_MB=50

# 在线会话里显示的客户端名称
CLIENT_NAME=车队中心

# 阿里云 OSS。四项都填写后，活动存档上传到 OSS；留空则用上面的本机目录
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
OSS_BUCKET=peak-tmp-v2
OSS_REGION=oss-cn-shanghai
# 对象路径为 activities/活动编号/文件名
OSS_PREFIX=activities
# 下载签名有效期，单位秒
OSS_SIGN_EXPIRES=1800
```

`.env` 已在 `server/.gitignore`，不要提交。

示例文件里的 `DB_NAME=peak` 与 `schema.sql` 不一致。执行这份建库脚本时，把 `DB_NAME` 写成 `fleet_center`。

---

## 数据库

在服务器上执行：

```bash
mysql -u root -p < schema.sql
```

脚本会：

1. 创建数据库 `fleet_center`（utf8mb4）
2. `CREATE TABLE IF NOT EXISTS` 建业务表
3. 若不存在 TMP ID 为 `admin` 的账号，插入超级管理员
4. 写入内置地图、客运和挂车 DLC

也可在宝塔 phpMyAdmin 里导入 `server/schema.sql`。

### 表

| 表 | 内容 |
| --- | --- |
| `center_members` | 成员：编号、TMP ID、密码、积分、管理员、权限 |
| `center_sessions` | 登录令牌。成员令牌和管理员令牌都在这里 |
| `center_activities` | 活动，含 DLC 勾选和打卡配置 |
| `center_activity_files` | 活动存档文件名和存放位置 |
| `center_checkins` | 签到记录 |
| `center_point_logs` | 积分增减 |
| `center_products` | 商城商品 |
| `center_redeems` | 兑换记录，`ship_status` 为 `pending` 或已发货 |
| `center_dlcs` | DLC。地图类的 `scs` 文件名供客户端部署时禁用 |

### 成员字段

| 字段 | 库列 | 说明 |
| --- | --- | --- |
| 编号 | `number` | 车队编号。超级管理员不占普通编号 |
| TMP ID | `tmp_id` | 登录账号，唯一 |
| 昵称 | `name` | 显示名 |
| 密码 | `password_hash` | `scrypt` 存储。空密码不能登录 |
| QQ | `qq` | 可选 |
| 职位 | `role` | 如司机 |
| 积分 | `score` | 与 `center_point_logs` 一起改 |
| 入队 / 退队 | `join_date` / `leave_date` | 有退队日期后不能登录 |
| 管理员 | `is_admin` | 才能使用管理菜单 |
| 超级管理员 | `is_super` | 拥有全部权限，成员列表里不显示 |
| 权限 | `permissions` | 见下方权限键 |

权限键：`members`、`points`、`activities`、`store`、`dlc`、`monitor`、`settings`。超级管理员忽略这些开关。

### 远程访问

本机连宝塔 MySQL 被拒绝、报错类似 `Host 'x.x.x.x' is not allowed` 时：

1. 宝塔 → 数据库 → 对应用户 → 权限 / 访问主机
2. 添加本机公网 IP，或临时 `%`
3. 云安全组放行 `3306`
4. 接口和数据库在同一台机器时用 `DB_HOST=127.0.0.1`，不必开放远程

---

## 登录

| 入口 | 账号 | 条件 |
| --- | --- | --- |
| 桌面端 | TMP ID + 密码 | 在队且已设置密码 |
| 管理功能 | 同一账号 | 另需管理员或超级管理员。登录成功后接口同时签发管理令牌 |

库首次导入后的超级管理员：**admin** / **ChangeMe123**。上线后立刻在「账号设置」里改掉，新密码至少 6 位。

成员请求头：`X-Client-Token`。管理请求头：`X-Admin-Token`。

---

## 活动存档

### 本地（未配齐 OSS）

- 目录：`{UPLOAD_ROOT 或 server/uploads}/{活动编号}/`
- 单文件上限：`UPLOAD_MAX_MB`，默认 50
- 列表给出站内路径 `/api/client/activities/{id}/files/{文件名}`，下载要带成员令牌

### 阿里云 OSS

四项都填写后启用：`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_BUCKET`、`OSS_REGION`。缺任意一项就继续用本地磁盘。

1. 桶建议私有读写
2. 对象路径：`activities/{活动编号}/{文件名}`
3. 重启后日志里会写明当前是 OSS 桶还是本机目录
4. 文件列表里的 `downloadUrl` 是签名地址，默认约 30 分钟有效，客户端直连 OSS 下载

删除活动或删除存档时，接口会同时删掉 OSS 对象或本地文件。

---

## 桌面客户端

开发：

```powershell
npm install
npm run dev          # 只开网页 http://localhost:1420，没有本机欧卡命令
npm run tauri dev    # 桌面程序，带托盘和本机能力
```

打包。产物在 `发布/`，也可以双击 `打包.bat`。

```powershell
npm run pack
```

| 产物 | 内容 |
| --- | --- |
| `Peak车队中心-4.0.2-安装包.exe` | NSIS 安装包 |
| `Peak车队中心-4.0.2-解压包.zip` | 免安装的正式程序 |
| `Peak车队中心-4.0.2-调试包.zip` | 带调试符号的程序 |

成员安装后用 TMP ID 登录。车队中心地址默认 `http://df.peakvtc.cn`，可在「平台设置」修改。本机欧卡目录、存档部署、改档和备份都在客户端完成，不经过数据库。

关闭窗口前，若活动存档还部署在本机，需要先到「存档部署」卸载。

---

## API 一览

连通检查不需要登录：`GET /api/client/ping`。地图瓦片配置：`GET /api/map/config`。

### 成员（`X-Client-Token`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/client/login` | `{ tmpId, password }`，返回 `token`；管理员还会带 `adminToken` |
| POST | `/api/client/logout` | 注销该成员的会话 |
| GET | `/api/client/me` | 当前成员 |
| PUT | `/api/client/password` | 修改密码，至少 6 位 |
| GET | `/api/client/activities` | 活动列表 |
| GET | `/api/client/activities/:id/files` | 存档列表 |
| GET | `/api/client/activities/:id/files/:name` | 下载存档 |
| GET | `/api/client/map-dlcs` | 部署时使用的地图 DLC |
| GET | `/api/client/members` | 在队成员 |
| GET | `/api/client/store` | 上架商品和自己的积分 |
| POST | `/api/client/store/redeem` | 兑换 |
| GET | `/api/client/redeems` | 自己的兑换记录 |

### 管理（`X-Admin-Token`）

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| POST | `/api/login` | 管理员登录，`{ username, password }` |
| GET / POST | `/api/members` | 成员。退队 `POST /api/members/:id/leave` |
| PUT / DELETE | `/api/members/:id` | 成员 |
| POST | `/api/members/sync-join-dates` | 成员。给没有入队日期的人补上创建日期 |
| GET / POST | `/api/points` | 积分 |
| GET / POST | `/api/activities` | 活动 |
| PUT / DELETE | `/api/activities/:id` | 活动 |
| GET / POST / DELETE | `/api/activities/:id/files` | 活动存档 |
| GET / POST / DELETE | `/api/checkins` | 活动。`POST /api/checkins/scan` 目前返回未接入 |
| GET / POST | `/api/store` | 商城 |
| PUT / DELETE | `/api/store/:id` | 商城 |
| GET | `/api/redeems` | 商城 |
| PUT | `/api/redeems/:id/ship` | 商城。标记发货或改回待发货 |
| DELETE | `/api/redeems/:id` | 商城 |
| GET | `/api/dlc` | DLC。`syncImages=1` 时同步 Steam 封面 |
| GET / DELETE | `/api/online`、`/api/online/:id` | 监控。删除即踢下线 |
| GET / PUT | `/api/permissions`、`/api/permissions/:id` | 设置 |

TruckersMP 服务器列表和玩家昵称由客户端另接外部接口，不经过这个服务。

---

## 部署检查清单

1. 上传 `server/`，保留服务器上已有的 `.env` 和 `uploads/`
2. `npm install --omit=dev`
3. 执行 `schema.sql`，确认库名是 `fleet_center`
4. `.env` 写上数据库账号，反代场景下 `BIND=127.0.0.1`
5. 需要 OSS 时填齐四项 OSS 变量
6. `pm2 start api.mjs --name peak-center`，或宝塔 Node 项目指向 `api.mjs`
7. 站点反代到 `PORT`，并放行活动压缩包的上传体积
8. 打开 `/api/client/ping`，再用 **admin** 登录桌面端并立刻改密
9. 把安装包发给成员。域名不是默认地址时，告知他们在「平台设置」里填写

---

## 常见问题

**`/api/client/ping` 失败，或日志里是数据库连接错误**  
核对 `DB_HOST`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`。`DB_NAME` 用 `fleet_center`。同机部署不要填公网地址。

**能打开接口，桌面端仍显示连接失败**  
看客户端「平台设置」里的车队中心地址是否指向反代域名，以及防火墙是否只放行了 80/443。

**登录提示已退队或未设置密码**  
退队成员不能登录。普通成员要在后台设至少 6 位密码。

**活动压缩包上传失败**  
看 `UPLOAD_MAX_MB`，以及 Nginx 的 `client_max_body_size` 是否小于接口允许的请求体。

**配了 OSS 仍写到本机目录**  
四项必须都有值。改完后重启进程，启动日志应出现 OSS 桶名，而不是本机目录。

**更新后登录或存档丢失**  
多半是覆盖了 `.env` 或 `uploads/`。从备份恢复这两处，不要用整目录覆盖。

---

## 安全备注

- 上线后修改默认管理员密码。不要把 `.env`、数据库密码和 OSS 密钥提交到仓库，也不要打进安装包
- 反代部署时接口只监听 `127.0.0.1`。MySQL 3306 不必对公网开放
- OSS 使用只具备该桶权限的 AccessKey，桶保持私有
- 更新时保留 `server/.env` 和 `server/uploads/`
