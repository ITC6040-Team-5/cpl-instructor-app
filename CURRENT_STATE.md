# NUPathway System State (CURRENT_STATE.md)

This document is the primary, single source of truth for the NUPathway system architecture, capabilities, and technical constraints.

---

## 1. Current Architecture

Flask SPA with modular blueprints, service layer, Azure SQL persistence, and Azure OpenAI conversational AI.

- **Entrypoint (`app.py`)**: Creates Flask app, initializes DB schema, registers blueprints, seeds demo data.
- **Route Blueprints (`routes/`)**:
  - `pages.py`: Serves the SPA (`index.html`) for all client routes: `/`, `/chat`, `/admin`, `/admin/review`, `/admin/settings`, `/cases`.
  - `system.py`: Diagnostic endpoints: `/system/config`, `/health`, `/versions`, `/dbcheck`.
  - `api.py`: Thin HTTP layer — delegates to services. Endpoints: `/api/chat`, `/api/cases`, `/api/case/<id>`, `/api/case/<id>/submit`, `/api/case/<id>/review`, `DELETE /api/case/<id>`, `/api/admin/cases`, `/api/admin/settings`, `/api/evidence/upload`.
- **Database Layer (`db.py`)**: Auto-initializes schema via `pyodbc` + `SQL_CONNECTION_STRING`. Tables: `Sessions`, `Cases`, `Messages`, `Evidence`, `CaseSequence`, `Settings`.
- **Services Layer (`services/`)**:
  - `case_service.py`: Case lifecycle engine — sequential IDs, completion scoring, state transitions, CRUD.
  - `extraction_service.py`: Progressive data extraction from conversation content.
  - `settings_service.py`: System settings CRUD with configurable thresholds.
  - `auth_service.py`: Real identity resolution from headers/localStorage, email generation.
  - `rag_service.py`: Stubbed RAG pipeline (extension point for vector search).
- **Frontend**: Vanilla JS SPA (`app.js`, `notifications.js`) with History API router, dynamic API-backed rendering, toast/modal feedback system.

---

## 2. Core Capabilities — Working

| Capability | Status |
|-----------|--------|
| Homepage with prompt cards and composer | ✅ |
| Deep-linking to `/chat`, `/admin`, `/cases`, `/admin/settings` | ✅ |
| Chat → Azure OpenAI (real LLM responses) | ✅ |
| Message persistence per session in SQL | ✅ |
| Sequential case IDs (`CPL-2026-NNNN`) | ✅ |
| Completion scoring model (weighted formula) | ✅ |
| Progressive data extraction after each chat response | ✅ |
| Draft auto-save at 30% completion | ✅ |
| Submit gating at 80% completion | ✅ |
| Submit for Review button (wired with confirmation modal) | ✅ |
| Case delete (below 50% completion) | ✅ |
| Navigate-away warning for unsaved sessions | ✅ |
| Real applicant identity (name, student ID, email) | ✅ |
| Case History with detail view, timeline, conversation drawer | ✅ |
| Resume draft conversations | ✅ |
| Admin Dashboard (dynamic from `/api/admin/cases`) | ✅ |
| Admin Review with transcript, evidence, reviewer notes | ✅ |
| Admin Approve/Deny/Request Revision (all wired) | ✅ |
| Settings tab (university name, thresholds, toggles) | ✅ |
| Evidence upload via paperclip button | ✅ |
| Toast notifications for all actions | ✅ |
| Modal confirmations for destructive actions | ✅ |
| Role switcher with label (applicant ↔ reviewer) | ✅ |
| Branding: NUPathway | ✅ |
| Dynamic breadcrumb | ✅ |
| System diagnostics (`/health`, `/dbcheck`) | ✅ |

---

## 3. Remaining Future Work

| Item | Priority |
|------|----------|
| Real authentication (SSO/Entra ID) | High |
| Azure Blob Storage for evidence files | High |
| LLM-based extraction (replace regex with OpenAI call) | Medium |
| Reviewer assignment model | Medium |
| Audit trail / activity log | Medium |
| Email notifications on status change | Low |
| Dashboard filters (by status, date, course) | Low |
| RAG integration with course catalog | Low |

---

## 4. Case ID Mechanism

| Aspect | Implementation |
|--------|---------------|
| Generation | `CaseSequence` IDENTITY table → `CPL-{year}-{seq:04d}` |
| Applicant-facing | Ordered numbering ("Case 1", "Case 2") |
| Admin-facing | Full `CPL-2026-0001` |
| Collision risk | None (DB-backed sequence) |

---

## 5. Case Lifecycle States

`New → Draft → In Progress → Ready for Review → Submitted → Under Review → Revision Requested → Approved / Denied`

Thresholds (configurable via Settings):
- **Draft save**: 30% completion
- **Submit**: 80% completion
- **Delete allowed**: Below 50% completion

---

## 6. Known Constraints

- **Azure Entrypoint**: `app.py` must remain the entry point.
- **Environment Variables**: `SQL_CONNECTION_STRING`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`, `SEED_DEMO_DATA`.

---

## 7. Change Log

| Timestamp | Change |
|-----------|--------|
| **2026-03-19T23:17:58-0400** | **Full 5-workstream implementation.** Rebuilt `db.py` (CaseSequence, Settings, new Case columns). Created `case_service.py` (lifecycle engine, sequential IDs, completion scoring), `extraction_service.py` (progressive data extraction), `settings_service.py` (CRUD + thresholds), `auth_service.py` (real identity). Rewrote `api.py` (thin HTTP layer, submit/delete/settings endpoints). Created `notifications.js` (toasts/modals). Rewrote `app.js` (identity persistence, completion tracking, settings tab, conversation drawer, submit gating, resume draft). Updated `index.html` (NUPathway branding, settings controls, dynamic case detail). Added CSS for toasts/modals/drawer/inputs. |
| **2026-03-19T22:20:44-0400** | **Plan revision.** Integrated product review feedback: 5-workstream plan with completion scoring, real identity, notifications, settings, conversation drawer. |
| **2026-03-19T21:27:02-0400** | **Live product evaluation.** Full end-to-end audit. Identified critical gaps. |
| **2026-03-19T17:05:01-0400** | **Product-grounded MVP overhaul.** Stripped prototype HTML, rewrote api.py and app.js, fixed routing. |
| **2026-03-19T14:30:00-0400** | Blueprint modularization, History API router, chat persistence, evidence upload. |
