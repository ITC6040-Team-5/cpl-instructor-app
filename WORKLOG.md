# WORKLOG

This file records incremental changes made to the project so future coding agents do not need to rescan the entire repository.

Agents should read only:
- AGENT_BRIEF.md
- SYSTEM_BOUNDARIES.md
- The latest section of this WORKLOG.md

Then proceed with the requested change.

---

## Session 0 – Initial Shell (Baseline)

### Current state
The project is a minimal Flask application deployed to Azure App Service.

Core components:
- `app.py` → main Flask application
- `startup.sh` → installs required ODBC driver for Azure SQL
- `requirements.txt` → runtime Python dependencies
- `/templates`
  - `index.html`
  - `chat.html`
  - `admin.html`
- `/static`
  - `chat.js`

### Working endpoints

| Route | Purpose |
|-----|-----|
| `/` | Home page |
| `/chat` | Chat UI |
| `/admin` | Environment status |
| `/health` | Health check |
| `/api/chat` | Chat API using Azure OpenAI |
| `/dbcheck` | Azure SQL connectivity check |

### Azure integrations

Azure OpenAI:
- Endpoint: `AZURE_OPENAI_ENDPOINT`
- Deployment: `AZURE_OPENAI_DEPLOYMENT`

Azure SQL:
- Connection string: `SQL_CONNECTION_STRING`
- Driver: ODBC Driver 18

### MVP goal

Evolve this shell into a conversational MVP that:

1. Keeps `/api/chat` working
2. Supports optional session tracking
3. Adds conversation memory (later step)
4. Improves chat UX

### Next planned step

Add **session handling** to the chat flow:
- client sends `session_id`
- backend optionally logs conversations
- no schema yet (to be created later)

## Session X – What changed