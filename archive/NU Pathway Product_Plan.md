# NUPathway - Product Plan v1.0

## Executive Summary

NUPathway is a platform for managing Credit for Prior Learning (CPL) evaluation at universities. At its core, NUPathway provides a conversational interface—Echo—that guides students through the CPL process, delivering the kind of natural, professional dialogue a student might have with a knowledgeable advisor, while the underlying platform gathers information, validates evidence, and compiles structured case records for human reviewers.

NUPathway reduces administrative friction while keeping decision authority firmly with advisors and faculty. It is not a decision-maker; it is an intelligent intake and case preparation layer.

**Pilot scope:** Single university deployment, approximately 200-400 cases per semester, standalone system with optional ticketing integration.

---

## Product Vision

**For** university students seeking credit for prior learning, **who** currently navigate unclear eligibility requirements, scattered information, and slow feedback loops, **NUPathway** guides them through the CPL process with the clarity and responsiveness of a dedicated advisor. **Unlike** email-based intake or static web forms, **NUPathway** provides an intelligent, policy-grounded conversation that gathers complete information upfront, reduces back-and-forth, and gives students visibility into their case status.

**For** advisors and CPL reviewers, **who** spend significant time on administrative intake tasks and incomplete submissions, **NUPathway** delivers structured, complete case records ready for evaluation. **Unlike** manual email triage, **NUPathway** ensures every case arrives with the information needed to make a decision, with clear audit trails and routing to appropriate reviewers.

---

## 1. Problem Statement

### Current State Pain Points

**For students:**
- Unclear eligibility: Students don't know which prior learning qualifies for which courses
- Scattered information: CPL policies, course requirements, and submission processes live in multiple places
- Slow feedback loops: 5-15 working days for decisions, with back-and-forth if evidence is incomplete
- No visibility: Once submitted, students can't track case status

**For advisors and reviewers:**
- Manual intake: Gathering student details, evidence, and matching to courses happens via email
- Incomplete submissions: Cases often arrive missing key evidence, requiring follow-up
- Repetitive evaluation: Same certifications get re-evaluated against same courses repeatedly
- No institutional memory: Prior decisions aren't easily searchable for precedent

### Success Criteria

The pilot will measure success across four dimensions: intake efficiency (target: students complete intake in under 15 minutes, down from days of email exchange), submission completeness (target: over 90% of cases arrive with sufficient evidence, up from approximately 60%), reviewer efficiency (target: administrative time per case under 15 minutes, down from 30-45 minutes), and turnaround time (target: 3-7 days for decisions, down from 5-15 days).

---

## 2. Scope and Boundaries

### Platform Role

NUPathway serves as an **intake, guidance, and case preparation** system. It is explicitly **not** a decision-maker.

### In Scope

NUPathway is designed to support conversational intake for CPL inquiries and applications, course and certification matching based on a curated curriculum knowledge base, evidence upload and organization with basic validation, case record generation with structured facts and identified gaps, student authentication (required before case submission), case status tracking for students, an administrative review experience with case queue and decision capture, re-submission handling with case history linkage, and optional integration with external ticketing systems via API.

### Out of Scope

NUPathway will not approve or deny CPL applications (human decision only), provide general academic advising (degree planning, course selection, admissions), integrate with SIS/Canvas/Ellucian in the initial phase, perform real-time external credential verification (this is a nice-to-have, not blocking), engage in conversations unrelated to CPL, or generate policy statements that don't exist in the knowledge base.

### Safety Boundaries

NUPathway operates within several safety constraints: no hallucinated policy (if Echo cannot find a match or is uncertain, it should ask clarifying questions or route to a human—never fabricate eligibility or requirements), minimal PII exposure (student identifiers shown only when necessary, anonymized in confirmations), comprehensive audit trail (case actions logged with timestamp and actor), and conversation scoping (off-topic queries redirected politely back to CPL).

---

## 3. User Personas and Journeys

### Student Applicant

The primary user is an undergraduate or graduate student with prior certifications, work experience, or military training seeking course credit. Their journey begins when they access NUPathway's student interface, where they encounter Echo—a conversational experience with a welcome message and suggested starting points for common scenarios. Through guided dialogue with Echo, they describe their prior learning, and the platform matches it to potential courses while Echo asks clarifying questions. The student uploads evidence such as certificates, transcripts, or employer letters, then verifies their identity via student ID or email when ready to submit. They review a case summary, confirm submission, receive a case number and email confirmation, and can return anytime to check status or respond to requests for additional information.

