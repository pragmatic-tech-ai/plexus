// The main↔renderer contract for the TODL language server. An opaque pipe: it
// carries already-framed JSON-RPC *message objects* (never LSP types), so no
// language knowledge crosses the boundary. Mirrors the agent-api.ts pattern.
export enum TodlLspChannel {
  ToServer = 'todl-lsp:to-server', // renderer → main → child stdin
  FromServer = 'todl-lsp:from-server', // child stdout → main → renderer
  ServerRestart = 'todl-lsp:server-restart', // main → renderer, resync signal
}

// The preload bridge exposed as window.api.todlLsp. Opaque: unknown-typed
// messages, no LSP shapes leak across the context boundary.
export interface ITodlLspApi {
  send(msg: unknown): void
  onMessage(cb: (msg: unknown) => void): () => void
  onServerRestart(cb: () => void): () => void
}
