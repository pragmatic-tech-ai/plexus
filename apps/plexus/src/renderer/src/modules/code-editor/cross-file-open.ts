// A generic seam for routing Monaco cross-file navigation to the host app. Bare
// Monaco (monaco.editor.create) can only navigate go-to-definition within a
// model it already has loaded; jumping to a file that isn't open in a tab needs
// the app to open it. The app registers an opener; CodeEditor invokes it from
// Monaco's code-editor-open handler when the target resource isn't the current
// editor's model. Kept host-neutral (a URI string in, a boolean handled-flag
// out) so CodeEditor stays generic — the TODL-specific resolution lives in the
// bootstrap wiring.

export interface CrossFileSelection { startLineNumber?: number; startColumn?: number }

export type CrossFileOpener = (uri: string, selection?: CrossFileSelection) => boolean

let opener: CrossFileOpener | undefined

export function setCrossFileOpener(fn: CrossFileOpener): void { opener = fn }

// Returns true when an opener was set and it claimed the URI (so the caller can
// suppress Monaco's default handling); false otherwise.
export function handleCrossFileOpen(uri: string, selection?: CrossFileSelection): boolean {
  return opener !== undefined ? opener(uri, selection) : false
}
