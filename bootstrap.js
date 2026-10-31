import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

export const name = 'goal-mode'
export const inject = ['agents', 'goals', 'jobs', 'sessionQuery', 'storageDomain', 'connection']
const spec = defineDomain({
  name: 'goal_mode', version: 1,
  tables: { sessions: domainTable(z.object({ modelCreate: z.boolean(), continueWhileBusy: z.boolean(), interval: z.string().nullable() })) },
})
const MAX_TIMEOUT = 2 ** 31 - 1

/** Stable wait and timer ownership, independent of the current policy revision. */
export function createBridge(ctx, records) {
  const bridge = {
    records, current: null, closing: false, waiters: new Map(), timers: new Map(), operations: new Set(),
    runtime: { revision: null, pendingRevision: null, error: null },
  }
  let writeTail = Promise.resolve()
  function mutate(callback) {
    const result = writeTail.then(callback)
    writeTail = result.catch(() => {})
    return result
  }
  function release(id) { bridge.waiters.get(id)?.resolve() }
  function cancelTimer(id) {
    const timer = bridge.timers.get(id)
    if (!timer) return
    clearTimeout(timer.handle)
    bridge.timers.delete(id)
  }
  function schedule(timer) {
    timer.handle = setTimeout(() => {
      if (bridge.timers.get(timer.agent.id) !== timer) return
      const plan = bridge.current.timer(timer.agent)
      if (!plan || plan.interval !== timer.interval) { refresh(timer.agent.id); return }
      if (Date.now() < timer.due) { schedule(timer); return }
      bridge.current.deliver(timer.agent, timer.interval)
      if (bridge.timers.get(timer.agent.id) !== timer) return
      timer.due = Date.now() + timer.milliseconds
      schedule(timer)
    }, Math.min(MAX_TIMEOUT, Math.max(0, timer.due - Date.now())))
    timer.handle.unref?.()
  }
  function refresh(id) {
    for (const [sessionId, waiter] of bridge.waiters) {
      if (id !== undefined && sessionId !== id) continue
      const waiting = bridge.current.hold(waiter.agent)
      if (waiting === null) waiter.resolve()
      else waiter.waiting = waiting
    }
    const agents = id === undefined ? ctx.agents.list() : [ctx.agents.get(id)].filter(Boolean)
    for (const agent of agents) {
      const plan = bridge.current.timer(agent), previous = bridge.timers.get(agent.id)
      if (plan && previous?.agent === agent && previous.interval === plan.interval) continue
      cancelTimer(agent.id)
      if (!plan) continue
      const timer = { agent, ...plan, due: Date.now() + plan.milliseconds, handle: null }
      bridge.timers.set(agent.id, timer)
      schedule(timer)
    }
  }
  function hold({ agent, signal }) {
    if (signal.aborted || bridge.closing) return
    const waiting = bridge.current.hold(agent)
    if (waiting === null) return
    return new Promise(resolve => {
      const done = () => {
        signal.removeEventListener('abort', done)
        bridge.waiters.delete(agent.id)
        resolve()
      }
      bridge.waiters.set(agent.id, { agent, waiting, resolve: done })
      signal.addEventListener('abort', done, { once: true })
    })
  }
  function disposed(agent) {
    release(agent.id)
    cancelTimer(agent.id)
    refresh()
  }
  function close() {
    bridge.closing = true
    for (const waiter of bridge.waiters.values()) waiter.resolve()
    for (const id of bridge.timers.keys()) cancelTimer(id)
  }
  return Object.assign(bridge, { mutate, refresh, hold, release, disposed, close })
}