### Academic Advisor

Advisors serve as first-line reviewers who triage incoming CPL cases and route to subject matter experts when needed. They access NUPathway's administrative interface to view a queue of pending cases, open individual case records to review student information, claimed learning, target courses, uploaded evidence, and the platform's extracted summary and gap analysis. They can approve, deny, request more information, or route to a department SME. All decisions require a rationale, and students are notified automatically of any status changes.

### Department Subject Matter Expert

Faculty or department staff who evaluate complex cases requiring subject expertise receive routed cases via notification and queue visibility. They review the case record with focus on how the evidence maps to specific course learning outcomes, provide a recommendation or final decision, and the case is then returned to the advisor queue or closed.

---

## 4. Platform Capabilities

### Overview

NUPathway can be understood as a set of coordinated capabilities organized into conceptual layers. The student-facing layer provides Echo, the conversational interface, for interaction, evidence submission, and case status visibility. The orchestration layer coordinates conversation flow, evidence handling, and case lifecycle. The knowledge layer provides access to versioned course catalogs, CPL policies, certification mappings, and evaluation rubrics that ground Echo's responses. The intelligence layer uses Claude API with retrieval-augmented generation to match student inquiries against the knowledge base and generate structured, policy-grounded responses. The administrative layer supports review workflows, decision capture, and routing. The integration layer enables notifications, optional ticketing system connectivity, and audit logging.

### Capability Details

**Echo (Conversational Interface):** NUPathway's primary student-facing modality is Echo, a conversational interface designed with a clean, professional, 2026-forward aesthetic. Echo behaves like an advisor-style assistant, guiding students through natural dialogue with suggested prompts, contextual follow-ups, and progressive information gathering. The experience prioritizes guided conversation over form-filling. Echo is web-based (responsive for mobile) and supports session persistence so students can return and continue.

**Course Matching:** NUPathway enables matching between a student's prior learning and eligible courses. When a student describes their credentials or experience through Echo, the platform searches its knowledge base and surfaces relevant course options, presenting them through the dialogue for the student to confirm or refine.

**Evidence Handling:** NUPathway supports upload of PDFs, images, and common document formats. It can validate file type and size, extract metadata (filename, upload time, checksum), and optionally detect digital signatures or perform text extraction. Files are stored securely with access control.

**Knowledge Base:** NUPathway draws on structured course information (codes, names, learning outcomes, credit values, CPL eligibility), CPL policy documents, known certification-to-course mappings, and evaluation rubrics. All content is versioned so case records can reference the specific knowledge base version used.

**Case Lifecycle:** NUPathway manages case records from creation through resolution. Cases receive unique human-readable IDs (e.g., CPL-2025-00123), progress through status stages (draft, submitted, under review, info requested, approved, denied), link to prior submissions when resubmitted, and retain conversation transcripts for audit purposes.

**Administrative Interface:** NUPathway provides a clean, professional interface for reviewers featuring a filterable case queue, detailed case record view, decision capture with required rationale, routing to other reviewers, and case history display. The design follows a modern, polished aesthetic suitable for institutional use—think Notion's clarity with official flair.

**Notifications:** NUPathway can send email notifications for key events—case submitted, status changed, information requested, decision made—using branded templates.

**Ticketing Integration:** NUPathway can optionally push case information to systems like Zendesk or Intercom via API, sending case ID, student email, summary, status, and link to the administrative interface.

**Audit Trail:** NUPathway maintains an immutable record of actions with timestamp, actor, action type, case ID, and relevant payload information. Retention follows university policy.

---

## 5. Case Record Concept

NUPathway produces structured case records that serve as the interface between AI-assisted intake and human review. This follows patterns similar to how platforms like Zendesk or Intercom log user interactions and create support tickets, but tailored for CPL evaluation.

A case record typically captures: student identifiers and contact information (with authentication status), the type and description of prior learning claimed, target course(s) with their learning outcomes, uploaded evidence files with metadata, a platform-generated summary of key facts extracted from evidence, a mapping of how evidence relates to course learning outcomes, identified gaps or missing information, a confidence assessment with recommended routing, the full conversation transcript, the knowledge base version used, and the complete review history including any decisions and rationale.

The detailed schema will be finalized during implementation to ensure it aligns with actual data flows and integration requirements.

---

## 6. Conversational Design

