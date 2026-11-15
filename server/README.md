# Peak 车队网站

Express + MySQL。浏览器打开的页面，和桌面启动器加载的页面，都是这一套。页面文件在 `dist/`，由仓库根目录执行 `npm run build:web` 生成。

成员、活动、签到、商城存在 MySQL。活动存档优先放阿里云 OSS，未配置时落在本机磁盘。地图在线和服务器数据来自 EVM。

## 启动

```bash
npm install
cp .env.example .env
npm start
```

开发时自动重启：

```bash
npm run dev
```

浏览器打开 `http://127.0.0.1:3000`。`PEAK_API_ONLY=1` 时只保留 `/api/*`，不提供网页。

宝塔上用 PM2：

```bash
pm2 start ecosystem.config.js
pm2 save
```

进程名是 `peak`。改 `.env` 后执行 `pm2 restart peak`。

## 环境变量

复制 `.env.example`。至少填写 `SESSION_SECRET`、MySQL 和 `BOT_API_TOKEN`。

`UPDATE_PUBLIC_ORIGIN` 写成对外地址，例如 `http://df.peakvtc.cn`。不填时，反代把 Host 变成 `127.0.0.1` 也会回退到这个地址，避免安装包下载链接指向本机。

`.env` 不要提交。更新代码时保留服务器上的 `.env` 和 `uploads/`。

## 目录

| 文件 | 作用 |
| --- | --- |
| `server.js` | 入口：网页、后台接口、定时任务 |
| `db.js` | 成员、登录、权限 |
| `bizDb.js` | 活动、签到、商品、兑换 |
| `clientApi.js` | 桌面端 `/api/client/*`，以及安装包更新 |
| `openApi.js` | 机器人只读接口 `/api/open/*` |
| `checkinAuto.js` | 按地图坐标自动签到 |
| `activityStorage.js` | 存档：有 OSS 用 OSS，否则本地 |
| `dist/` | 网站页面 |
| `updates/` | 桌面安装包和 `latest.json` |
| `uploads/` | 未走 OSS 时的存档和 DLC 封面 |

## 登录

| 入口 | 条件 |
| --- | --- |
| 网页后台 | 管理员或超级管理员 |
| 桌面端 | 在队成员，已设置密码 |
| 开放接口 | `BOT_API_TOKEN`，只读 |

库里还没有超级管理员时，启动会创建 `admin` / `admin123`。上线后马上改掉。

## 桌面更新

把安装包和 `latest.json` 放到 `updates/`。客户端请求：

`/api/client/update/windows/x86_64/当前版本`

没有更新时返回 204。下载地址使用 `UPDATE_PUBLIC_ORIGIN`。
