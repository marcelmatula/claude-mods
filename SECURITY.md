# Security

## Reporting a vulnerability

Please report security problems privately through GitHub, not in a public issue: [report a vulnerability](https://github.com/marcelmatula/claude-mods/security/advisories/new) (Security tab, then "Report a vulnerability").

Say which mod and which version or commit it affects, what you found, and how to reproduce it. This is a personal project, so replies are best effort.

## Supported versions

Fixes go to the latest version of each mod on `main` and into that mod's next release. Older releases are not patched.

## What the mods can access

Each mod's README has a "What it can access" section listing its hooks and `$` calls, and its `capabilities.json` holds the same list. CI fails if a mod uses a hook or `$` call beyond that list. To check a mod yourself, run `claude plugin validate <mod>` and read its `hooks:` and `calls:` lines.
