# Peak 车队中心

版本 **V4.1.1**。成员用 TMP ID 登录后接档、看在线；管理员按权限管理成员、积分、活动和商城。

同一套 Vue 界面有两个入口：

- 网站 `http://df.peakvtc.cn`，由 `server/` 提供。改功能后重新构建网页并上传即可，不用重新打包安装程序。
- Windows 桌面程序是启动器。正式包打开上面的网站，只额外提供本机欧卡能力：存档部署、工具箱、欧卡路径、检查更新。更新日志也只在桌面端弹出。

车队数据在网站的 MySQL 里。桌面程序不带数据库，也不保存数据库密码。

## 目录结构

```
src/
  kernel/            会话、权限、接口、本机调用、依赖 DLC
  shell/             登录页、主框架
  modules/           功能模块，每个目录自带 module.ts 和 Page.vue
src-tauri/
  src/lib.rs         窗口、托盘、本机命令
  src/native/        存档部署、改档、备份、TMP 前缀
  tauri.conf.json    正式包加载 http://df.peakvtc.cn
server/              网站和接口，页面在 server/dist
scripts/pack.mjs     打安装包、解压包、调试包
打包.bat             双击打包
发布/                打包产物
```

## 如何运行

需要 Node.js、Rust，以及 Windows 上的 WebView2。网站还需要 MySQL。

```powershell
npm install
cd server
npm install
```

调试桌面窗口，页面来自本机 Vite：

```powershell
npm run tauri dev
```

只看网页，地址 `http://localhost:1420`。浏览器里没有存档部署、工具箱和检查更新。

```powershell
npm run dev
```

构建网站并放到 `server/dist`：

```powershell
npm run build:web
cd server
copy .env.example .env
npm start
```

浏览器打开 `http://127.0.0.1:3000`。把 `server/dist` 上传到线上后，已安装的桌面程序会直接用到新页面。

打安装包。产物在 `发布/`，也可以双击 `打包.bat`。只有本机能力或安装程序本身变了，才需要发新的安装包。

```powershell
npm run pack
```

## 模块

每个功能是 `src/modules/某功能/`。`module.ts` 写编号、标题、分组、排序、图标和权限，`Page.vue` 是页面。壳子按 `order` 收集，再按账号权限显示。`local: true` 的模块只在桌面程序里出现。

| 模块 | 菜单名 | 分组 | 谁能看见 |
| --- | --- | --- | --- |
| home | 首页 | 顶部 | 已登录 |
| deploy | 存档部署 | 接档器 | 仅桌面端 |
| fleet | 在线成员 | 接档器 | 已登录 |
| servers | 服务器 | 接档器 | 已登录 |
| toolbox | 工具箱 | 接档器 | 仅桌面端 |
| member-add | 新增成员 | 车队管理 | 成员权限 |
| members | 成员管理 | 车队管理 | 成员权限 |
| points | 积分管理 | 车队管理 | 积分权限 |
| activities | 活动管理 | 车队管理 | 活动权限 |
| checkins | 签到记录 | 车队管理 | 活动权限 |
| store | 积分商店 | 商城管理 | 已登录 |
| my-redeems | 我的兑换 | 商城管理 | 已登录 |
| products | 商品管理 | 商城管理 | 商城权限 |
| redeems | 兑换记录 | 商城管理 | 商城权限 |
| profile | 账号设置 | 系统设置 | 已登录 |
| online-users | 在线用户 | 系统设置 | 监控权限 |
| permissions | 权限管理 | 系统设置 | 设置权限 |
| settings | 平台设置 | 系统设置 | 已登录 |
| accounts | 账号创建 | 系统设置 | 设置权限 |
| oplog | 操作记录 | 系统设置 | 仅管理员 |
| about | 关于 | 系统设置 | 已登录 |

新加一页时，建目录并写出 `module.ts` 和 `Page.vue`。分组名已经在 `groupOrder` 里时，不用改壳子。网站上线执行 `npm run build:web`，把 `server/dist` 传到 `http://df.peakvtc.cn`。
