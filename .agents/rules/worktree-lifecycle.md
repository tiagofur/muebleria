# Git Worktree Lifecycle per Issue

- Always create a dedicated git worktree for each new issue or task worked on, rooted at:
  `../muebles-worktrees/<issue-number>-<slug>`
- Never implement issue changes directly on the primary checkout or mix work from multiple issues in one branch/worktree.
- Once the PR for the issue is merged into `main`, clean up by deleting/removing the corresponding worktree (`git worktree remove ...` / `git branch -d ...`).
