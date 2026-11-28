# D-60 The release PR is opened with a GitHub App token, not `GITHUB_TOKEN`

- **Status**: Accepted (2026-11-28)
- **Code**: `.github/workflows/bump.yml`; the repository's GitHub App (Actions variable `RELEASE_APP_ID`, secret
  `RELEASE_APP_PRIVATE_KEY`)

## Context

The release PR must get the checks that the "Require CI" ruleset requires (D-52). `bump.yml` opened it with
`GITHUB_TOKEN` and then started `ci.yml` on the branch with `workflow_dispatch`. On the v0.1.7 release PR (#42) that
dispatched run passed, but GitHub also created a `pull_request` CI run by `github-actions[bot]` and left it at
"awaiting approval" (`action_required`). That suite blocked the merge until someone approved it or bypassed the
ruleset.

## Decision

- `bump.yml` gets an installation token of the repository's own GitHub App with `actions/create-github-app-token`
  (pinned by SHA), asking for Contents and Pull requests write only. The App has just those permissions, no webhook,
  and is installed on this repository only.
- The checkout (whose credentials the push uses), the push of `release/vX.Y.Z` and `gh pr create` use that token. The
  commit is made as the App's bot user, so the commit and the PR show the same author.
- The workflow's own `GITHUB_TOKEN` is cut to `contents: read`, and the `workflow_dispatch` step is removed: a PR
  opened by an App runs `ci.yml` on `pull_request` like any other PR.

## Alternatives not taken

- Keeping the dispatch and approving or bypassing each time: every release needs a manual step, and bypassing
  becomes a habit that hides a real failure.
- A personal access token: tied to one person's account, with an expiry to manage and wider access than needed.
- A release tool (release-please, changesets): changes the whole release flow (D-42) for what is a token problem.

## Consequences

- "Allow GitHub Actions to create and approve pull requests" (D-42) is no longer needed.
- If the App is uninstalled or its key is revoked, `bump.yml` fails at the token step; a new key goes into
  `RELEASE_APP_PRIVATE_KEY`.
- `app-id` is deprecated in `create-github-app-token` v3.4.0 in favour of `client-id`. It still works; switching
  means storing the App's Client ID and passing `client-id`.
