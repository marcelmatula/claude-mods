import { atom, read, update } from 'claude-code'
import type { Register, SessionRateLimit } from 'claude-code'

import type { Limit } from '../types'

const limits = atom({ plugin: 'limits-meter', key: 'limits' } as const, [])

const WINDOWS = [
  { kind: 'five_hour', label: 'Session', short: '5h' },
  { kind: 'seven_day', label: 'Week', short: '7d' },
] as const

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const SEPARATOR = '   '
const TRACK = 'subtle'
// The hint line's rows start two columns in from the terminal's edge.
const INDENT = 2

type Tier = { name: 'full' | 'compact' | 'minimal'; bar: number }

const TIERS: Tier[] = [
  { name: 'full', bar: 8 },
  { name: 'compact', bar: 5 },
  { name: 'minimal', bar: 0 },
]

const known = (list: readonly SessionRateLimit[]): Limit[] =>
  list
    .filter(one => WINDOWS.some(w => w.kind === one.kind))
    .map(({ kind, percentUsed, resetsAt }) =>
      resetsAt === undefined ? { kind, percentUsed } : { kind, percentUsed, resetsAt },
    )

const colorFor = (percent: number) =>
  percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'success'

const percentText = (percent: number) => `${Math.round(percent)}%`.padStart(4)

// Cells one meter takes: "label ", the bar and a space, then "nn%" padded to 4.
const meterWidth = (tier: Tier, label: string) =>
  label.length + 1 + (tier.bar > 0 ? tier.bar + 1 : 0) + 4

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const { rateLimits } = await $.session.usage()
      await update($, limits, () => known(rateLimits))
    } catch {
      // No reading yet; session.measure fills it in after the next response.
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, limits, () => known(e.rateLimits))
    }

    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const engine = await next(e)
    const list = await read($, limits)
    const readings = WINDOWS.flatMap(w => {
      const one = list.find(l => l.kind === w.kind)

      return one === undefined ? [] : [{ ...w, percent: one.percentUsed }]
    })

    if (readings.length === 0) {
      return engine
    }

    // The most detailed tier that fits between the indents.
    const columns = e.viewport?.columns ?? 80
    const layout = TIERS.map(tier => {
      const meters = readings.map(r => ({
        label: tier.name === 'full' ? r.label : r.short,
        percent: r.percent,
      }))
      const width =
        meters.reduce((sum, m) => sum + meterWidth(tier, m.label), 0) +
        SEPARATOR.length * (meters.length - 1)

      return { tier, meters, width }
    }).find(l => l.width <= columns - 2 * INDENT)

    if (layout === undefined) {
      return engine
    }

    const { Box, Text } = $.ui.resolve(e)

    const bar = (percent: number, cells: number) => {
      const eighths = Math.round((Math.min(100, Math.max(0, percent)) / 100) * cells * 8)
      const full = Math.floor(eighths / 8)
      const partial = EIGHTHS[eighths % 8] ?? ''
      const empty = cells - full - (partial === '' ? 0 : 1)
      const color = colorFor(percent)

      return (
        <Box flexDirection="row" marginRight={1}>
          {[
            ...(full > 0 ? [<Text color={color}>{'█'.repeat(full)}</Text>] : []),
            ...(partial !== '' ? [<Text color={color} backgroundColor={TRACK}>{partial}</Text>] : []),
            ...(empty > 0 ? [<Text backgroundColor={TRACK}>{' '.repeat(empty)}</Text>] : []),
          ]}
        </Box>
      )
    }

    // The engine's line is a full-width row (hint left, notices right) that paints
    // over anything placed on it, and a Box around it may not size it. So it stays
    // as it is, and the meters take the row under it, centred on the terminal.
    return (
      <Box flexDirection="column">
        {engine}
        <Box flexDirection="row" marginLeft={Math.max(0, Math.floor((columns - layout.width) / 2) - INDENT)}>
          {layout.meters.map((meter, index) => (
            <Box flexDirection="row">
              {[
                ...(index > 0 ? [<Text dimColor>{SEPARATOR}</Text>] : []),
                <Text dimColor>{`${meter.label} `}</Text>,
                ...(layout.tier.bar > 0 ? [bar(meter.percent, layout.tier.bar)] : []),
                <Text color={colorFor(meter.percent)} bold>
                  {percentText(meter.percent)}
                </Text>,
              ]}
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
