import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Limit, Reading } from '../types'

const limits = atom({ plugin: 'limits-meter', key: 'limits' } as const, [])
const isHidden = atom({ plugin: 'limits-meter', key: 'isHidden' } as const, false)
// The time the countdowns count from: the latest minute check or reading, 0 before one.
const time = atom({ plugin: 'limits-meter', key: 'time' } as const, 0)
// When this session's own engine last brought figures, 0 before it has.
const measuredAt = atom({ plugin: 'limits-meter', key: 'measuredAt' } as const, 0)
// When this session's prompt cache was last used: the end of its latest response, 0 before
// one. Unlike the limits it is not shared, the cache belonging to the session's own prompt.
const cachedAt = atom({ plugin: 'limits-meter', key: 'cachedAt' } as const, 0)
// The session's name, as /rename or --name set it; '' while it has none.
const sessionName = atom({ plugin: 'limits-meter', key: 'name' } as const, '')

// $.store key that keeps the shown/hidden choice across sessions.
const HIDDEN_KEY = 'isHidden'
// $.store key of the newest figures any session got, with when it got them. The limits are
// the account's, but each session's engine learns them only from its own responses.
const READING_KEY = 'reading'

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

const MINUTE_MS = 60_000

// How long the prompt cache stays warm after it is used. Claude Code does not tell a mod
// which applies to the account, so the `cacheTtl` option says.
const CACHE_TTLS = { '5m': 5 * MINUTE_MS, '1h': 60 * MINUTE_MS } as const
const CACHE_LABEL = 'Cache'
// The cache gets colder from the moment it is used, and a countdown to that is not a
// reset: this marks the time left until it is cold, not until a window starts again.
const CACHE_MARK = '↓'

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const SEPARATOR = '   '
// Marks a countdown as the time until the window starts again, not a time of day.
const RESET_MARK = '↻'
const TRACK = 'subtle'
// The hint line's rows start two columns in from the terminal's edge.
const INDENT = 2

// The session's name leads the row, cut with an ellipsis to at most NAME_CELLS cells. On a
// row too narrow for it, it gives up cells down to NAME_MIN_CELLS before the meters lose
// detail, and goes only when no tier with bars leaves it that many.
const NAME_CELLS = 24
const NAME_MIN_CELLS = 8
const ELLIPSIS = '…'

type Tier = { labels: 'long' | 'short'; bar: number; countdowns: boolean; cache: boolean }

// From the most detailed down; the first that fits is drawn. The tiers without the cache
// are the row as it was before the cache came, so a row too narrow for the cache keeps
// whatever the windows alone could. The cache stays as long as the short labels let it fit,
// which is longer than the long labels would, and goes before the countdowns do.
const TIERS: Tier[] = [
  { labels: 'long', bar: 8, countdowns: true, cache: true },
  { labels: 'short', bar: 5, countdowns: true, cache: true },
  { labels: 'long', bar: 8, countdowns: true, cache: false },
  { labels: 'short', bar: 5, countdowns: true, cache: false },
  { labels: 'short', bar: 5, countdowns: false, cache: false },
  { labels: 'short', bar: 0, countdowns: false, cache: false },
]

// One item of the row, whatever it measures. `fill` is how much of the bar is filled, as
// a percentage; `value` is what follows the bar, a percentage or a word, in up to 4 cells.
type Meter = {
  label: string
  fill: number
  color: string
  value: string
  isDim: boolean
  countdown: string | undefined
}

// The prompt cache as of some moment: warm with the percentage of its lifetime left and,
// while the time is running, the time left; or cold. Absent before the session's first
// response.
type Cache = { isWarm: boolean; remaining: number; untilCold: string | undefined }

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

const percentText = (percent: number) => `${Math.round(percent)}%`

// Each value counts as 4 cells. What a shorter one lacks goes at the end of its meter, so
// it sits one cell from its bar and one space from its countdown whatever its digits, and
// the row keeps its width.
const VALUE_CELLS = 4
const valuePad = (meter: Meter) => ' '.repeat(Math.max(0, VALUE_CELLS - meter.value.length))

