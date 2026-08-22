#!/usr/bin/env node
/**
 * RAGDom — récupération des bases PUBLIÉES pour le développement local.
 *
 * Les bases .sqlite du corpus dépassent la limite GitHub de 100 Mo : elles ne
 * sont donc PAS dans le dépôt, mais publiées comme assets d'une release GitHub.
 * En production, le Dockerfile les télécharge au build et main.py:56-70 les copie
 * vers DATABASES_DIR au démarrage. Le développement local (`npm run dev` sur une
 * machine Windows/macOS/Linux) n'avait AUCUN équivalent → la bibliothèque locale
 * restait vide. Ce script comble ce trou.
 *
 * Il interroge l'API GitHub de la release publique (dépôt PUBLIC → aucun token),
 * télécharge chaque asset .sqlite vers `databases_publiees/` à la racine du projet
 * (le seed câblé dans main.py les copiera ensuite vers DATABASES_DIR), suit les
 * redirections des browser_download_url, affiche la progression et SAUTE tout
 * fichier déjà présent à la bonne taille (reprise idempotente, zéro re-téléchargement).
 *
 * Node pur, ZÉRO dépendance (https natif). Compatible Node 18+.
 *
 * Réglages via variables d'environnement (aucune valeur figée) :
 *   RAGDOM_RELEASE_REPO  (défaut « amichiamine/RAGDom »)
 *   RAGDOM_RELEASE_TAG   (défaut « corpus-1am-v1 »)
 *   RAGDOM_PUBLISHED_DBS (défaut « <racine>/databases_publiees »)
 *
 * Usage : node scripts/fetch_published_dbs.mjs
 */
import { createWriteStream, existsSync, mkdirSync, statSync, renameSync, unlinkSync } from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = process.env.RAGDOM_RELEASE_REPO || 'amichiamine/RAGDom'
const TAG = process.env.RAGDOM_RELEASE_TAG || 'corpus-1am-v1'
const DEST = process.env.RAGDOM_PUBLISHED_DBS || path.join(ROOT, 'databases_publiees')

// En-têtes communs : l'API GitHub EXIGE un User-Agent, sinon 403.
const UA = { 'User-Agent': 'RAGDom-fetch-published-dbs', Accept: 'application/vnd.github+json' }

/** GET JSON avec suivi des redirections (résout la promesse sur l'objet parsé). */
function getJson(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: UA }, (res) => {
      const { statusCode, headers } = res
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume() // vide le flux avant de suivre la redirection
        if (redirectsLeft <= 0) return reject(new Error('Trop de redirections (JSON)'))
        return resolve(getJson(headers.location, redirectsLeft - 1))
      }
      if (statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${statusCode} sur ${url}`))
      }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

/** Barre de progression compacte réécrite sur place (une seule ligne). */
function drawProgress(name, received, total) {
  const pct = total ? Math.min(100, (received / total) * 100) : 0
  const mb = (n) => (n / (1024 * 1024)).toFixed(1)
  const width = 24
  const filled = Math.round((pct / 100) * width)
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled)
  const line = total
    ? `  ${name}  [${bar}] ${pct.toFixed(0)}%  ${mb(received)}/${mb(total)} Mo`
    : `  ${name}  ${mb(received)} Mo`
  if (process.stdout.isTTY) process.stdout.write('\r' + line.padEnd(78))
}

/** Télécharge un asset vers un fichier temporaire (.part) puis renomme (atomique). */
function download(url, target, name, expectedSize, redirectsLeft = 6) {
  return new Promise((resolve, reject) => {
    const tmp = target + '.part'
    https.get(url, { headers: UA }, (res) => {
      const { statusCode, headers } = res
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume()
        if (redirectsLeft <= 0) return reject(new Error('Trop de redirections (asset)'))
        // Les browser_download_url renvoient vers un CDN (objects.githubusercontent.com).
        return resolve(download(headers.location, target, name, expectedSize, redirectsLeft - 1))
      }
      if (statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${statusCode} sur ${name}`))
      }
      const total = expectedSize || Number(headers['content-length']) || 0
      let received = 0
      let lastTick = 0
      const out = createWriteStream(tmp)
      res.on('data', (chunk) => {
        received += chunk.length
        const now = Date.now()
        if (now - lastTick > 120) { drawProgress(name, received, total); lastTick = now }
      })
      res.pipe(out)
      out.on('finish', () => out.close(() => {
        drawProgress(name, received, total)
        if (process.stdout.isTTY) process.stdout.write('\n')
        // Contrôle d'intégrité par taille (le seul disponible sans somme publiée).
        if (expectedSize && received !== expectedSize) {
          try { unlinkSync(tmp) } catch { /* ignore */ }
          return reject(new Error(
            `${name} : taille reçue ${received} ≠ attendue ${expectedSize} (téléchargement incomplet)`))
        }
        renameSync(tmp, target)
        resolve(received)
      }))
      out.on('error', (e) => { try { unlinkSync(tmp) } catch { /* ignore */ } reject(e) })
    }).on('error', reject)
  })
}

async function main() {
  console.log(`→ Bases publiées RAGDom : release ${REPO}@${TAG}`)
  mkdirSync(DEST, { recursive: true })

  const apiUrl = `https://api.github.com/repos/${REPO}/releases/tags/${TAG}`
  let release
  try {
    release = await getJson(apiUrl)
  } catch (e) {
    console.error(`✖ Impossible de lire la release (${e.message}).`)
    console.error('  Vérifiez la connexion réseau, le dépôt/tag, ou définissez '
      + 'RAGDOM_RELEASE_REPO / RAGDOM_RELEASE_TAG.')
    process.exit(1)
  }

  const assets = (release.assets || []).filter((a) => a.name.endsWith('.sqlite'))
  if (assets.length === 0) {
    console.error('✖ Aucun asset .sqlite dans cette release.')
    process.exit(1)
  }

  let downloaded = 0
  let skipped = 0
  for (const asset of assets) {
    const target = path.join(DEST, asset.name)
    // Déjà présent à la bonne taille → on saute (idempotence / reprise).
    if (existsSync(target) && statSync(target).size === asset.size) {
      console.log(`  ✔ ${asset.name} déjà présent (${(asset.size / (1024 * 1024)).toFixed(1)} Mo) — ignoré`)
      skipped += 1
      continue
    }
    try {
      await download(asset.browser_download_url, target, asset.name, asset.size)
      downloaded += 1
    } catch (e) {
      console.error(`\n✖ Échec du téléchargement de ${asset.name} : ${e.message}`)
      process.exit(1)
    }
  }

  console.log(`✔ Terminé — ${downloaded} téléchargée(s), ${skipped} déjà présente(s) dans ${DEST}`)
  console.log('  Lancez le backend : les bases seront copiées vers DATABASES_DIR au démarrage (main.py).')
}

main().catch((e) => { console.error('✖ Erreur inattendue :', e); process.exit(1) })
