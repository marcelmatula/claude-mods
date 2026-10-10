import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Limit } from '../types'

const limits = atom({ plugin: 'limits-meter', key: 'limits' } as const, [])
const isHidden = atom({ plugin: 'limits-meter', key: 'isHidden' } as const, false)
// The time the countdowns count from: the latest minute check or reading, 0 before one.
const time = atom({ plugin: 'limits-meter', key: 'time' } as const, 0)

// $.store key that keeps the shown/hidden choice across sessions.
const HIDDEN_KEY = 'isHidden'

// How often the meters check the engine's figures and the time: an idle session gets no
// responses to notice a reset by, nothing else refills the state if it was emptied, and
// the countdowns move on a minute.
const CHECK_MS = 60_000

// How long after /clear or /resume the state is filled in again. The engine empties it
// within a few milliseconds of session.end.
const REFILL_DELAY_MS = 250

// `left` is the most cells a window's countdown takes: "5:00" and "6d 23h". Each one is
// padded to it, so the centred row doesn't shift as the countdowns tick over.
const WINDOWS = [
  { kind: 'five_hour', label: 'Session', short: '5h', left: 4 },
  { kind: 'seven_day', label: 'Week', short: '7d', left: 6 },
] as const

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const SEPARATOR = '   '
// Marks a countdown as the time until the window starts again, not a time of day.
const RESET_MARK = '↻'
const TRACK = 'subtle'
// The hint line's rows start two columns in from the terminal's edge.
const INDENT = 2

type Tier = { labels: 'long' | 'short'; bar: number; countdowns: boolean }

// From the most detailed down: the labels shorten first, then the countdowns go, then
// the bars.
const TIERS: Tier[] = [
  { labels: 'long', bar: 8, countdowns: true },
  { labels: 'short', bar: 5, countdowns: true },
  { labels: 'short', bar: 5, countdowns: false },
  { labels: 'short', bar: 0, countdowns: false },
]

type Meter = { label: string; percent: number; countdown: string | undefined }

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

// The time left until a reset, rounded up to the minute so that it never reads 0:00
// before the reset: "2:31" under a day, "3d 4h" from a day on.
const leftText = (ms: number) => {
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 24 * 60) {
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
  }

  return `${Math.floor(minutes / (24 * 60))}d ${Math.floor((minutes % (24 * 60)) / 60)}h`
}

// Cells one meter takes: "label ", the bar and a space, "nn%" padded to 4, then the
// countdown with its space and mark.
const meterWidth = (tier: Tier, meter: Meter) =>
  meter.label.length + 1 + (tier.bar > 0 ? tier.bar + 1 : 0) + 4 + (meter.countdown?.length ?? 0)

// The time, then the engine's latest figures with any window past its reset time at 0%.
// The time is written every time, which moves the countdowns on; the figures only when
// they differ from the state's, since a write redraws the meters.
async function refresh($: EngineInterface) {
  const now = await $.clock.now()
  await update($, time, () => now)
  const { rateLimits } = await $.session.usage()
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

// Runs the minute check at the start of each minute, so the countdowns turn over with the
// clock's minutes. Each wait is measured from the time again, which keeps it on the minute,
// and is set before the check runs, so a check that never finishes doesn't stop the next.
async function checkOnTheMinute($: EngineInterface) {
  const now = await $.clock.now().catch(() => 0)
  $.clock.after(CHECK_MS - (now % CHECK_MS), async () => {
    void checkOnTheMinute($)
    try {
      await refresh($)
    } catch {
      // The next check tries again.
    }
  })
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
    await checkOnTheMinute($)

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
      await update($, time, () => now)
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
    if (list.length === 0) {
      return engine
    }

    // Read only when there are figures, so the minute's time redraws nothing otherwise.
    const now = await read($, time)
    const shown = current(list, now)
    const readings = WINDOWS.flatMap(w => {
      const one = shown.find(l => l.kind === w.kind)
      if (one === undefined) {
        return []
      }

      const left = one.resetsAt === undefined ? NaN : Date.parse(one.resetsAt) - now
      const countdown =
        now > 0 && left > 0 ? ` ${RESET_MARK}${leftText(left).padEnd(w.left)}` : undefined

      return [{ ...w, percent: one.percentUsed, countdown }]
    })

    if (readings.length === 0) {
      return engine
    }

    // The most detailed tier that fits between the indents.
    const columns = e.viewport?.columns ?? 80
    const layout = TIERS.map(tier => {
      const meters: Meter[] = readings.map(r => ({
        label: tier.labels === 'long' ? r.label : r.short,
        percent: r.percent,
        countdown: tier.countdowns ? r.countdown : undefined,
      }))
      const width =
        meters.reduce((sum, m) => sum + meterWidth(tier, m), 0) +
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
                ...(meter.countdown !== undefined ? [<Text dimColor>{meter.countdown}</Text>] : []),
              ]}
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
