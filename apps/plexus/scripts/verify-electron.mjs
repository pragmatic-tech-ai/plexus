// Catches an interrupted Electron binary download before it fails cryptically later.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const electronDist = join(dirname(createRequire(import.meta.url).resolve('electron/package.json')), 'dist')

if (!existsSync(electronDist)) {
  console.error(
    `\n[verify-electron] Missing ${electronDist} — the electron package installed ` +
    `but its binary did not download (interrupted install, or a proxy/firewall ` +
    `blocking github.com release downloads).\n` +
    `Fix: node node_modules/electron/install.js\n` +
    `If that also fails to reach github.com, set ELECTRON_MIRROR to an internal ` +
    `mirror or configure your proxy env vars first.\n`,
  )
  process.exit(1)
}
