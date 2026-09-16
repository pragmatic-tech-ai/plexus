import { describe, expect, test, vi } from 'vitest'
import { FileChangeKind, type FileChangeEvent, type IFileWatchApi } from '../../../../../shared/file-watch-api.js'
import { FileWatchService } from '../file-watch-service.js'
import { ProjectExplorerService } from '../../../modules/project-explorer/services/project-explorer-service.js'

// Minimal fakes: a fake preload bridge and a fake explorer exposing an OpenProjects
// collection with a Subscribe(cb) + ToArray().
function makeBridge() {
  let changedCb: ((e: FileChangeEvent) => void) | undefined
  const watch = vi.fn(async () => {})
  const unwatch = vi.fn(async () => {})
  const api: IFileWatchApi = {
    watch, unwatch,
    onChanged: (cb) => { changedCb = cb; return () => { changedCb = undefined } },
  }
  return { api, watch, unwatch, fire: (e: FileChangeEvent) => changedCb?.(e) }
}

function makeExplorer(folders: string[]) {
  let subCb: (() => void) | undefined
  const items = folders.map((f) => ({ Folder: f }))
  const OpenProjects = {
    ToArray: () => items.slice(),
    Subscribe: (cb: () => void) => { subCb = cb; return () => { subCb = undefined } },
    _set: (next: string[]) => { items.length = 0; next.forEach((f) => items.push({ Folder: f })); subCb?.() },
  }
  return { OpenProjects }
}

function makeProvider(explorer: unknown) {
  return {
    getRequired: (key: unknown) => {
      if (key === ProjectExplorerService.Key) return explorer
      throw new Error('unexpected key')
    },
  }
}

describe('FileWatchService', () => {
  test('watches the roots of already-open projects on construction', () => {
    const b = makeBridge()
    ;(globalThis as unknown as { api?: unknown }).api = { fileWatch: b.api }
    const explorer = makeExplorer(['C:/proj/a'])
    const svc = new FileWatchService(makeProvider(explorer) as never)
    expect(b.watch).toHaveBeenCalledWith('C:/proj/a')
    svc.dispose()
  })

  test('watches on open and unwatches on close', () => {
    const b = makeBridge()
    ;(globalThis as unknown as { api?: unknown }).api = { fileWatch: b.api }
    const explorer = makeExplorer([])
    const svc = new FileWatchService(makeProvider(explorer) as never)
    ;(explorer.OpenProjects as unknown as { _set: (f: string[]) => void })._set(['C:/proj/b'])
    expect(b.watch).toHaveBeenCalledWith('C:/proj/b')
    ;(explorer.OpenProjects as unknown as { _set: (f: string[]) => void })._set([])
    expect(b.unwatch).toHaveBeenCalledWith('C:/proj/b')
    svc.dispose()
  })

  test('broadcasts Changed events to subscribers', () => {
    const b = makeBridge()
    ;(globalThis as unknown as { api?: unknown }).api = { fileWatch: b.api }
    const explorer = makeExplorer([])
    const svc = new FileWatchService(makeProvider(explorer) as never)
    const seen: FileChangeEvent[] = []
    svc.Subscribe((e) => seen.push(e))
    b.fire({ path: 'C:/proj/b/x.todl', kind: FileChangeKind.Changed })
    expect(seen).toEqual([{ path: 'C:/proj/b/x.todl', kind: FileChangeKind.Changed }])
    svc.dispose()
  })
})
