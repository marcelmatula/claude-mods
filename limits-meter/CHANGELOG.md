# Changelog

## 0.4.0

- The Claude desktop app shows the figures. Its Code tab draws no hint line, so the meter row never appeared there; now a session in the app shows them as text in the prompt's footer, beside the model's name: `Session 61% ↻0:42 · Week 75% ↻2d 21h`. They count down every minute and `/limits` hides and shows them. Terminal sessions keep the meter row and show no such text.
- Fix: a session you left idle while working in another one kept showing the figures from its own last response, say 61% when you were already at 91%. Your limits are shared by all your sessions, but each session gets figures only with its own responses. Now every session saves the newest figures it gets, and the others pick them up at their next minute check.
- A new session shows the newest saved figures straight away, instead of waiting for its first response. A session on an API key, which has no rate-limit windows, drops them after its first response.
- New access, declared in `capabilities.json` and the README's "What it can access" section: `$.session.surfaces`, to tell a desktop app session from a terminal one, and `$.ui.status`, to show the figures in the app's footer. The mod's store, which held only the shown or hidden choice, now also holds the newest figures and when they arrived, and the session state holds one more value, when the session's own figures arrived.

Upgrade: nothing to do.

## 0.3.0

- Each meter shows the time left until its window resets, dim, after its percentage: `↻2:31` (hours and minutes) for the session and `↻3d 4h` (days and hours) for the week, which reads hours and minutes in its last day. It counts down at the start of every minute without waiting for a response, and rounds up, so it never reads `0:00` before the reset. Each countdown keeps the same width, so the centred row doesn't shift as it ticks over.
- On a narrow terminal the countdowns go after the labels shorten and before the bars do.
- The minute check now runs at the start of each minute instead of a minute after the session started.
- Access: nothing new. The minute check uses `$.clock.after` alone, so `$.clock.every` is gone from `capabilities.json` and the README. The mod's session state holds one more value, the time the countdowns count from.

Upgrade: nothing to do.

## 0.2.1

- Fix: a window whose reset time passes while the session sits idle no longer stays at its old figure (say 100%) until the next response. The mod checks once a minute and drops it to 0%, and a reading that arrives already past its reset time shows 0% too.
- Fix: after `/clear` or `/resume` the meters come back at once. Before, Claude Code emptied the mod's state there without starting it again, so the row stayed away until a window moved a whole point, and `/limits` toggled a meter that had nothing to draw. A meter you hid stays hidden through them.
- `/limits` says when the meter has no usage figures to show yet, instead of answering "Limits meter shown." with nothing drawn.
- New access, declared in `capabilities.json` and the README's "What it can access" section: a `session.end` hook, to see a `/clear` or `/resume`, and `$.clock.now`, `$.clock.every` and `$.clock.after`, to read the time, run the minute check and fill the state in again shortly after.

Upgrade: nothing to do.

## 0.2.0

- `/limits` hides or shows the meter row: `/limits` on its own switches it, and `/limits off` and `/limits on` set it. Claude Code's own hint line stays as it is either way.
- The choice is remembered across sessions, so a hidden meter stays hidden until you turn it back on.
- New access, declared in `capabilities.json` and the README's "What it can access" section: a `command.run` hook for `/limits`, plus `$.command.register`, `$.store.get` and `$.store.set` to add the command and keep the setting.

Upgrade: nothing to do. The meter shows by default, as before.

## 0.1.0

- First release: the session (5 h) and weekly usage limits as small progress bars with a percentage, on a centred row under the prompt's hint line.
