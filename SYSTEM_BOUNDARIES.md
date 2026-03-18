# SYSTEM_BOUNDARIES (Do Not Break)

This repository is an Azure-deployed Flask shell that already connects to:
- Azure OpenAI (chat completions) via `/api/chat`
- Azure SQL connectivity check via `/dbcheck`

The goal is to evolve this into a functional MVP WITHOUT breaking the existing Azure wiring, deployment stability, or environment contracts.

## Non-negotiables (do not change)
### Deployment & entrypoint
- Do not rename or replace the application entrypoint: `app.py`
- Do not modify `startup.sh` (it installs Microsoft ODBC Driver 18 and is required for `pyodbc` on Azure App Service)
- Keep the current deployment workflow intact (Azure App Service expectations)

### Environment variables (names must remain identical)
Do not rename these env vars (they are part of the deployment contract):
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_API_VERSION` (optional; defaults exist)
- `AZURE_OPENAI_DEPLOYMENT`
- `SQL_CONNECTION_STRING`

Do not log or print secret values.

### Route/API contracts (preserve these paths)
These routes must keep working:
- `GET /health` → returns `{ "status": "ok" }`
- `POST /api/chat` → accepts `{ "message": "..." }`, returns `{ "answer": "..." }`
- `GET /dbcheck` → attempts SQL connection and returns a JSON status
- `GET /admin` → basic status page for environment readiness
- `GET /static/<path:filename>` → serves JS/CSS

You may ADD new routes (e.g., `/api/sessions`, `/api/history`) but do not break or remove the existing ones.

## Allowed changes (safe to evolve)
### Internal structure
- You may add modules/packages (e.g., `src/`, `services/`, `db/`) and have `app.py` call them.
- Adding new routes is expected
- Adding new modules is encouraged
- Extending /api/chat behavior (internally) is allowed as long as the response contract stays the same
- You may refactor logic out of `app.py` into service/helper layers, as long as the external route behavior stays compatible.

### UI
- You may modify `templates/*.html` and `static/*` as needed (keeping the route paths intact).
- Prefer keeping client behavior in `static/chat.js` rather than inline scripts.

### Database schema
- You may introduce new SQL tables needed for the MVP (e.g., conversation memory).
- Do not change the meaning of `SQL_CONNECTION_STRING`.
- Schema creation/migrations should be additive and safe.

## Guardrails for AI coding agents
- Do not perform sweeping refactors (“rewrite the app”, “switch frameworks”, “move entrypoints”).
- Do not rename environment variables or routes.
- Do not remove existing dependencies required for Azure runtime.
- Propose changes before deleting or moving files.
- Keep changes small, testable, and incremental.