// The time left until a reset, rounded up to the minute so that it never reads 0:00
// before the reset: "2:31" under a day, "3d 4h" from a day on.
const leftText = (ms: number) => {
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 24 * 60) {
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
  }

  return `${Math.floor(minutes / (24 * 60))}d ${Math.floor((minutes % (24 * 60)) / 60)}h`
}

// What the meters show at `now`: each known window's percentage and, while its reset is
// still ahead, the time left until it.
const readingsAt = (list: readonly Limit[], now: number) => {
  const shown = current(list, now)

  return WINDOWS.flatMap(w => {
    const one = shown.find(l => l.kind === w.kind)
    if (one === undefined) {
      return []
    }

    const left = one.resetsAt === undefined ? NaN : Date.parse(one.resetsAt) - now

    return [{ ...w, percent: one.percentUsed, untilReset: now > 0 && left > 0 ? leftText(left) : undefined }]
  })
}

// The cache's lifetime, which the `cacheTtl` option sets when the module loads.
let cacheMs: number = CACHE_TTLS['5m']

// The time left until the cache is cold, rounded up to the minute like the windows'
// countdowns: "4m", and "60m" on the hour's lifetime.
const cacheLeftText = (ms: number) => `${Math.ceil(ms / MINUTE_MS)}m`

// Most cells that text takes, which the countdown is padded to.
const cacheLeftWidth = () => `${cacheMs / MINUTE_MS}m`.length

// The cache as of `now`, given when it was last used. A turn that is running keeps it warm
// with every request it makes, so while one is, there is no time to count down. Absent
// before the session's first response, and wherever the time is not known.
const cacheAt = (touched: number, now: number, isWorking: boolean): Cache | undefined => {
  if (touched === 0 || now === 0) {
    return undefined
  }

  if (isWorking) {
    return { isWarm: true, remaining: 100, untilCold: undefined }
  }

  const left = touched + cacheMs - now

  return left > 0
    ? { isWarm: true, remaining: Math.min(100, (left * 100) / cacheMs), untilCold: cacheLeftText(left) }
    : { isWarm: false, remaining: 0, untilCold: undefined }
}

// The figures as one line of text: "Session 61% ↻0:42 · Week 75% ↻2d 21h · Cache warm ↓4m".
// It leaves out the session's name, which the desktop app shows itself.
const statusText = (list: readonly Limit[], now: number, touched: number) => {
  const parts = readingsAt(list, now).map(
    r => `${r.label} ${Math.round(r.percent)}%${r.untilReset === undefined ? '' : ` ${RESET_MARK}${r.untilReset}`}`,
  )
  const cache = cacheAt(touched, now, false)
  if (cache !== undefined) {
    parts.push(
      `${CACHE_LABEL} ${cache.isWarm ? 'warm' : 'cold'}${cache.untilCold === undefined ? '' : ` ${CACHE_MARK}${cache.untilCold}`}`,
    )
  }

  return parts.length === 0 ? undefined : parts.join(' · ')
}

// The meters a tier draws for the windows' readings.
const windowMeter = (r: ReturnType<typeof readingsAt>[number], tier: Tier): Meter => ({
  label: tier.labels === 'long' ? r.label : r.short,
  fill: r.percent,
  color: colorFor(r.percent),
  value: percentText(r.percent),
  isDim: false,
  countdown:
    tier.countdowns && r.untilReset !== undefined ? ` ${RESET_MARK}${r.untilReset.padEnd(r.left)}` : undefined,
})

// The cache as a meter: a bar that empties as the cache cools, in the limits' colours turned
// round (green with most of the lifetime left), and "warm" or "cold" where their percentage is.
const cacheMeter = (cache: Cache, tier: Tier): Meter => ({
  label: CACHE_LABEL,
  fill: cache.remaining,
  color: colorFor(100 - cache.remaining),
  value: cache.isWarm ? 'warm' : 'cold',
  isDim: !cache.isWarm,
  countdown:
    tier.countdowns && cache.untilCold !== undefined
      ? ` ${CACHE_MARK}${cache.untilCold.padEnd(cacheLeftWidth())}`
      : undefined,
})

