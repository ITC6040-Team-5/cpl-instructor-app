# NUPathway System State (CURRENT_STATE.md)

This document is the primary, single source of truth for the NUPathway system architecture, capabilities, and technical constraints.

---

## Future Implementation approaches:
Overall approach to act as precise, surgical extensions to the existing codebase rather than rewrites (unless deemed critial use-case or scenario).

---

## 1. Current Architecture

Flask SPA with modular blueprints, service layer, Azure SQL persistence, and Azure OpenAI conversational AI.

Azure deployment URL: https://cpl-team5-app-gjdpfpebfxcnf5cp.eastus-01.azurewebsites.net

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
| **2026-03-23T16:15:00-0400** | **Phase 4 surgical bug fixes.** Fixed identity bleed (Alex Watson) by clearing `localStorage` on fresh chat. Stopped artificial 35% completion jumps by gating message score behind identity presence. Added lightweight course lookup "RAG" via `rag_service.py` reading `/knowledge/catalog.json` avoiding vector overhead. Secured admin login by SHA-256 hashing on the frontend and reseeding the DB appropriately. Tuned Echo prompt to be concise and avoid overclaiming. Maintained strict architectural preservation across all layers. |
| **2026-03-20T23:50:00-0400** | **Phase 3 holistic upgrade implementation complete.** 8 workstreams across 6 files. W1: backend-enforced admin auth (`AdminUsers`/`AdminSessions` tables, `authenticate_admin`, `@require_admin` on 6 endpoints, login/logout API, login modal). W2: mode separation (role switch requires login, "New Case" hidden in reviewer mode, dead "Case Review" nav removed, `getAdminHeaders()` isolates admin from applicant identity). W3: per-case reviewer data isolation (`ReviewerChecks` table, GET/POST `/api/case/<id>/checks`, auto-save on toggle). W4: escalation scaffold (drawer with case ref, email, notes, prepare action). W5: UI uplift (badge `white-space: nowrap`, breadcrumb contrast, avatar `min-size`+`flex-shrink`, review column `align-self: stretch`, vertical checkboxes). W6: state cleanup (admin token in `sessionStorage`, `formatTimestamp` dedup, 401 auto-logout, global search guards). W7: Echo avatar sizing fix. W8: status transition validation map in `review_case()`, primary action toggle by mode. All structural verifications passed (20/20 checks). |
| **2026-03-20T23:21:58-0400** | **Phase 3 holistic upgrade plan created.** Full codebase review + live product visual audit completed. Plan covers 8 workstreams: W1 — backend-enforced admin auth (hashed passwords, session tokens, route protection, login modal); W2 — applicant/reviewer mode separation (clear state boundaries, hide "New Case" in reviewer mode, remove dead nav items); W3 — case-specific reviewer data isolation (`ReviewerChecks` table, per-case checkbox persistence); W4 — escalation workflow scaffold (drawer with email destination, no actual send); W5 — UI uplift (badge wrapping fix, breadcrumb contrast, sidebar collapse, Echo avatar sizing, review column heights, consistent button sizing); W6 — state/storage cleanup (prevent stale identity inheritance, informational query detection, resume-without-identity feedback); W7 — Echo branding & icon fixes; W8 — admin queue actions (per-row delete with confirmation, status transition validation). Also identified 7 independent issues (duplicate `formatTimestamp`, missing CSRF, identity headers leaking into admin requests). |
| **2026-03-20T01:23:21-0400** | **Phase 2 remaining P2 fixes.** Implemented Fix 8 (Echo prompt tuning — more inquisitive tone, "university ID" terminology), Fix 9 (global search bar wired for case/student ID lookup on Enter), Fix 10 (session recovery on page refresh — reloads messages and restores case sidebar). All 17/17 Phase 2 fixes now complete. |
| **2026-03-20T01:10:41-0400** | **Phase 2 implementation complete.** Implemented 14 of 17 fixes across 6 files. P0: rebalanced completion scoring (6 criteria, 85% without course, was 75%), retroactive `user_id` update after extraction, dual `user_id`/`student_id` query for case retrieval. P1: admin naming normalized to "Case Queue", queue table fully rewritten (dynamic tabs, client-side search/sort/filter, Date Updated column, loading/empty/no-results states), sidebar active-state fix (review→queue mapping), case detail actions moved above timeline, review screen action bar with clear button hierarchy, role switcher always visible, resume draft keyword detection. P2: name normalization in extraction service. Deferred: prompt tuning, search bar, session recovery. |
| **2026-03-20T01:08:25-0400** | **Additional UI refinements.** Added Fixes 15–17 to Phase 2 plan: queue table empty/loading/no-results states, reviewer action button prominence (sticky, clear hierarchy), and applicant case detail action buttons reorder (moved above timeline for visibility). |
| **2026-03-20T01:03:18-0400** | **Reviewer/admin UI plan refinements.** Added Fixes 11–14 to Phase 2 implementation plan: admin naming normalization → "Case Queue", queue table UI overhaul (dynamic tabs, timestamps, sentence-case headers, client-side sort), case review screen polish, sidebar active-state fix. Based on validated product feedback from manual testing. |
| **2026-03-20T00:40:57-0400** | **Live evaluation + Alex Watson investigation.** Full end-to-end live product testing on Azure. Root causes identified: (1) case-user linkage broken — `user_id` stays `"anonymous"` after identity extraction, making `GET /api/cases` return empty; (2) completion scoring caps at 75% when no course extracted and only 1 evidence file; (3) prompt cards create duplicate cases (no dedup); (4) name parsing inconsistent across sessions; (5) role switcher visually hidden. Updated `implementation_plan.md` with Phase 2 (10 fixes: P0=user_id retroactive update + scoring rebalance + identity-based retrieval; P1=dedup + role switcher + resume draft; P2=name normalization + echo tuning + search bar + session recovery). Created `live_evaluation_report.md`. |
| **2026-03-19T23:17:58-0400** | **Full 5-workstream implementation.** Rebuilt `db.py` (CaseSequence, Settings, new Case columns). Created `case_service.py` (lifecycle engine, sequential IDs, completion scoring), `extraction_service.py` (progressive data extraction), `settings_service.py` (CRUD + thresholds), `auth_service.py` (real identity). Rewrote `api.py` (thin HTTP layer, submit/delete/settings endpoints). Created `notifications.js` (toasts/modals). Rewrote `app.js` (identity persistence, completion tracking, settings tab, conversation drawer, submit gating, resume draft). Updated `index.html` (NUPathway branding, settings controls, dynamic case detail). Added CSS for toasts/modals/drawer/inputs. |
| **2026-03-19T22:20:44-0400** | **Plan revision.** Integrated product review feedback: 5-workstream plan with completion scoring, real identity, notifications, settings, conversation drawer. |
| **2026-03-19T21:27:02-0400** | **Live product evaluation.** Full end-to-end audit. Identified critical gaps. |
| **2026-03-19T17:05:01-0400** | **Product-grounded MVP overhaul.** Stripped prototype HTML, rewrote api.py and app.js, fixed routing. |
| **2026-03-19T14:30:00-0400** | Blueprint modularization, History API router, chat persistence, evidence upload. |

