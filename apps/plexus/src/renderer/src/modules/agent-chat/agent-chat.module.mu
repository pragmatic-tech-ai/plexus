// The Agent chat module — a ShellModule contributing one capability whose
// content is the AgentService, rendered by DataTemplate[DataType = AgentService]
// (agent-chat.resources.mu) in the shell's left panel.

import ChatSessionsService from "./services/chat-sessions-service.js"
import ChatStore from "./services/chat-store.js"
import ProjectAgentCatalog from "./services/project-agent-catalog.js"
import TemplateGalleryService from "./services/template-gallery-service.js"

module AgentChatModule [ Name = "Agent" ] {
    .services: {
        // Manager of the parallel agent conversations (dock tabs + nav panel).
        ChatSessionsService
        // Persistence for resumable conversations (userData/conversations.json).
        ChatStore
        // Per-project .claude/ agents + skills catalog cache (backs the project's
        // "Run Agent / Skill" submenu).
        ProjectAgentCatalog
        // Dev-only card gallery (a dock tab main.js seeds when IsDevelopment).
        TemplateGalleryService
    }
    // Left-rail capability: the Conversations panel (New / Open / Stored),
    // rendered by DataTemplate[ChatSessionsService] in conversations.resources.mu.
    Capability [ Name = "Conversations", Icon = @Conversations, ServiceKey = ChatSessionsService ]
}
