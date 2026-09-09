// Minimal MCP server over stdio exposing two no-op tools, for McpClient tests.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({ name: 'stub', version: '0.0.0' })
const ok = async () => ({ content: [{ type: 'text', text: 'ok' }] })
server.registerTool('alpha', { description: 'a' }, ok)
server.registerTool('beta', { description: 'b' }, ok)
await server.connect(new StdioServerTransport())
