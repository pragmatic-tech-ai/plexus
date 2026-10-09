import type { ITypeChecker, TypeCheckRequest, TypeCheckResult } from '@pragmatic-tech-ai/todl/build-system-core'

/** Renderer ITypeChecker: forwards the request to the Electron main process over IPC. */
export class IpcTypeChecker implements ITypeChecker
{
    private static readonly MissingApiMessage = 'window.api.typeCheck is unavailable — the Electron preload bridge did not load'

    public async Check(request: TypeCheckRequest): Promise<TypeCheckResult>
    {
        const api = (globalThis as unknown as { api?: { typeCheck?: { Check(r: TypeCheckRequest): Promise<TypeCheckResult> } } }).api
        if (api?.typeCheck === undefined)
        {
            throw new Error(IpcTypeChecker.MissingApiMessage)
        }
        return api.typeCheck.Check(request)
    }
}
