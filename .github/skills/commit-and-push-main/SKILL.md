---
name: commit-and-push-main
description: Stage the intended repository changes, commit them with the property setup and payroll task override message, and push the main branch to origin when explicitly requested.
---

# Commit and push to main

Use this skill only when the user explicitly asks to commit and push these changes to `main`. Creating or updating this skill does not itself authorize a commit or push.

Before running Git commands:

1. Check `git status --short --branch` and confirm the current branch is `main`.
2. Review the staged and unstaged changes. Do not include unrelated files. If the branch is not `main`, or the changes include unrelated work, stop and ask the user instead of switching branches or pushing.
3. Confirm the intended changes are ready to commit and that the remote is `origin`.

Then stage the intended changes, commit, and push:

```bash
git add .
git commit -m "feat: refactor property setup UI and implement task overrides in payroll"
git push origin main
```

For Copilot-authored commits, include the repository-required trailer in the commit message:

```text
Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>
```

If a command fails, stop and report the error. Do not force-push, amend an existing commit, or retry against another branch or remote without the user's authorization.
