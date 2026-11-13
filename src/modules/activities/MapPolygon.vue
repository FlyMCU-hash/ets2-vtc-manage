<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const props = defineProps<{
  points: { lat: number; lng: number }[]
  serverName: string
  config: Record<string, unknown> | null
  active?: boolean
}>()
const emit = defineEmits<{ update: [points: { lat: number; lng: number }[]] }>()
const host = ref<HTMLElement | null>(null)
let map: L.Map | null = null
let layer: L.Layer | null = null
let tiles: L.TileLayer | null = null
let marker: L.Layer | null = null
let world: L.LatLngBounds | null = null
let focused = false
let resizeObserver: ResizeObserver | null = null
const tileUrls = { ets: '', promods: '' }

const FALLBACK_MAP = {
  ets: {
    tileUrl: 'https://ets2.online/map/ets2map_159/{z}/{x}/{y}.png',
    maxZoom: 8,
    minZoom: 2,
    tileSize: 512,
    bounds: { x: 131072, y: 131072 },
  },
  promods: {
    tileUrl: 'https://ets2.online/map/ets2mappromods_158/{z}/{x}/{y}.png',
    maxZoom: 8,
    minZoom: 2,
    tileSize: 512,
    bounds: { x: 131072, y: 131072 },
  },
} as const

function mapType() {
  return /promods/i.test(props.serverName) ? 'promods' : 'ets'
}

function mapBag() {
  const key = mapType()
  const fromConfig = props.config?.[key]
  if (fromConfig && typeof fromConfig === 'object') return fromConfig as Record<string, unknown>
  return FALLBACK_MAP[key]
}

function draw() {
  if (!map) return
  if (layer) map.removeLayer(layer)
  const latlngs = props.points.map((point) => [point.lat, point.lng] as [number, number])
  const group = L.layerGroup()
  if (latlngs.length >= 2) {
    const shape = latlngs.length >= 3
      ? L.polygon(latlngs, { color: '#2f6bff', weight: 2, fillOpacity: 0.12 })
      : L.polyline(latlngs, { color: '#2f6bff', weight: 2 })
    group.addLayer(shape)
  }
  latlngs.forEach((latlng, index) => {
    group.addLayer(L.circleMarker(latlng, {
      radius: 12,
      color: '#2f6bff',
      weight: 2,
      fillColor: '#ffffff',
      fillOpacity: 1,
    }).bindTooltip(String(index + 1), { permanent: true, direction: 'center', className: 'map-index' }))
  })
  layer = group.addTo(map)
}

function fit() {
  if (!map) return
  map.invalidateSize()
  if (props.points.length) {
    focused = true
    map.fitBounds(L.latLngBounds(props.points.map((point) => [point.lat, point.lng] as [number, number])).pad(0.4), { maxZoom: 7 })
    return
  }
  focused = false
  reveal()
}

function focus(lat: number, lng: number) {
  if (!map) return
  focused = true
  map.invalidateSize()
  map.setView([lat, lng], 7)
  if (marker) map.removeLayer(marker)
  marker = L.layerGroup([
    L.circleMarker([lat, lng], {
      radius: 16,
      color: '#ffffff',
      weight: 5,
      fillColor: '#e11d48',
      fillOpacity: 1,
    }),
    L.circleMarker([lat, lng], {
      radius: 5,
      color: '#ffffff',
      weight: 0,
      fillColor: '#ffffff',
      fillOpacity: 1,
    }),
  ]).addTo(map)
}

defineExpose({ fit, focus })

function reveal(attempt = 0) {
  if (!map || !world || !host.value) return
  map.invalidateSize()
  const size = map.getSize()
  const box = host.value.getBoundingClientRect()
  const ready = size.x > 20 && size.y > 120 && Math.abs(size.y - box.height) < 4
  if (!ready) {
    if (attempt < 15) window.setTimeout(() => reveal(attempt + 1), 80)
    return
  }
  if (!focused) map.setView(world.getCenter(), 4)
}

function applyTiles() {
  if (!map) return
  const bag = mapBag()
  const maxZoom = Number(bag.maxZoom) || 8
  const minZoom = 0
  const tileSize = Number(bag.tileSize) || 512
  const boundsBox = (bag.bounds || {}) as { x?: number; y?: number }
  const bx = Number(boundsBox.x) || 131072
  const by = Number(boundsBox.y) || 131072
  world = L.latLngBounds(map.unproject([0, by], maxZoom), map.unproject([bx, 0], maxZoom))
  map.setMinZoom(minZoom)
  map.setMaxZoom(maxZoom)
  map.setMaxBounds(world.pad(0.05))
  const fallback = FALLBACK_MAP[mapType()].tileUrl
  const url = fallback
  if (tiles && tileUrls[mapType()] === url) {
    reveal()
    return
  }
  if (tiles) map.removeLayer(tiles)
  tileUrls[mapType()] = url
  tiles = L.tileLayer(url, {
    minZoom,
    maxZoom,
    maxNativeZoom: maxZoom,
    tileSize,
    noWrap: true,
  }).addTo(map)
  reveal()
}

onMounted(() => {
  if (!host.value) return
  map = L.map(host.value, {
    crs: L.CRS.Simple,
    attributionControl: false,
    zoomSnap: 0.25,
    minZoom: 0,
    maxZoom: 8,
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
    doubleClickZoom: false,
  })
  map.on('click', (event) => {
    emit('update', [...props.points, { lat: event.latlng.lat, lng: event.latlng.lng }])
  })
  applyTiles()
  draw()
  resizeObserver = new ResizeObserver(() => map?.invalidateSize())
  resizeObserver.observe(host.value)
})

watch(() => props.points, draw, { deep: true })
watch(() => props.serverName, applyTiles)
watch(() => props.active, (active) => {
  if (active === false) return
  window.setTimeout(() => reveal(), 120)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  map?.remove()
  map = null
})
</script>

<template>
  <div ref="host" class="map"></div>
</template>
