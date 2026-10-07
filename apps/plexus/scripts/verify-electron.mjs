// Ensures Electron's binary is present (npm may run this before electron's own postinstall).
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'

const electronDir = dirname(createRequire(import.meta.url).resolve('electron/package.json'))
const electronDist = join(electronDir, 'dist')

if (!existsSync(electronDist)) {
  spawnSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit' })
}

if (!existsSync(electronDist)) {
  console.error(
    `\n[verify-electron] Missing ${electronDist} — the electron binary did not download ` +
    `(interrupted install, or a proxy/firewall blocking github.com release downloads).\n` +
    `Fix: node node_modules/electron/install.js\n` +
    `If that also fails to reach github.com, set ELECTRON_MIRROR to an internal ` +
    `mirror or configure your proxy env vars first.\n`,
  )
  process.exit(1)
}