// Cells one meter takes: "label ", the bar and a space, the value in its 4 cells, then the
// countdown with its space and mark.
const meterWidth = (tier: Tier, meter: Meter) =>
  meter.label.length + 1 + (tier.bar > 0 ? tier.bar + 1 : 0) + VALUE_CELLS + (meter.countdown?.length ?? 0)

// Cells a text takes, a character to a cell: a name in wide characters (CJK, emoji) takes
// more than this says, which moves the row off centre.
const cellsOf = (text: string) => [...text].length

// The text in at most `cells` cells, cut with an ellipsis when it is longer.
const clip = (text: string, cells: number) =>
  cellsOf(text) <= cells ? text : `${[...text].slice(0, cells - 1).join('').trimEnd()}${ELLIPSIS}`

const isLimit = (one: unknown): one is Limit => {
  if (typeof one !== 'object' || one === null) return false
  const { kind, percentUsed, resetsAt } = one as Record<string, unknown>

  return (
    typeof kind === 'string' &&
    typeof percentUsed === 'number' &&
    (resetsAt === undefined || typeof resetsAt === 'string')
  )
}

const isReading = (value: unknown): value is Reading => {
  if (typeof value !== 'object' || value === null) return false
  const { at, limits } = value as Record<string, unknown>

  return typeof at === 'number' && Array.isArray(limits) && limits.every(isLimit)
}

// The reading a session saved last, or undefined when there is none the mod can read.
async function savedReading($: EngineInterface): Promise<Reading | undefined> {
  try {
    const value = await $.store.get(READING_KEY)
    return isReading(value) ? value : undefined
  } catch {
    return undefined
  }
}

// The time, then the newest figures with any window past its reset time at 0%: the
// engine's, or the reading another session saved when that is newer. The time is written
// every time, which moves the countdowns on; the figures only when they differ from the
// state's, since a write redraws the meters.
async function refresh($: EngineInterface) {
  const now = await $.clock.now()
  await update($, time, () => now)
  const usage = await $.session.usage()
  const own = known(usage.rateLimits)
  // Responses with no windows mean the session is off a subscription (on an API key), so
  // the figures another session saved are not its limits.
  const isOffSubscription = own.length === 0 && (usage.cost?.usd ?? 0) > 0
  const saved = isOffSubscription ? undefined : await savedReading($)
  const newest = saved !== undefined && saved.at > (await read($, measuredAt)) ? saved.limits : own
  const fresh = current(newest, now)
  if (JSON.stringify(fresh) !== JSON.stringify(await read($, limits))) {
    await update($, limits, () => fresh)
  }

  await showStatus($)
}

// The text the status entry was last set to, so it is set again only when it changes.
let statusShown: string | undefined

// The desktop app draws no hint line, but it does draw a plugin's status entry, small in
// the prompt's footer. So a session that draws on no terminal shows the figures there as
// text, and a terminal session, which has the meter row, sets none.
async function showStatus($: EngineInterface) {
  try {
    const surfaces = await $.session.surfaces()
    const isOffTerminal = surfaces.length > 0 && !surfaces.includes('terminal')
    const text =
      isOffTerminal && !(await read($, isHidden))
        ? statusText(await read($, limits), await read($, time), await read($, cachedAt))
        : undefined
    if (text !== statusShown) {
      statusShown = text
      $.ui.status(text)
    }
  } catch {
    // The next minute check tries again.
  }
}

// The name the classic hooks last brought to this load of the module, undefined before
// they have. A reload starts it over while the state keeps the name it had.
let nameSeen: string | undefined

// Keeps the session's name as Claude Code handed it to a settings hook, no name included,
// so a session that lost its name loses it from the row.
async function nameSession($: EngineInterface, title: string | undefined) {
  const name = title?.trim() ?? ''
  nameSeen = name
  try {
    if (name !== (await read($, sessionName))) {
      await update($, sessionName, () => name)
    }
  } catch {
    // The next prompt brings it again.
  }
}

