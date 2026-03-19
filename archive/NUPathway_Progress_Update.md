# NUPathway — Progress Update

**Spring 2026 · Working Prototype Stage**

---

## Product Identity

**NUPathway** is the platform — the complete Credit for Prior Learning (CPL) evaluation system encompassing intake, case preparation, review workflows, and administrative tooling. NUPathway is the product name and should be treated as a brand, not a functional descriptor.

**Echo** is NUPathway's conversational interface — an advisor-style AI assistant that guides students through the CPL process via natural dialogue. Echo is one modality within NUPathway; it is not the product itself. Echo functions like a knowledgeable advisor: it asks the right questions, gathers complete information, and compiles structured case records for human reviewers. It does not make decisions.

These names are deliberate. NUPathway conveys direction and progress — a path through a process that currently has none. Echo conveys responsiveness and clarity — a system that listens, understands, and reflects back structured insight. Both names should be used consistently across all materials.

---

## The Problem

### For Students

- Unclear which prior learning qualifies for which courses
- Policies and submission steps scattered across multiple sources
- 5–15 day turnaround with repeated back-and-forth for missing evidence
- No way to track case status after submission

### For Advisors & Reviewers

- Manual intake via email — gathering details is time-consuming
- ~40% of cases arrive missing key evidence, requiring follow-up
- Same certifications re-evaluated against same courses repeatedly
- No searchable institutional memory of prior decisions

**Current state:** Days of email exchange, 30–45 min admin time per case, multi-week turnaround.

---

## Our Approach

NUPathway is an intelligent intake and case preparation layer — not a decision-maker.

### Echo — Conversational Interface

Advisor-style AI assistant that guides students through CPL intake via natural dialogue — not a chatbot, not a form.

### NUPathway — Platform Capabilities

Course matching, evidence handling, case lifecycle, knowledge base — all coordinated to produce complete, structured case records.

### Human Authority — Preserved at Every Step

AI prepares and organizes. Advisors and SMEs make every approval or denial decision. Full audit trail.

---

## System Architecture

NUPathway is organized into four coordinated layers with an administrative portal alongside:

**Student-Facing Layer:** Echo conversational UI, evidence upload, status tracking.

**Orchestration Layer:** Conversation flow, evidence handling, case lifecycle management.

**Intelligence Layer:** LLM integration with RAG for course matching, policy grounding, and guardrails.

**Knowledge Layer:** Versioned course catalog, CPL policies, certification mappings, rubrics.

**Admin Portal:** Case queue, review UI, decision capture with required rationale, routing.

Infrastructure principles: closed-loop architecture, on-premise sensitive data, full audit trail, FERPA-aligned.

<!-- AZURE-DEPLOYMENT-NOTE-START -->

### Deployment Note: Azure Infrastructure

For the current implementation and pilot deployment, NUPathway is hosted entirely within a Microsoft Azure instance. This includes compute, storage, networking, and LLM provisioning via Azure OpenAI Service. All platform components — Echo's conversational backend, the knowledge base retrieval pipeline, case storage, and the administrative portal — live within this Azure environment.

This decision aligns with the university's existing cloud infrastructure and simplifies compliance, access control, and operational management for the pilot. Azure OpenAI Service provides the LLM capability that powers Echo's conversational intelligence and the RAG-based course matching pipeline.

The platform architecture is designed to be LLM-provider-agnostic at the integration layer, so the specific model provider can be swapped in future iterations without architectural changes to the orchestration, knowledge, or application layers.

<!-- AZURE-DEPLOYMENT-NOTE-END -->

---

## Echo — Conversational Design

Echo follows a guided 6-step conversational pathway:

1. **Greeting & Intent** — Orient the student, offer clear starting points
2. **Prior Learning Capture** — Type, description, dates, institution
3. **Course Matching** — Platform searches knowledge base, Echo presents options
4. **Evidence Collection** — Guide what to upload based on claim type
5. **Identity Verification** — Required before submission
6. **Review & Submit** — Summary, confirmation, case number, next steps

### Design Principles

- **Guided over open-ended** — Clear options first, elaboration when needed
- **Progressive gathering** — Details only when relevant, no front-loading
- **Always transparent** — Communicate what happens next, show progress
- **Graceful fallback** — If unclear after attempts, offer human handoff
- **Policy-grounded only** — Every response traces to verified knowledge base content

---

## Case Records & Admin Portal

### Structured Case Record

Each case record captures: student identity and contact (authenticated), prior learning type, description, and dates, target course(s) with learning outcomes, uploaded evidence with metadata, platform-extracted fact summary, evidence-to-outcome mapping, identified gaps and missing information, confidence assessment with routing recommendation, full conversation transcript, and knowledge base version reference.

### Admin Portal

- **Case Queue** — Filterable by status, department, confidence, date, assignee
- **Case Record View** — All information in a scannable layout with evidence preview
- **Decision Capture** — Approve, deny, request info, or route — with required rationale
- **Status Tracking** — Draft → Submitted → Under Review → Info Requested → Resolved
- **Audit Trail** — Immutable log of every action with timestamp and actor

---

## What's Built So Far

**Working prototype with backend integration — tested and functional.**

### Completed

- Product Plan v1.0 (PRD) — vision, scope, personas, architecture, evaluation framework
- Technical Companion — schemas, component diagrams, sample conversations, 20-week timeline
- Echo conversational interface — working prototype with LLM backend
- Conversational state machine — guided intake flow with fallback handling
- Course matching via RAG — retrieval-augmented generation against knowledge base
- Case record generation — structured output from conversational intake

### In Progress

- Admin portal UI — case queue and review experience
- Evidence upload and validation pipeline
- Knowledge base content curation for pilot university

---

## Target Success Metrics

| Metric | Before | Target | Improvement |
|--------|--------|--------|-------------|
| Intake Time | Days of email | < 15 min | ~95% reduction |
| Submission Completeness | ~60% complete | > 90% complete | +30pp improvement |
| Admin Time / Case | 30–45 min | < 15 min | ~60% reduction |
| Decision Turnaround | 5–15 days | 3–7 days | ~50% faster |

---

## Safety & Guardrails

**No Hallucinated Policy** — Echo only surfaces verified knowledge base content. If uncertain, it asks clarifying questions or routes to a human — never fabricates eligibility or requirements.

**Human Decision Authority** — The system never approves or denies CPL applications. All final decisions rest with advisors and faculty subject matter experts.

**Full Audit Trail** — Every action logged with timestamp, actor, action type, and relevant payload. Immutable and aligned with university retention policy.

**Privacy & FERPA Alignment** — Minimal PII exposure, anonymized logs, encryption at rest and in transit. Designed for FERPA compliance with university counsel review.

### Pre-Launch Testing Plan

Policy edge cases, hallucination probes, adversarial inputs, ambiguous evidence, course mismatches.

---

## What's Next

**Near Term** — Finish admin portal UI, evidence upload pipeline, knowledge base content curation for pilot courses.

**Pre-Pilot** — End-to-end integration testing, red-team testing (hallucination, adversarial), user acceptance testing with advisors.

**Pilot Launch** — Single university deployment, 200–400 cases/semester, weekly feedback sessions with reviewers.

**Post-Pilot** — Measure against success metrics, iterate based on feedback, evaluate expansion beyond pilot.

### Open Questions

Vector store selection, university SSO integration, document verification approach, infrastructure hosting specifics.

---

*Intelligent CPL intake. Human decisions. Complete case records.*
