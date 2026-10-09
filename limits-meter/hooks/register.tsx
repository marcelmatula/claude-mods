import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Limit } from '../types'

const limits = atom({ plugin: 'limits-meter', key: 'limits' } as const, [])
const isHidden = atom({ plugin: 'limits-meter', key: 'isHidden' } as const, false)

// $.store key that keeps the shown/hidden choice across sessions.
const HIDDEN_KEY = 'isHidden'

// How often the meters check the engine's figures: an idle session gets no responses to
// notice a reset by, and nothing else refills the state if it was emptied.
const CHECK_MS = 60_000

// How long after /clear or /resume the state is filled in again. The engine empties it
// within a few milliseconds of session.end.
const REFILL_DELAY_MS = 250

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

const hasReset = (one: Limit, now: number) =>
  one.resetsAt !== undefined && Date.parse(one.resetsAt) <= now

// A window starts again at 0% when its reset time passes, but Claude Code sends the new
// figure only with the next response, so until then the mod resets it itself.
const current = (list: readonly Limit[], now: number): Limit[] =>
  list.map(one => (hasReset(one, now) ? { kind: one.kind, percentUsed: 0 } : one))

const colorFor = (percent: number) =>
  percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'success'

const percentText = (percent: number) => `${Math.round(percent)}%`.padStart(4)

// Cells one meter takes: "label ", the bar and a space, then "nn%" padded to 4.
const meterWidth = (tier: Tier, label: string) =>
  label.length + 1 + (tier.bar > 0 ? tier.bar + 1 : 0) + 4

// The engine's latest figures, with any window past its reset time at 0%. Written only
// when they differ from the state's, since a write redraws the meters.
async function refresh($: EngineInterface) {
  const { rateLimits } = await $.session.usage()
  const now = await $.clock.now()
  const fresh = current(known(rateLimits), now)
  if (JSON.stringify(fresh) !== JSON.stringify(await read($, limits))) {
    await update($, limits, () => fresh)
  }
}

// Fills the state a session starts from: the saved shown/hidden choice and the figures.
async function fill($: EngineInterface) {
  try {
    const stored = await $.store.get(HIDDEN_KEY)
    await update($, isHidden, () => stored === true)
  } catch {
    // No stored choice: the meters show.
  }

  try {
    await refresh($)
  } catch {
    // No reading yet; session.measure fills it in after the next response.
  }
}

// What `/limits <args>` asks for: show, hide, flip, or undefined for anything else.
const wanted = (args: string, hidden: boolean): boolean | undefined => {
  const word = args.trim().toLowerCase()
  if (word === '') return !hidden
  if (word === 'off') return true
  if (word === 'on') return false
  return undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'limits',
        description: 'Show or hide the usage limits meter',
        argumentHint: 'on|off',
      })
    } catch {
      // Without the command the meters still work; they just can't be hidden.
    }

    await fill($)

    $.clock.every(CHECK_MS, async () => {
      try {
        await refresh($)
      } catch {
        // The next check tries again.
      }
    })

    return next(e)
  })

  // /clear and /resume empty the session's state and run no session.start after it, while
  // the engine keeps its figures, so the meters would stay away until a window moved.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      $.clock.after(REFILL_DELAY_MS, () => void fill($))
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      const now = await $.clock.now()
      await update($, limits, () => current(known(e.rateLimits), now))
    }

    return next(e)
  })

  on('command.run', { command: 'limits' }, async ($, e) => {
    const hidden = await read($, isHidden)
    // A plugin's own $.command.run can leave args out; typed commands carry "".
    const hide = wanted(e.args ?? '', hidden)
    if (hide === undefined) {
      return { text: 'Usage: /limits shows or hides the limits meter; /limits on and /limits off set it.' }
    }

    await update($, isHidden, () => hide)
    try {
      await $.store.set(HIDDEN_KEY, hide)
    } catch {
      return { text: `Limits meter ${hide ? 'hidden' : 'shown'} for this session; the choice could not be saved for later ones.` }
    }

    if (hide) {
      return { text: 'Limits meter hidden. /limits brings it back.' }
    }

    try {
      await refresh($)
    } catch {
      // Answer from the figures the state has.
    }

    if ((await read($, limits)).length === 0) {
      return {
        text: 'Limits meter shown, but there are no usage figures yet. Claude Code gets them with its next response (on a Claude subscription).',
      }
    }

    return { text: 'Limits meter shown.' }
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const engine = await next(e)
    if (await read($, isHidden)) {
      return engine
    }

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
