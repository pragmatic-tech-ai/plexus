import {
  monacoToLspPosition, lspToMonacoRange, monacoToLspRange,
  type LspRange, type MonacoRange, type MonacoPosition,
} from './position.js'

// Pure LSP↔Monaco provider adapters. They take a requester (the language client)
// + a model-like (only needs its URI string) + a Monaco position, issue an LSP
// request, and map the response to neutral Monaco-shaped objects. No runtime
// monaco import, so they are headless-testable; the registration shim
// (register-providers.ts) constructs monaco.Uri and registers them.

// Non-generic so a plain test fake ({ sendRequest: async () => ... }) and the
// client's generic sendRequest both satisfy it; adapters cast the result.
export interface LspRequester { sendRequest(method: string, params: unknown): Promise<unknown> }
export interface ModelLike { uri: { toString(): string } }

export interface HoverResult { contents: Array<{ value: string }>; range?: MonacoRange }
export interface LocationResult { uri: string; range: MonacoRange }
export interface CompletionItemResult { label: string; kind?: number; insertText: string; detail?: string; documentation?: string }
export interface CompletionResult { suggestions: CompletionItemResult[] }

function textDocumentParams(model: ModelLike, position: MonacoPosition): unknown {
  return { textDocument: { uri: model.uri.toString() }, position: monacoToLspPosition(position) }
}

type LspMarkup = string | { value: string }
interface LspHover { contents: LspMarkup | LspMarkup[]; range?: LspRange }

function hoverText(contents: LspHover['contents']): string {
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) return contents.map((c) => (typeof c === 'string' ? c : c.value)).join('\n')
  return contents.value
}

export async function provideHover(req: LspRequester, model: ModelLike, position: MonacoPosition): Promise<HoverResult | null> {
  const res = (await req.sendRequest('textDocument/hover', textDocumentParams(model, position))) as LspHover | null
  if (res == null) return null
  const out: HoverResult = { contents: [{ value: hoverText(res.contents) }] }
  if (res.range !== undefined) out.range = lspToMonacoRange(res.range)
  return out
}

interface LspLocation { uri: string; range: LspRange }

function toLocations(res: LspLocation | LspLocation[] | null): LocationResult[] {
  const list = res == null ? [] : Array.isArray(res) ? res : [res]
  return list.map((l) => ({ uri: l.uri, range: lspToMonacoRange(l.range) }))
}

export async function provideDefinition(req: LspRequester, model: ModelLike, position: MonacoPosition): Promise<LocationResult[]> {
  return toLocations((await req.sendRequest('textDocument/definition', textDocumentParams(model, position))) as LspLocation | LspLocation[] | null)
}

export async function provideReferences(req: LspRequester, model: ModelLike, position: MonacoPosition): Promise<LocationResult[]> {
  const params = { ...(textDocumentParams(model, position) as object), context: { includeDeclaration: true } }
  return toLocations((await req.sendRequest('textDocument/references', params)) as LspLocation | LspLocation[] | null)
}

interface LspCompletionItem { label: string; kind?: number; insertText?: string; detail?: string; documentation?: string | { value: string } }
type LspCompletionResponse = LspCompletionItem[] | { items: LspCompletionItem[] } | null

export async function provideCompletion(req: LspRequester, model: ModelLike, position: MonacoPosition): Promise<CompletionResult> {
  const res = (await req.sendRequest('textDocument/completion', textDocumentParams(model, position))) as LspCompletionResponse
  const items = res == null ? [] : Array.isArray(res) ? res : res.items
  return {
    suggestions: items.map((it): CompletionItemResult => {
      const doc = typeof it.documentation === 'string' ? it.documentation : it.documentation?.value
      const out: CompletionItemResult = { label: it.label, insertText: it.insertText ?? it.label }
      if (it.kind !== undefined) out.kind = it.kind
      if (it.detail !== undefined) out.detail = it.detail
      if (doc !== undefined) out.documentation = doc
      return out
    }),
  }
}

export interface FoldingRangeResult { start: number; end: number; kind?: string }

export async function provideFoldingRanges(req: LspRequester, model: ModelLike): Promise<FoldingRangeResult[]> {
  const res = (await req.sendRequest('textDocument/foldingRange', { textDocument: { uri: model.uri.toString() } })) as Array<{ startLine: number; endLine: number; kind?: string }> | null
  return (res ?? []).map((r) => {
    const out: FoldingRangeResult = { start: r.startLine + 1, end: r.endLine + 1 }
    if (r.kind !== undefined) out.kind = r.kind
    return out
  })
}

export interface SymbolResult {
  name: string
  detail: string
  kind: number
  range: MonacoRange
  selectionRange: MonacoRange
  children: SymbolResult[]
}

interface LspDocumentSymbol {
  name: string
  detail?: string
  kind: number
  range: LspRange
  selectionRange: LspRange
  children?: LspDocumentSymbol[]
}

function toSymbol(s: LspDocumentSymbol): SymbolResult {
  return {
    name: s.name,
    detail: s.detail ?? '',
    kind: s.kind,
    range: lspToMonacoRange(s.range),
    selectionRange: lspToMonacoRange(s.selectionRange),
    children: (s.children ?? []).map(toSymbol),
  }
}

