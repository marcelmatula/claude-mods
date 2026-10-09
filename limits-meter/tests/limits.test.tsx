import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const T0 = Date.parse('2026-10-09T12:00:00Z')
const at = (ms: number) => new Date(T0 + ms).toISOString()
const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }

// Stands in for the engine beneath the plugin. In a session `next(e)` answers the
// hint line as an engine node, so that is what the meters are drawn around here.
// It keeps the figures each measurement carried, as $.session.usage() answers them, and
// a test can change them without one. Its clock stands at T0 until a test moves it.
const engineBeneath = (on: On) => {
  const engine = { clock: mock.clock(on, { now: T0 }), rateLimits: [] as SessionRateLimit[] }
  on('ui.render', { component: 'PromptHint' }, () => ({ type: 'engine', ref: 0 }))
  on('session.measure', ($, e) => {
    engine.rateLimits = e.rateLimits
    return { changed: e.changed }
  })
  on('session.usage', () => ({
    value: { startedAt: T0, context: { window: 200_000 }, rateLimits: engine.rateLimits },
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  return engine
}

const startSession = ($: Engine) =>
  $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

const measure = ($: Engine, rateLimits: SessionRateLimit[]) =>
  $.session.measure({ context: { window: 200_000 }, rateLimits, changed: ['rateLimits'] })

const mountHint = ($: Engine, surface: (typeof SURFACES)[number], columns: number) =>
  $.ui.mount({
    plugin: 'limits-meter',
    surface,
    component: 'PromptHint',
    props: HINT,
    viewport: { columns, rows: 40 },
  })

const marginOf = async (ui: Awaited<ReturnType<typeof mountHint>>) =>
  (await ui.findAll({ type: 'Box' })).find(box => box.props.marginLeft !== undefined)?.props
    .marginLeft

describe('limits-meter', () => {
  test('leaves the hint line alone before any rate-limit reading', async ($, on) => {
    engineBeneath(on)

    for (const surface of SURFACES) {
      const ui = await mountHint($, surface, 120)
      expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })
      await ui.unmount()
    }
  })

  test('draws both windows on a centred row under the hint line', async ($, on) => {
    engineBeneath(on)
    await measure($, [
      { kind: 'five_hour', percentUsed: 23.4, resetsAt: at(3 * 3_600_000) },
      { kind: 'seven_day', percentUsed: 81 },
      { kind: 'spend_limit', percentUsed: 12 },
    ])

    for (const surface of SURFACES) {
      const ui = await mountHint($, surface, 120)

      expect(await ui.find({ type: 'Text', text: 'Session ' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Week ' })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: ' 23%' }))?.props.color).toBe('success')
      expect((await ui.find({ type: 'Text', text: ' 81%' }))?.props.color).toBe('error')
      expect(await ui.find({ type: 'Text', text: /12%/ })).toBeUndefined()
      // 21 + 3 + 18 = 42 cells centred in 120 start at column 39, 37 past the indent.
      expect(await marginOf(ui)).toBe(37)

      await ui.unmount()
    }
  })

  test('redraws when a reading arrives after the line was drawn', async ($, on) => {
    engineBeneath(on)

    for (const surface of SURFACES) {
      const ui = await mountHint($, surface, 120)
      expect(await ui.find({ type: 'Text', text: /%/ })).toBeUndefined()

      await measure($, [{ kind: 'five_hour', percentUsed: 60 }])
      expect((await ui.find({ type: 'Text', text: ' 60%' }))?.props.color).toBe('warning')

      await ui.unmount()
      await measure($, [])
    }
  })

  test('shrinks on a narrow terminal and gives way when nothing fits', async ($, on) => {
    engineBeneath(on)
    await measure($, [
      { kind: 'five_hour', percentUsed: 104 },
      { kind: 'seven_day', percentUsed: 10 },
    ])

    for (const surface of SURFACES) {
      const narrow = await mountHint($, surface, 40)
      expect(await narrow.find({ type: 'Text', text: '5h ' })).toBeDefined()
      expect((await narrow.find({ type: 'Text', text: '104%' }))?.props.color).toBe('error')
      await narrow.unmount()

      const tiny = await mountHint($, surface, 20)
      expect(await tiny.drawn()).toEqual({ type: 'engine', ref: 0 })
      await tiny.unmount()
    }
  })
})

describe('reset times', () => {
  test('a window drops to 0% once its reset time passes, with no response in between', async ($, on) => {
    const { clock } = engineBeneath(on)
    await startSession($)

    for (const surface of SURFACES) {
      await measure($, [
        { kind: 'five_hour', percentUsed: 100, resetsAt: new Date(clock.now() + 90_000).toISOString() },
        { kind: 'seven_day', percentUsed: 64, resetsAt: at(3 * 86_400_000) },
      ])
      const ui = await mountHint($, surface, 120)
      expect((await ui.find({ type: 'Text', text: '100%' }))?.props.color).toBe('error')

      await clock.advance(120_000)
      expect(await ui.find({ type: 'Text', text: '100%' })).toBeUndefined()
      expect((await ui.find({ type: 'Text', text: '  0%' }))?.props.color).toBe('success')
      expect((await ui.find({ type: 'Text', text: ' 64%' }))?.props.color).toBe('warning')

      await ui.unmount()
    }
  })

  test('a reading whose reset time has already passed shows 0%', async ($, on) => {
    engineBeneath(on)
    await measure($, [
      { kind: 'five_hour', percentUsed: 100, resetsAt: at(-60_000) },
      { kind: 'seven_day', percentUsed: 30 },
    ])

    const ui = await mountHint($, 'terminal', 120)
    expect((await ui.find({ type: 'Text', text: '  0%' }))?.props.color).toBe('success')
    expect(await ui.find({ type: 'Text', text: ' 30%' })).toBeDefined()
    await ui.unmount()
  })
})

// /clear and /resume end the session (session.end), empty the plugin's state and start
// no session.start, while the engine keeps its figures.
const endSession = ($: Engine, reason: 'clear' | 'resume') =>
  $.session.end({ reason, sessionId: 'ended', resume: { id: 'ended' } })

describe('/clear and /resume', () => {
  for (const reason of ['clear', 'resume'] as const) {
    test(`after /${reason} the meters come back from the engine's figures`, async ($, on) => {
      const engine = engineBeneath(on)
      await startSession($)
      await measure($, [{ kind: 'five_hour', percentUsed: 40 }])

      const ui = await mountHint($, 'terminal', 120)
      expect(await ui.find({ type: 'Text', text: ' 40%' })).toBeDefined()

      // A later response moved the window less than a whole point, so no measurement came.
      engine.rateLimits = [{ kind: 'five_hour', percentUsed: 40.6 }]
      await endSession($, reason)
      await engine.clock.advance(1_000)
      expect(await ui.find({ type: 'Text', text: ' 41%' })).toBeDefined()
      await ui.unmount()
    })
  }

  test('a hidden meter stays hidden after /clear', async ($, on) => {
    const engine = engineBeneath(on)
    storeBeneath(on, { isHidden: true })
    await startSession($)
    await measure($, READINGS)

    await endSession($, 'clear')
    await engine.clock.advance(1_000)
    const ui = await mountHint($, 'terminal', 120)
    expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })
    await ui.unmount()
  })

  test('the minute check draws figures the state lost', async ($, on) => {
    const engine = engineBeneath(on)
    await startSession($)
    const ui = await mountHint($, 'terminal', 120)
    expect(await ui.find({ type: 'Text', text: /%/ })).toBeUndefined()

    engine.rateLimits = [{ kind: 'seven_day', percentUsed: 30 }]
    await engine.clock.advance(60_000)
    expect(await ui.find({ type: 'Text', text: ' 30%' })).toBeDefined()
    await ui.unmount()
  })
})

// An in-memory $.store beneath the plugin, so a test can read what was saved.
const storeBeneath = (on: On, saved: Record<string, unknown>) => {
  on('store.get', ($, e) => ({ value: saved[e.key] }))
  on('store.set', ($, e) => {
    saved[e.key] = e.value
    return { value: undefined }
  })
}

// Raises /limits the way typing it at the prompt does.
const runLimits = ($: Engine, args = '') =>
  $.command.run({ command: 'limits', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

const READINGS: SessionRateLimit[] = [
  { kind: 'five_hour', percentUsed: 40 },
  { kind: 'seven_day', percentUsed: 5 },
]

describe('/limits', () => {
  test('off hides the row and saves the choice; on brings it back', async ($, on) => {
    engineBeneath(on)
    const saved: Record<string, unknown> = {}
    storeBeneath(on, saved)
    await measure($, READINGS)

    for (const surface of SURFACES) {
      const ui = await mountHint($, surface, 120)
      expect(await ui.find({ type: 'Text', text: ' 40%' })).toBeDefined()

      expect((await runLimits($, 'off')).text).toBe('Limits meter hidden. /limits brings it back.')
      expect(saved.isHidden).toBe(true)
      expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })

      expect((await runLimits($, ' ON ')).text).toBe('Limits meter shown.')
      expect(saved.isHidden).toBe(false)
      expect(await ui.find({ type: 'Text', text: ' 40%' })).toBeDefined()

      await ui.unmount()
    }
  })

  test('a bare /limits toggles, and an unknown argument changes nothing', async ($, on) => {
    engineBeneath(on)
    const saved: Record<string, unknown> = {}
    storeBeneath(on, saved)
    await measure($, READINGS)
    const ui = await mountHint($, 'terminal', 120)

    await runLimits($)
    expect(saved.isHidden).toBe(true)
    expect(await ui.find({ type: 'Text', text: /%/ })).toBeUndefined()

    expect((await runLimits($, 'maybe')).text).toMatch(/^Usage: /)
    expect(saved.isHidden).toBe(true)

    await runLimits($, '')
    expect(saved.isHidden).toBe(false)
    expect(await ui.find({ type: 'Text', text: ' 40%' })).toBeDefined()
    await ui.unmount()
  })

  test('a new session starts hidden when that was the saved choice', async ($, on) => {
    engineBeneath(on)
    storeBeneath(on, { isHidden: true })
    await startSession($)
    await measure($, READINGS)

    const ui = await mountHint($, 'terminal', 120)
    expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })
    await ui.unmount()
  })

  test('says so when there is nothing to show yet', async ($, on) => {
    engineBeneath(on)
    storeBeneath(on, {})

    expect((await runLimits($, 'on')).text).toMatch(/^Limits meter shown, but there are no usage figures yet/)
    await measure($, READINGS)
    expect((await runLimits($, 'on')).text).toBe('Limits meter shown.')
  })
})
