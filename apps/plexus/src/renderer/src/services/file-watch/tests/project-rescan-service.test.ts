import { describe, expect, test, vi } from 'vitest'
import { FileChangeKind, type FileChangeEvent } from '../../../../../shared/file-watch-api.js'
import { ProjectRescanService } from '../project-rescan-service.js'
import { FileWatchService } from '../file-watch-service.js'
import { ProjectExplorerService } from '../../../modules/project-explorer/services/project-explorer-service.js'
import { EnvironmentService } from '../../environment/environment-service.js'

function harness(folders: string[]) {
  let changedCb: ((e: FileChangeEvent) => void) | undefined
  const fileWatch = { Subscribe: (cb: (e: FileChangeEvent) => void) => { changedCb = cb; return () => {} } }
  const RefreshProjects = vi.fn(async () => {})
  const explorer = {
    OpenProjects: { ToArray: () => folders.map((f) => ({ Folder: f })) },
    RefreshProjects,
  }
  const env = { IsWindows: true }
  const provider = {
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
