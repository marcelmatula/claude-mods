import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit, UsageUnit } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const T0 = Date.parse('2026-10-09T12:00:00Z')
const at = (ms: number) => new Date(T0 + ms).toISOString()
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }

// Stands in for the engine beneath the plugin. In a session `next(e)` answers the
// hint line as an engine node, so that is what the meters are drawn around here.
// It keeps the figures each measurement carried, as $.session.usage() answers them, and
// a test can change them, and set a cost once responses have come, without one. Its clock
// stands at T0 until a test moves it.
const engineBeneath = (on: On) => {
  const engine = {
    clock: mock.clock(on, { now: T0 }),
    rateLimits: [] as SessionRateLimit[],
    cost: undefined as { usd: number } | undefined,
  }
  on('ui.render', { component: 'PromptHint' }, () => ({ type: 'engine', ref: 0 }))
  on('session.measure', ($, e) => {
    engine.rateLimits = e.rateLimits
    return { changed: e.changed }
  })
  on('session.usage', () => ({
    value: {
      startedAt: T0,
      context: { window: 200_000 },
      rateLimits: engine.rateLimits,
      ...(engine.cost === undefined ? {} : { cost: engine.cost }),
    },
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  return engine
}

const startSession = ($: Engine) =>
  $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

const measure = ($: Engine, rateLimits: SessionRateLimit[]) =>
  $.session.measure({ context: { window: 200_000 }, rateLimits, changed: ['rateLimits'] })

const mountHint = ($: Engine, surface: (typeof SURFACES)[number], columns: number, props = HINT) =>
  $.ui.mount({
    plugin: 'limits-meter',
    surface,
    component: 'PromptHint',
    props,
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
      expect((await ui.find({ type: 'Text', text: '23%' }))?.props.color).toBe('success')
      expect((await ui.find({ type: 'Text', text: '81%' }))?.props.color).toBe('error')
      expect(await ui.find({ type: 'Text', text: /12%/ })).toBeUndefined()
      // Only the session reading has a reset time, so only it counts down.
      expect((await ui.findAll({ type: 'Text', text: /↻/ })).map(t => t.text)).toEqual([' ↻3:00'])
      // 27 + 3 + 18 = 48 cells centred in 120 start at column 36, 34 past the indent.
      expect(await marginOf(ui)).toBe(34)

      await ui.unmount()
    }
  })

  test('redraws when a reading arrives after the line was drawn', async ($, on) => {
    engineBeneath(on)

    for (const surface of SURFACES) {
      const ui = await mountHint($, surface, 120)
      expect(await ui.find({ type: 'Text', text: /%/ })).toBeUndefined()

      await measure($, [{ kind: 'five_hour', percentUsed: 60 }])
      expect((await ui.find({ type: 'Text', text: '60%' }))?.props.color).toBe('warning')

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
      expect((await ui.find({ type: 'Text', text: '0%' }))?.props.color).toBe('success')
      expect((await ui.find({ type: 'Text', text: '64%' }))?.props.color).toBe('warning')

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
    expect((await ui.find({ type: 'Text', text: '0%' }))?.props.color).toBe('success')
    expect(await ui.find({ type: 'Text', text: '30%' })).toBeDefined()
    await ui.unmount()
  })
})

describe('countdowns', () => {
  const countdowns = async (ui: Awaited<ReturnType<typeof mountHint>>) =>
    (await ui.findAll({ type: 'Text', text: /↻/ })).map(t => t.text)

  test('each window shows the time left until its reset, dim, after its percentage', async ($, on) => {
    engineBeneath(on)
    await measure($, [
      { kind: 'five_hour', percentUsed: 38, resetsAt: at(2 * HOUR + 31 * MINUTE) },
      { kind: 'seven_day', percentUsed: 82, resetsAt: at(3 * DAY + 4 * HOUR + 20 * MINUTE) },
    ])

    for (const surface of SURFACES) {
      const ui = await mountHint($, surface, 120)
      expect((await ui.find({ type: 'Text', text: ' ↻2:31' }))?.props.dimColor).toBe(true)
      expect((await ui.find({ type: 'Text', text: ' ↻3d 4h ' }))?.props.dimColor).toBe(true)
      // The README's screenshot: 27 + 3 + 26 = 56 cells centred in 120 start at column 32,
      // 30 past the indent.
      expect(await marginOf(ui)).toBe(30)
      await ui.unmount()
    }
  })

  test('a percentage is followed by one space and its countdown, and the row stays put as it gains a digit', async ($, on) => {
    engineBeneath(on)
    await measure($, [
      { kind: 'five_hour', percentUsed: 5, resetsAt: at(2 * HOUR) },
      { kind: 'seven_day', percentUsed: 38, resetsAt: at(3 * DAY + 4 * HOUR) },
    ])

    const ui = await mountHint($, 'terminal', 120)
    // A value's texts in order: itself, its countdown, then what it lacks of 4 cells.
    const after = async (value: string) => {
      const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
      return texts.slice(texts.indexOf(value), texts.indexOf(value) + 3)
    }
    expect(await after('5%')).toEqual(['5%', ' ↻2:00', '  '])
    expect(await after('38%')).toEqual(['38%', ' ↻3d 4h ', ' '])
    const margin = await marginOf(ui)

    await measure($, [
      { kind: 'five_hour', percentUsed: 50, resetsAt: at(2 * HOUR) },
      { kind: 'seven_day', percentUsed: 38, resetsAt: at(3 * DAY + 4 * HOUR) },
    ])
    expect(await after('50%')).toEqual(['50%', ' ↻2:00', ' '])
    expect(await marginOf(ui)).toBe(margin)
    await ui.unmount()
  })

  test('rounds up to the minute, and the week reads h:mm in its last day', async ($, on) => {
    engineBeneath(on)
    const ui = await mountHint($, 'terminal', 120)

    await measure($, [
      { kind: 'five_hour', percentUsed: 99, resetsAt: at(30_000) },
      { kind: 'seven_day', percentUsed: 90, resetsAt: at(17 * HOUR + 5 * MINUTE) },
    ])
    expect(await countdowns(ui)).toEqual([' ↻0:01', ' ↻17:05 '])

    await measure($, [
      { kind: 'five_hour', percentUsed: 1, resetsAt: at(5 * HOUR) },
      { kind: 'seven_day', percentUsed: 1, resetsAt: at(6 * DAY + 23 * HOUR + 59 * MINUTE + 1) },
    ])
    expect(await countdowns(ui)).toEqual([' ↻5:00', ' ↻7d 0h '])

    await measure($, [{ kind: 'seven_day', percentUsed: 50, resetsAt: at(DAY - 1) }])
    expect(await countdowns(ui)).toEqual([' ↻1d 0h '])
    await ui.unmount()
  })

  test('counts down each minute with no response, and the row stays in place', async ($, on) => {
    const { clock } = engineBeneath(on)
    await startSession($)
    await measure($, [
      { kind: 'five_hour', percentUsed: 40, resetsAt: at(2 * HOUR + 31 * MINUTE) },
      { kind: 'seven_day', percentUsed: 20, resetsAt: at(3 * DAY + 10 * HOUR) },
    ])

    const ui = await mountHint($, 'terminal', 120)
    expect(await countdowns(ui)).toEqual([' ↻2:31', ' ↻3d 10h'])
    const margin = await marginOf(ui)

    await clock.advance(MINUTE)
    expect(await countdowns(ui)).toEqual([' ↻2:30', ' ↻3d 9h '])
    expect(await marginOf(ui)).toBe(margin)

    await clock.advance(30 * MINUTE)
    expect(await countdowns(ui)).toEqual([' ↻2:00', ' ↻3d 9h '])
    await ui.unmount()
  })

  test('the minute checks keep to the minute when the session starts partway through one', async ($, on) => {
    const { clock } = engineBeneath(on)
    await clock.advance(25_000)
    await startSession($)
    await measure($, [{ kind: 'five_hour', percentUsed: 40, resetsAt: at(HOUR) }])

    const ui = await mountHint($, 'terminal', 120)
    expect(await countdowns(ui)).toEqual([' ↻1:00'])

    // The first check comes at the next whole minute, not a minute after the start.
    await clock.advance(35_000)
    expect(await countdowns(ui)).toEqual([' ↻0:59'])
    await clock.advance(MINUTE)
    expect(await countdowns(ui)).toEqual([' ↻0:58'])
    await ui.unmount()
  })

  test('a countdown goes when its window resets and comes back with the next reading', async ($, on) => {
    const { clock } = engineBeneath(on)
    await startSession($)
    await measure($, [{ kind: 'five_hour', percentUsed: 100, resetsAt: at(90_000) }])

    const ui = await mountHint($, 'terminal', 120)
    expect(await countdowns(ui)).toEqual([' ↻0:02'])

    await clock.advance(2 * MINUTE)
    expect(await ui.find({ type: 'Text', text: '0%' })).toBeDefined()
    expect(await countdowns(ui)).toEqual([])

    await measure($, [{ kind: 'five_hour', percentUsed: 1, resetsAt: new Date(clock.now() + 5 * HOUR).toISOString() }])
    expect(await countdowns(ui)).toEqual([' ↻5:00'])
    await ui.unmount()
  })

  test('on a narrow terminal the countdowns go before the bars do', async ($, on) => {
    engineBeneath(on)
    await measure($, [
      { kind: 'five_hour', percentUsed: 40, resetsAt: at(2 * HOUR) },
      { kind: 'seven_day', percentUsed: 60, resetsAt: at(2 * DAY) },
    ])

    for (const surface of SURFACES) {
      // Full needs 56 cells, short labels with countdowns 43, without them 29.
      const medium = await mountHint($, surface, 50)
      expect(await medium.find({ type: 'Text', text: '5h ' })).toBeDefined()
      expect(await countdowns(medium)).toEqual([' ↻2:00', ' ↻2d 0h '])
      await medium.unmount()

      const narrow = await mountHint($, surface, 40)
      expect(await countdowns(narrow)).toEqual([])
      expect(await narrow.find({ type: 'Text', text: /█/ })).toBeDefined()
      expect(await narrow.find({ type: 'Text', text: '40%' })).toBeDefined()
      await narrow.unmount()
    }
  })
})

// Each session's engine learns the figures only from its own responses, while the limits
// are the account's, so the sessions share the newest reading through $.store.
describe('other sessions', () => {
  test('a session saves each reading for the others, but not one with no windows', async ($, on) => {
    engineBeneath(on)
    const saved: Record<string, unknown> = {}
    storeBeneath(on, saved)

    await measure($, READINGS)
    expect(saved.reading).toEqual({ at: T0, limits: READINGS })

    await measure($, [])
    expect(saved.reading).toEqual({ at: T0, limits: READINGS })
  })

  test('an idle session picks up a newer reading within a minute', async ($, on) => {
    const { clock } = engineBeneath(on)
    const saved: Record<string, unknown> = {}
    storeBeneath(on, saved)
    await startSession($)
    await measure($, [{ kind: 'five_hour', percentUsed: 61, resetsAt: at(HOUR) }])

    const ui = await mountHint($, 'terminal', 120)
    expect(await ui.find({ type: 'Text', text: '61%' })).toBeDefined()

    // Forty minutes later another session's response saves a newer reading.
    await clock.advance(40 * MINUTE)
    saved.reading = { at: clock.now(), limits: [{ kind: 'five_hour', percentUsed: 91, resetsAt: at(HOUR) }] }
    expect(await ui.find({ type: 'Text', text: '61%' })).toBeDefined()

    await clock.advance(MINUTE)
    expect((await ui.find({ type: 'Text', text: '91%' }))?.props.color).toBe('error')
    expect(await ui.find({ type: 'Text', text: ' ↻0:19' })).toBeDefined()
    await ui.unmount()
  })

  test("an older saved reading does not replace the session's own", async ($, on) => {
    const { clock } = engineBeneath(on)
    const saved: Record<string, unknown> = {}
    storeBeneath(on, saved)
    await startSession($)
    await clock.advance(10 * MINUTE)
    await measure($, [{ kind: 'seven_day', percentUsed: 75 }])
    saved.reading = { at: T0, limits: [{ kind: 'seven_day', percentUsed: 70 }] }

    const ui = await mountHint($, 'terminal', 120)
    await clock.advance(MINUTE)
    expect(await ui.find({ type: 'Text', text: '75%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '70%' })).toBeUndefined()
    await ui.unmount()
  })

  test('a new session shows the saved reading before its first response', async ($, on) => {
    engineBeneath(on)
    storeBeneath(on, {
      reading: { at: T0 - 10 * MINUTE, limits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: at(2 * HOUR) }] },
    })
    await startSession($)

    const ui = await mountHint($, 'terminal', 120)
    expect(await ui.find({ type: 'Text', text: '40%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' ↻2:00' })).toBeDefined()
    await ui.unmount()
  })

  test('a session on an API key drops the saved figures after its first response', async ($, on) => {
    const engine = engineBeneath(on)
    storeBeneath(on, { reading: { at: T0 - MINUTE, limits: [{ kind: 'five_hour', percentUsed: 40 }] } })
    await startSession($)

    const ui = await mountHint($, 'terminal', 120)
    expect(await ui.find({ type: 'Text', text: '40%' })).toBeDefined()

    // A response came and was priced, and it carried no rate-limit windows.
    engine.cost = { usd: 0.02 }
    await engine.clock.advance(MINUTE)
    expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })
    await ui.unmount()
  })

  test("a saved reading the mod can't read is passed over", async ($, on) => {
    const engine = engineBeneath(on)
    storeBeneath(on, { reading: { at: 'later', limits: [{ kind: 'five_hour' }] } })
    engine.rateLimits = [{ kind: 'seven_day', percentUsed: 30 }]
    await startSession($)

    const ui = await mountHint($, 'terminal', 120)
    expect(await ui.find({ type: 'Text', text: '30%' })).toBeDefined()
    await ui.unmount()
  })
})

// The surfaces the session draws on, and a record of each status entry the plugin sets.
const statusBeneath = (on: On, surfaces: ('terminal' | 'desktop' | 'mobile' | 'vscode')[]) => {
  const statuses: (string | undefined)[] = []
  on('session.surfaces', () => ({ value: surfaces }))
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  return statuses
}

// The desktop app draws no hint line, so there the figures go in the status entry.
describe('desktop app', () => {
  const FIGURES: SessionRateLimit[] = [
    { kind: 'five_hour', percentUsed: 61, resetsAt: at(42 * MINUTE) },
    { kind: 'seven_day', percentUsed: 75, resetsAt: at(2 * DAY + 21 * HOUR) },
  ]

  test('a session that draws only on the desktop shows the figures as its status entry', async ($, on) => {
    engineBeneath(on)
    const statuses = statusBeneath(on, ['desktop'])

    await measure($, FIGURES)
    expect(statuses).toEqual(['Session 61% ↻0:42 · Week 75% ↻2d 21h'])
  })

  test('the status entry counts down each minute and follows /limits', async ($, on) => {
    const { clock } = engineBeneath(on)
    storeBeneath(on, {})
    const statuses = statusBeneath(on, ['desktop'])
    await startSession($)
    await measure($, FIGURES)

    await clock.advance(MINUTE)
    expect(statuses.at(-1)).toBe('Session 61% ↻0:41 · Week 75% ↻2d 20h')

    await runLimits($, 'off')
    expect(statuses.at(-1)).toBeUndefined()
    await runLimits($, 'on')
    expect(statuses.at(-1)).toBe('Session 61% ↻0:41 · Week 75% ↻2d 20h')
  })

  test('a window that has reset shows 0% with no countdown', async ($, on) => {
    const { clock } = engineBeneath(on)
    const statuses = statusBeneath(on, ['desktop'])
    await startSession($)
    await measure($, [{ kind: 'five_hour', percentUsed: 98, resetsAt: at(90_000) }])

    await clock.advance(2 * MINUTE)
    expect(statuses.at(-1)).toBe('Session 0%')
  })

  for (const surfaces of [['terminal'], ['terminal', 'mobile']] as const) {
    test(`a session drawn on ${surfaces.join(' and ')} sets no status entry`, async ($, on) => {
      engineBeneath(on)
      const statuses = statusBeneath(on, [...surfaces])
      await measure($, FIGURES)
      expect(statuses).toEqual([])
    })
  }
})

// The session's slash commands beneath the plugin: what $.command.list answers, which a
// test can empty as a lost registration would, and each name the plugin registers.
const commandsBeneath = (on: On) => {
  const commands = { listed: [] as string[], registered: [] as string[] }
  on('command.list', () => ({
    value: commands.listed.map(name => ({ name, description: '', source: 'plugin' as const })),
  }))
  on('command.register', ($, e) => {
    commands.registered.push(e.name)
    commands.listed = [...new Set([...commands.listed, e.name])]
    return { value: { command: e.name } }
  })
  return commands
}

describe('the /limits command', () => {
  test('the minute check adds /limits back once the session no longer lists it', async ($, on) => {
    const { clock } = engineBeneath(on)
    const commands = commandsBeneath(on)
    await startSession($)
    expect(commands.registered).toEqual(['limits'])

    await clock.advance(MINUTE)
    expect(commands.registered).toEqual(['limits'])

    // The registration went, as in a desktop app session the mod was updated under.
    commands.listed = []
    await clock.advance(MINUTE)
    expect(commands.registered).toEqual(['limits', 'limits'])
    expect(commands.listed).toEqual(['limits'])
  })

  test('a load with no session.start sets itself up at its first reading', async ($, on) => {
    const { clock } = engineBeneath(on)
    const commands = commandsBeneath(on)
    await measure($, [{ kind: 'five_hour', percentUsed: 40, resetsAt: at(HOUR) }])
    expect(commands.registered).toEqual(['limits'])

    const ui = await mountHint($, 'terminal', 120)
    await clock.advance(MINUTE)
    expect(await ui.find({ type: 'Text', text: ' ↻0:59' })).toBeDefined()

    // A second reading starts no second minute check.
    await measure($, [{ kind: 'five_hour', percentUsed: 41, resetsAt: at(HOUR) }])
    expect(commands.registered).toEqual(['limits'])
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
      expect(await ui.find({ type: 'Text', text: '40%' })).toBeDefined()

      // A later response moved the window less than a whole point, so no measurement came.
      engine.rateLimits = [{ kind: 'five_hour', percentUsed: 40.6 }]
      await endSession($, reason)
      await engine.clock.advance(1_000)
      expect(await ui.find({ type: 'Text', text: '41%' })).toBeDefined()
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
    expect(await ui.find({ type: 'Text', text: '30%' })).toBeDefined()
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
      expect(await ui.find({ type: 'Text', text: '40%' })).toBeDefined()

      expect((await runLimits($, 'off')).text).toBe('Limits meter hidden. /limits brings it back.')
      expect(saved.isHidden).toBe(true)
      expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })

      expect((await runLimits($, ' ON ')).text).toBe('Limits meter shown.')
      expect(saved.isHidden).toBe(false)
      expect(await ui.find({ type: 'Text', text: '40%' })).toBeDefined()

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
    expect(await ui.find({ type: 'Text', text: '40%' })).toBeDefined()
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

// A response of the main thread ended: the context window moved and has a reading. Given
// windows, they moved too unless `changed` says only the context did; a measurement carries
// the windows either way.
const respond = (
  $: Engine,
  rateLimits: SessionRateLimit[] = [],
  changed: UsageUnit[] = rateLimits.length > 0 ? ['context', 'rateLimits'] : ['context'],
) => $.session.measure({ context: { window: 200_000, tokens: 50_000, percent: 25 }, rateLimits, changed })

// A compaction moves the context window too, but leaves it with no reading.
const compact = ($: Engine) =>
  $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ['context'] })

// The prompt cache is warm for a while after each response. Claude Code doesn't say how long
// the account's cache lasts, so the `cacheTtl` option does: 5 minutes unless it says 1h.
describe('prompt cache', () => {
  const FIGURES: SessionRateLimit[] = [
    { kind: 'five_hour', percentUsed: 61, resetsAt: at(42 * MINUTE) },
    { kind: 'seven_day', percentUsed: 75, resetsAt: at(2 * DAY + 21 * HOUR) },
  ]

  test('shows nothing until the session has had a response', async ($, on) => {
    engineBeneath(on)
    await startSession($)
    // A window moved, with no response of this session's behind it.
    await measure($, [{ kind: 'five_hour', percentUsed: 40, resetsAt: at(HOUR) }])

    const ui = await mountHint($, 'terminal', 120)
    expect(await ui.find({ type: 'Text', text: '40%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Cache ' })).toBeUndefined()
    await ui.unmount()
  })

  test('a response makes it warm, with the time left, after the windows', async ($, on) => {
    engineBeneath(on)
    await respond($, [
      { kind: 'five_hour', percentUsed: 38, resetsAt: at(2 * HOUR + 31 * MINUTE) },
      { kind: 'seven_day', percentUsed: 82, resetsAt: at(3 * DAY + 4 * HOUR + 20 * MINUTE) },
    ])

    for (const surface of SURFACES) {
      const ui = await mountHint($, surface, 120)
      expect(await ui.find({ type: 'Text', text: 'Cache ' })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: 'warm' }))?.props.color).toBe('success')
      expect((await ui.find({ type: 'Text', text: ' ↓5m' }))?.props.dimColor).toBe(true)
      // 27 + 3 + 26 + 3 + 23 = 82 cells centred in 120 start at column 19, 17 past the indent.
      expect(await marginOf(ui)).toBe(17)
      await ui.unmount()
    }
  })

  test('counts down each minute, and its colour goes from green to red as it empties', async ($, on) => {
    const { clock } = engineBeneath(on)
    await startSession($)
    await respond($)

    const ui = await mountHint($, 'terminal', 120)
    for (const [countdown, color] of [
      [' ↓5m', 'success'],
      [' ↓4m', 'success'],
      [' ↓3m', 'success'],
      [' ↓2m', 'warning'],
      [' ↓1m', 'error'],
    ]) {
      expect((await ui.find({ type: 'Text', text: 'warm' }))?.props.color).toBe(color)
      expect(await ui.find({ type: 'Text', text: countdown })).toBeDefined()
      await clock.advance(MINUTE)
    }

    expect((await ui.find({ type: 'Text', text: 'cold' }))?.props.dimColor).toBe(true)
    await ui.unmount()
  })

  test('goes cold the moment it lapses, not at the next minute check', async ($, on) => {
    const { clock } = engineBeneath(on)
    await clock.advance(20_000)
    await startSession($)
    // Used at 12:00:20, so cold from 12:05:20; the minute checks come at 12:05:00 and 12:06:00.
    await respond($)

    const ui = await mountHint($, 'terminal', 120)
    await clock.advance(5 * MINUTE - 10_000)
    expect(await ui.find({ type: 'Text', text: 'warm' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' ↓1m' })).toBeDefined()

    await clock.advance(15_000)
    expect(await ui.find({ type: 'Text', text: 'warm' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: 'cold' }))?.props.dimColor).toBe(true)
    expect(await ui.find({ type: 'Text', text: /↓/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a later response starts the time over, and the lapse moves with it', async ($, on) => {
    const { clock } = engineBeneath(on)
    await clock.advance(20_000)
    await startSession($)
    await respond($)

    const ui = await mountHint($, 'terminal', 120)
    await clock.advance(4 * MINUTE)
    await respond($)
    expect(await ui.find({ type: 'Text', text: ' ↓5m' })).toBeDefined()

    // The first response's lapse (12:05:20) has passed, the second's (12:09:20) has not. At
    // the 12:06:00 check 3 minutes 20 seconds are left, which reads as 4.
    await clock.advance(2 * MINUTE)
    expect(await ui.find({ type: 'Text', text: ' ↓4m' })).toBeDefined()
    await clock.advance(2 * MINUTE + 50_000)
    expect(await ui.find({ type: 'Text', text: ' ↓1m' })).toBeDefined()

    // 12:09:25, before the minute check at 12:10:00.
    await clock.advance(15_000)
    expect(await ui.find({ type: 'Text', text: 'cold' })).toBeDefined()
    await ui.unmount()
  })

  test('lasts an hour when the cacheTtl option says 1h, and the row keeps its width', { options: { cacheTtl: '1h' } }, async ($, on) => {
    const { clock } = engineBeneath(on)
    await startSession($)
    await respond($)

    const ui = await mountHint($, 'terminal', 120)
    expect(await ui.find({ type: 'Text', text: ' ↓60m' })).toBeDefined()
    const margin = await marginOf(ui)

    await clock.advance(30 * MINUTE)
    expect(await ui.find({ type: 'Text', text: ' ↓30m' })).toBeDefined()

    await clock.advance(21 * MINUTE)
    expect(await ui.find({ type: 'Text', text: ' ↓9m ' })).toBeDefined()
    expect(await marginOf(ui)).toBe(margin)

    await clock.advance(9 * MINUTE)
    expect(await ui.find({ type: 'Text', text: 'cold' })).toBeDefined()
    await ui.unmount()
  })

  test('a running turn keeps it warm, with no time to count', async ($, on) => {
    const { clock } = engineBeneath(on)
    await startSession($)
    await respond($)
    await clock.advance(10 * MINUTE)

    const idle = await mountHint($, 'terminal', 120)
    expect(await idle.find({ type: 'Text', text: 'cold' })).toBeDefined()
    await idle.unmount()

    // Every request of the turn uses the cache, so a turn longer than its lifetime is no
    // reason to call it cold.
    const busy = await mountHint($, 'terminal', 120, { ...HINT, isWorking: true })
    expect((await busy.find({ type: 'Text', text: 'warm' }))?.props.color).toBe('success')
    expect(await busy.find({ type: 'Text', text: /↓/ })).toBeUndefined()
    await busy.unmount()
  })

  test('a compaction leaves the old prompt behind, and the next response starts it again', async ($, on) => {
    engineBeneath(on)
    await startSession($)
    await respond($)

    const ui = await mountHint($, 'terminal', 120)
    expect(await ui.find({ type: 'Text', text: 'warm' })).toBeDefined()

    await compact($)
    expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })

    await respond($)
    expect(await ui.find({ type: 'Text', text: 'warm' })).toBeDefined()
    await ui.unmount()
  })

  test('a session with no usage windows still shows it', async ($, on) => {
    engineBeneath(on)
    await respond($)

    const ui = await mountHint($, 'terminal', 120)
    expect(await ui.find({ type: 'Text', text: 'Cache ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /%/ })).toBeUndefined()
    // 23 cells centred in 120 start at column 48, 46 past the indent.
    expect(await marginOf(ui)).toBe(46)
    await ui.unmount()
  })

  test("is the session's own: nothing of it goes to the other sessions", async ($, on) => {
    engineBeneath(on)
    const saved: Record<string, unknown> = {}
    storeBeneath(on, saved)
    await startSession($)

    await respond($, [{ kind: 'five_hour', percentUsed: 40 }])
    expect(Object.keys(saved)).toEqual(['reading'])
    expect(saved.reading).toEqual({ at: T0, limits: [{ kind: 'five_hour', percentUsed: 40 }] })
  })

  test('on a narrow terminal it stays while the short labels fit it, and goes before the countdowns do', async ($, on) => {
    engineBeneath(on)
    await respond($, [
      { kind: 'five_hour', percentUsed: 40, resetsAt: at(2 * HOUR) },
      { kind: 'seven_day', percentUsed: 60, resetsAt: at(2 * DAY) },
    ])

    // The full row needs 82 cells, short labels with the cache 66, the full windows alone
    // 56, short labels without the cache 43.
    const full = await mountHint($, 'terminal', 86)
    expect(await full.find({ type: 'Text', text: 'Session ' })).toBeDefined()
    expect(await full.find({ type: 'Text', text: 'Cache ' })).toBeDefined()
    await full.unmount()

    for (const columns of [85, 70]) {
      const short = await mountHint($, 'terminal', columns)
      expect(await short.find({ type: 'Text', text: '5h ' })).toBeDefined()
      expect(await short.find({ type: 'Text', text: 'Cache ' })).toBeDefined()
      await short.unmount()
    }

    // The row as it was without the cache: the windows with their full labels.
    for (const columns of [69, 60]) {
      const windows = await mountHint($, 'terminal', columns)
      expect(await windows.find({ type: 'Text', text: 'Session ' })).toBeDefined()
      expect(await windows.find({ type: 'Text', text: 'Cache ' })).toBeUndefined()
      await windows.unmount()
    }

    const narrow = await mountHint($, 'terminal', 59)
    expect(await narrow.find({ type: 'Text', text: '5h ' })).toBeDefined()
    expect(await narrow.find({ type: 'Text', text: 'Cache ' })).toBeUndefined()
    expect((await narrow.findAll({ type: 'Text', text: /↻/ })).map(t => t.text)).toEqual([' ↻2:00', ' ↻2d 0h '])
    await narrow.unmount()
  })

  test('/limits hides it with the rest of the row', async ($, on) => {
    engineBeneath(on)
    storeBeneath(on, {})
    await respond($, FIGURES)

    const ui = await mountHint($, 'terminal', 120)
    expect(await ui.find({ type: 'Text', text: 'warm' })).toBeDefined()

    await runLimits($, 'off')
    expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })
    await runLimits($, 'on')
    expect(await ui.find({ type: 'Text', text: 'warm' })).toBeDefined()
    await ui.unmount()
  })

  test('the desktop status entry says it too, in one entry per response', async ($, on) => {
    const { clock } = engineBeneath(on)
    storeBeneath(on, {})
    const statuses = statusBeneath(on, ['desktop'])
    await startSession($)

    await respond($, FIGURES)
    expect(statuses).toEqual(['Session 61% ↻0:42 · Week 75% ↻2d 21h · Cache warm ↓5m'])

    await clock.advance(MINUTE)
    expect(statuses.at(-1)).toBe('Session 61% ↻0:41 · Week 75% ↻2d 20h · Cache warm ↓4m')

    await clock.advance(4 * MINUTE)
    expect(statuses.at(-1)).toBe('Session 61% ↻0:37 · Week 75% ↻2d 20h · Cache cold')

    // A response that moved no window moves only the context window.
    await respond($, FIGURES, ['context'])
    expect(statuses.at(-1)).toBe('Session 61% ↻0:37 · Week 75% ↻2d 20h · Cache warm ↓5m')
  })
})
