# Changelog

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