// Fills the state a session starts from: the saved shown/hidden choice, the session's name
// and the figures.
async function fill($: EngineInterface) {
  try {
    const stored = await $.store.get(HIDDEN_KEY)
    await update($, isHidden, () => stored === true)
  } catch {
    // No stored choice: the meters show.
  }

  // /clear and /resume empty the state just after the SessionStart that names the session
  // they start may have run, so the name it brought is written again.
  const name = nameSeen
  if (name !== undefined) {
    try {
      await update($, sessionName, () => name)
    } catch {
      // The next prompt brings it again.
    }
  }

  try {
    await refresh($)
  } catch {
    // No reading yet, from this session or a saved one; session.measure fills it in
    // after the next response.
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

    await keepCommand($)
  })
}

// Whether a timer is waiting for the cache to go cold. The minute check would show it up to
// a minute late, so one timer waits for the moment itself. A response in the meantime moves
// that moment later, and the timer, finding it so, waits again: one is enough.
let isWatchingCache = false

function watchCache($: EngineInterface, wait: number) {
  if (isWatchingCache) {
    return
  }

  isWatchingCache = true
  $.clock.after(wait, async () => {
    isWatchingCache = false
    try {
      const touched = await read($, cachedAt)
      const now = await $.clock.now()
      if (touched === 0) {
        return
      }

      const left = touched + cacheMs - now
      if (left > 0) {
        watchCache($, left)
        return
      }

      await update($, time, () => now)
      await showStatus($)
    } catch {
      // The next minute check shows it.
    }
  })
}

// A response ended: the cache was used just before, so its time starts over. Anything else
// that moves the context window without a response (a compaction, which leaves the window
// with no reading) starts a different prompt, which the old cache does not serve.
async function useCache($: EngineInterface, hasResponse: boolean) {
  if (!hasResponse) {
    await update($, cachedAt, () => 0)
    return
  }

  const now = await $.clock.now()
  await update($, time, () => now)
  await update($, cachedAt, () => now)
  watchCache($, cacheMs)
}

// Whether this load of the module runs the minute check. session.start starts it, and
// one follows every load of the module; should a load come without one, the next reading
// starts it, and adds /limits.
let isChecking = false

async function startChecking($: EngineInterface) {
  if (!isChecking) {
    isChecking = true
    await checkOnTheMinute($)
  }
}

const COMMAND = { name: 'limits', description: 'Show or hide the usage limits meter', argumentHint: 'on|off' }

// Adds /limits, replacing any registration the session already has.
async function registerCommand($: EngineInterface) {
  try {
    await $.command.register(COMMAND)
  } catch {
    // Without the command the meters still work; they just can't be hidden.
  }
}

