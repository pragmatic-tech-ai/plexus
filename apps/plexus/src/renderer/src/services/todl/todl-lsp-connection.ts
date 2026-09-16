import {
  AbstractMessageReader, AbstractMessageWriter, createMessageConnection,
  type MessageConnection, type DataCallback, type Message, type Disposable,
} from 'vscode-jsonrpc'
import type { ITodlLspApi } from '../../../../shared/todl-lsp-api.js'

// A JSON-RPC MessageConnection over the opaque preload pipe. Whole message
// objects cross IPC (the main-process relay already did the stdio Content-Length
// framing), so there is no framing here — the reader just hands each delivered
// object to the connection, and the writer forwards each outgoing object.
class BridgeReader extends AbstractMessageReader {
  constructor(private readonly bridge: ITodlLspApi) { super() }
  listen(callback: DataCallback): Disposable {
    const off = this.bridge.onMessage((msg) => callback(msg as Message))
    return { dispose: off }
  }
}

class BridgeWriter extends AbstractMessageWriter {
  constructor(private readonly bridge: ITodlLspApi) { super() }
  async write(msg: Message): Promise<void> { this.bridge.send(msg) }
  end(): void {}
}

export function createTodlLspConnection(bridge: ITodlLspApi): MessageConnection {
  const conn = createMessageConnection(new BridgeReader(bridge), new BridgeWriter(bridge))
  conn.listen()
  return conn
}
