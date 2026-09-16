import { test, expect } from 'vitest'
import { ServiceProvider, ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import { DiagnosticsService } from '../../../services/diagnostics/diagnostics-service.js'
import { ProblemsService, ProblemsServiceKey } from '../problems-service.js'

// Regression for the Status-region dock never rendering: the ShellControlDefinition
// declares `DataContext = <token>` and the shell resolves it via
// provider.get(def.DataContext) with NO class→Key normalization. So the .mu must
// reference the ServiceKey INSTANCE (ProblemsServiceKey), not the ProblemsService
// class — otherwise the lookup misses and the control is silently dropped.
test('ProblemsServiceKey is the ServiceKey the shell resolves the dock DataContext through', () => {
    const provider = new ServiceProvider()
    provider.registerInstance(DiagnosticsService.Key, new DiagnosticsService(provider))
    // Registered exactly as the module does — under the service's Key token.
    provider.registerInstance(ProblemsService.Key, new ProblemsService(provider))

    expect(ProblemsServiceKey).toBeInstanceOf(ServiceKey)
    expect(ProblemsServiceKey).toBe(ProblemsService.Key)
    // The shell does provider.get(def.DataContext); this must return the service.
    expect(provider.get(ProblemsServiceKey)).toBeInstanceOf(ProblemsService)
    // The class is NOT a resolvable token (proves why DataContext = <class> failed).
    expect(provider.get(ProblemsService as unknown as ServiceKey<ProblemsService>)).toBeUndefined()
})