// Adds /limits again when the session no longer lists it: a desktop app session that
// was running when the mod was updated lost it.
async function keepCommand($: EngineInterface) {
  try {
    if (!(await $.command.list()).some(c => c.name === COMMAND.name)) {
      await registerCommand($)
    }
  } catch {
    // The next check looks again.
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

export const register: Register = (on, options) => {
  cacheMs = CACHE_TTLS[options.cacheTtl === '1h' ? '1h' : '5m']

  on('session.start', async ($, e, next) => {
    await registerCommand($)
    await fill($)
    await startChecking($)

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

  // Claude Code tells a mod the session's name only through these two settings hook events:
  // at the start (a --name, or the name of a session resumed), and with each prompt, which
  // brings a /rename. Nothing else of either is read, and both go on as they came.
  on('classic.SessionStart', async ($, e, next) => {
    await nameSession($, e.session_title)
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await nameSession($, e.session_title)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (!isChecking) {
      await registerCommand($)
      await startChecking($)
    }

    // The window's fill moves with every response, and has no reading yet after a compaction.
    const isContextMoved = e.changed.includes('context')
    if (isContextMoved) {
      await useCache($, e.context.tokens !== undefined)
    }

    if (e.changed.includes('rateLimits')) {
      const now = await $.clock.now()
      const reading = known(e.rateLimits)
      await update($, time, () => now)
      await update($, measuredAt, () => now)
      await update($, limits, () => current(reading, now))
      await showStatus($)

      // Saved for the other sessions, which pick it up at their next minute check. A
      // reading with no windows (no subscription) would empty their meters.
      if (reading.length > 0) {
        try {
          await $.store.set(READING_KEY, { at: now, limits: reading } satisfies Reading)
        } catch {
          // The other sessions keep the reading they have.
        }
      }
    } else if (isContextMoved) {
      await showStatus($)
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
    await showStatus($)
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

    const name = await read($, sessionName)
    const list = await read($, limits)
    const touched = await read($, cachedAt)
    if (list.length === 0 && touched === 0 && name === '') {
      return engine
    }

    // Read only when there are figures or a cache, so the minute's time redraws nothing
    // otherwise.
    const now = list.length === 0 && touched === 0 ? 0 : await read($, time)
    const windows = readingsAt(list, now)
    const cache = cacheAt(touched, now, e.props.isWorking)

    if (windows.length === 0 && cache === undefined && name === '') {
      return engine
    }

    // The most detailed tier that fits between the indents: first the tiers with bars led
    // by the name, then each tier as it was without it.
    const columns = e.viewport?.columns ?? 80
    const room = columns - 2 * INDENT
    const tiers = [
      ...(name === '' ? [] : TIERS.filter(t => t.bar > 0).map(tier => ({ tier, hasName: true }))),
      ...TIERS.map(tier => ({ tier, hasName: false })),
    ]
    const layout = tiers.map(({ tier, hasName }) => {
      const meters: Meter[] = [
        ...windows.map(r => windowMeter(r, tier)),
        ...(tier.cache && cache !== undefined ? [cacheMeter(cache, tier)] : []),
      ]
      const metersWidth =
        meters.reduce((sum, m) => sum + meterWidth(tier, m), 0) +
        SEPARATOR.length * Math.max(0, meters.length - 1)
      const nameRoom = Math.min(NAME_CELLS, room - metersWidth - (meters.length > 0 ? SEPARATOR.length : 0))
      const shownName =
        hasName && nameRoom >= Math.min(cellsOf(name), NAME_MIN_CELLS) ? clip(name, nameRoom) : undefined
      const nameWidth = shownName === undefined ? 0 : cellsOf(shownName) + (meters.length > 0 ? SEPARATOR.length : 0)

      return { tier, meters, shownName, hasName, width: nameWidth + metersWidth }
    }).find(l => (l.hasName ? l.shownName !== undefined : l.meters.length > 0) && l.width <= room)

    if (layout === undefined) {
      return engine
    }

    const { Box, Text } = $.ui.resolve(e)

    const bar = (percent: number, cells: number, color: string) => {
      const eighths = Math.round((Math.min(100, Math.max(0, percent)) / 100) * cells * 8)
      const full = Math.floor(eighths / 8)
      const partial = EIGHTHS[eighths % 8] ?? ''
      const empty = cells - full - (partial === '' ? 0 : 1)

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

    // The session's name, bold, set off from the meters as they are from each other.
    const lead =
      layout.shownName === undefined
        ? []
        : [
            <Text bold>{layout.shownName}</Text>,
            ...(layout.meters.length > 0 ? [<Text dimColor>{SEPARATOR}</Text>] : []),
          ]

    // The engine's line is a full-width row (hint left, notices right) that paints
    // over anything placed on it, and a Box around it may not size it. So it stays
    // as it is, and the meters take the row under it, centred on the terminal.
    return (
      <Box flexDirection="column">
        {engine}
        <Box flexDirection="row" marginLeft={Math.max(0, Math.floor((columns - layout.width) / 2) - INDENT)}>
          {lead}
          {layout.meters.map((meter, index) => (
            <Box flexDirection="row">
              {[
                ...(index > 0 ? [<Text dimColor>{SEPARATOR}</Text>] : []),
                <Text dimColor>{`${meter.label} `}</Text>,
                ...(layout.tier.bar > 0 ? [bar(meter.fill, layout.tier.bar, meter.color)] : []),
                meter.isDim ? (
                  <Text dimColor>{meter.value}</Text>
                ) : (
                  <Text color={meter.color} bold>
                    {meter.value}
                  </Text>
                ),
                ...(meter.countdown !== undefined ? [<Text dimColor>{meter.countdown}</Text>] : []),
                ...(valuePad(meter) !== '' ? [<Text>{valuePad(meter)}</Text>] : []),
              ]}
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
