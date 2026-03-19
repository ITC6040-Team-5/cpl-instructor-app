# Product Context & Frontend Integration Handoff

*This document serves to carry over the conceptual and practical context from the UI prototyping phase into the backend integration phase (Azure + Flask). Crucially, everything here is meant to be an **iterative guideline, not a hard restriction**. This represents our current best thinking on the product flow, but we intend to adapt and improve it as we build and learn.*

---

## 1. Product Philosophy & Core Concept

**The problem:** Traditional portfolio assessment (CPL - Credit for Prior Learning) is intimidating, bureaucratic, and resembles doing your taxes.
**The solution:** A **conversation-first** AI assistant that acts as a friendly coach. Instead of filling out forms, the user simply talks to the AI about their experiences. The AI's job is to extract competencies, suggest evidence mappings, and help the user build a structured "Case" ready for human review.

### Key Conceptual Pillars
*   **Conversation is the Interface:** Users don't click "Create Case." They just start talking. The conversation *is* the entry point.
*   **Contextual Actions:** Features like "Upload Evidence" belong to a specific context/case, not a global navigation menu.
*   **Role Separation (Applicant vs. Reviewer):** 
    *   *Applicants* experience a warm, chat-heavy interface with guided steps. 
    *   *Reviewers* (SMEs/Admins) experience a data-dense, triaging interface where the conversation is just an audit log, and the structured data (competencies + evidence) takes center stage.

---

## 2. The Current State of the UI Prototype

The frontend codebase (`index.html`, `styles.css`, `app.js`) currently represents a highly polished, responsive, vanilla JS prototype. It simulates a modern, glassmorphic UI inspired by modern developer docs.

**Key UI Capabilities Currently Built (Mocked Data):**
*   **Dynamic Landing Page:** Clean entry point with prompt suggestions.
*   **Role Switcher:** Allows toggling between Applicant View and Reviewer Portal to visualize different needs.
*   **Chat Interface:** Fixed header/footer scrolling, high-density message bubbles, and smooth animations.
*   **In-Chat Authentication:** Simulates asking the user for their email in-chat to "unlock" their profile and case history dynamically.
*   **Record Sidebar:** A right-hand panel that parses the conversation structure. It has tabs for the **Case Record** (competencies mapped) and **Evidence** (file attachments).
*   **Case History:** A multi-case list view with drill-down timelines showing where a specific case is in the pipeline (Draft, Intake, Review, Approved).

---

## 3. Azure / Flask Integration Strategy

We are layering this new UI onto an **existing, stable Azure-deployed Flask application**. The Flask app already handles complex wiring to Azure OpenAI via an `/api/chat` endpoint. 

*The goal is to preserve the stable Azure backend while radically upgrading the UI, proceeding incrementally to avoid breaking the existing system.*

### Phase 1: Visual Integration (Asset Porting)
*   **Action:** Move the prototype's `styles.css`, `app.js`, and HTML into the Flask structure (`static/` and `templates/`).
*   **Goal:** Ensure the new UI renders perfectly within the Flask templating engine, respecting Azure's hosting rules and asset pipelines. No backend data changes yet.

### Phase 2: API Wiring & Decoupling
*   **Action:** Strip the mock `setTimeout` JS responses in the frontend. Wire the chat composer to send and receive standard `fetch()` calls to the **existing** `/api/chat` Flask route.
*   **Goal:** Prove the new, polished UI can successfully communicate with the real Azure OpenAI model using the established backend logic. 
*   *Note on Flexibility:* If the UI needs a different JSON structure than the current API provides, we will iteratively adjust the frontend to handle what Flask returns, or lightly adapt the Flask route without breaking its Azure OpenAI core.

### Phase 3: Building Backend Capability (Persistence First)
*   **Action:** Introduce session management and conversation persistence.
*   **Goal:** Because the product is conversation-first, the chat transcript is the source of truth. The immediate backend priority—once the UI is wired—must be saving the chat history to Azure SQL against a unique session ID, so the transcript persists across page reloads.

---

## 4. How to Use This Document

When starting a new development session or introducing a new agent to the Flask repository, provide this document as the establishing context. 

**Prompt:** *"Please read `flask_integration_handoff.md` to understand the product philosophy, the current UI state, and our iterative integration approach. Use this as our flexible guideline for moving forward."*
