# Contributing

Thanks for helping with claude-mods. This page covers how to report a problem, how to propose a change, and what a change needs before it can be merged.

## Reporting bugs and asking for features

Open an issue: [github.com/marcelmatula/claude-mods/issues](https://github.com/marcelmatula/claude-mods/issues). Say which mod, which Claude Code version (`claude --version`), what you expected and what happened. Feature ideas are welcome there too.

Report security problems privately instead, as [SECURITY.md](SECURITY.md) describes.

This is a personal project, so replies are best effort.

## Proposing a change

Changes reach `main` only through pull requests:

1. Fork the repo, or create a branch if you have access, and make the change there.
2. Run the checks below locally.
3. Open a pull request against `main` that says what changes and why.
4. CI ("Check mods") must pass, and the branch must be up to date with `main`. CodeQL scans the pull request too.
5. The maintainer reviews it and merges it with a rebase.

## What a change needs

- **Tests.** New functionality and changed behaviour come with tests in the mod's `tests/` folder (`*.test.ts` or `*.test.tsx`, run by `claude plugin test`). A bug fix adds a test that fails without the fix, where that is practical. CI fails a mod that has no tests.
- **Declared access.** If a change needs a hook or `$` call the mod didn't use before, add it to the mod's `capabilities.json` and to the "What it can access" section of its README in the same pull request, and say why. CI fails when a mod uses a hook or call that `capabilities.json` doesn't declare.
- **A clean validation.** `claude plugin validate --strict` must pass at the repo root and in the mod's folder. It treats warnings as errors.
- **Matching style.** Write TypeScript that reads like the code around it. Mods are Claude Code function-hooks plugins; the API is early access, and CI checks the mods on the Claude Code version pinned in [`.github/claude-code/package.json`](.github/claude-code/package.json).
- **A version bump for user-visible changes.** Raise the mod's `version` in its `.claude-plugin/plugin.json` following semantic versioning. Releases are tagged `<mod>-v<version>` and come with release notes.

A new mod is a folder with its own `.claude-plugin/plugin.json`, README, tests and `capabilities.json`, plus one entry in `.claude-plugin/marketplace.json` and a row in the root README's table.

## Running the checks locally

From the repo root, with Claude Code installed:

```
claude plugin validate . --strict
cd <mod> && claude plugin validate . --strict && claude plugin test . && cd ..
node .github/scripts/check-capabilities.mjs <mod>
```

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE), like the rest of the project.
