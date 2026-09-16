import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import { TodlLspChannel } from '../../shared/todl-lsp-api.js'

// The minimum a forked child must expose for the relay. Kept as a structural
// type (not an electron UtilityProcess) so the host is unit-testable with an
// in-memory fake child and carries no electron import.
export interface ChildLike {
  stdout: NodeJS.ReadableStream
  stdin: NodeJS.WritableStream
  on(event: 'exit', cb: () => void): void
  kill(): void
}

// Dumb, semantics-blind relay owning the forked server's lifecycle. It frames
// the child's stdio with vscode-jsonrpc purely to move whole JSON-RPC message
// objects across IPC; it never interprets them. Restarts the child on crash and
// signals the renderer to resync. Electron wiring lives in ./register.ts so this
// class stays headless-testable.
export class TodlServerHost {
  private child: ChildLike | undefined
  private writer: StreamMessageWriter | undefined
  private disposed = false

  constructor(
    private readonly spawnChild: () => ChildLike,
    private readonly emit: (channel: string, msg?: unknown) => void,
  ) {}

  start(): void {
    const child = this.spawnChild()
    this.child = child
    new StreamMessageReader(child.stdout).listen((msg) => this.emit(TodlLspChannel.FromServer, msg))
    this.writer = new StreamMessageWriter(child.stdin)
    child.on('exit', () => {
      if (this.disposed) return
      this.emit(TodlLspChannel.ServerRestart)
      this.start()
    })
  }

  send(msg: unknown): void {
    void this.writer?.write(msg as never)
  }

  dispose(): void {
    this.disposed = true
    this.child?.kill()
  }
}
