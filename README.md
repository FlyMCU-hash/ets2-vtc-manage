# Peak 车队中心

版本 **V4.1.0**。这是给 Peak 车队成员用的 Windows 桌面程序。成员用 TMP ID 登录后可以接档、看在线、用欧卡工具箱；管理员再按权限管理成员、积分、活动和商城。

界面按功能模块注册。壳子启动时扫描 `src/modules/*/module.ts`，不在代码里逐个引用页面。车队数据默认走 `http://df.peakvtc.cn`。本机欧卡操作由 Rust 完成，程序里不保存数据库密码。

## 目录结构

```
PEAK车队/
  src/
    kernel/          会话、权限、接口请求、本机调用
    shell/           登录页、主框架、图标、提示
    modules/         功能模块，每个目录自带 module.ts 和 Page.vue
  src-tauri/
    src/lib.rs       启动窗口和托盘
    src/shell.rs     窗口尺寸与托盘菜单
    src/native/      存档部署、改档、备份、TMP 前缀等本机能力
    tauri.conf.json
  scripts/pack.mjs   打安装包、解压包、调试包
  打包.bat           双击打包
  发布/              打包产物
```

## 如何运行

需要 Node.js、Rust，以及 Windows 上的 WebView2。

安装依赖：

```powershell
npm install
```

只开网页。浏览器里看不到本机欧卡命令，地址是 `http://localhost:1420`。

```powershell
npm run dev
```

开桌面程序，带托盘和本机能力：

```powershell
npm run tauri dev
```

打安装包、解压包和调试包。产物在 `发布/`。也可以直接双击 `打包.bat`。

```powershell
npm run pack
```

车队接口在 `http://df.peakvtc.cn`，桌面程序不再自带数据库服务。

## 模块化说明

每个功能是 `src/modules/某功能/` 里的一个目录，里面固定两份文件：

- `module.ts`：编号、标题、分组、排序、图标、权限，以及页面入口。
- `Page.vue`：这一页的界面。点开菜单时才加载。

`src/kernel/modules.ts` 用 `import.meta.glob('../modules/*/module.ts')` 收集全部模块，再按 `order` 排序。外壳按当前账号的权限过滤菜单。`permission` 不写时，登录用户都能看见。`managerOnly` 为真时，只有管理员能看见。

| 模块 | 菜单名 | 分组 | 排序 | 谁能看见 |
| --- | --- | --- | --- | --- |
| home | 首页 | 顶部 | 10 | 已登录 |
| deploy | 存档部署 | 接档器 | 20 | 已登录 |
| fleet | 在线成员 | 接档器 | 30 | 已登录 |
| servers | 服务器 | 接档器 | 40 | 已登录 |
| toolbox | 工具箱 | 接档器 | 45 | 已登录 |
| member-add | 新增成员 | 车队管理 | 50 | 成员权限 |
| members | 成员管理 | 车队管理 | 51 | 成员权限 |
| points | 积分管理 | 车队管理 | 52 | 积分权限 |
| activities | 活动管理 | 车队管理 | 53 | 活动权限 |
| checkins | 签到记录 | 车队管理 | 54 | 活动权限 |
| store | 积分商店 | 商城管理 | 60 | 已登录 |
| my-redeems | 我的兑换 | 商城管理 | 61 | 已登录 |
| products | 商品管理 | 商城管理 | 62 | 商城权限 |
| redeems | 兑换记录 | 商城管理 | 63 | 商城权限 |
| profile | 账号设置 | 系统设置 | 70 | 已登录 |
| online-users | 在线用户 | 系统设置 | 80 | 监控权限 |
| permissions | 权限管理 | 系统设置 | 85 | 设置权限 |
| settings | 平台设置 | 系统设置 | 90 | 已登录 |
| accounts | 账号创建 | 系统设置 | 100 | 设置权限 |
| oplog | 操作记录 | 系统设置 | 110 | 仅管理员 |
| about | 关于 | 系统设置 | 120 | 已登录 |

新加一页时，建一个目录并写出上面两个文件。分组名已经在 `groupOrder` 里时，不用再改壳子。
