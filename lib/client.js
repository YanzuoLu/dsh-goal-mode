// Browser half, registered lazily by the native DSH module loader.
window.__ModuleLoader__.load({
  id: 'dsh-goal-mode',
  factory: require => {
    const React = require('react')
    const { useEffect, useState, useSyncExternalStore } = React
    const { Fragment, jsx, jsxs } = require('react/jsx-runtime')
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
    const { Menu, Switch, Input, Button, Modal, Toast, IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconWarningOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')
    const ID = 'dsh-goal-mode', NS = 'goal-mode', PERMISSION = 'conversation.input.permission'
    const WRAPPED = Symbol.for('dsh-goal-mode.permission-wrapper')
    const MCP_WRAPPED = Symbol.for('dsh-mcp-toggle.permission-wrapper')
    const identity = value => value
    const Empty = () => null
    const PRESETS = ['5m', '10m', '20m', '30m', '1h', '2h']
    // BEGIN SHARED INTERVAL
    const INTERVAL_ERROR = 'Use m, h and d, optionally combined, such as 45m, 1h30m or 2d. The interval must be between 1 minute and 30 days.'
    
    /** Parse ordered duration units and return a canonical minute-resolution interval. */
    function parseInterval(value) {
      if (typeof value !== 'string') throw new Error(INTERVAL_ERROR)
      const text = value.replace(/\s/g, '').toLowerCase()
      const match = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/.exec(text)
      if (!match || !text) throw new Error(INTERVAL_ERROR)
      const minutes = Number(match[1] ?? 0) * 1440 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
      if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 43200) throw new Error(INTERVAL_ERROR)
      const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), rest = minutes % 60
      return { interval: `${days ? `${days}d` : ''}${hours ? `${hours}h` : ''}${rest ? `${rest}m` : ''}`, milliseconds: minutes * 60000 }
    }
    // END SHARED INTERVAL
    const zh = {
      goal: '目标', modelCreate: '允许模型创建目标', continueWhileBusy: '后台工作时继续续轮', interval: '定时提醒',
      off: '关闭', custom: '自定义…', apply: '应用', close: '关闭', jobs: '{count} 个任务', subagents: '{count} 个子代理', waiting: '等待后台 {parts}', join: '、',
      invalid: '请使用 m、h、d 及其组合，例如 45m、1h30m、2d。间隔需在 1 分钟到 30 天之间。',
      error: '目标设置失败：{message}',
    }
    const en = {
      goal: 'Goal', modelCreate: 'Model can create goals', continueWhileBusy: 'Continue while background work runs', interval: 'Check-in interval',
      off: 'Off', custom: 'Custom…', apply: 'Apply', close: 'Close', jobs: '{count} jobs', subagents: '{count} subagents', waiting: 'Waiting for {parts}', join: ' and ',
      invalid: 'Use m, h and d, optionally combined, such as 45m, 1h30m or 2d. The interval must be between 1 minute and 30 days.',
      error: 'Goal settings failed: {message}',
    }
    const CSS = `
.dsh-goal-trigger{border-radius:var(--dsw-radius-sm);height:28px;min-width:0;color:var(--dsw-alias-label-secondary);cursor:pointer;background:none;border:none;outline:none;display:flex;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:400;line-height:20px}
.dsh-goal-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-goal-trigger:focus-visible:not([data-selection-focus]){box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.dsh-goal-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.dsh-goal-chevron{color:var(--dsw-alias-label-caption);transition:transform .12s}
.dsh-goal-chevronOpen{transform:rotate(180deg)}
.dsh-goal-wait{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}
.dsh-goal-switch-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 12px;color:var(--dsw-alias-label-primary);font-size:13px}
.dsh-goal-status{padding:8px 12px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsh-goal-option{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%}
.dsh-goal-current{display:flex;align-items:center;gap:2px;color:var(--dsw-alias-label-tertiary)}
.dsh-goal-current svg,.dsh-goal-check{flex:none;width:16px;height:16px}
`
    async function callHost(endpoint, payload, signal) {
      const response = await fetch(`api/goal-mode/${endpoint}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const result = await response.json()
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
    const initial = sessionId => ({ sessionId, value: null, saving: false, error: null })
    function createController() {
      const state = createSnapshotStore(initial()), lifetime = new AbortController(), writes = new Map()
      let active, read, errorId = 0
      const patch = (seat, values) => { if (active === seat && !lifetime.signal.aborted) state.set({ ...state.getSnapshot(), ...values }) }
      const fail = (seat, error) => patch(seat, { error: { id: ++errorId, message: error.message } })
      const abortRead = () => { read?.abort(); read = undefined }
      async function refresh() {
        const seat = active
        if (!seat || read || writes.has(seat.sessionId)) return
        const controller = new AbortController()
        read = controller
        try {
          const value = await callHost('get', { sessionId: seat.sessionId }, controller.signal)
          if (read === controller) patch(seat, { value, error: null })
        } catch (error) { if (!controller.signal.aborted) fail(seat, error) }
        finally { if (read === controller) read = undefined }
      }
      function mount(sessionId) {
        abortRead()
        const seat = { sessionId }
        active = seat
        state.set(initial(sessionId))
        const writing = writes.get(sessionId)
        if (writing) void writing.then(() => { if (active === seat) void refresh() })
        else void refresh()
        return () => { if (active === seat) { abortRead(); active = undefined } }
      }
      function save(values) {
        const seat = active
        if (!seat || !state.getSnapshot().value || writes.has(seat.sessionId)) return
        abortRead()
        patch(seat, { saving: true, error: null })
        const write = callHost('set', { sessionId: seat.sessionId, ...values }, lifetime.signal)
          .then(value => { patch(seat, { value }); return true })
          .catch(error => { if (!lifetime.signal.aborted) fail(seat, error); return false })
          .finally(() => { writes.delete(seat.sessionId); patch(seat, { saving: false }) })
        writes.set(seat.sessionId, write)
        return write
      }
      return { state, mount, refresh, save, dispose() { active = undefined; abortRead(); lifetime.abort() } }
    }
    function Picker({ sessionId, locked, useInput, useSession, useSessions, controller, sessions, locale, t }) {
      const ready = useInput(input => input !== undefined)
      const running = useSession(session => session.running)
      const removed = useSession(session => session.removed)
      const catalog = useSessions(identity)
      const state = useSyncExternalStore(controller.state.subscribe, controller.state.getSnapshot, controller.state.getSnapshot)
      useSyncExternalStore(locale.subscribe, locale.getSnapshot, locale.getSnapshot)
      const [open, setOpen] = useState(false), [custom, setCustom] = useState(false), [text, setText] = useState('')
      const [invalid, setInvalid] = useState(false), [dismissedError, setDismissedError] = useState(null)
      const subagent = sessions.subagentAddress(sessionId) !== undefined
      const available = ready && !removed && !subagent && (catalog.byId[sessionId]?.retainedBy?.mainView ?? 0) > 0
      useEffect(() => {
        setOpen(false); setCustom(false); setInvalid(false)
        if (available) return controller.mount(sessionId)
      }, [available, sessionId, controller])
      useEffect(() => {
        if (!available) return
        void controller.refresh()
        if (!running) return
        const timer = setInterval(() => { void controller.refresh() }, 10000)
        return () => clearInterval(timer)
      }, [available, running, controller])
      useEffect(() => { if (!available || locked === true) { setOpen(false); setCustom(false) } }, [available, locked])
      if (subagent) return null
      const value = state.sessionId === sessionId ? state.value : null
      const disabled = locked === true || !available || value === null || state.saving
      const waiting = value?.waiting
      const status = waiting ? t('waiting', { parts: ['jobs', 'subagents'].filter(key => waiting[key]).map(key => t(key, { count: waiting[key] })).join(t('join')) }) : ''
      const error = state.sessionId === sessionId ? state.error : null
      const presetValue = value === null || value.interval === null || PRESETS.includes(value.interval)
      const option = (label, selected) => jsxs('span', { className: 'dsh-goal-option', children: [label, selected && jsx(IconCheckOutlineRegular, { className: 'dsh-goal-check' })] })
      const intervalRow = {
        id: 'interval', disabled,
        label: jsxs('span', { className: 'dsh-goal-option', children: [t('interval'), jsxs('span', { className: 'dsh-goal-current', children: [value?.interval ?? t('off'), jsx(IconChevronRightOutlineRegular, {})] })] }),
        submenu: [
          { id: 'interval:off', disabled, label: option(t('off'), value !== null && value.interval === null) },
          ...PRESETS.map(interval => ({ id: `interval:${interval}`, disabled, label: option(interval, value?.interval === interval) })),
          { id: 'interval:custom', disabled, label: option(presetValue ? t('custom') : `${t('custom')} (${value.interval})`, !presetValue) },
        ],
      }
      const select = id => {
        const choice = id.slice('interval:'.length)
        setOpen(false)
        if (choice === 'custom') { setText(value?.interval ?? ''); setCustom(true) }
        else void controller.save({ interval: choice === 'off' ? null : choice })
      }
      const applyCustom = async () => {
        let parsed
        try { parsed = parseInterval(text) } catch { setInvalid(true); return }
        if (await controller.save({ interval: parsed.interval })) setCustom(false)
      }
      return jsxs(Fragment, { children: [
        jsx(Menu, {
          open, side: 'top', align: 'start', portal: true, onClose: () => setOpen(false),
          anchor: jsxs('button', {
            type: 'button', className: 'dsh-goal-trigger', disabled,
            'aria-label': status ? `${t('goal')} · ${status}` : t('goal'), 'aria-haspopup': 'menu', 'aria-expanded': open, title: status || t('goal'),
            onClick: () => { if (!open) void controller.refresh(); setOpen(!open) },
            children: [t('goal'), waiting && jsx('span', { className: 'dsh-goal-wait', 'aria-hidden': true }), jsx(IconChevronDownOutlineRegular, { className: `dsh-goal-chevron${open ? ' dsh-goal-chevronOpen' : ''}` })],
          }),
          footer: [intervalRow], onSelect: select,
          children: [
            waiting && jsx('div', { className: 'dsh-goal-status', role: 'status', children: status }, 'status'),
            ...['modelCreate', 'continueWhileBusy'].map(field => jsxs('div', { className: 'dsh-goal-switch-row', children: [
              jsx('span', { children: t(field) }), jsx(Switch, { checked: value?.[field] ?? false, label: t(field), disabled, onChange: checked => { void controller.save({ [field]: checked }) } }),
            ] }, field)),
          ],
        }),
        jsx(Modal, {
          open: custom, title: t('interval'), closeLabel: t('close'), onClose: () => setCustom(false),
          children: jsx(Input, { value: text, disabled: state.saving, 'aria-label': t('interval'), 'data-modal-autofocus': true, placeholder: '1h30m', onChange: event => setText(event.target.value), onKeyDown: event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void applyCustom() } }),
          footer: jsx(Button, { variant: 'primary', disabled: state.saving, onClick: () => { void applyCustom() }, children: t('apply') }),
        }),
        invalid && jsx(Toast, { text: t('invalid'), icon: jsx(IconWarningOutlineRegular, {}), onDone: () => setInvalid(false) }),
        error && error.id !== dismissedError && jsx(Toast, { text: t('error', { message: error.message }), icon: jsx(IconWarningOutlineRegular, {}), onDone: () => setDismissedError(error.id) }, error.id),
      ] })
    }
    function installPicker(ctx, controller) {
      const slots = ctx.slots
      const locale = { subscribe: listener => ctx.locale.subscribe(listener), getSnapshot: () => ctx.locale.getSnapshot() }
      const t = ctx.locale.bind(NS)
      return slots.inject(PERMISSION, function* () {
        const patched = new Map()
        let stopped = false
        const reconcile = () => {
          if (stopped) return
          const entries = slots.entries(PERMISSION)
          for (const [entry, record] of patched) if (!entries.includes(entry)) {
            if (entry.component === record.wrapper) entry.component = record.original
            patched.delete(entry)
          }
          for (const entry of entries) {
            const Original = entry.component
            if (Original === Empty || Original[WRAPPED]) continue
            const previous = patched.get(entry)
            function PermissionWithGoal(props) {
              // If MCP arrives later, only our outermost wrapper contributes Goal.
              return jsxs(Fragment, { children: [React.createElement(Original, props),
                !stopped && entry.component === PermissionWithGoal && jsx(Picker, { ...props, controller, sessions: ctx.sessions, locale, t }, props.sessionId),
              ] })
            }
            PermissionWithGoal[WRAPPED] = true
            PermissionWithGoal[MCP_WRAPPED] = Original[MCP_WRAPPED]
            patched.set(entry, { original: previous?.original ?? Original, wrapper: PermissionWithGoal, restore: Original })
            entry.component = PermissionWithGoal
          }
        }
        yield ctx.on('slots/changed', key => { if (key === PERMISSION) reconcile() })
        yield slots.subscribe(PERMISSION, reconcile)
        reconcile()
        const pulse = () => ({ name: PERMISSION, priority: Math.max(1e9, ...slots.entries(PERMISSION).map(entry => entry.options.priority ?? 0)) + 1 })
        slots.register(pulse(), Empty)()
        yield slots.register(pulse(), Empty)
        yield () => {
          stopped = true
          for (const [entry, record] of patched) if (entry.component === record.wrapper) entry.component = record.restore
          patched.clear()
        }
      })
    }
    function apply(ctx) {
      ctx.inject(['sessions', 'locale'], ctx => {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'goal-mode: dictionaries')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-plugin', ID); style.textContent = CSS; document.head.appendChild(style)
          return () => style.remove()
        }, 'goal-mode: styles')
        const controller = createController()
        ctx.effect(() => controller.dispose, 'goal-mode: requests')
        installPicker(ctx, controller)
      })
    }
    return { name: ID, inject: ['slots'], apply }
  },
})
