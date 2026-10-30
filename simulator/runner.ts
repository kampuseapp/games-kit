// A web worker that runs a game's rules for the simulator, one call at a time, through the kit's judge
// (src/judge.ts: the same checks Kampuse makes). It keeps no game state between calls: the simulator holds
// the state and sends it with every call, as Kampuse does.

import { RulesError, fuzz, legalMoves, play, replay, rulesOf, show, type AnyRules, type FuzzOptions, type FuzzReport, type Has, type Note, type Shown, type Step } from '../src/judge'

export type { Note, Shown, Step }

export type RunnerReq =
  | { id: number; op: 'load'; url: string }
  | { id: number; op: 'step'; step: Step; state: unknown; players: number }
  | { id: number; op: 'replay'; steps: Step[]; players: number }
  | { id: number; op: 'moves'; state: unknown; side: number }
  | { id: number; op: 'fuzz'; opts: FuzzOptions }

export type RunnerRes =
  | {
      id: number
      ok: true
      notes: Note[]
      /** After load: which of the optional functions the rules have. */
      has?: Has
      /** After a step the rules took: the new state and what everyone sees. */
      state?: unknown
      shown?: Shown
      /** After a move the rules turned down: why. */
      refused?: string
      /** After a replay: the state it ended in, as JSON. */
      final?: string
      /** After moves: the moves a side could make. */
      moves?: unknown[]
      /** After a fuzz run. */
      report?: FuzzReport
    }
  | { id: number; ok: false; error: string; notes: Note[] }

const scope = self as unknown as { onmessage: ((e: MessageEvent<RunnerReq>) => void) | null; postMessage(msg: RunnerRes): void }

let rules: AnyRules | null = null

scope.onmessage = async (e) => {
  const req = e.data
  const notes: Note[] = []
  const reply = (fields: Omit<Extract<RunnerRes, { ok: true }>, 'id' | 'ok' | 'notes'>) => scope.postMessage({ id: req.id, ok: true, notes, ...fields })
  try {
    if (req.op === 'load') {
      const loaded = rulesOf(await import(/* @vite-ignore */ req.url), notes)
      rules = loaded.rules
      return reply({ has: loaded.has })
    }
    if (!rules) throw new RulesError('The rules are not loaded.')
    switch (req.op) {
      case 'step': {
        const out = play(rules, req.step, req.state, req.players, notes)
        if ('refused' in out) return reply({ refused: out.refused })
        return reply({ state: out.state, shown: show(rules, out.state, req.players, notes) })
      }
      // In a worker of its own (the simulator starts a fresh one), so nothing kept outside the state carries over.
      case 'replay':
        return reply({ final: replay(rules, req.steps, req.players) })
      case 'moves':
        return reply({ moves: legalMoves(rules, req.state, req.side, notes) ?? [] })
      case 'fuzz':
        return reply({ report: fuzz(rules, req.opts) })
    }
  } catch (err) {
    scope.postMessage({ id: req.id, ok: false, notes, error: err instanceof RulesError ? err.message : `The rules could not run: ${err instanceof Error ? err.message : String(err)}` })
  }
}