export async function apply(ctx) {
  const domain = await ctx.storageDomain.open(spec)
  const bridge = createBridge(ctx, domain.table('sessions'))
  const operation = callback => {
    const promise = Promise.resolve().then(callback)
    bridge.operations.add(promise)
    return promise.finally(() => bridge.operations.delete(promise))
  }
  let checking = false, rejected
  async function load(initial = false) {
    if (checking || bridge.closing) return
    checking = true
    let release
    try {
      try { release = JSON.parse(await readFile(new URL('./release.json', import.meta.url), 'utf8')) }
      catch (error) { if (!initial && error.code === 'ENOENT') return; throw error }
      if (!/^[a-f0-9]{12}$/.test(release.revision) || release.entry !== `./dist/host/${release.revision}/host.js`) throw new Error('Invalid Goal Mode release manifest')
      if (release.revision === bridge.runtime.revision || release.revision === rejected) return
      bridge.runtime.pendingRevision = release.revision
      if (!initial && bridge.operations.size) return
      const next = await import(new URL(release.entry, import.meta.url).href)
      if (bridge.closing || (!initial && bridge.operations.size)) return
      const runtime = next.createRuntime(ctx, bridge)
      for (const method of ['initialize', 'preExecute', 'hold', 'timer', 'deliver', 'jobEvent', 'get', 'set', 'cleanup']) {
        if (typeof runtime[method] !== 'function') throw new Error(`Missing Goal Mode method: ${method}`)
      }
      bridge.current = runtime
      bridge.runtime.revision = release.revision
      bridge.runtime.pendingRevision = null
      bridge.runtime.error = null
      if (!initial) bridge.refresh()
    } catch (error) {
      if (initial) throw error
      rejected = release?.revision
      bridge.runtime.error = error.message
      ctx.logger.warn(`Goal Mode update: ${error.message}`)
    } finally { checking = false }
  }
  ctx.effect(() => async () => {
    bridge.close()
    await Promise.allSettled([...bridge.operations])
    await domain.close()
  }, 'goal-mode: stable lifetime')
  await load(true)

  ctx.on('tools/pre-execute', (exec, next) => bridge.current.preExecute(exec, next), { prepend: true })
  ctx.on('agent/turn-stopping', payload => bridge.hold(payload))
  ctx.on('agent/inbox/inserted', ({ agent }) => bridge.release(agent.id))
  ctx.on('agent/status', () => bridge.refresh())
  ctx.on('agent/disposed', ({ agent }) => bridge.disposed(agent))
  ctx.on('goal/changed', ({ agent }) => bridge.refresh(agent.id))
  ctx.on('goal/activation-changed', ({ sessionId }) => bridge.refresh(sessionId))
  ctx.jobs.events.subscribe({ owners: 'all' }, event => bridge.current.jobEvent(event))
  ctx.on('agent/created', ({ agent, source }) => operation(() => bridge.current.initialize(agent, source === 'startup')))
  ctx.on('api-session/removed', id => {
    if (!bridge.closing) void operation(() => bridge.records.delete(id)).catch(error => ctx.logger.warn(`Goal Mode preference removal: ${error.message}`))
  })
  for (const agent of ctx.agents.list()) await operation(() => bridge.current.initialize(agent))

  for (const endpoint of ['get', 'set']) {
    ctx.connection.fetch.register({
      path: `/api/goal-mode/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        try {
          if (bridge.closing) return Response.json({ ok: false, error: { message: 'Goal Mode settings are stopping' } }, { status: 503 })
          const value = await operation(async () => bridge.current[endpoint](await request.json()))
          return Response.json({ ok: true, value })
        } catch (error) {
          return Response.json({ ok: false, error: { message: error.message } }, { status: 400 })
        }
      },
    })
  }
  ctx.effect(() => {
    let cleaning = false
    const updates = setInterval(() => { void load() }, 2000)
    const cleanup = setInterval(() => {
      if (cleaning || bridge.closing) return
      cleaning = true
      void operation(() => bridge.current.cleanup()).catch(error => ctx.logger.warn(`Goal Mode cleanup: ${error.message}`)).finally(() => { cleaning = false })
    }, 30000)
    updates.unref?.(); cleanup.unref?.()
    return () => { clearInterval(updates); clearInterval(cleanup) }
  }, 'goal-mode: releases and cleanup')
}
