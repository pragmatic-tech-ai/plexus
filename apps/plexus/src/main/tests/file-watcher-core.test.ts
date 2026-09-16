import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FSWatcher } from 'chokidar'
import { startWatch, stopWatch, noteInternalWrite } from '../file-watcher-core.js'
import { FileChangeKind, type FileChangeEvent } from '../../shared/file-watch-api.js'

// chokidar ignores files that appear during its initial scan (ignoreInitial),
// so tests must wait for `ready` before writing, or the event never fires.
function onceReady(w: FSWatcher): Promise<void> {
  return new Promise((res) => { w.on('ready', () => res()) })
}

// chokidar's awaitWriteFinish means events land shortly after a write settles.
function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = (): void => {
      if (pred()) return resolve()
      if (Date.now() - started > ms) return reject(new Error('timeout'))
      setTimeout(tick, 25)
    }
    tick()
  })
}

describe('file-watcher-core', () => {
  let dir: string
  let events: FileChangeEvent[]
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'fw-')); events = [] })
  afterEach(async () => { stopWatch(dir); await rm(dir, { recursive: true, force: true }) })

  test('emits a Changed/Added event for an external write', async () => {
    const w = startWatch(dir, (e) => events.push(e))
    await onceReady(w)
    const f = join(dir, 'note.txt')
    await writeFile(f, 'hello', 'utf8')
    await waitFor(() => events.some((e) => e.path === f))
    expect(events.some((e) => e.path === f && (e.kind === FileChangeKind.Added || e.kind === FileChangeKind.Changed))).toBe(true)
  })

  test('suppresses a write we announced via noteInternalWrite (control write still fires)', async () => {
    const w = startWatch(dir, (e) => events.push(e))
    await onceReady(w)
    const ours = join(dir, 'ours.txt')
    const control = join(dir, 'control.txt')
    noteInternalWrite(ours)
    await writeFile(ours, 'internal', 'utf8')
    await writeFile(control, 'external', 'utf8')
    // Wait until the live control write is observed — proves the watcher is active.
    await waitFor(() => events.some((e) => e.path === control))
    expect(events.some((e) => e.path === ours)).toBe(false)  // suppressed
    expect(events.some((e) => e.path === control)).toBe(true) // not suppressed
  })

  test('stopWatch halts further events', async () => {
    const w = startWatch(dir, (e) => events.push(e))
    await onceReady(w)
    const live = join(dir, 'live.txt')
    await writeFile(live, 'x', 'utf8')
    await waitFor(() => events.some((e) => e.path === live))  // watcher proven live
    stopWatch(dir)
    events.length = 0
    await writeFile(join(dir, 'after.txt'), 'y', 'utf8')
    await new Promise((r) => setTimeout(r, 800))
    expect(events.length).toBe(0)
  })
})
