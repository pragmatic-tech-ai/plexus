import { defineConfig } from '@playwright/test'

// Electron e2e harness. Tests launch the BUILT app (out/main/index.js) via
// playwright's _electron, so run `npm run build` first. Electron is
// single-instance per launch, so serialize (workers: 1, no parallel).
export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 180_000,
    expect: { timeout: 20_000 },
    reporter: [['list']],
    outputDir: './e2e/.artifacts',
})
