# claude-mods

[![Check mods](https://github.com/marcelmatula/claude-mods/actions/workflows/check.yml/badge.svg?branch=main)](https://github.com/marcelmatula/claude-mods/actions/workflows/check.yml) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/marcelmatula/claude-mods/badge)](https://scorecard.dev/viewer/?uri=github.com/marcelmatula/claude-mods) [![OpenSSF Best Practices](https://www.bestpractices.dev/projects/15312/badge)](https://www.bestpractices.dev/projects/15312)

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

## Feedback and contributing

- Bugs and feature ideas: [open an issue](https://github.com/marcelmatula/claude-mods/issues).
- Changes: pull requests are welcome; [CONTRIBUTING.md](CONTRIBUTING.md) covers the process and what a change needs.
- Security problems: report them privately, as [SECURITY.md](SECURITY.md) describes.

## Layout

Each mod is a folder with its own `.claude-plugin/plugin.json`, README, tests and `capabilities.json`, which lists the hooks and `$` calls the mod uses. `.claude-plugin/marketplace.json` lists each mod with `"source": "./<folder>"`, so adding a mod means adding a folder and one entry there.

On every push and pull request, CI ([`.github/workflows/check.yml`](.github/workflows/check.yml)) runs `claude plugin validate --strict` at the root, then `claude plugin validate --strict` and `claude plugin test` in each mod folder, on Claude Code 2.1.294 (pinned by hash in [`.github/claude-code/package-lock.json`](.github/claude-code/package-lock.json)). It also runs [`.github/scripts/check-capabilities.mjs`](.github/scripts/check-capabilities.mjs) on each mod, which fails if the mod uses a hook or `$` call that its `capabilities.json` doesn't declare. Each mod therefore needs at least one `*.test.ts` or `*.test.tsx`, and a `capabilities.json`. To run the same check locally: `node .github/scripts/check-capabilities.mjs <mod>`.

Releases are tagged `<mod>-v<version>`, for example `limits-meter-v0.1.0`.

To try local edits through the marketplace, add your clone instead: `/plugin marketplace add <path to clone>`. Claude Code then reads the mods from that folder, so `/reload-plugins` picks up an edit.

## Security

- Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).
- Changes reach `main` only through pull requests, once "Check mods" has passed and the branch is up to date with `main`. `main` can't be force-pushed or deleted.
- Release tags (`*-v*`) can't be moved or deleted once pushed.
- Dependabot keeps the commit-pinned GitHub Actions up to date.
- CodeQL scans the mods, the scripts and the workflows on every push to `main`, on pull requests and weekly ([`.github/workflows/codeql.yml`](.github/workflows/codeql.yml)).
- [OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/marcelmatula/claude-mods) scores the repo's security practices on every push to `main` and weekly ([`.github/workflows/scorecard.yml`](.github/workflows/scorecard.yml)).

## License

MIT. See [LICENSE](LICENSE).
