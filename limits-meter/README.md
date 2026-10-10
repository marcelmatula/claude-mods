# limits-meter

A Claude Code mod that shows your usage limits for the current session (5 h) and the week as small progress bars with a percentage and the time left until each resets. They sit on a centred row at the bottom of the screen, under the prompt's hint line; in the Claude desktop app they show as text in the prompt's footer. `/limits` hides or shows them, and the choice is remembered.

Part of [claude-mods](../README.md), Marcel's Claude Code marketplace (`marcel-mods`).

![limits-meter under the Claude Code prompt: Session 38 % in green, resetting in 2:31, and Week 82 % in red, resetting in 3 days 4 hours, centred on the row below the hint line](docs/screenshot.svg)

Each bar is green below 50 %, yellow from 50 % and red from 80 %, in your theme's colours. The screenshot is the mod running in a 120-column terminal with sample readings.

After each percentage, `↻` and a dim countdown give the time left until that window resets:

| Window | Countdown | Reads |
| --- | --- | --- |
| Session | `↻2:31` | 2 hours 31 minutes |
| Week | `↻3d 4h` | 3 days 4 hours; in its last day hours and minutes, as `↻17:05` |

It counts down at the start of every minute, without waiting for a response, and rounds up, so it never reads `0:00` before the reset. Each countdown keeps the same width, so the row doesn't shift as it ticks over.

## Install

Type this at the prompt of a Claude Code terminal session:

```
/plugin install limits-meter --marketplace marcelmatula/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). The mod is active in that session at once; the meters show as soon as it has a reading, at the latest after the next response.

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

Claude Code's own hint line stays as it is either way. The choice is remembered across sessions, so a hidden meter stays hidden until you turn it back on.

## In the Claude desktop app

The desktop app's Code tab draws no hint line under its prompt, so the meter row can't show there. Instead the figures appear as text in the prompt's footer, beside the model's name:

```
limits-meter  Session 61% ↻0:42 · Week 75% ↻2d 21h
```

They work as the row does: the same countdowns, moved on every minute, and `/limits` hides and shows them. They appear once the app has connected to the session, within a minute of opening it. A mod installed from a terminal at user scope, as under Install, loads in the desktop app's local sessions too.

## What to expect

- The figures are the ones Claude Code receives with each response, so the mod makes no requests of its own. They update whenever a window moves by a whole point.
- Your limits are shared by all your sessions, but each session gets figures only with its own responses. So every session saves the newest figures it gets, and the others pick them up within a minute: a session you left idle while working in another one catches up by itself.
- When a window's reset time passes while the session sits idle, its meter drops to 0 % within a minute, without waiting for the next response. Its countdown goes then, and comes back once a response brings the next window's reset time.
- The meters stay through `/clear` and `/resume`, and so does a hidden meter's choice.
- On a Claude subscription only. A new session shows the newest figures another session saved straight away; with none saved, the row appears after its first response. A session on an API key has no rate-limit windows, so its row goes after its first response.
- It adds one line at the bottom. While Claude Code shows a notice on the hint line (for example "Context left until auto-compact"), the notice moves to its own line under the meters.
- On a narrow terminal the labels shorten to `5h` and `7d` and the bars get shorter. Below about 47 columns the countdowns go, and below about 20 columns the row is hidden.

## What it can access

A mod runs inside Claude Code's plugin sandbox and can reach the outside only through `$` calls. On Claude Code 2.1.294 the sandbox has no `fetch`, `require`, `process` or `eval`, and the validator refuses disguised `$` access, so its list of hooks and calls covers everything a mod can do. For limits-meter that list is:

| Hooks | When they run |
| --- | --- |
| `session.start` | once when a session starts |
| `session.measure` | when Claude Code's usage figures change |
| `session.end` | when a session ends, to notice `/clear` and `/resume` |
| `ui.render` on `PromptHint` | when the line under the prompt is drawn |
| `command.run` on `limits` | when you run `/limits` |

| `$` calls | What for |
| --- | --- |
| `$.session.usage` | reads the rate-limit figures |
| `$.state.get`, `$.state.set` | keeps those figures for the session, with the time the countdowns count from and when the session's own figures arrived, in the mod's own state |
| `$.clock.now`, `$.clock.after` | at the start of every minute moves the countdowns on and checks whether a window's reset time has passed or the figures changed; fills the meters in again just after `/clear` or `/resume` |
| `$.ui.resolve` | gets the elements it draws with |
| `$.session.surfaces` | tells a session in the desktop app, which draws on no terminal, from a terminal session |
| `$.ui.status` | shows the figures as text in the desktop app's prompt footer |
| `$.command.register` | adds the `/limits` command |
| `$.store.get`, `$.store.set` | keeps the shown or hidden choice between sessions, and passes the newest figures between your open sessions |

It saves two things in the mod's own small store, which Claude Code keeps in your Claude Code configuration folder: the shown or hidden choice, and the newest usage figures (each window's percentage and reset time, and when they arrived). Beyond that it reads and writes no files, runs no shell commands and makes no network requests. It has no hooks on your prompts or on Claude's tool calls; its one command hook answers `/limits`.

Check this yourself from a clone of the repo, in the `hooks:` and `calls:` lines:

```
claude plugin validate limits-meter
```

[`capabilities.json`](capabilities.json) holds the same list. CI fails if the mod's hooks or `$` calls ever go beyond it, so any new kind of access has to show up as a change to that file.

## How it works

`hooks/register.tsx` is a plugin of function hooks:

- `session.start` reads the current windows with `$.session.usage()`.
- `session.measure` keeps them up to date as responses arrive, and saves them with the time they arrived in `$.store` for the other sessions.
- A timer started in `session.start` runs at the start of every minute. It records the time, which the countdowns count from, reads the figures again and sets a window whose reset time has passed to 0 %, since Claude Code sends the new figure only with the next response. It takes the figures another session saved when they are newer than the session's own.
- `/clear` and `/resume` empty the mod's session state and start no new `session.start`. A `session.end` hook sees them and, a moment later, reads the saved choice and the figures back in.
- A `ui.render` hook on the `PromptHint` site draws Claude Code's own hint line unchanged and adds the meter row below it, unless the meter is hidden. It works each countdown out from a window's reset time and the recorded time.
- In a session that draws on no terminal (the desktop app), the minute check, each new reading and `/limits` also set the mod's status entry with `$.ui.status`: the same figures as one line of text. A terminal session sets none.
- `/limits` is registered in `session.start` and answered by a `command.run` hook. It flips the hidden setting in the session's state, which redraws the row at once, and saves it with `$.store`. The next `session.start` reads it back.

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
