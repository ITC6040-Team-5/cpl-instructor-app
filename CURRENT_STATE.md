# NUPathway System State (CURRENT_STATE.md)

This document is the primary, single source of truth for the NUPathway system architecture, capabilities, and technical constraints. It acts as an evolving system memory.

---

## 1. Current Architecture
The application is a Vanilla JS / HTML frontend powered by a Flask backend, explicitly designed to run on Azure App Service connecting to Azure SQL and Azure OpenAI.

- **Entrypoint (`app.py`)**: Responsible ONLY for creating the Flask `app`, initializing the database via `db.py`, and registering the modular blueprint routes. It preserves the raw Azure start-up assumptions.
- **Route Blueprints (`routes/`)**: 
  - `pages.py`: Serves the primary SPA (`index.html`), the legacy shell (`chat.html`), and all static JS/CSS assets.
  - `system.py`: Contains technical diagnostic/operational endpoints like `/health`, `/versions`, `/admin` (config view), and `/dbcheck`.
  - `api.py`: Houses heavy business logic for chat orchestration, dynamic cases queue, case decision logic, and evidence uploads.
- **Database Layer (`db.py`)**: Uses `pyodbc` to bind to Azure SQL via the `SQL_CONNECTION_STRING` environment variable. It safely initializes the Schema (Tables: `Sessions`, `Cases`, `Messages`, `Evidence`) automatically if the database exists.

---

## 2. Core Capabilities Implemented
- **Conversational Flow**: Chat history is tracked sequentially per `session_id` to build contextual prompts for Azure OpenAI.
- **Case Creation**: Uses LLM Tool/Function-calling (`submit_cpl_case`). When a student indicates they are ready, the AI invokes the function behind the scenes to formally deposit a structured `Case` into the SQL database.
- **Reviewer System**: The Admin portal dynamically calls `/api/admin/cases` and `/api/case/<id>` to display the cases queue and populate detailed review panes. Reviews ("Approve" / "Deny") trigger a live SQL `UPDATE`.
- **Uploads**: `/api/evidence/upload` sanitizes filenames and validates file type/size (< 10MB) before securely writing them to the server disk and logging the path to the database.

---

## 3. Key Technical Decisions
- **DB Fallback Strategy**: To ensure the application does not crash in local development environments where SQL Drivers (`pyodbc`) or credentials are missing, the system gracefully falls back to using in-memory mock objects (like the `mock_sessions` dict) and static placeholder data arrays.
- **File Storage Approach**: Currently, evidence uploads are streamed directly to the local `/uploads/` directory hosted inside the App Service container, rather than calling an external File API.
- **Route Structure Decisions**: We aggressively decoupled monolithic routing in `app.py` into distinct blueprints to preserve long-term maintainability without compromising the startup script bindings.

---

## 4. Known Constraints
- **Azure Entrypoint Must Not Break**: The deployment pipeline and Gunicorn invoke the `app` instance from `app.py`. The fundamental top-level shape of the `Flask` initialization must be maintained.
- **Environment Variable Dependencies**: The system absolutely requires the following mapped variables inside Azure Configuration to run securely:
  - `SQL_CONNECTION_STRING`
  - `AZURE_OPENAI_ENDPOINT`
  - `AZURE_OPENAI_API_KEY`
  - `AZURE_OPENAI_DEPLOYMENT`
  - `AZURE_OPENAI_API_VERSION`

---

## 5. Architectural Extension Points (Auth & RAG)
To ensure the MVP gracefully scales without premature over-engineering, we have introduced explicit abstractions:
- **Authentication (`services/auth_service.py`)**: A dedicated service layer now intercepts requests to inject a `user_id`. Currently, it uses a mock `X-Mock-User-Id` header (or a default fallback) but is perfectly positioned to decode JWTs from Entra ID/SAML later.
- **Knowledge Base (`services/rag_service.py`)**: An isolated service layer that intercepts the LLM prompt. The `knowledge/` directory has been scaffolded to house `catalogs/`, `policies/`, and `examples/`. The service currently returns a generic prompt grounding rule, but provides the exact insertion point for future FAISS/Chroma vector retrieval logic.
- **Relational Integrity (`db.py`)**: `user_id` has been injected deeply into the `Cases`, `Sessions`, and `Evidence` tables. When a student uploads evidence during an active chat, the file is bound to their `session_id`. When the AI formally generates the `Case` record, the system automatically loops back and permanently binds all session evidence to the new `case_id`, preventing orphaned files.

---

## 6. Known Limitations / Future Work
- **Blob Storage Migration**: Because evidence is saved directly to local container storage (`/uploads/`), if Azure App Service is fundamentally scaled out horizontally to multiple instances, files will split arbitrarily. Migrating file storage to a dedicated Azure Blob Storage container is necessary for multi-instance load balancing.
- **True Auth Enforcement**: The `auth_service.py` needs to be wired to a real Identity Provider. The UI will need to swap the role-switcher for a true login redirect.
- **Data Ingestion Pipeline**: Scripts must be written to actively chunk and vectorize University PDFs into the `knowledge/` directory to make the RAG abstraction functional.

---

## 7. Change Log
- **2026-03-19:** 
  - Restructured architecture from monolithic `app.py` into Blueprint modules (`routes/*`).
  - Integrated full end-to-end API logic connecting Chat persistence, AI Cases extraction tool-calling, Admin Reviewer dashboard syncing, and enforced Evidence upload limits to a `db.py` Azure SQL schema.
  - Archived outdated prototype documentation into `/archive/`.
  - Introduced structural scaffolding for Future Auth (`auth_service.py`) and RAG (`rag_service.py`, `knowledge/`), and strictly bound `user_id` and `session_id` to orphaned upload elements to solidify the relational schema.
