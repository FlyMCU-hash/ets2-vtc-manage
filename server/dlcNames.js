/** ETS2 地图 DLC 中文名（按 appId 优先，其次英文名） */
const BY_APP_ID = {
  2780810: "北欧地平线",
  2604420: "希腊",
  2004210: "西巴尔干",
  1209460: "伊比利亚",
  1056760: "通往黑海之路",
  925580: "波罗的海彼岸",
  558244: "意大利",
  531130: "法兰西万岁！",
  304212: "斯堪的纳维亚",
  227310: "向东前进！",
  1889000: "俄罗斯之心",
  4159240: "林业机械",
  388477: "Schwarzmüller 挂车包",
  2193220: "Feldbinder 挂车包",
  2455690: "Wielton 挂车包",
  2569750: "TIRSAN 挂车包",
  2833100: "Schmitz Cargobull 挂车包",
  3034940: "Kögel 挂车包",
  3034950: "Kässbohrer 挂车包",
  933610: "Krone 挂车包",
};

const BY_NAME = {
  "Nordic Horizons": "北欧地平线",
  Greece: "希腊",
  Iberia: "伊比利亚",
  "Road to the Black Sea": "通往黑海之路",
  "Beyond the Baltic Sea": "波罗的海彼岸",
  Italia: "意大利",
  "Vive la France !": "法兰西万岁！",
  "Vive la France!": "法兰西万岁！",
  Scandinavia: "斯堪的纳维亚",
  "Going East!": "向东前进！",
  "West Balkans": "西巴尔干",
  "Heart of Russia": "俄罗斯之心",
  "Forest Machinery": "林业机械",
  "Schwarzmüller Trailer Pack": "Schwarzmüller 挂车包",
  "Feldbinder Trailer Pack": "Feldbinder 挂车包",
  "Wielton Trailer Pack": "Wielton 挂车包",
  "TIRSAN Trailer Pack": "TIRSAN 挂车包",
  "Schmitz Cargobull Trailer Pack": "Schmitz Cargobull 挂车包",
  "Kögel Trailer Pack": "Kögel 挂车包",
  "Kässbohrer Trailer Pack": "Kässbohrer 挂车包",
  "Krone Trailer Pack": "Krone 挂车包",
};

function translateDlcName(item = {}) {
  const appId = Number(item.appId);
  const en = String(item.name || "").trim();
  const zh = BY_APP_ID[appId] || BY_NAME[en] || "";
  return {
    name: en,
    nameZh: zh || en,
    nameEn: en,
  };
}

module.exports = {
  translateDlcName,
  BY_APP_ID,
  BY_NAME,
};
