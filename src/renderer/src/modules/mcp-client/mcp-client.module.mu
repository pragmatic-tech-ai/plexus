// mcp-client.module.mu — the MCP Client module.
//
// Contributes the "MCP Servers" capability: a left-rail panel to register and
// manage external MCP servers (stdio + HTTP/SSE) that the agent may use, with
// per-server tool gating and import from the user's Claude config. A pure
// contributor — one service + a Capability nav entry; the panel is rendered by
// DataTemplate[McpServersService] in mcp-client.resources.mu (merged app-global).

import McpServersService from "./services/mcp-servers-service.js"

module McpClientModule [ Name = "McpClient" ] {
    .services: {
        McpServersService
    }

    Capability [ Name = "MCP Servers", Icon = @Mcp, ServiceKey = McpServersService ]
}
