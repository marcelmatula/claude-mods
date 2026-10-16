# limits-meter

A Claude Code mod that shows your usage limits for the current session (5 h) and the week as small progress bars with a percentage and the time left until each resets, whether the session's prompt cache is still warm and for how long, and the session's name once you have given it one. They sit on a centred row at the bottom of the screen, under the prompt's hint line; in the Claude desktop app they show as text in the prompt's footer. `/limits` hides or shows them, and the choice is remembered.

Part of [claude-mods](../README.md), Marcel's Claude Code marketplace (`marcel-mods`).

![limits-meter under the Claude Code prompt: the session's name, flaky-test-fix, in bold, then Session 38 % in green, resetting in 2:31, Week 82 % in red, resetting in 3 days 4 hours, and the prompt cache warm for about 4 more minutes, centred on the row below the hint line](docs/screenshot.svg)

Each bar is green below 50 %, yellow from 50 % and red from 80 %, in your theme's colours. The screenshot is the mod running in a 120-column terminal with sample readings, in a session named `flaky-test-fix`.

After each percentage, `↻` and a dim countdown give the time left until that window resets:

| Window | Countdown | Reads |
| --- | --- | --- |
| Session | `↻2:31` | 2 hours 31 minutes |
| Week | `↻3d 4h` | 3 days 4 hours; in its last day hours and minutes, as `↻17:05` |

It counts down at the start of every minute, without waiting for a response, and rounds up, so it never reads `0:00` before the reset. Each countdown keeps the same width, so the row doesn't shift as it ticks over.

## The prompt cache

After the two windows, a third item says whether the session's prompt cache is still warm. Claude Code sends the conversation with every request, and the API keeps it in a prompt cache for a few minutes, so the next response reads it from there, cheaper and faster. Each response starts that time over; once it runs out with no response, the cache is cold and the next response pays for the whole conversation again.

| Shows | Means |
| --- | --- |
| `Cache █████▋ warm ↓4m` | the cache was used within its lifetime; about 4 minutes are left until it is cold |
| `Cache` with an empty bar, `cold` | its lifetime has run out; the next response re-sends the whole conversation |
| nothing | the session has had no response yet, or its conversation was just compacted, cleared or resumed |

The bar empties as the cache cools, and takes the limits' colours turned round: green while more than half of the lifetime is left, yellow from the half-way point, red in the last fifth. `↓` marks the time until it is cold, as `↻` marks the time until a window resets. It counts down at the start of every minute and rounds up like the other countdowns, but goes cold at the moment its lifetime ends, not up to a minute later.

**How long it lasts.** Claude Code doesn't tell a mod how long the account's cache lasts: 5 minutes, or an hour on accounts that have the longer one. The `cacheTtl` option says which, `5m` (the default) or `1h`. Installing the mod asks for it, and afterwards it is a row in `/config`.

**It is an estimate.** The mod can't see the cache, only that a response ended, so:

- It counts from the end of the latest response. The cache was last used when that response began, so the countdown can read the length of that response too long.
- While a turn is running, the terminal row shows the cache as `warm` with no countdown, since every request of the turn uses it. The desktop app's text can't tell that a turn is running, so for a turn longer than the lifetime it may read `cold` until the turn ends.
- It doesn't see anything else that drops the cache, such as switching model with `/model`, or caching being turned off for the session.
- It holds for the main conversation; a subagent has a cache of its own, which isn't shown.

Unlike the limits, the cache belongs to one session's conversation, so nothing about it is shared between sessions.

## The session's name

Once you name a session, with `/rename <name>` or by starting it with `claude --name <name>`, the row starts with that name in bold, set off from the meters: `limits work   Session ███      38% ↻2:31   Week …`.

- It is the name you gave the session. Claude Code also titles a session by itself, but it doesn't tell a mod that title, so a session you haven't named shows no name.
- Claude Code tells a mod the name only when a session starts and with each prompt you send. So a name the session starts with, from `--name` or a session you resume, shows from the start or at the latest with your first prompt, and after `/rename` the new name shows with your next prompt.
- A name longer than 24 characters is cut short with `…`. On a narrower terminal it gets shorter still, down to 8 characters, before the meters lose any detail. When not even that fits beside the meters' bars, the row goes on without it.
- It counts a character to a cell, so a name in wide characters, such as Chinese, Japanese or emoji, puts the row a little off centre.
- Before the session has any figures, the name is the row on its own. `/limits` hides it with the rest of the row.
- The desktop app shows the session's name itself, so the figures in its footer leave it out.

## Install

Type this at the prompt of a Claude Code terminal session:

```
/plugin install limits-meter --marketplace marcelmatula/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). It asks how long your prompt cache lasts, `5m` or `1h`; see [The prompt cache](#the-prompt-cache). The mod is active in that session at once; the meters show as soon as it has a reading, at the latest after the next response.

Or in two steps:

```
/plugin marketplace add marcelmatula/claude-mods
/plugin install limits-meter@marcel-mods
```

## Showing and hiding

| Type | What happens |
| --- | --- |
| `/limits` | hides the meter row if it's showing, shows it if it's hidden |
| `/limits off` | hides it |
| `/limits on` | shows it |

Claude Code's own hint line stays as it is either way. The cache item is part of the row, so `/limits` hides and shows it with the windows. The choice is remembered across sessions, so a hidden meter stays hidden until you turn it back on.

## In the Claude desktop app

The desktop app's Code tab draws no hint line under its prompt, so the meter row can't show there. Instead the figures appear as text in the prompt's footer, beside the model's name:

```
limits-meter  Session 61% ↻0:42 · Week 75% ↻2d 21h · Cache warm ↓4m
```

They work as the row does: the same countdowns, moved on every minute, and `/limits` hides and shows them. They appear once the app has connected to the session, within a minute of opening it. A mod installed from a terminal at user scope, as under Install, loads in the desktop app's local sessions too.

## What to expect

- The figures are the ones Claude Code receives with each response, so the mod makes no requests of its own. They update whenever a window moves by a whole point.
- Your limits are shared by all your sessions, but each session gets figures only with its own responses. So every session saves the newest figures it gets, and the others pick them up within a minute: a session you left idle while working in another one catches up by itself.
- When a window's reset time passes while the session sits idle, its meter drops to 0 % within a minute, without waiting for the next response. Its countdown goes then, and comes back once a response brings the next window's reset time.
- The meters stay through `/clear` and `/resume`, and so does a hidden meter's choice.
- The limits are on a Claude subscription only. A new session shows the newest figures another session saved straight away; with none saved, the row appears after its first response. A session on an API key has no rate-limit windows, so its windows go after its first response, and the cache item stays: with no windows, the row is the cache alone.
- It adds one line at the bottom. While Claude Code shows a notice on the hint line (for example "Context left until auto-compact"), the notice moves to its own line under the meters.
- On a narrow terminal the labels shorten to `5h` and `7d` and the bars get shorter. The cache item goes below about 70 columns, the windows then keeping their full labels down to about 60; the countdowns go below about 47 columns, and the row is hidden below about 20. These widths are for a session with no name; a name takes room of its own, as [The session's name](#the-sessions-name) says.

## What it can access

A mod runs inside Claude Code's plugin sandbox and can reach the outside only through `$` calls. On Claude Code 2.1.294 the sandbox gives a mod no way to make web requests, load modules, reach the process or run code from a string, and the validator refuses disguised `$` access, so its list of hooks and calls covers everything a mod can do. For limits-meter that list is:

| Hooks | When they run |
| --- | --- |
| `session.start` | once when a session starts |
| `session.measure` | when Claude Code's usage figures change, which includes the end of each response |
| `session.end` | when a session ends, to notice `/clear` and `/resume` |
| `ui.render` on `PromptHint` | when the line under the prompt is drawn |
| `classic.SessionStart` | when a session starts, including after `/clear` and `/resume`, to read the session's name |
| `classic.UserPromptSubmit` | when you send a prompt, to read the session's name again after a `/rename` |
| `command.run` on `limits` | when you run `/limits` |

| `$` calls | What for |
| --- | --- |
| `$.session.usage` | reads the rate-limit figures |
| `$.state.get`, `$.state.set` | keeps those figures for the session, with the time the countdowns count from, when the session's own figures arrived, when the prompt cache was last used, and the session's name, in the mod's own state |
| `$.clock.now`, `$.clock.after` | at the start of every minute moves the countdowns on and checks whether a window's reset time has passed or the figures changed; at the moment the cache's lifetime ends marks it cold; fills the meters in again just after `/clear` or `/resume` |
| `$.ui.resolve` | gets the elements it draws with |
| `$.session.surfaces` | tells a session in the desktop app, which draws on no terminal, from a terminal session |
| `$.ui.status` | shows the figures as text in the desktop app's prompt footer |
| `$.command.register`, `$.command.list` | adds the `/limits` command, and adds it again if the session no longer lists it |
| `$.store.get`, `$.store.set` | keeps the shown or hidden choice between sessions, and passes the newest figures between your open sessions |

It saves two things in the mod's own small store, which Claude Code keeps in your Claude Code configuration folder: the shown or hidden choice, and the newest usage figures (each window's percentage and reset time, and when they arrived). The cache item is not saved there. It needs no access of its own: it uses the `session.measure` hook the windows already use, learns only that a response ended (the context window moved and has a reading), and never looks at token counts, prompts or responses. The session's name is not saved there either, nor shared with other sessions. Beyond that it reads and writes no files, runs no shell commands and makes no network requests.

The two `classic.` hooks run on Claude Code's settings hook events `SessionStart` and `UserPromptSubmit`, the only places Claude Code hands a mod the session's name. The `UserPromptSubmit` hook receives each prompt you send, as any hook on that event does, but reads only the session's name from it: it never looks at the prompt's text, and passes every prompt on as it came, never blocking, changing or keeping one. The mod has no hooks on Claude's tool calls, and its one command hook answers `/limits`.

Check this yourself from a clone of the repo, in the `hooks:` and `calls:` lines:

```
claude plugin validate limits-meter
```

[`capabilities.json`](capabilities.json) holds the same list. CI fails if the mod's hooks or `$` calls ever go beyond it, so any new kind of access has to show up as a change to that file.

## How it works

`hooks/register.tsx` is a plugin of function hooks:

- `session.start` reads the current windows with `$.session.usage()`.
- `session.measure` keeps them up to date as responses arrive, and saves them with the time they arrived in `$.store` for the other sessions. It also marks the prompt cache as used when it reports the context window moving with a reading, which a response does; a compaction moves it with none, which clears the mark. A timer set for the end of the cache's lifetime marks it cold at that moment, and sets itself again if a response moved the end later.
- A timer started in `session.start` runs at the start of every minute. It records the time, which the countdowns count from, reads the figures again and sets a window whose reset time has passed to 0 %, since Claude Code sends the new figure only with the next response. It takes the figures another session saved when they are newer than the session's own.
- `classic.SessionStart` and `classic.UserPromptSubmit` hooks take the session's name from the `session_title` that Claude Code gives those settings hook events, and keep it in the session's state, which redraws the row. Neither changes the event.
- `/clear` and `/resume` empty the mod's session state and start no new `session.start`. A `session.end` hook sees them and, a moment later, reads the saved choice and the figures back in, and writes the name the latest `SessionStart` brought, which may have come before the state was emptied.
- A `ui.render` hook on the `PromptHint` site draws Claude Code's own hint line unchanged and adds the meter row below it, led by the session's name when it has one, unless the meter is hidden. It works each countdown out from a window's reset time, or the cache's last use plus its lifetime, and the recorded time; while a turn is running (the hint's `isWorking`) it shows the cache as warm with no countdown.
- In a session that draws on no terminal (the desktop app), the minute check, each new reading, the end of the cache's lifetime and `/limits` also set the mod's status entry with `$.ui.status`: the same figures as one line of text. A terminal session sets none.
- `/limits` is registered in `session.start` and answered by a `command.run` hook. The minute check registers it again when the session no longer lists it, as happened in a desktop app session the mod was updated under; should a load of the mod come without a `session.start`, its first reading registers the command and starts the minute check. It flips the hidden setting in the session's state, which redraws the row at once, and saves it with `$.store`. The next `session.start` reads it back.

Built and tested on Claude Code 2.1.294. The function-hooks plugin API is early access and may change between releases.

## Development

From this folder:

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## License

MIT. See [LICENSE](LICENSE).
