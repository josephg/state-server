import { IncomingMessage, ServerResponse } from "http";
import asyncstream from 'ministreamiterator'

interface StateServerOpts<T> {
  initialVerson?: string
  initialValue?: T
  patchType?: 'snapshot' | 'merge-object' | string
  contentType?: string
  httpHeaders?: {[k: string]: string | any},
  // innerHeaders?: {[k: string]: string | any},

  /**
   * Handler called once when the peer disconnects
   */
  onclose?: () => void

  /**
   * Send a heartbeat message every (seconds). Defaults to every 30 seconds.
   * This is needed to avoid some browsers closing the connection automatically
   * after a 1 minute timeout.
   * 
   * Set to `null` to disable heartbeat messages.
   */
  heartbeatSecs?: number | null
}

export interface MaybeFlushable {
  flush?: () => void
}

interface StateMessage {
  headers?: {[k: string]: string | any},
  data: any, // patch
  version?: string | any
}

const writeHeaders = (stream: ServerResponse, headers: Record<string, string>) => {
  stream.write(
    Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')
    + '\r\n'
  )
}

export default function stream<T>(res: ServerResponse & MaybeFlushable, opts: StateServerOpts<T> = {}) {
  // These headers are sent both in the HTTP response and in the first SSE
  // message, because there's no API for reading these headers back from
  // EventSource in the browser.

  const httpHeaders: Record<string, string> = {
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
    // ...innerHeaders,
    ...opts.httpHeaders
  }

  if (opts.contentType) httpHeaders['content-type'] = opts.contentType
  if (opts.patchType) httpHeaders['patch-type'] = opts.patchType

  res.writeHead(209, 'Subscription', httpHeaders)

  let connected = true

  const stream = asyncstream<StateMessage>(() => {
    connected = false
    res.end() // will fire res.emit('close') if not already closed
  })

  res.once('close', () => {
    connected = false
    stream.end()
    opts.onclose?.()
  })

  // if (opts.heartbeatSecs !== null) {
  //   ;(async () => {
  //     // 30 second heartbeats to avoid timeouts
  //     while (true) {
  //       await new Promise(res => setTimeout(res, 30*1000))

  //       if (!connected) break
        
  //       res.write(`:\n`);
  //       // res.write(`event: heartbeat\ndata: \n\n`);
  //       // res.write(`data: {}\n\n`)
  //       res.flush?.()
  //     }
  //   })()
  // }

  ;(async () => {
    if (connected) {
      for await (const val of stream.iter) {
        if (!connected) break
        console.log('got val', val)

        const data = Buffer.from(`${JSON.stringify(val)}\n`, 'utf8')

        const patchHeaders: Record<string, string> = {
          // 'content-type': 'application/json',
          // 'patch-type': 'snapshot',
          'content-length': `${data.length}`,
          ...val.headers
        }
        if (val.version) patchHeaders['version'] = val.version

        writeHeaders(res, patchHeaders)
        res.write(data)
        res.flush?.()
      }
    }
  })()

  // let headersSent = false
  const append = (patch: any, version?: string) => {
    if (!connected) return

    let message: StateMessage = {data: patch}
    if (version != null) message.version = version

    console.log('append', message)
    stream.append(message)
  }

  // if (opts.initialValue !== undefined) {
  //   append(opts.initialValue, opts.initialVerson)
  // }

  return { stream, append }
}

module.exports = stream
