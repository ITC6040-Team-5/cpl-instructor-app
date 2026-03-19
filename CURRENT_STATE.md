# NUPathway System State (CURRENT_STATE.md)

This document is the primary, single source of truth for the NUPathway system architecture, capabilities, and technical constraints.

---

## 1. Current Architecture

Flask SPA with modular blueprints, Azure SQL persistence, and Azure OpenAI conversational AI.

- **Entrypoint (`app.py`)**: Creates Flask app, initializes DB schema, registers blueprints, seeds demo data.
- **Route Blueprints (`routes/`)**:
  - `pages.py`: Serves the SPA (`index.html`) for all client routes: `/`, `/chat`, `/admin`, `/admin/review`, `/cases`.
  - `system.py`: Diagnostic endpoints: `/system/config`, `/health`, `/versions`, `/dbcheck`.
  - `api.py`: All business logic — chat orchestration, case lifecycle, admin queue, evidence upload.
- **Database Layer (`db.py`)**: Auto-initializes schema via `pyodbc` + `SQL_CONNECTION_STRING`. Tables: `Sessions`, `Cases`, `Messages`, `Evidence`.
- **Services Layer**:
  - `auth_service.py`: Stubbed user identity (extension point for Entra ID/SSO).
  - `rag_service.py`: Stubbed RAG pipeline (extension point for vector search).
- **Frontend**: Vanilla JS SPA (`app.js`) with History API router, dynamic API-backed rendering.

---

## 2. Core Capabilities Implemented

### Applicant Journey
- **Conversational Intake (Echo)**: AI-guided 6-step pathway: Greeting → Prior Learning Capture → Course Matching → Evidence Collection → Review → Submission. System prompt enforces advisor-style behavior.
- **Auto-Draft Case**: On first message, a Draft case is automatically created with a human-readable ID (`CPL-XXXX`). Case exists from the moment conversation begins.
- **Case Lifecycle**: `Draft → Submitted → Under Review → Info Requested → Approved → Denied`. Status transitions driven by LLM tool calls and admin actions.
- **Evidence Upload**: Files validated (type/size), saved to disk, linked to session/case. Upload UI in intake sidebar updates live.
- **Case History**: Applicant can view all their cases via `/api/cases`, dynamically rendered with real status, confidence scores, and creation dates.
- **Deep-Linking**: Direct navigation to `/chat`, `/cases`, `/admin` works correctly.

### Reviewer Journey
- **Admin Dashboard**: Dynamic case queue fetched from `/api/admin/cases`. Filterable table with case ID, applicant, course, status, confidence.
- **Case Review Detail**: Three-pane layout populated from API — Case Record (summary, course, confidence, status), Transcript (full conversation history), Evidence (attached files). All dynamically loaded when clicking a case.
- **Decision Capture**: Approve/Deny actions update case status in DB via `/api/case/<id>/review`.

### System
- **Seed Data**: 3 realistic demo cases with full conversation histories auto-inserted on first boot.
- **Mock Mode**: When Azure keys are unavailable, chat returns mock responses and cases use in-memory storage.

---

## 3. Key Technical Decisions

- **"Conversation is the Interface"**: Following the Product Plan, cases are created as Drafts on first message. No separate "Create Case" step.
- **History API Router**: SPA navigation via `window.history.pushState` with deep-link support on page load.
- **Route Separation**: `/system/config` for diagnostics, `/admin` for the Reviewer Portal. No collision.
- **Progressive Case Building**: The LLM tool call `submit_cpl_case` transitions Draft → Submitted with structured data (target course, confidence score, summary).
- **In-Memory Fallback**: All DB operations gracefully fall back to in-memory dicts when `pyodbc` or `SQL_CONNECTION_STRING` is unavailable.

---

## 4. Known Constraints

- **Azure Entrypoint**: `app.py` must remain the entry point. `startup.sh` must not be modified.
- **Environment Variables** (names are deployment contracts):
  - `SQL_CONNECTION_STRING`
  - `AZURE_OPENAI_ENDPOINT`
  - `AZURE_OPENAI_API_KEY`
  - `AZURE_OPENAI_DEPLOYMENT`
  - `AZURE_OPENAI_API_VERSION`

---

## 5. Known Limitations / Future Work

| Item | Status | Notes |
|------|--------|-------|
| **Authentication** | Stubbed | `auth_service.py` returns mock user. Needs Entra ID/SSO integration. |
| **RAG / Knowledge Base** | Scaffolded | `rag_service.py` + `knowledge/` directory ready. Needs vector store + document ingestion. |
| **Blob Storage** | Not started | Files saved to local `/uploads/`. Must migrate to Azure Blob Storage for multi-instance scaling. |
| **Notifications** | Not started | Email on status change not implemented. |
| **Re-submission** | Not started | Case history linkage for resubmitted cases. |
| **Audit Trail** | Not started | Immutable action log table. |
| **Course Matching** | Mocked | Echo suggests courses conversationally but no real catalog search. |

---

## 6. Change Log

| Date | Change |
|------|--------|
| **2026-03-19 (PM)** | **Product-grounded MVP overhaul.** Stripped all prototype hardcoded HTML (~250 lines). Rewrote `api.py` with auto-Draft case creation, 6-step Echo system prompt, `/api/cases` applicant endpoint, seed data. Rewrote `app.js` with deep-linking, dynamic rendering for Case History, Admin Dashboard, and Admin Review panes. Fixed route collision (`/admin` → `/system/config`), DOM ID mismatch, broken deep-linking. |
| **2026-03-19 (AM)** | Blueprint modularization, History API router, chat persistence, evidence upload, admin review API wiring. Extension points for auth and RAG. |
