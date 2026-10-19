import { describe, expect, it } from 'vitest'
import { AppWriteStatus } from '@pragmatic-tech-ai/pragmatic-protocol'
import { TenantPublishStatus } from '@pragmatic-tech-ai/plexus-core/shared/tenant-publish-api.js'

// The renderer-safe local enum is cast from the wire enum in TenantDeployService; this pins the
// two value sets together so wire drift fails here instead of silently breaking status mapping.
describe('TenantPublishStatus vs protocol AppWriteStatus', () =>
{
    it('has exactly the same value set', () =>
    {
        const local = Object.values(TenantPublishStatus).sort()
        const wire = Object.values(AppWriteStatus).sort()
        expect(local).toEqual(wire)
    })
})
