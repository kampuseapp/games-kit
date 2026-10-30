// The simulator's line to the rules worker (runner.ts): one question at a time, each with a time
// limit. Rules that never answer (a loop that does not end) get the worker stopped and started again.

import type { Has } from '../src/judge'
import type { RunnerReq, RunnerRes } from './runner'

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never
/** A question for the worker, before it is numbered. */
type Ask = WithoutId<RunnerReq>

/** How long a call may take before the worker is stopped (ms). */
const STUCK_MS = 2_000

export class RulesRunner {
  private worker!: Worker
  private next = 1
  private waiting = new Map<number, { resolve: (res: RunnerRes) => void; reject: (e: Error) => void; timer: number }>()
  /** The optional functions the rules have, once loaded. */
  has: Has | null = null
  private loading: Promise<RunnerRes> | null = null

  constructor(readonly url: string) {
    this.spawn()
  }

  private spawn() {
    this.worker = new Worker(new URL('./runner.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<RunnerRes>) => {
      const wait = this.waiting.get(e.data.id)
      if (!wait) return
      clearTimeout(wait.timer)
      this.waiting.delete(e.data.id)
      wait.resolve(e.data)
    }
    this.worker.onerror = (e) => {
      e.preventDefault()
      this.failAll(new Error(`The rules worker failed: ${e.message || 'see the browser console'}`))
    }
    this.has = null
    this.loading = null
  }

  private failAll(error: Error) {
    for (const wait of this.waiting.values()) {
      clearTimeout(wait.timer)
      wait.reject(error)
    }
    this.waiting.clear()
  }

  /** Loads the rules module (again after a restart). */
  load(): Promise<RunnerRes> {
    this.loading ??= this.send({ op: 'load', url: `${this.url}?t=${Date.now()}` }, 10_000).then((res) => {
      if (res.ok && res.has) this.has = res.has
      return res
    })
    return this.loading
  }

  /** Asks the rules something, once they are loaded. Rejects only when the worker is stuck or broken. */
  async ask(req: Ask, ms = STUCK_MS): Promise<RunnerRes> {
    const loaded = await this.load()
    if (!loaded.ok) return loaded
    return this.send(req, ms)
  }

  private send(req: Ask, ms: number): Promise<RunnerRes> {
    const id = this.next++
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.waiting.delete(id)
        this.worker.terminate()
        this.failAll(new Error('The rules were stopped too.'))
        this.spawn()
        reject(new Error(`The rules did not answer within ${ms / 1000} s (a loop that never ends?). They were stopped and loaded again.`))
      }, ms)
      this.waiting.set(id, { resolve, reject, timer })
      this.worker.postMessage({ ...req, id } as RunnerReq)
    })
  }

  terminate() {
    this.failAll(new Error('The game was closed.'))
    this.worker.terminate()
  }
}
