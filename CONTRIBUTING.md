# Contributing

## To this starter

Found a bug in the scripts, or a step in the README that didn't work for you? Open an issue or a small PR here. One change per PR, with what and why.

## To TrueForge (the PR prize)

TrueForge itself is open source (MIT): https://github.com/truefoundry/trueforge. A PR merged there is its own prize at Stranger Builds, open to every participant. Follow the maintainers' rules in their [CONTRIBUTING.md](https://github.com/truefoundry/trueforge/blob/main/CONTRIBUTING.md):

1. **Issue first.** Pick an issue labelled [`help wanted`](https://github.com/truefoundry/trueforge/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22), or open one and wait for a maintainer to approve it. PRs without an approved issue are not reviewed.
2. **Small and focused.** One change, clearly described.
3. **Green before you open it:** `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint:ci`, `pnpm format:check` (Node 22.14+, pnpm via `corepack enable`).
4. **Source only.** Don't hand-edit the generated SDK, OpenAPI files or catalog output; change the route handlers in `packages/trueforge/src/routes/`.
5. **During review:** merge `main` into your branch; don't rebase or force-push.

Things you hit while building on this starter (a missing SDK helper, a doc gap, an error message that didn't help) make good issues. Put them in your feedback note too.
