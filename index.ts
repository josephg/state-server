import { IncomingMessage, ServerResponse } from "http";
import asyncstream from 'ministreamiterator'

interface StateServerOpts<T> {
  initialVerson?: string
  initialValue?: T
  patchType?: 'full-snapshot' | 'merge-object' | string
  contentType?: string
  httpHeaders?: {[k: string]: string | any},
  innerHeaders?: {[k: string]: string | any},

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

export default function stream<T>(res: ServerResponse & MaybeFlushable, opts: StateServerOpts<T> = {}) {
  // These headers are sent both in the HTTP response and in the first SSE
  // message, because there's no API for reading these headers back from
  // EventSource in the browser.
  const innerHeaders = {
    'braid-version': '0.1',
    'inner-content-type': opts.contentType ?? 'application/json',
    'patch-type': opts.patchType ?? 'full-snapshot',
    ...opts.innerHeaders
  }

  res.writeHead(200, 'OK', {
    'cache-control': 'no-cache',
    'content-type': 'text/event-stream',
    'connection': 'keep-alive',
    ...innerHeaders,
    ...opts.httpHeaders
  })

  let connected = true

  const stream = asyncstream(() => {
    connected = false
    res.end() // will fire res.emit('close') if not already closed
  })

  res.once('close', () => {
    connected = false
    stream.end()
    opts.onclose?.()
  })

  if (opts.heartbeatSecs !== null) {
    ;(async () => {
      // 30 second heartbeats to avoid timeouts
      while (true) {
        await new Promise(res => setTimeout(res, 30*1000))

        if (!connected) break
        
        res.write(`:\n`);
        // res.write(`event: heartbeat\ndata: \n\n`);
        // res.write(`data: {}\n\n`)
        res.flush?.()
      }
    })()
  }

  ;(async () => {
    while (connected) {
      for await (const val of stream.iter) {
        console.log('got val')
        res.write(`data: ${JSON.stringify(val)}\n\n`)
        res.flush?.()
      }
    }
  })()

  let headersSent = false
  const append = (patch: any, version?: string) => {
    if (!connected) return

    let message: StateMessage = {data: patch}
    if (version != null) message.version = version

    if (!headersSent) {
      message.headers = innerHeaders
      headersSent = true
    }

    console.log('append', message)
    stream.append(message)
  }

  if (opts.initialValue !== undefined) {
    append(opts.initialValue, opts.initialVerson)
  }

  return { stream, append }
}

module.exports = stream
