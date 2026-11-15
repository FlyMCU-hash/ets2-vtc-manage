/**
 * API 未返回时的 DLC 补充目录（地图 / 货物 / 挂车）
 * imageUrl 使用 Steam Store API 当前 header（带 hash 路径）
 */
const EXTRA_DLCS = [
  // ---- 地图 DLC（截图中的全部；scsFiles = 游戏根目录包名）----
  {
    appId: 2780810,
    name: "Nordic Horizons",
    nameZh: "北欧地平线",
    type: 1,
    scsFiles: ["dlc_nordic.scs"],
    desc: "前往北欧高纬度地区，体验峡湾、山地与极地风光的全新货运路线。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2780810/755876b6f5502e6f99963003277519a3b96ba55b/header.jpg",
  },
  {
    appId: 2604420,
    name: "Greece",
    nameZh: "希腊",
    type: 1,
    scsFiles: ["dlc_greece.scs"],
    desc: "探索希腊半岛与岛屿之间的公路网络，感受地中海沿岸城市与港口货运。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2604420/cebe22adfddfdec1d60f73217a85ed2e68df1563/header.jpg",
  },
  {
    appId: 2004210,
    name: "West Balkans",
    nameZh: "西巴尔干",
    type: 1,
    scsFiles: ["dlc_balkan_w.scs"],
    desc: "穿越西巴尔干多国，体验山区公路、海岸线与多样化的货运目的地。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2004210/1e291946eb2ca0b65895d1d6479aa657d6d68f71/header.jpg",
  },
  {
    appId: 1209460,
    name: "Iberia",
    nameZh: "伊比利亚",
    type: 1,
    scsFiles: ["dlc_iberia.scs"],
    desc: "前往西班牙与葡萄牙，拓展伊比利亚半岛的城市、港口与货运网络。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1209460/826486bdcbe5668b0aa70bca2b7a6ee5a59bba85/header.jpg",
  },
  {
    appId: 1056760,
    name: "Road to the Black Sea",
    nameZh: "通往黑海之路",
    type: 1,
    scsFiles: ["dlc_balkan_e.scs"],
    desc: "前往罗马尼亚、保加利亚与土耳其欧洲部分，打通通往黑海的货运走廊。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1056760/f900c995f29d2d645e500521656b6139d66ba345/header.jpg",
  },
  {
    appId: 925580,
    name: "Beyond the Baltic Sea",
    nameZh: "波罗的海彼岸",
    type: 1,
    scsFiles: ["dlc_balt.scs"],
    desc: "探索芬兰、爱沙尼亚、拉脱维亚与立陶宛，体验波罗的海沿岸货运。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/925580/735f6c4b4f67b9709b3c2b19bbf0c5ff6209885f/header.jpg",
  },
  {
    appId: 558244,
    name: "Italia",
    nameZh: "意大利",
    type: 1,
    scsFiles: ["dlc_it.scs"],
    desc: "穿越意大利半岛，连接阿尔卑斯到南部港口的城市与货运线路。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/558244/81e219d061a698d9195fd54f12490fd39d667c52/header.jpg",
  },
  {
    appId: 531130,
    name: "Vive la France!",
    nameZh: "法兰西万岁！",
    type: 1,
    scsFiles: ["dlc_fr.scs"],
    desc: "拓展法国全境道路网络，体验从海岸到内陆的多样化货运任务。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/531130/12e1527163a739ab37f5a910045f9a74246b1d7e/header.jpg",
  },
  {
    appId: 304212,
    name: "Scandinavia",
    nameZh: "斯堪的纳维亚",
    type: 1,
    scsFiles: ["dlc_north.scs"],
    desc: "前往丹麦、挪威与瑞典，挑战北欧公路与港口之间的长途货运。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/304212/c8a19f31c2eef65f1b78b1210c04073867220a02/header.jpg",
  },
  {
    appId: 227310,
    name: "Going East!",
    nameZh: "向东前进！",
    type: 1,
    scsFiles: ["dlc_east.scs"],
    desc: "向东欧拓展地图，连接波兰、捷克、斯洛伐克与匈牙利等地的货运路线。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/227310/ff67a1defadae8f710e3439d90a16dc5f8ae42f5/header.jpg",
  },

  // ---- 货物 / 设备 ----
  {
    appId: 4159240,
    name: "Forest Machinery",
    nameZh: "林业机械",
    type: 2,
    scsFiles: ["dlc_forest_harvesting.scs"],
    desc: "扩展可运输货物，加入伐木机、集材机、削片机、挖掘机等林业专用设备，并为卡车提供新的配件装饰。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4159240/4b8509a668ff03b91fa7063f464dcc1da61f4b98/header.jpg",
  },

  // ---- 挂车包 ----
  {
    appId: 388477,
    name: "Schwarzmüller Trailer Pack",
    nameZh: "Schwarzmüller 挂车包",
    type: 3,
    scsFiles: ["dlc_schwarzmuller.scs"],
    desc: "官方授权的 Schwarzmüller 高细节挂车模型，包含帘布车、冷藏车、木材车、食品罐车与低平板拖车等。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/388477/1878c3401408aeee761a635b5c9b14e5a7096a3d/header.jpg",
  },
  {
    appId: 2193220,
    name: "Feldbinder Trailer Pack",
    nameZh: "Feldbinder 挂车包",
    type: 3,
    scsFiles: ["dlc_feldbinder.scs"],
    desc: "欧洲知名罐车与筒仓制造商 Feldbinder 官方授权挂车包，包含多种筒仓车、食品罐车与化学品罐车。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2193220/af5a6e14ac7c63e0c084cbd81645cad2ff9a6e3b/header.jpg",
  },
  {
    appId: 2455690,
    name: "Wielton Trailer Pack",
    nameZh: "Wielton 挂车包",
    type: 3,
    scsFiles: ["dlc_wielton.scs"],
    desc: "Wielton 官方授权挂车包，带来多种实用挂车车型与驾驶室配件，扩展你的车队装备选择。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2455690/490bf81095983ccefe65a88d5b8a75d57fe59b1e/header.jpg",
  },
  {
    appId: 2569750,
    name: "TIRSAN Trailer Pack",
    nameZh: "TIRSAN 挂车包",
    type: 3,
    scsFiles: ["dlc_tirsan.scs"],
    desc: "土耳其 TIRSAN 官方授权挂车包，加入帘布、冷藏、自卸、平板与集装箱运输等多种挂车。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2569750/c76a9a6b4fab3584751e8ba3358664b48eb6d0bb/header.jpg",
  },
  {
    appId: 2833100,
    name: "Schmitz Cargobull Trailer Pack",
    nameZh: "Schmitz Cargobull 挂车包",
    type: 3,
    scsFiles: ["dlc_schmitz.scs"],
    desc: "德国 Schmitz Cargobull 官方挂车包，包含多款帘布、冷藏、自卸等挂车与驾驶室配件。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2833100/45e4b1ba231c768045a81c9516747fb870d4dd34/header.jpg",
  },
  {
    appId: 3034940,
    name: "Kögel Trailer Pack",
    nameZh: "Kögel 挂车包",
    type: 3,
    scsFiles: ["dlc_kogel.scs"],
    desc: "Kögel 官方挂车包，加入 Cargo、Cool、Tipper 等多款挂车以及轮毂与驾驶室装饰。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3034940/ad48efd9f6c291ba786639c7032b7ebb29766ac1/header.jpg",
  },
  {
    appId: 3034950,
    name: "Kässbohrer Trailer Pack",
    nameZh: "Kässbohrer 挂车包",
    type: 3,
    scsFiles: ["dlc_kassbohrer.scs"],
    desc: "Kässbohrer 官方授权挂车包，带来多款专业挂车车型与驾驶室装饰，丰富长途运输装备。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3034950/c54bc9e52b6fb2050c7f98e288e4a5a3dbbd24dd/header.jpg",
  },
  {
    appId: 933610,
    name: "Krone Trailer Pack",
    nameZh: "Krone 挂车包",
    type: 3,
    scsFiles: ["dlc_krone.scs"],
    desc: "Bernard Krone 官方授权挂车包，加入多款欧洲常见挂车、改装件与品牌驾驶室配件。",
    imageUrl:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/933610/3bd212120bb993d2fb5cd64d265ffbb3e1dd2504/header.jpg",
  },
  {
    appId: 910001,
    name: "Polar",
    nameZh: "极地",
    type: 1,
    scsFiles: ["dlc_polar.scs"],
    desc: "极地相关地图扩展包。",
    imageUrl: "",
  },
  {
    appId: 910002,
    name: "Krone Agriculture",
    nameZh: "Krone 农业挂车",
    type: 3,
    scsFiles: ["dlc_krone_agriculture.scs"],
    desc: "Krone 农业挂车扩展包。",
    imageUrl: "",
  },
];

