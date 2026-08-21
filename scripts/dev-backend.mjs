#!/usr/bin/env node
/**
 * RAGDom — lanceur backend multiplateforme (Windows/Linux/macOS).
 *
 * Résout le Python du venv (backend/.venv ou backend/venv), choisit un port
 * LIBRE (BACKEND_PORT souhaité, sinon +1, +2… — rien n'est figé) et lance
 * uvicorn. Le proxy Vite suit automatiquement via BACKEND_PORT hérité.
 *
 * Modes : --setup (crée venv + pip install), --pytest, --no-reload.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backend = path.join(root, 'backend')
const isWin = process.platform === 'win32'

function venvPython() {
  const bin = isWin ? 'Scripts' : 'bin'
  const exe = isWin ? 'python.exe' : 'python'
  const candidates = [
    path.join(backend, '.venv', bin, exe),
    path.join(backend, 'venv', bin, exe),
    path.join(root, '.venv', bin, exe),   // venv à la racine du projet
    path.join(root, 'venv', bin, exe),
  ]
  return candidates.find(existsSync) ?? null
}

function systemPython() {
  for (const cmd of [isWin ? 'py' : 'python3', 'python']) {
    const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore' })
    if (probe.status === 0) return cmd
  }
  console.error('✖ Python introuvable — installez Python 3.11+ (python.org)')
  process.exit(1)
}

async function freePort(preferred) {
  const tryPort = (port) => new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
  for (let port = preferred; port < preferred + 20; port++) {
    if (await tryPort(port)) return port
  }
  console.error(`✖ Aucun port libre entre ${preferred} et ${preferred + 19}`)
  process.exit(1)
}

const args = process.argv.slice(2)

if (args.includes('--setup')) {
  const py = systemPython()
  console.log('→ Création du venv backend/.venv…')
  spawnSync(py, ['-m', 'venv', '.venv'], { cwd: backend, stdio: 'inherit' })
  const vpy = venvPython()
  console.log('→ Installation de la whitelist (requirements.txt)…')
  spawnSync(vpy, ['-m', 'pip', 'install', '-r', 'requirements.txt'], { cwd: backend, stdio: 'inherit' })
  console.log('→ Post-install obligatoire (opencv headless, tech_specs §8)…')
  spawnSync(vpy, ['-m', 'pip', 'uninstall', '-y', 'opencv-python'], { cwd: backend, stdio: 'inherit' })
  spawnSync(vpy, ['-m', 'pip', 'install', 'opencv-python-headless==4.10.0.84', 'numpy==1.26.4'],
    { cwd: backend, stdio: 'inherit' })
  console.log('✔ Setup terminé — lancez : npm run dev')
  process.exit(0)
}

const py = venvPython()
if (!py) {
  console.error('✖ venv absent — lancez d\'abord : npm run setup')
  process.exit(1)
}

if (args.includes('--pytest')) {
  const r = spawnSync(py, ['-m', 'pytest', 'tests/', '-q', '--ignore=tests/bench_ram_100p.py'],
    { cwd: backend, stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

const preferred = Number(process.env.BACKEND_PORT) || 8000
const port = await freePort(preferred)
if (port !== preferred) console.log(`ℹ Port ${preferred} occupé → bascule sur ${port}`)
process.env.BACKEND_PORT = String(port) // hérité par le proxy Vite (npm run dev)

const uvicornArgs = ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(port)]
if (!args.includes('--no-reload')) uvicornArgs.push('--reload')
console.log(`→ Backend RAGDom : http://localhost:${port}  (API + UI si frontend/dist existe)`)
const child = spawn(py, uvicornArgs, { cwd: backend, stdio: 'inherit', env: process.env })
child.on('exit', (code) => process.exit(code ?? 0))