export async function provideDocumentSymbols(req: LspRequester, model: ModelLike): Promise<SymbolResult[]> {
  const res = (await req.sendRequest('textDocument/documentSymbol', { textDocument: { uri: model.uri.toString() } })) as LspDocumentSymbol[] | null
  return (res ?? []).map(toSymbol)
}

export interface SemanticTokensResult { data: number[] }

export async function provideDocumentSemanticTokens(req: LspRequester, model: ModelLike): Promise<SemanticTokensResult> {
  const res = (await req.sendRequest('textDocument/semanticTokens/full', { textDocument: { uri: model.uri.toString() } })) as { data: number[] } | null
  return { data: res?.data ?? [] }
}

export interface SignatureHelpResult {
  signatures: Array<{ label: string; documentation?: string; parameters: Array<{ label: string }> }>
  activeSignature: number
  activeParameter: number
}

interface LspSignatureHelp {
  signatures: Array<{ label: string; documentation?: string | { value: string }; parameters?: Array<{ label: string | [number, number] }> }>
  activeSignature?: number
  activeParameter?: number
}

// The write-path adapters need to both request and apply edits.
export interface LspEditClient extends LspRequester {
  applyWorkspaceEdit(edit: { changes?: Record<string, LspTextEdit[]> }): Promise<void>
}

export interface LspTextEdit { range: LspRange; newText: string }

export interface PrepareRenameResult { range: MonacoRange; text: string }

export async function providePrepareRename(req: LspRequester, model: ModelLike, position: MonacoPosition): Promise<PrepareRenameResult | null> {
  const res = (await req.sendRequest('textDocument/prepareRename', textDocumentParams(model, position))) as
    { range: LspRange; placeholder?: string } | LspRange | null
  if (res == null) return null
  const range = 'range' in res ? res.range : res
  const text = 'placeholder' in res && res.placeholder !== undefined ? res.placeholder : ''
  return { range: lspToMonacoRange(range), text }
}

// Delegate the rename WorkspaceEdit to the client's unified apply path, and
// return an empty Monaco edit so Monaco applies nothing itself (it would drop
// closed-file edits). Loses Monaco's native rename preview (flagged, v1).
export async function provideRenameEdits(client: LspEditClient, model: ModelLike, position: MonacoPosition, newName: string): Promise<{ edits: [] }> {
  const params = { ...(textDocumentParams(model, position) as object), newName }
  const edit = (await client.sendRequest('textDocument/rename', params)) as { changes?: Record<string, LspTextEdit[]> } | null
  if (edit !== null && edit.changes !== undefined) await client.applyWorkspaceEdit(edit)
  return { edits: [] }
}

export interface CodeActionResult { title: string; kind?: string; edits: Array<{ uri: string; range: MonacoRange; text: string }> }

interface LspCodeAction { title: string; kind?: string; edit?: { changes?: Record<string, LspTextEdit[]> } }

export async function provideCodeActions(req: LspRequester, model: ModelLike, range: MonacoRange, diagnostics: unknown[]): Promise<CodeActionResult[]> {
  const params = { textDocument: { uri: model.uri.toString() }, range: monacoToLspRange(range), context: { diagnostics } }
  const res = (await req.sendRequest('textDocument/codeAction', params)) as LspCodeAction[] | null
  return (res ?? []).map((a) => {
    const edits: Array<{ uri: string; range: MonacoRange; text: string }> = []
    for (const [uri, textEdits] of Object.entries(a.edit?.changes ?? {})) {
      for (const e of textEdits) edits.push({ uri, range: lspToMonacoRange(e.range), text: e.newText })
    }
    const out: CodeActionResult = { title: a.title, edits }
    if (a.kind !== undefined) out.kind = a.kind
    return out
  })
}

export async function provideFormattingEdits(req: LspRequester, model: ModelLike): Promise<Array<{ range: MonacoRange; text: string }>> {
  const res = (await req.sendRequest('textDocument/formatting', {
    textDocument: { uri: model.uri.toString() }, options: { tabSize: 2, insertSpaces: true },
  })) as LspTextEdit[] | null
  return (res ?? []).map((e) => ({ range: lspToMonacoRange(e.range), text: e.newText }))
}

export async function provideSignatureHelp(req: LspRequester, model: ModelLike, position: MonacoPosition): Promise<SignatureHelpResult | null> {
  const res = (await req.sendRequest('textDocument/signatureHelp', textDocumentParams(model, position))) as LspSignatureHelp | null
  if (res == null) return null
  return {
    signatures: res.signatures.map((s) => {
      const doc = typeof s.documentation === 'string' ? s.documentation : s.documentation?.value
      const sig: { label: string; documentation?: string; parameters: Array<{ label: string }> } = {
        label: s.label,
        parameters: (s.parameters ?? []).map((p) => ({ label: typeof p.label === 'string' ? p.label : s.label.slice(p.label[0], p.label[1]) })),
      }
      if (doc !== undefined) sig.documentation = doc
      return sig
    }),
    activeSignature: res.activeSignature ?? 0,
    activeParameter: res.activeParameter ?? 0,
  }
}
