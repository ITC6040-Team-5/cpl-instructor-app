# CLAUDE.md — Behavioral Rules for This Project

## Non-Negotiable Rules

### Never push to GitHub without explicit permission
Do not run `git push` in any form — including `--force` — unless the user says "push this" in that specific message. Plan approval is NOT push approval.

### Never overwrite the plan file without archiving first
Before rewriting `fizzy-churning-octopus.md`, move the existing content to `plans/archive/` with this exact filename format: `topic-YYYY-MM-DD.md` (e.g. `v3-implementation-2026-04-03.md`).

Then add a row to the Archive Index table in `fizzy-churning-octopus.md` with:
- Date & time (ET) of archiving
- Link to the archive file
- Why it was scrapped (one sentence)
- What's still useful in it

The archive file header must include: archived date/time, who archived it, reason, source, and status of items.

This creates a full audit trail — future sessions can see exactly what was tried, when, why it was dropped, and what to salvage.

### One file at a time, verify before moving on
Never make changes across multiple files simultaneously. Change one file, verify the app still works, then move to the next. This applies especially to `styles.css`, `app.js`, and `index.html`.

### No code snippets in the plan file
The plan file describes what to do and why. It does not contain implementation code. Code snippets belong in the code files, not the plan.

### Read before you write
Never edit a file you haven't read in the current session. Always read the relevant section first.

### Do not design and implement at the same time
Design decisions (what should a screen look like, where does navigation go) belong in the prototype (`/design/v3/`). Implementation (writing the actual HTML/CSS/JS) happens after the design is approved.

---

## Project Context

**Product:** NUPathway — CPL (Credit for Prior Learning) evaluation platform
**Also called:** "the Studio" (product pivot name)
**Stack:** Flask + Vanilla JS SPA + Azure SQL + Azure OpenAI (Echo)
**Deploy:** GitHub Actions on push to `main` → Azure Web App
**Clean baseline:** commit `989d7e3` ("Final fixes?") on `develop` / `87fc9b7` on `main`

**Key files:**
- `static/styles.css` — CSS (2,765 lines, being split)
- `static/app.js` — All frontend JS (1,862 lines, being split)
- `templates/index.html` — Single HTML template (807 lines, being split)
- `static/notifications.js` — Toast/modal system (175 lines, do not modify)
- `design/DESIGN_SYSTEM.md` — V3 design tokens and principles (canonical reference)
- `design/v2/` — V2 React prototype (layout reference, do not modify)
- `design/v3/` — V3 prototype (to be built here, not in the live app)

**Plans:**
- Active plan: `/Users/paresh/.claude/plans/fizzy-churning-octopus.md`
- Archive: `/Users/paresh/.claude/plans/archive/`

---

## Workflow Order (Do Not Skip Steps)

1. **Make files maintainable** — split CSS, JS, HTML into small focused files. No functionality changes.
2. **Build V3 prototype** — in `/design/v3/`. Clickable. Approved screen by screen.
3. **Port prototype to live app** — one screen at a time. Verify after each.

---

## How to Work With This Codebase

- Read only the files relevant to the current task. Do not read all three large files at once.
- When a function is mentioned, grep for it rather than reading the whole file.
- When a CSS class is mentioned, grep for it rather than reading the whole stylesheet.
- File sizes that exceed ~400 lines should be split before being worked on extensively.
- The archive exists so the plan stays short. Move completed/superseded content there.
