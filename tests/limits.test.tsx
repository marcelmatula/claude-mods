import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }

// Stands in for the engine beneath the plugin. In a session `next(e)` answers the
// hint line as an engine node, so that is what the meters are drawn around here.
const engineBeneath = (on: On) => {
  on('ui.render', { component: 'PromptHint' }, () => ({ type: 'engine', ref: 0 }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
}

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
      { kind: 'five_hour', percentUsed: 23.4, resetsAt: '2026-10-08T22:00:00Z' },
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