### Design Philosophy

Echo functions as an **advisor-style assistant**, not a simple chatbot. The distinction matters: chatbots typically react to user queries; an advisor-style assistant guides users through a purposeful journey while remaining responsive to their needs. The experience should feel like talking to a knowledgeable, patient advisor who asks the right questions at the right time, never overwhelming the student but always moving toward a complete case submission.

The conversation is **controlled but not rigid**—structured enough to ensure all required information is gathered, flexible enough to handle the varied ways students describe their prior learning.

### Typical Conversational Pathway

The conversation typically follows a guided progression designed to feel natural while gathering required information. It begins with a greeting that orients the student and offers clear starting points for common scenarios. Echo then captures the student's intent—whether they're exploring eligibility or ready to apply—and redirects off-topic queries politely.

For students exploring, Echo answers questions about CPL policy, eligible courses, and evidence requirements, drawing on NUPathway's knowledge base and offering to start an application when ready. For students ready to apply, the conversation moves through prior learning capture (type, description, dates, institution), course matching (the platform searches and Echo presents relevant options), evidence collection (guiding what to upload based on the claim type), identity verification (required before submission), case summary review (showing what will be submitted with the option to correct), and finally confirmation with case number and next steps.

Throughout, Echo maintains transparency about what happens next, provides a reference number once assigned, and offers clear paths forward from every state. If the conversation cannot confidently proceed after reasonable attempts at clarification, Echo offers handoff to human support.

### Design Principles

The conversational experience prioritizes guided interaction over open-ended chat—starting with clear options and allowing elaboration when needed. Information is gathered progressively, asking for details only when relevant rather than front-loading all questions. Echo maintains transparency by always communicating what happens next and showing progress. Graceful fallbacks ensure that if intent remains unclear after reasonable attempts, Echo offers human handoff rather than looping. Every conversational state has a path forward or explicit handoff—no dead ends. Responses stay scoped to CPL, with off-topic queries redirected politely but warmly.

---

## 7. Knowledge Base

### Content Overview

The knowledge base grounds all of Echo's responses in verified institutional information. It contains four primary content types.

**Course Catalog:** All courses eligible for CPL, including course codes, names, departments, credit values, levels (undergraduate/graduate), learning outcomes, and guidance on what evidence typically supports CPL claims for each course.

**CPL Policy:** Institutional policy documents covering eligibility criteria, evidence requirements, process steps, timelines, and any specific rules or exceptions. Structured for retrieval so Echo can cite specific policy sections.

**Certification Mappings:** Pre-defined mappings between known certifications (such as AWS, PMP, or industry credentials) and courses, including match strength and any notes about partial coverage or additional evidence needs.

**Evaluation Rubrics:** Structured criteria that advisors use when evaluating evidence against learning outcomes, enabling Echo to assess and communicate confidence levels appropriately.

### Versioning and Maintenance

All knowledge base content is versioned. When content is updated, a new version is created and the previous version is archived. Case records reference the specific version used, ensuring decisions can be understood in context of the policy that applied at the time. Administrators can view differences between versions and understand how the knowledge base has evolved.

Content ingestion supports PDF and structured input formats. Administrators review extracted content before publishing, ensuring accuracy.

---

## 8. Administrative Experience

### Design Direction

The administrative experience follows a clean, modern design language—think Notion's clarity combined with institutional polish appropriate for a university system. The aesthetic should feel professional and trustworthy while being highly functional and easy to scan.

### Core Capabilities

**Case Queue:** The primary view shows pending cases with key information visible at a glance—case ID, summary of the claim, time since submission, and confidence level. Filters allow reviewers to narrow by status, department, confidence, date range, or assignee. Bulk actions support efficient processing when appropriate.

**Case Record View:** Opening a case displays all relevant information in a structured, scannable layout. Student information (appropriately anonymized where needed), prior learning details, target course with learning outcomes, uploaded evidence with preview capability, platform-extracted summary and outcome mapping, identified gaps, confidence assessment, and recommended routing are all visible. The conversation transcript is accessible for context. For re-submissions, previous case history is linked and viewable.

**Decision Capture:** Reviewers select an action (approve, deny, request more information, route to another reviewer) and provide required rationale. The experience supports both structured rationale selection and free-text notes. Routing allows assignment to specific individuals or department queues.

**Ticketing Integration:** A mechanism to push case information to external systems like Zendesk or Intercom via API, for organizations that want cases visible in their existing tools alongside the dedicated interface.

