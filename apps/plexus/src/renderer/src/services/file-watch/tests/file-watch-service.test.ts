import { describe, expect, test, vi } from 'vitest'
import { FileChangeKind, type FileChangeEvent, type IFileWatchApi } from '@pragmatic-tech-ai/plexus-core/shared/file-watch-api.js'
import { FileWatchService } from '../file-watch-service.js'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { FakeSolutionManager } from '../../solution/tests/fake-solution-manager.js'

// Minimal fakes: a fake preload bridge and a fake SolutionManagerService whose
// ActiveSolution.Members carries the open projects.
function makeBridge()
{
  let changedCb: ((e: FileChangeEvent) => void) | undefined
  const watch = vi.fn(async () => {})
  const unwatch = vi.fn(async () => {})
  const api: IFileWatchApi = {
    watch, unwatch,
    onChanged: (cb) => { changedCb = cb; return () => { changedCb = undefined } },
  }
  return { api, watch, unwatch, fire: (e: FileChangeEvent) => changedCb?.(e) }
}

function makeManager(folders: string[])
{
  const manager = new FakeSolutionManager()
  for (const f of folders) manager.AddResolved({ RootPath: f, Name: f })
  return manager
}

function makeProvider(manager: FakeSolutionManager)
{
  const provider = new ServiceProvider()
  manager.RegisterOn(provider)
  return provider
}

describe('FileWatchService', () => {
  test('watches the roots of already-open projects on construction', () => {
    const b = makeBridge()
    ;(globalThis as unknown as { api?: unknown }).api = { fileWatch: b.api }
    const manager = makeManager(['C:/proj/a'])
    const svc = new FileWatchService(makeProvider(manager) as never)
    expect(b.watch).toHaveBeenCalledWith('C:/proj/a')
    svc.dispose()
  })

  test('watches on open and unwatches on close', () => {
    const b = makeBridge()
    ;(globalThis as unknown as { api?: unknown }).api = { fileWatch: b.api }
    const manager = makeManager([])
    const svc = new FileWatchService(makeProvider(manager) as never)
    const added = manager.AddResolved({ RootPath: 'C:/proj/b', Name: 'b' })
    expect(b.watch).toHaveBeenCalledWith('C:/proj/b')
    manager.Remove(added)
    expect(b.unwatch).toHaveBeenCalledWith('C:/proj/b')
    svc.dispose()
  })

  test('broadcasts Changed events to subscribers', () => {
    const b = makeBridge()
    ;(globalThis as unknown as { api?: unknown }).api = { fileWatch: b.api }
    const manager = makeManager([])
    const svc = new FileWatchService(makeProvider(manager) as never)
    const seen: FileChangeEvent[] = []
    svc.Subscribe((e) => seen.push(e))
    b.fire({ path: 'C:/proj/b/x.todl', kind: FileChangeKind.Changed })
    expect(seen).toEqual([{ path: 'C:/proj/b/x.todl', kind: FileChangeKind.Changed }])
    svc.dispose()
  })
})
