import { build } from 'vite'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'server', 'dist')
const assets = join(dist, 'assets')
const staging = join(root, 'server', 'dist-staging')
const manifestPath = join(dist, 'assets-manifest.json')
const configFile = join(root, 'vite.config.ts')

function log(...args) {
  console.log('[build-web]', ...args)
}

function fatal(msg) {
  console.error('[build-web][ERROR]', msg)
  process.exit(1)
}

function listFiles(dir, root = dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listFiles(full, root))
    else out.push(relative(root, full).replaceAll('\\', '/'))
  }
  return out
}

function readPrevious() {
  if (!existsSync(manifestPath)) return listFiles(assets)
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return Array.isArray(parsed.current) ? parsed.current.filter((name) => typeof name === 'string') : []
  } catch {
    return []
  }
}

function copyDir(from, to) {
  mkdirSync(to, { recursive: true })
  for (const name of readdirSync(from)) {
    const src = join(from, name)
    const dst = join(to, name)
    if (statSync(src).isDirectory()) copyDir(src, dst)
    else copyFileSync(src, dst)
  }
}

try {
  const previous = readPrevious()
  log(`上一版资源计数: ${previous.length}`)

  log('清理 staging 目录…')
  rmSync(staging, { recursive: true, force: true })

  log('开始 vite 构建到 server/dist-staging…')
  await build({
    configFile,
    logLevel: 'error',
    build: {
      outDir: staging,
      emptyOutDir: true,
    },
  })

  const stagingAssets = join(staging, 'assets')
  if (!existsSync(stagingAssets)) fatal('构建产物缺失: server/dist-staging/assets 不存在')
  const current = listFiles(stagingAssets)
  log(`构建完成，本次产出 ${current.length} 个资源`)

  const keep = new Set([...current, ...previous])
  mkdirSync(assets, { recursive: true })
  log('复制新资源到 server/dist/assets…')
  for (const name of readdirSync(stagingAssets)) {
    const from = join(stagingAssets, name)
    const to = join(assets, name)
    const st = statSync(from)
    if (st.isDirectory()) {
      rmSync(to, { recursive: true, force: true })
      copyDir(from, to)
    } else {
      copyFileSync(from, to)
    }
  }

  let removed = 0
  for (const name of listFiles(assets)) {
    if (!keep.has(name)) {
      rmSync(join(assets, name), { force: true })
      removed++
    }
  }
  log(`清理过期资源 ${removed} 个`)

  for (const name of readdirSync(staging)) {
    if (name === 'assets') continue
    const from = join(staging, name)
    const to = join(dist, name)
    rmSync(to, { recursive: true, force: true })
    const st = statSync(from)
    if (st.isDirectory()) copyDir(from, to)
    else copyFileSync(from, to)
  }

  writeFileSync(manifestPath, `${JSON.stringify({ current, previous }, null, 2)}\n`)
  rmSync(staging, { recursive: true, force: true })
  log(`完成：网页已输出到 server/dist，保留上一版 ${previous.length} 个资源`)
} catch (err) {
  fatal(err instanceof Error ? err.stack ?? err.message : String(err))
}