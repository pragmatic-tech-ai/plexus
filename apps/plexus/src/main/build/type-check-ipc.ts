import type { IpcMain } from 'electron'
import type { ITypeChecker, TypeCheckRequest } from '@pragmatic-tech-ai/todl/build-system-core'
import { TypeCheckChannel } from '@pragmatic-tech-ai/plexus-core/shared/type-check-api.js'

/** Wires the type-check IPC handler in the Electron main process. */
export class TypeCheckIpc
{
    public static Register(ipc: IpcMain, checker: ITypeChecker): void
    {
        ipc.handle(TypeCheckChannel.Check, (_event, request: TypeCheckRequest) => checker.Check(request))
    }
}
