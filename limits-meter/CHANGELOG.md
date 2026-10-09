# Changelog

## 0.2.0

- `/limits` hides or shows the meter row: `/limits` on its own switches it, and `/limits off` and `/limits on` set it. Claude Code's own hint line stays as it is either way.
- The choice is remembered across sessions, so a hidden meter stays hidden until you turn it back on.
- New access, declared in `capabilities.json` and the README's "What it can access" section: a `command.run` hook for `/limits`, plus `$.command.register`, `$.store.get` and `$.store.set` to add the command and keep the setting.

Upgrade: nothing to do. The meter shows by default, as before.

## 0.1.0

- First release: the session (5 h) and weekly usage limits as small progress bars with a percentage, on a centred row under the prompt's hint line.