---

## 9. Evaluation Framework

### Accuracy and Grounding

NUPathway's accuracy can be measured through manual review of course matching precision (target: over 90% of matches are appropriate), spot-checking policy citations to ensure they trace to actual knowledge base content (target: 100% traceable), red-team testing with trick questions to verify zero policy hallucination, and comparison of platform-identified gaps against expert review (target: over 80% agreement).

### Operational Efficiency

Efficiency metrics compare pilot performance against current state baselines. Student intake time should drop from days of email exchange to under 15 minutes. Cases with complete evidence on first submission should rise from approximately 60% to over 90%. Reviewer administrative time per case should decrease from 30-45 minutes to under 15 minutes. End-to-end decision turnaround should improve from 5-15 days to 3-7 days.

### User Satisfaction

Satisfaction can be assessed through post-submission surveys for students (target: over 4.0 out of 5.0), weekly feedback sessions with reviewers during pilot, and analytics on conversation completion rates (target: over 80% of started sessions reach submission).

### Risk Monitoring

Key risks are monitored through sampling and logging. Hallucinated policy triggers immediate escalation if any instance is found in weekly case sampling. Off-topic conversation rates are tracked with a threshold of 10% for review. Privacy incidents trigger immediate escalation on any occurrence. Document handling errors are monitored with a 5% upload failure rate as the threshold for investigation.

### Testing Approach

Before pilot launch, NUPathway should be tested against CPL-specific scenarios including policy edge cases (unusual eligibility situations), out-of-scope requests (attempts to use Echo for non-CPL purposes), hallucination probes (questions about fictional policies), ambiguous evidence (documents missing key information), course mismatches (credentials that don't align with requested courses), identity verification edge cases, and adversarial inputs (injection attempts in free-text fields).

---

## 10. Technical Approach

### LLM Integration

NUPathway uses Claude API with carefully designed system prompts that define Echo's role, scope constraints, behavioral rules, and output format expectations. Responses are grounded through retrieval-augmented generation—user queries are matched against the knowledge base, relevant content is injected into the prompt context, and responses cite retrieved material rather than generating from general knowledge.

Guardrails may include input filtering for obvious manipulation attempts, output validation to verify policy citations exist in the knowledge base, and confidence-based fallback to human routing when Echo cannot proceed reliably.

### Retrieval Pipeline

The retrieval approach will use vector similarity search to find relevant knowledge base content for each user query. The specific implementation (vector store choice, embedding model, chunk strategy) will be determined during development based on performance testing with representative queries.

### Security and Privacy

Security measures may include authentication integrated with university systems (OAuth/SAML) or email verification for MVP, role-based authorization (student, advisor, SME, admin), encryption at rest and in transit, minimized PII storage with anonymization in logs, immutable audit logging, and data retention aligned with university policy. NUPathway is designed to support FERPA compliance, with final compliance review involving university counsel.

### Infrastructure

Infrastructure decisions (cloud provider, database, vector store, queue system, monitoring) will be finalized during implementation based on university IT requirements and constraints.

---

## 11. Glossary

| Term | Definition |
|------|------------|
| CPL | Credit for Prior Learning—academic credit awarded for knowledge and skills gained outside traditional coursework |
| Case Record | Structured data package containing all information needed for a reviewer to evaluate a CPL application |
| Echo | NUPathway's conversational interface—an advisor-style assistant that guides students through CPL intake |
| Evidence | Documentation supporting a CPL claim, such as certificates, transcripts, employer letters, or military training records |
| Knowledge Base | Curated, versioned collection of courses, policies, certification mappings, and rubrics that ground Echo's responses |
| NUPathway | The platform as a whole, encompassing all capabilities from intake through review |
| RAG | Retrieval-Augmented Generation—technique for grounding LLM responses in specific retrieved documents rather than general knowledge |
| SME | Subject Matter Expert—faculty or staff with expertise in a specific academic domain who evaluates complex CPL cases |
| Outcome Mapping | Analysis of how a student's evidence aligns with specific course learning outcomes |
| Intake | The process of gathering information from a student about their prior learning and CPL goals |
| Case Queue | The administrative view showing pending cases awaiting review |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | March 2026 | — | Initial comprehensive plan |

---

*This document serves as the primary scoping and requirements reference for NUPathway. Technical specifications, delivery timeline, and detailed designs are maintained in companion documents.*
