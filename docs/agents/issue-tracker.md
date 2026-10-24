# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues in `CaramelizedCUDA/yan-local-chat` (the `origin` remote). Use the `gh` CLI for all operations.

## Remotes

- `origin` — `CaramelizedCUDA/yan-local-chat` (default for `gh` in this clone).
- `upstream` — `Master-Norna/yan`.

`gh` infers the repo from `origin` when run inside this clone. For an issue that belongs to the upstream project, pass `--repo Master-Norna/yan` explicitly; do not let a local-fork issue silently land upstream.

## Conventions

Creating or changing remote tracker state—including issues, pull requests, comments, labels, assignments, claims, and closures—is an external write. Run a write command only when the current task already authorizes that specific action; this reference documents syntax and grants no permission by itself.

- **Create an issue**: use the PowerShell example on Windows, or the Bash example only from a Bash shell. Both examples create a remote issue and require the authorization above. Add `--repo Master-Norna/yan` only when the issue is deliberately for the upstream project.

### PowerShell (preferred on Windows)

Write the multi-line body as UTF-8 without a byte-order mark, then pass its path with `gh issue create --body-file <path>`:

```powershell
$title = 'Investigate the export failure'
$body = @'
## Observed
Export fails after selecting a valid file.

## Expected
The selected file is exported without an error.
'@

# Write a temporary UTF-8 body file without a BOM so gh reads the full text cleanly.
$bodyPath = Join-Path $env:TEMP (([guid]::NewGuid().ToString('N')) + '.md')
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
try {
    [System.IO.File]::WriteAllText($bodyPath, $body, $utf8NoBom)

    # This creates an issue remotely; run it only with existing task authorization.
    gh issue create --title $title --body-file $bodyPath
    if ($LASTEXITCODE -ne 0) {
        throw "gh issue create failed with exit code $LASTEXITCODE."
    }
}
finally {
    Remove-Item -LiteralPath $bodyPath -Force -ErrorAction SilentlyContinue
}
```

### Bash (only when the current shell is Bash)

Use a quoted here-document inside command substitution. Do not paste this Bash syntax into PowerShell:

```bash
gh issue create --title "Investigate the export failure" --body "$(cat <<'BODY'
## Observed
Export fails after selecting a valid file.

## Expected
The selected file is exported without an error.
BODY
)"
```

- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/CaramelizedCUDA/yan-local-chat/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking** below). Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh api --paginate 'repos/CaramelizedCUDA/yan-local-chat/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `origin` (`CaramelizedCUDA/yan-local-chat`) unless the task explicitly names the upstream repository.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets. The examples below use the origin repo; substitute `Master-Norna/yan` in the API path only for upstream work.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/CaramelizedCUDA/yan-local-chat/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/CaramelizedCUDA/yan-local-chat/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
