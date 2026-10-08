# claude-mods

[![Check mods](https://github.com/marcelmatula/claude-mods/actions/workflows/check.yml/badge.svg?branch=main)](https://github.com/marcelmatula/claude-mods/actions/workflows/check.yml)

Marcel's mods for Claude Code, in one plugin marketplace: `marcel-mods`.

| Mod | What it does |
| --- | --- |
| [limits-meter](limits-meter) | Shows your session (5 h) and weekly usage limits as small progress bars under the prompt. |

## Install a mod

Type this at the prompt of a Claude Code terminal session:

```
/plugin install limits-meter --marketplace marcelmatula/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads the mod in every session). Once the marketplace is added, other mods from it install with `/plugin install <mod>@marcel-mods`.

Or add the marketplace first:

```
/plugin marketplace add marcelmatula/claude-mods
/plugin install limits-meter@marcel-mods
```

`/plugin marketplace update marcel-mods` fetches new mods and versions.

## Layout

Each mod is a folder with its own `.claude-plugin/plugin.json`, README, tests and `capabilities.json`, which lists the hooks and `$` calls the mod uses. `.claude-plugin/marketplace.json` lists each mod with `"source": "./<folder>"`, so adding a mod means adding a folder and one entry there.

On every push and pull request, CI ([`.github/workflows/check.yml`](.github/workflows/check.yml)) runs `claude plugin validate` at the root, then `claude plugin validate` and `claude plugin test` in each mod folder, on Claude Code 2.1.294. It also runs [`.github/scripts/check-capabilities.mjs`](.github/scripts/check-capabilities.mjs) on each mod, which fails if the mod uses a hook or `$` call that its `capabilities.json` doesn't declare. Each mod therefore needs at least one `*.test.ts` or `*.test.tsx`, and a `capabilities.json`. To run the same check locally: `node .github/scripts/check-capabilities.mjs <mod>`.

Releases are tagged `<mod>-v<version>`, for example `limits-meter-v0.1.0`.

To try local edits through the marketplace, add your clone instead: `/plugin marketplace add <path to clone>`. Claude Code then reads the mods from that folder, so `/reload-plugins` picks up an edit.

## Security

- Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).
- `main` can't be force-pushed or deleted, and a commit lands on it only after "Check mods" has passed on that commit. So push a branch or open a pull request first, and move `main` once the check is green.
- Release tags (`*-v*`) can't be moved or deleted once pushed.
- Dependabot keeps the commit-pinned GitHub Actions up to date.

## License

MIT. See [LICENSE](LICENSE).
