// tenant-explorer.module.mu — the Tenant Explorer module: a rail Capability whose
// left-panel content is served by TenantExplorerService.

import TenantExplorerService from "./services/tenant-explorer-service.js"

shell module TenantExplorerModule [ Name = "Tenant Explorer" ] {
    .services: { TenantExplorerService }

    Capability [ Name = "Tenant Explorer", Icon = @ServerEnvironment, ServiceKey = TenantExplorerService, Order = 20 ]
}
