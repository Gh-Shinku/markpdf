# AGENTS.md

## Development

- Keep changes focused and avoid unrelated rewrites.
- Prefer existing project patterns before introducing new structure.
- Run relevant checks before handing off changes.
- Do not overwrite or discard user changes without explicit approval.

## Web

- Work in `web/` for frontend changes.
- Use `npm run check` before finalizing frontend work when practical.
- Do not add explanatory annotation text in the frontend to justify or describe
  interaction mechanics. Make behavior clear through controls, labels, and
  state instead.

## Server

- Work in `server/` for backend changes.
- Keep tests close to the behavior being changed.

## Commit Message Style

Use this format:

```text
[type] description
```

Allowed types:

```text
feat | fix | refactor | docs | test | chore
```

Example:

```text
[feat] add user profile page
```

Commit changes as separate commits when they cover multiple independent concerns
(one concern per commit):

```text
[feat] add toc page injection option
[feat] restore last opened toc file
```

If the concerns cannot be cleanly separated because they share the same files,
a coarse-grained single commit is acceptable.