---

## 8. Phase 2: Live Evaluation Findings (2026-03-20)

> Added after live testing on Azure deployment. See [live_evaluation_report.md](file:///Users/paresh/.gemini/antigravity/brain/05be1110-7864-402d-8add-aa40610f27c6/live_evaluation_report.md) for full investigation.

### Critical Gaps Discovered

| Issue | Root Cause | Impact | Priority |
|-------|-----------|--------|----------|
| Case history empty for applicant | Cases created with `user_id = "anonymous"`, never updated after identity extraction | Applicant cannot see their own cases | P0 |
| Completion stalls at 75% | Scoring formula requires course extraction (20%) + 2 evidence files (20%) for full credit | Submit button permanently disabled | P0 |
| No case retrieval by identity | `GET /api/cases` queries only by `user_id`, not `student_id` | Returning users can't find prior cases | P0 |
| Duplicate cases per user | No dedup — each prompt card/new session creates a fresh case | Fragmented user data | P1 |
| Role switcher invisible | CSS opacity on sidebar footer | Admin flow inaccessible without debug tools | P1 |
| "Resume my draft" broken | Creates new session instead of finding existing draft | Misleading UX | P1 |
| Name parsing inconsistent | LLM extracts whatever text was said, no normalization | "Alex" vs "Alex Watson" on admin | P2 |

### Alex Watson Case (specific scenario investigation)

- Progress capped at exactly 75%: name (20%) + messages≥6 (20%) + 1 evidence (15%) + summary (20%) = 75%. Missing: course (0%) + needs 2nd evidence file for full 20%.
- Case visible on admin side but invisible to applicant due to `user_id` mismatch.
- Refresh did not break session (localStorage persists), but case history query failed due to `user_id` not being updated after extraction.

### Reviewer/Admin UI Refinements (2026-03-20T01:03)

Added to implementation plan as Fixes 11–14 based on validated product feedback:

| Fix | Description |
|-----|-------------|
| Fix 11 | Normalize admin naming → "Case Queue" across sidebar, heading, breadcrumb |
| Fix 12 | Queue table UI overhaul: dynamic tab counts, sentence-case headers, date/timestamp column, search refinement, client-side sort |
| Fix 13 | Case review screen polish: consistent typography, card layout, button hierarchy |
| Fix 14 | Sidebar active-state fix: correct highlight behavior across admin sub-views |
