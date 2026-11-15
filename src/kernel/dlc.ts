export type DisableDlc = {
  id: number
  name: string
  kind: '地图' | '货物' | '挂车' | '客运'
  files: string[]
}

/** 部署时用来禁用的固定 21 个。 */
const BUILTIN: DisableDlc[] = [
  { id: 2604420, name: '希腊', kind: '地图', files: ['dlc_greece.scs'] },
  { id: 2004210, name: '西巴尔干', kind: '地图', files: ['dlc_balkan_w.scs'] },
  { id: 1209460, name: '伊比利亚', kind: '地图', files: ['dlc_iberia.scs'] },
  { id: 1056760, name: '通往黑海之路', kind: '地图', files: ['dlc_balkan_e.scs'] },
  { id: 925580, name: '波罗的海彼岸', kind: '地图', files: ['dlc_balt.scs'] },
  { id: 558244, name: '意大利', kind: '地图', files: ['dlc_it.scs'] },
  { id: 531130, name: '法兰西万岁！', kind: '地图', files: ['dlc_fr.scs'] },
  { id: 304212, name: '斯堪的纳维亚', kind: '地图', files: ['dlc_north.scs'] },
  { id: 227310, name: '向东前进！', kind: '地图', files: ['dlc_east.scs'] },
  { id: 910001, name: '极地', kind: '地图', files: ['dlc_polar.scs'] },
  { id: 3796990, name: '冰岛', kind: '地图', files: ['dlc_iceland.scs'] },
  { id: 3809270, name: '客运', kind: '客运', files: ['dlc_bus.scs'] },
  { id: 388477, name: 'Schwarzmüller 挂车包', kind: '挂车', files: ['dlc_schwarzmuller.scs'] },
  { id: 2193220, name: 'Feldbinder 挂车包', kind: '挂车', files: ['dlc_feldbinder.scs'] },
  { id: 2455690, name: 'Wielton 挂车包', kind: '挂车', files: ['dlc_wielton.scs'] },
  { id: 2569750, name: 'TIRSAN 挂车包', kind: '挂车', files: ['dlc_tirsan.scs'] },
  { id: 2833100, name: 'Schmitz Cargobull 挂车包', kind: '挂车', files: ['dlc_schmitz.scs'] },
  { id: 3034940, name: 'Kögel 挂车包', kind: '挂车', files: ['dlc_kogel.scs'] },
  { id: 3034950, name: 'Kässbohrer 挂车包', kind: '挂车', files: ['dlc_kassbohrer.scs'] },
  { id: 933610, name: 'Krone 挂车包', kind: '挂车', files: ['dlc_krone.scs'] },
  { id: 910002, name: 'Krone 农业挂车', kind: '挂车', files: ['dlc_krone_agriculture.scs'] },
]

export function fallbackDisableDlcs() {
  return BUILTIN.map((item) => ({ ...item, files: [...item.files] }))
}

export function loadDisableDlcs() {
  return Promise.resolve(fallbackDisableDlcs())
}
