# AGENT_BRIEF (Read First)

## What this repo is
A minimal Flask web app deployed on Azure App Service. It serves a simple web UI and provides a chat API that calls Azure OpenAI. It also includes a DB connectivity test endpoint for Azure SQL.

## Current working behavior (shell)
- Web pages:
  - `GET /` renders `templates/index.html`
  - `GET /chat` renders `templates/chat.html`
  - `GET /admin` renders a basic environment readiness page (`templates/admin.html`)
- API endpoints:
  - `POST /api/chat`: takes `{ "message": "..." }` and returns `{ "answer": "..." }` using Azure OpenAI Chat Completions.
  - `GET /health`: returns `{ "status": "ok" }`
  - `GET /dbcheck`: checks Azure SQL connectivity using `pyodbc` and `SQL_CONNECTION_STRING`
- Static assets:
  - `GET /static/<path>` serves files in `/static` (e.g., `static/chat.js`)

## Non-negotiables
Before making changes, read: `SYSTEM_BOUNDARIES.md`.
Key point: do not break Azure wiring, env var names, entrypoint `app.py`, or existing routes.

## MVP direction (what we’re building toward)
A functional conversational MVP that:
- keeps the existing `/api/chat` endpoint working
- can be extended with:
  - basic session handling (client passes `session_id`)
  - optional conversation memory stored in Azure SQL (later step)
  - improved UI UX for chat (streaming optional later)

## How to work on this repo
- The agent is allowed to evolve internal structure and introduce new abstractions.
- it just shouldn’t rewrite the app or change deployment assumptions.
- Prefer adding new modules and calling them from `app.py` rather than rewriting the app.
- If adding conversation memory, implement it behind a clean interface (e.g., `memory_store.py`), then wire it into `/api/chat`.

## Local test checklist
- `GET /health` returns ok
- `GET /chat` loads and the UI can call `/api/chat`
- `POST /api/chat` returns an `answer`
- `GET /dbcheck` works when `SQL_CONNECTION_STRING` is set

## When responding
- List files you plan to change.
- Provide exact diffs or complete file contents.
- Provide a quick “how to test locally” section.