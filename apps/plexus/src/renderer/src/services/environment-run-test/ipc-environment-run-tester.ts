import { EnvironmentRunTesterKey, type IEnvironmentRunTester, type RunTestResult } from '@pragmatic-tech-ai/plexus-core/renderer/modules/environment-run-test'
import { RelayWire, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { IRunTestBridge } from '../../../../shared/run-test-api.js'

// The renderer-side environment run-tester: the concrete IEnvironmentRunTester plexus-core's
// RunTestContributor resolves (through EnvironmentRunTesterKey). A thin wrapper over the preload bridge
// (window.api.runTest) that unwraps the RelayReply, so a failure rejects with its sentence. The load and
// the account session stay in main.
export class IpcEnvironmentRunTester implements IEnvironmentRunTester
{
    public static readonly Key = EnvironmentRunTesterKey

    private static readonly BridgeUnavailable =
        'IpcEnvironmentRunTester: window.api.runTest is unavailable — the Electron preload '
        + 'bridge did not load. This service requires a desktop host.'

    private readonly api: IRunTestBridge

    constructor()
    {
        const bridge = (globalThis as unknown as { api?: { runTest?: IRunTestBridge } }).api
        if (bridge?.runTest === undefined)
        {
            throw new Error(IpcEnvironmentRunTester.BridgeUnavailable)
        }
        this.api = bridge.runTest
    }

    public async Run(target: TargetRef, outputDir: string): Promise<RunTestResult>
    {
        return RelayWire.Unwrap(await this.api.Run(IpcEnvironmentRunTester.Wire(target), outputDir))
    }

    // Only Name and Source cross the bridge, whatever else the caller's object carries.
    private static Wire(target: TargetRef): TargetRef
    {
        return { Name: target.Name, Source: target.Source }
    }
}

export default IpcEnvironmentRunTester
