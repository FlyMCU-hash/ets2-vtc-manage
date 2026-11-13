import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const product = conf.productName
const version = conf.version
const bin = pkg.name
const outDir = join(root, '发布')
const tauriJs = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')

function runTauri(args) {
  const result = spawnSync(process.execPath, [tauriJs, 'build', ...args], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function psQuote(value) {
  return `'${value.replaceAll("'", "''")}'`
}

function zipStage(stageDir, zipPath) {
  const command = `
    $ErrorActionPreference = 'Stop'
    if (Test-Path -LiteralPath ${psQuote(zipPath)}) {
      Remove-Item -LiteralPath ${psQuote(zipPath)} -Force
    }
    Compress-Archive -Path (Join-Path ${psQuote(stageDir)} '*') -DestinationPath ${psQuote(zipPath)}
  `
  const encoded = Buffer.from(command, 'utf16le').toString('base64')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function stageCopy(stageDir, files) {
  rmSync(stageDir, { recursive: true, force: true })
  mkdirSync(stageDir, { recursive: true })
  for (const [from, name] of files) copyFileSync(from, join(stageDir, name))
}

function newestSetup() {
  const dir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
  const setups = readdirSync(dir)
    .filter((name) => name.endsWith('-setup.exe'))
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (!setups.length) throw new Error('没有找到 NSIS 安装包')
  return setups[0]
}

const NSIS_DLL_SHA1 = '75197FEE3C6A814FE035788D1C34EAD39349B860'
const NSIS_DLL_URLS = [
  'https://ghfast.top/https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll',
  'https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll',
]

function ensureNsisPlugin() {
  const local = process.env.LOCALAPPDATA
  if (!local) return
  const dest = join(local, 'tauri', 'NSIS', 'Plugins', 'x86-unicode', 'additional', 'nsis_tauri_utils.dll')
  if (existsSync(dest)) {
    const hash = createHash('sha1').update(readFileSync(dest)).digest('hex').toUpperCase()
    if (hash === NSIS_DLL_SHA1) return
  }
  mkdirSync(dirname(dest), { recursive: true })
  for (const url of NSIS_DLL_URLS) {
    const result = spawnSync(
      'curl.exe',
      ['-L', '--retry', '3', '--retry-all-errors', '--connect-timeout', '20', '--max-time', '120', '-o', dest, url],
      { stdio: 'inherit' },
    )
    if (result.status !== 0 || !existsSync(dest)) continue
    const hash = createHash('sha1').update(readFileSync(dest)).digest('hex').toUpperCase()
    if (hash === NSIS_DLL_SHA1) return
  }
  console.error('NSIS 插件下载失败，安装包可能无法生成')
}

mkdirSync(outDir, { recursive: true })

console.log(`正在编译 ${product} 安装包和解压包…`)
ensureNsisPlugin()
runTauri(['--bundles', 'nsis'])

const installer = join(outDir, `${product}-${version}-安装包.exe`)
copyFileSync(newestSetup(), installer)

const releaseExe = join(root, 'src-tauri', 'target', 'release', `${bin}.exe`)
const releaseStage = join(tmpdir(), `pack-${bin}-release`)
stageCopy(releaseStage, [[releaseExe, `${product}.exe`]])
const portable = join(outDir, `${product}-${version}-解压包.zip`)
zipStage(releaseStage, portable)

console.log(`正在编译 ${product} 调试包…`)
runTauri(['--debug', '--no-bundle'])

const debugExe = join(root, 'src-tauri', 'target', 'debug', `${bin}.exe`)
const debugPdb = join(root, 'src-tauri', 'target', 'debug', `${bin}.pdb`)
const debugFiles = [[debugExe, `${product}.exe`]]
if (existsSync(debugPdb)) debugFiles.push([debugPdb, `${product}.pdb`])
const debugStage = join(tmpdir(), `pack-${bin}-debug`)
stageCopy(debugStage, debugFiles)
const debugZip = join(outDir, `${product}-${version}-调试包.zip`)
zipStage(debugStage, debugZip)

console.log('打包完成：')
console.log(installer)
console.log(portable)
console.log(debugZip)
