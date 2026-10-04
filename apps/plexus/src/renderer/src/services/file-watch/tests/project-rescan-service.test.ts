import { describe, expect, test, vi } from 'vitest'
import { FileChangeKind, type FileChangeEvent } from '@pragmatic-tech-ai/plexus-core/shared/file-watch-api.js'
import { ProjectRescanService } from '../project-rescan-service.js'
import { FileWatchService } from '../file-watch-service.js'
import { ProjectExplorerService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/project-explorer'
import { SolutionManagerService } from '@pragmatic-tech-ai/todl'
import { FakeSolutionManager } from '../../solution/tests/fake-solution-manager.js'
import { EnvironmentService } from '@pragmatic-tech-ai/plexus-core/renderer/environment/environment-service.js'

function harness(folders: string[])
{
  let changedCb: ((e: FileChangeEvent) => void) | undefined
  const fileWatch = { Subscribe: (cb: (e: FileChangeEvent) => void) => { changedCb = cb; return () => {} } }
  const RefreshProjects = vi.fn(async () => {})
  const explorer = { RefreshProjects }
  const manager = new FakeSolutionManager()
  for (const f of folders) manager.AddResolved({ RootPath: f, Name: f })
  const env = { IsWindows: true }
  const provider = {
    get: (key: unknown) => (key === SolutionManagerService.Key ? manager : undefined),
    getRequired: (key: unknown) => {
      if (key === FileWatchService.Key) return fileWatch
      if (key === ProjectExplorerService.Key) return explorer
      if (key === EnvironmentService.Key) return env
      throw new Error('unexpected key')
    },
  }
  const svc = new ProjectRescanService(provider as never)
  return { svc, fire: (e: FileChangeEvent) => changedCb?.(e), RefreshProjects }
}

describe('ProjectRescanService', () => {
  test('debounces a burst of changes into ONE RefreshProjects for the owning folder', async () => {
    vi.useFakeTimers()
    const h = harness(['C:/proj/a'])
    for (let i = 0; i < 5; i++) h.fire({ path: `C:/proj/a/src/f${i}.todl`, kind: FileChangeKind.Changed })
    await vi.advanceTimersByTimeAsync(300)
    expect(h.RefreshProjects).toHaveBeenCalledTimes(1)
    expect(h.RefreshProjects).toHaveBeenCalledWith(['C:/proj/a'])
    vi.useRealTimers()
  })

  test('ignores a change outside every open project', async () => {
    vi.useFakeTimers()
    const h = harness(['C:/proj/a'])
    h.fire({ path: 'C:/elsewhere/x.todl', kind: FileChangeKind.Changed })
    await vi.advanceTimersByTimeAsync(300)
    expect(h.RefreshProjects).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
