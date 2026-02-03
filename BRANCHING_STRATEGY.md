# Branching Strategy

## Overview

This project uses a simple branching strategy that allows multiple developers to work on the project simultaneously without conflicts.

## Workflow

1. **Create a branch from `main`**
   - Branch name should be a short description of the changes (e.g., `add-user-authentication`, `fix-order-display-bug`)

2. **Do your feature work**
   - Commit often with short but descriptive commit messages
   - Push your branch to GitHub

3. **Create a Pull Request**
   - Open a PR from your branch to `main`
   - No approvals are required - you can merge freely

4. **Merge your PR**
   - Once merged, a GitHub Action automatically deploys the latest code to Vercel

## Important Notes

- **Always push code to GitHub and merge PRs** - This is how the latest code gets deployed to Vercel via GitHub Actions
- **Commit frequently** - Use short but descriptive commit messages
- **Keep PRs focused** - Ideally, PRs should be less than 250 lines of code change (this is a guideline, not a hard rule)

## Why This Strategy?

This simple branching strategy allows multiple developers to work on different features simultaneously without stepping on each other's work. Each developer works in their own branch, and changes are integrated through PRs.