function mergeExtraDlcs(apiItems = []) {
  const map = new Map();
  for (const item of apiItems) {
    map.set(Number(item.appId), item);
  }
  for (const extra of EXTRA_DLCS) {
    const id = Number(extra.appId);
    const scsFiles = Array.isArray(extra.scsFiles) ? extra.scsFiles.slice() : [];
    if (!map.has(id)) {
      map.set(id, {
        appId: extra.appId,
        name: extra.nameZh || extra.name,
        nameZh: extra.nameZh || extra.name,
        nameEn: extra.name,
        type: extra.type,
        desc: extra.desc || "",
        imageUrl: extra.imageUrl || "",
        originalPrice: extra.originalPrice ?? null,
        finalPrice: extra.finalPrice ?? null,
        discount: extra.discount ?? 0,
        scsFiles,
        source: "local",
      });
    } else {
      // API 有条目但缺封面时，用本地可用图补上；补上 scsFiles 供接档器匹配
      const cur = map.get(id);
      const next = { ...cur };
      if (!next.imageUrl && extra.imageUrl) next.imageUrl = extra.imageUrl;
      if (scsFiles.length && (!Array.isArray(next.scsFiles) || !next.scsFiles.length)) {
        next.scsFiles = scsFiles;
      }
      map.set(id, next);
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const ta = Number(a.type) || 99;
    const tb = Number(b.type) || 99;
    if (ta !== tb) return ta - tb;
    return String(a.nameZh || a.name).localeCompare(String(b.nameZh || b.name), "zh");
  });
}

/** 接档器专用：地图 DLC 目录（appId + scs 文件名） */
function listMapDlcsForClient() {
  return EXTRA_DLCS.filter((d) => Number(d.type) === 1).map((d) => ({
    appId: Number(d.appId),
    name: d.nameZh || d.name,
    nameEn: d.name,
    type: 1,
    scsFiles: Array.isArray(d.scsFiles) ? d.scsFiles.slice() : [],
  }));
}

/** 接档器专用：网站 DLC 目录全部条目（部署时禁用对应 scs） */
function listWebDlcsForClient() {
  return EXTRA_DLCS.map((d) => ({
    appId: Number(d.appId),
    name: d.nameZh || d.name,
    nameEn: d.name,
    type: Number(d.type) || 0,
    scsFiles: Array.isArray(d.scsFiles) ? d.scsFiles.slice() : [],
  }));
}

module.exports = {
  EXTRA_DLCS,
  mergeExtraDlcs,
  listMapDlcsForClient,
  listWebDlcsForClient,
};
