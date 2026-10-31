import { createUserMessage, boundContextSummary } from '@deepseek-ai/dsh-llm'
import { parseInterval } from './interval.js'

export const DEFAULTS = Object.freeze({ modelCreate: false, continueWhileBusy: false, interval: null })
export const DENY = 'the model cannot create goals in this session, only the user can with /goal'

/** Policy only. The stable entry retains every hook, waiter, timer and record. */
export function createRuntime(ctx, bridge) {
  const settings = id => bridge.records.get(id) ?? DEFAULTS
  const armed = agent => {
    if (ctx.agents.get(agent.id) !== agent) return false
    const goal = ctx.goals.get(agent)
    return goal?.phase === 'active' && goal.activation === 'armed'
  }
  function descendants(rootId) {
    const childrenOf = new Map()
    for (const agent of ctx.agents.list()) {
      const { parentSession, origin } = agent.session.header
      if (parentSession === undefined || origin !== 'subagent') continue
      const siblings = childrenOf.get(parentSession) ?? []
      siblings.push(agent)
      childrenOf.set(parentSession, siblings)
    }
    const result = [], pending = [rootId], visited = new Set()
    while (pending.length) {
      const parentId = pending.shift()
      if (visited.has(parentId)) continue
      visited.add(parentId)
      for (const child of childrenOf.get(parentId) ?? []) {
        result.push(child)
        pending.push(child.id)
      }
    }
    return result
  }
  function busy(agent) {
    const children = descendants(agent.id)
    const jobs = [agent, ...children].reduce((count, owner) => count + ctx.jobs.list(owner.id)
      .filter(job => job.owner === owner.id && (job.status === 'running' || job.status === 'stopping')).length, 0)
    return { jobs, subagents: children.filter(child => child.status === 'running').length }
  }
  function hold(agent) {
    if (bridge.closing || settings(agent.id).continueWhileBusy || agent.inbox.nextStep.length || agent.inbox.nextTurn.length || !armed(agent)) return null
    const goal = ctx.goals.get(agent)
    if (goal.roundsStarted >= goal.maxGoalRounds) return null
    const count = busy(agent)
    return count.jobs || count.subagents ? count : null
  }
  function timer(agent) {
    const interval = settings(agent.id).interval
    return !bridge.closing && interval !== null && armed(agent) ? parseInterval(interval) : null
  }
  function deliver(agent, interval) {
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: `scheduled goal check-in (every ${interval}). Check on running jobs and subagents, then continue the goal.` }],
      source: { kind: 'goal-check-in', form: 'notice', summary: boundContextSummary(`Goal check-in · ${interval}`) },
    }))
  }
  function preExecute(exec, next) {
    if (exec.name === 'create_goal' && settings(exec.agent.id).modelCreate !== true) return { kind: 'deny', reason: DENY }
    return next()
  }
  async function initialize(agent, fresh = false) {
    const header = agent.session.header
    if (fresh && header.origin !== 'subagent' && header.id.startsWith('session-sidechat-') && header.parentSession && !bridge.records.get(header.id)) {
      await bridge.mutate(() => bridge.records.get(header.id) ? undefined : bridge.records.put(header.id, { ...settings(header.parentSession) }))
    }
    bridge.refresh(agent.id)
  }
  async function sessionIdFor(payload) {
    if (typeof payload?.sessionId !== 'string' || !payload.sessionId) throw new Error('sessionId is required')
    const sessionId = payload.sessionId
    if (!ctx.agents.get(sessionId)) {
      const view = await ctx.sessionQuery.observeSession(sessionId)
      view[Symbol.dispose]()
    }
    return sessionId
  }
  function value(sessionId) {
    return { sessionId, ...settings(sessionId), waiting: bridge.waiters.get(sessionId)?.waiting ?? null }
  }
  async function get(payload) { return value(await sessionIdFor(payload)) }
  async function set(payload) {
    const sessionId = await sessionIdFor(payload)
    const patch = {}
    for (const field of ['modelCreate', 'continueWhileBusy']) {
      if (!(field in payload)) continue
      if (typeof payload[field] !== 'boolean') throw new Error(`${field} must be a boolean`)
      patch[field] = payload[field]
    }
    if ('interval' in payload) patch.interval = payload.interval === null ? null : parseInterval(payload.interval).interval
    await bridge.mutate(() => bridge.records.put(sessionId, { ...settings(sessionId), ...patch }))
    bridge.refresh(sessionId)
    return value(sessionId)
  }
  async function cleanup() {
    if (![...bridge.records.entries()].length) return
    const present = new Set((await ctx.sessionQuery.listSessions()).map(record => record.header.id))
    for (const [id] of bridge.records.entries()) if (!present.has(id)) await bridge.records.delete(id)
  }
  return { initialize, preExecute, hold, timer, deliver, get, set, cleanup }
}
