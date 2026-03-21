"""
api.py — API route handlers.

Thin HTTP layer. Business logic lives in services/.
"""
import os
import json
import uuid
import logging

from flask import Blueprint, request, jsonify, current_app
from openai import AzureOpenAI
import werkzeug.utils

from db import get_db_connection
from services.auth_service import get_current_user, generate_email, validate_student_id, validate_applicant_name
from services.case_service import (
    ensure_session, get_case_for_session, create_case, update_case,
    transition_status, delete_case, get_case_by_id, get_cases_for_user,
    get_all_cases, get_message_count, get_evidence_count, compute_completion,
)
from services.extraction_service import extract_case_data
from services.settings_service import get_all_settings, update_settings, get_threshold, get_setting
from services.rag_service import retrieve_policy_context

api_bp = Blueprint('api', __name__, url_prefix='/api')
logger = logging.getLogger(__name__)

# In-memory message store for local dev without DB
mock_sessions = {}


# ═══════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════

ECHO_SYSTEM_PROMPT = """You are Echo, the NUPathway advisor-style AI assistant for Credit for Prior Learning (CPL) evaluation at {university_name}.

You are NOT a chatbot. You are an intelligent, patient intake advisor who guides students through a structured conversational pathway. Your job is to gather complete information for a CPL case record that human reviewers will evaluate.

## Your Conversational Pathway (follow this progression naturally):

1. **Greeting & Identity** — Welcome the student warmly and personally. Early in the conversation, ask for their full name and university ID (their 9–10 digit student number). Frame it naturally: "Before we get started, could I get your full name and university ID so I can set up your case file?" Then explore what course or subject area they'd like credit for.

2. **Prior Learning Capture** — This is where you shine. Be genuinely curious. Ask about their specific experiences: What was their role? What did they actually do day to day? How long? What organization? Push past surface-level answers — ask "Can you tell me more about that?" or "What specific skills did you develop in that role?" Get concrete, detailed stories, not one-word answers.

3. **Course Matching** — Based on what they describe, suggest which course competencies their experience might map to. Be specific about which learning outcomes align. If unsure, ask clarifying questions rather than guessing.

4. **Evidence Collection** — Ask what documentation they can provide (certificates, performance reviews, training records, employer letters). Explain what types of evidence are strongest. Remind them they can upload files using the paperclip button in the message area.

5. **Review & Assessment** — When you have a good picture, summarize what you've gathered. Identify any gaps. Tell the student when their case looks strong enough to submit (aim for around 80% completeness). Be explicit: "I think your case is looking strong and ready for submission" or "We still need a bit more detail on..."

6. **Submission Guidance** — When enough information is gathered, proactively tell the student: "Your case looks ready! You can click the 'Submit for Review' button in the sidebar to send it to the evaluation team." Do NOT wait for the student to ask.

## Behavioral Rules:
- Be warm, curious, and conversational — never robotic or form-like
- Ask ONE or TWO questions at a time, not a long list
- Acknowledge what the student shares before asking the next question ("That's great experience — " or "Thanks for sharing that")
- Follow up on interesting details — show genuine interest in their story
- If the student gives a vague answer, probe deeper: "Can you give me a specific example?"
- If the student goes off-topic, gently redirect to CPL
- NEVER fabricate policies or eligibility requirements
- NEVER approve or deny applications — you prepare cases for human reviewers
- Communicate progress: "I've noted that — it maps well to [competency]"
- If uncertain, ask for clarification rather than guessing
- After gathering identity (name + university ID), reference the student by name
- Make clear that submission does not guarantee approval — a reviewer will make the final decision

## Context:
{policy_context}"""


def save_message(session_id, role, content):
    """Save a chat message to DB or in-memory fallback."""
    conn = get_db_connection()
    if not conn:
        mock_sessions.setdefault(session_id, []).append({"role": role, "content": content})
        return
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO Messages (session_id, role, content) VALUES (?, ?, ?)",
            (session_id, role, content)
        )
        conn.commit()
    except Exception as e:
        logger.error(f"Failed to save message: {e}")
    finally:
        conn.close()


def get_message_history(session_id):
    """Retrieve chat history from DB or in-memory fallback."""
    conn = get_db_connection()
    if not conn:
        return mock_sessions.get(session_id, [])
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT role, content FROM Messages WHERE session_id = ? ORDER BY timestamp ASC",
            (session_id,)
        )
        rows = cursor.fetchall()
        return [{"role": row.role, "content": row.content} for row in rows]
    except Exception as e:
        logger.error(f"Failed to fetch history: {e}")
        return []
    finally:
        conn.close()


def get_client():
    """Get Azure OpenAI client."""
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    api_key = os.getenv("AZURE_OPENAI_API_KEY")
    api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-12-01-preview")

    if not endpoint:
        return None, "Missing AZURE_OPENAI_ENDPOINT"
    if not api_key:
        return None, "Missing AZURE_OPENAI_API_KEY"

    try:
        client = AzureOpenAI(
            azure_endpoint=endpoint,
            api_key=api_key,
            api_version=api_version,
        )
        return client, None
    except Exception as e:
        return None, f"Client initialization failed: {type(e).__name__}"


def _build_case_response(case_data, session_id):
    """Build the case metadata included in every chat response."""
    if not case_data:
        return {}
    msg_count = get_message_count(session_id)
    ev_count = get_evidence_count(case_id=case_data.get("case_id"), session_id=session_id)
    pct = compute_completion(case_data, msg_count, ev_count)
    return {
        "case_id": case_data.get("case_id"),
        "status": case_data.get("status"),
        "completion_pct": pct,
        "target_course": case_data.get("target_course"),
        "summary": case_data.get("summary"),
        "applicant_name": case_data.get("applicant_name"),
        "student_id": case_data.get("student_id"),
    }


# ═══════════════════════════════════════════════════
# Chat API
# ═══════════════════════════════════════════════════

@api_bp.post("/chat")
def api_chat():
    try:
        user = get_current_user(request)

        data = request.get_json(silent=True) or {}
        user_message = (data.get("message") or "").strip()
        session_id = (data.get("session_id") or "anonymous_session").strip()

        # Accept identity from payload (frontend sends from localStorage)
        applicant_info = {}
        for field in ("applicant_name", "student_id", "applicant_email"):
            val = data.get(field) or user.get(field)
            if val:
                applicant_info[field] = val

        if not user_message:
            return jsonify({"error": "Message is required"}), 400

        user_id = applicant_info.get("student_id") or user.get("user_id") or "anonymous"

        # Ensure session
        ensure_session(session_id, user_id, user.get("role", "applicant"), applicant_info)

        # Get or create case for this session
        case_data = get_case_for_session(session_id)
        if not case_data:
            case_data = create_case(session_id, user_id, applicant_info)

        case_id = case_data["case_id"] if case_data else None

        # Save user message
        save_message(session_id, "user", user_message)

        deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT")
        if not deployment:
            # LOCAL MOCK for UI testing without Azure keys
            answer = f"[Echo Mock]: I received your message. Case **{case_id}** is being built. (Azure OpenAI keys not configured for real AI responses.)"
            save_message(session_id, "assistant", answer)

            # Run mock extraction
            history = get_message_history(session_id)
            extracted = extract_case_data(history)
            if extracted and case_id:
                update_case(case_id, {k: v for k, v in extracted.items() if v})

            # Recompute completion and apply thresholds
            case_data = get_case_for_session(session_id) or case_data
            case_resp = _apply_thresholds(case_data, session_id)

            return jsonify({"answer": answer, **case_resp})

        client, err = get_client()
        if err:
            return jsonify({"error": err}), 500

        # RAG: inject policy context
        policy_context = retrieve_policy_context(user_message)
        university_name = get_setting("university_name") or "Northeastern University"

        history = get_message_history(session_id)
        messages = [
            {"role": "system", "content": ECHO_SYSTEM_PROMPT.format(
                policy_context=policy_context,
                university_name=university_name,
            )}
        ]
        messages.extend(history[-10:])

        if not history or history[-1].get("content") != user_message:
            messages.append({"role": "user", "content": user_message})

        response = client.chat.completions.create(
            model=deployment,
            messages=messages,
            temperature=0.3,
        )

        message = response.choices[0].message
        answer = (message.content or "").strip()
        save_message(session_id, "assistant", answer)

        # ── Progressive extraction ──
        # Run after every response to keep case record updated
        all_messages = get_message_history(session_id)
        if len(all_messages) >= 2:
            try:
                extracted = extract_case_data(all_messages)
                if extracted and case_id:
                    updates = {k: v for k, v in extracted.items() if v}
                    # Merge applicant info from extraction
                    if updates.get("applicant_name") and not applicant_info.get("applicant_name"):
                        applicant_info["applicant_name"] = updates["applicant_name"]
                        # Generate email from name
                        uni_domain = (university_name or "northeastern.edu").lower().replace(" ", "") + ".edu"
                        if "." not in uni_domain.split("@")[-1] if "@" in uni_domain else True:
                            uni_domain = "northeastern.edu"
                        updates["applicant_email"] = generate_email(updates["applicant_name"], uni_domain)

                    # Retroactive user_id update: fix cases created as "anonymous"
                    resolved_id = updates.get("student_id") or applicant_info.get("student_id")
                    if resolved_id and case_data.get("user_id") in (None, "", "anonymous"):
                        updates["user_id"] = resolved_id

                    update_case(case_id, updates)
            except Exception as e:
                logger.warning(f"Extraction failed (non-fatal): {e}")

        # Recompute completion and apply thresholds
        case_data = get_case_for_session(session_id) or case_data
        case_resp = _apply_thresholds(case_data, session_id)

        return jsonify({"answer": answer, **case_resp})

    except Exception as e:
        logger.exception("Chat API error")
        return jsonify({"error": f"Chat failed: {type(e).__name__}"}), 500


def _apply_thresholds(case_data, session_id):
    """Recompute completion and apply draft/submit thresholds.
    Returns dict with case metadata for frontend."""
    if not case_data:
        return {}

    case_id = case_data.get("case_id")
    msg_count = get_message_count(session_id)
    ev_count = get_evidence_count(case_id=case_id, session_id=session_id)
    pct = compute_completion(case_data, msg_count, ev_count)

    # Update completion in DB
    update_case(case_id, {"completion_pct": pct})

    draft_threshold = get_threshold("draft_save_threshold")
    status = case_data.get("status", "New")

    # Auto-transition New → Draft when above threshold
    if status == "New" and pct >= draft_threshold:
        transition_status(case_id, "Draft")
        status = "Draft"

    # Auto-transition Draft → In Progress at higher completion
    if status == "Draft" and pct > draft_threshold + 10:
        transition_status(case_id, "In Progress")
        status = "In Progress"

    submit_threshold = get_threshold("submit_threshold")

    return {
        "case_id": case_id,
        "status": status,
        "completion_pct": pct,
        "target_course": case_data.get("target_course"),
        "summary": case_data.get("summary"),
        "applicant_name": case_data.get("applicant_name"),
        "student_id": case_data.get("student_id"),
        "can_submit": pct >= submit_threshold,
        "draft_saved": status != "New",
    }


# ═══════════════════════════════════════════════════
# Case Submit
# ═══════════════════════════════════════════════════

@api_bp.post("/case/<case_id>/submit")
def submit_case(case_id):
    """Applicant submits a case for review. Must be ≥ submit threshold."""
    case = get_case_by_id(case_id)
    if not case:
        return jsonify({"error": "Case not found"}), 404

    submit_threshold = get_threshold("submit_threshold")
    pct = case.get("completion_pct", 0)

    if pct < submit_threshold:
        return jsonify({
            "error": f"Case is only {pct}% complete. Must reach {submit_threshold}% before submitting.",
            "completion_pct": pct,
        }), 400

    if case.get("status") in ("Submitted", "Under Review", "Approved", "Denied"):
        return jsonify({"error": f"Case is already {case['status']}"}), 400

    # Generate final summary via LLM if messages exist
    final_summary = case.get("summary")
    messages = case.get("messages", [])
    if messages and len(messages) >= 2:
        try:
            extracted = extract_case_data(messages)
            if extracted.get("summary"):
                final_summary = extracted["summary"]
            if extracted.get("confidence_score"):
                update_case(case_id, {"confidence_score": extracted["confidence_score"]})
        except Exception as e:
            logger.warning(f"Final extraction on submit failed: {e}")

    updates = {"status": "Submitted"}
    if final_summary:
        updates["summary"] = final_summary

    transition_status(case_id, "Submitted")
    update_case(case_id, updates)

    return jsonify({
        "status": "success",
        "case_id": case_id,
        "new_status": "Submitted",
        "message": "Your case has been submitted for review. A reviewer will evaluate it — submission does not guarantee approval.",
    })


# ═══════════════════════════════════════════════════
# Case Delete
# ═══════════════════════════════════════════════════

@api_bp.delete("/case/<case_id>")
def delete_case_endpoint(case_id):
    """Delete a low-completeness draft case."""
    max_pct = get_threshold("delete_allowed_below")
    success, error = delete_case(case_id, max_completion=max_pct)
    if not success:
        return jsonify({"error": error}), 400
    return jsonify({"status": "success", "message": "Case deleted."})


# ═══════════════════════════════════════════════════
# Evidence Upload
# ═══════════════════════════════════════════════════

ALLOWED_EXTENSIONS = {'pdf', 'png', 'jpg', 'jpeg', 'doc', 'docx', 'md'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@api_bp.post("/evidence/upload")
def upload_evidence():
    if 'file' not in request.files:
        return jsonify({"error": "No file parameter"}), 400

    file = request.files.get('file')
    if not file or file.filename == '':
        return jsonify({"error": "Empty filename"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "File type not allowed. Supported: JPEG, PNG, PDF, DOC, MD"}), 400

    file.seek(0, os.SEEK_END)
    file_length = file.tell()
    if file_length > MAX_FILE_SIZE:
        return jsonify({"error": "File exceeds 10MB limit"}), 400
    file.seek(0)

    filename = werkzeug.utils.secure_filename(file.filename)
    upload_folder = os.path.join(current_app.root_path, 'uploads')
    os.makedirs(upload_folder, exist_ok=True)

    unique_filename = f"{uuid.uuid4().hex}_{filename}"
    file_path = os.path.join(upload_folder, unique_filename)
    file.save(file_path)

    session_id = request.form.get("session_id")
    case_id = request.form.get("case_id")

    user = get_current_user(request)
    user_id = user.get("student_id") or user.get("user_id") or "anonymous"

    # Link to case if we can find one
    if not case_id and session_id:
        case_data = get_case_for_session(session_id)
        if case_data:
            case_id = case_data["case_id"]

    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO Evidence (case_id, session_id, user_id, file_name, file_path, status) VALUES (?, ?, ?, ?, ?, 'Uploaded')",
                (case_id, session_id, user_id, filename, file_path)
            )
            conn.commit()
        except Exception as e:
            logger.error(f"Failed to save evidence to DB: {e}")
        finally:
            conn.close()

    # Recompute completion after evidence upload
    if case_id:
        case_data = get_case_for_session(session_id) if session_id else None
        if case_data:
            msg_count = get_message_count(session_id)
            ev_count = get_evidence_count(case_id=case_id, session_id=session_id)
            pct = compute_completion(case_data, msg_count, ev_count)
            update_case(case_id, {"completion_pct": pct})

    return jsonify({
        "status": "success",
        "filename": filename,
        "case_id": case_id,
        "message": "Evidence uploaded successfully.",
    })


# ═══════════════════════════════════════════════════
# Applicant Case APIs
# ═══════════════════════════════════════════════════

@api_bp.get("/cases")
def get_my_cases():
    """Returns cases for the current user (applicant view). Excludes 'New' status."""
    user = get_current_user(request)
    user_id = user.get("student_id") or user.get("user_id") or "anonymous"
    student_id = user.get("student_id")
    cases = get_cases_for_user(user_id, student_id=student_id)

    # Applicant-friendly ordering: simple numbering, no raw case IDs
    result = []
    for i, c in enumerate(reversed(cases), 1):  # Oldest first for numbering
        result.append({
            "index": i,
            "case_id": c["case_id"],
            "target_course": c.get("target_course") or "Building case...",
            "status": c.get("status"),
            "completion_pct": c.get("completion_pct", 0),
            "summary": c.get("summary"),
            "applicant_name": c.get("applicant_name"),
            "created_at": c.get("created_at"),
            "updated_at": c.get("updated_at"),
            "session_id": c.get("session_id"),
        })
    result.reverse()  # Most recent first for display

    return jsonify({"cases": result})


@api_bp.get("/case/<case_id>")
def get_case(case_id):
    """Returns full case details including evidence and messages."""
    case = get_case_by_id(case_id)
    if not case:
        return jsonify({"error": "Case not found"}), 404

    return jsonify({
        "case_id": case.get("case_id"),
        "case_seq": case.get("case_seq"),
        "applicant_name": case.get("applicant_name") or "Not yet provided",
        "student_id": case.get("student_id"),
        "applicant_email": case.get("applicant_email"),
        "target_course": case.get("target_course") or "Not yet determined",
        "status": case.get("status"),
        "completion_pct": case.get("completion_pct", 0),
        "confidence_score": case.get("confidence_score"),
        "summary": case.get("summary") or "No summary generated yet.",
        "reviewer_notes": case.get("reviewer_notes"),
        "session_id": case.get("session_id"),
        "created_at": case.get("created_at"),
        "updated_at": case.get("updated_at"),
        "evidence": case.get("evidence", []),
        "messages": case.get("messages", []),
    })


# ═══════════════════════════════════════════════════
# Admin / Reviewer APIs
# ═══════════════════════════════════════════════════

@api_bp.get("/admin/cases")
def get_admin_cases():
    """Returns all cases for admin dashboard."""
    cases = get_all_cases()
    result = []
    for c in cases:
        result.append({
            "case_id": c.get("case_id"),
            "applicant": c.get("applicant_name") or f"Student #{c.get('student_id') or 'Unknown'}",
            "student_id": c.get("student_id"),
            "target_course": c.get("target_course") or "Not yet determined",
            "status": c.get("status"),
            "completion_pct": c.get("completion_pct", 0),
            "confidence_score": c.get("confidence_score"),
            "summary": c.get("summary"),
            "assignee": "Unassigned",
            "created_at": c.get("created_at"),
            "updated_at": c.get("updated_at"),
        })
    return jsonify({"cases": result})


@api_bp.post("/case/<case_id>/review")
def review_case(case_id):
    """Admin action: approve, deny, or request revision on a case."""
    data = request.get_json(silent=True) or {}
    decision = data.get("decision", "Unknown")
    notes = data.get("notes", "")

    status_map = {
        "Approve": "Approved",
        "Deny": "Denied",
        "Request Revision": "Revision Requested",
    }
    new_status = status_map.get(decision, decision)

    success = transition_status(case_id, new_status, notes=notes if notes else None)
    if not success:
        return jsonify({"error": f"Cannot transition to {new_status}"}), 400

    if notes:
        update_case(case_id, {"reviewer_notes": notes})

    return jsonify({
        "status": "success",
        "case_id": case_id,
        "decision": decision,
        "new_status": new_status,
        "message": f"Case {decision.lower()}d successfully.",
    })


# ═══════════════════════════════════════════════════
# Settings API
# ═══════════════════════════════════════════════════

@api_bp.get("/admin/settings")
def get_settings_endpoint():
    """Get all system settings."""
    return jsonify(get_all_settings())


@api_bp.post("/admin/settings")
def update_settings_endpoint():
    """Update system settings."""
    data = request.get_json(silent=True) or {}
    if not data:
        return jsonify({"error": "No settings provided"}), 400

    result = update_settings(data)
    if result is None:
        return jsonify({"error": "Failed to update settings"}), 500

    return jsonify({"status": "success", "settings": result, "message": "Settings saved."})


# ═══════════════════════════════════════════════════
# Seed Data
# ═══════════════════════════════════════════════════

def seed_demo_data():
    """Insert realistic demo cases if the DB is empty. Gated by SEED_DEMO_DATA env var."""
    if os.getenv("SEED_DEMO_DATA", "true").lower() != "true":
        return

    conn = get_db_connection()
    if not conn:
        return

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM Cases")
        count = cursor.fetchone()[0]
        if count > 0:
            return

        demo_data = [
            {
                "session_id": "demo_session_mgmt",
                "user_id": "100000001",
                "applicant_name": "Maria Santos",
                "student_id": "100000001",
                "case_id": "CPL-2026-0001",
                "case_seq": 1,
                "target_course": "MGT301: Principles of Management",
                "status": "Submitted",
                "completion_pct": 85,
                "confidence_score": 85,
                "summary": "5 years as Assistant Manager at RetailCo. Managed staff of 15, handled scheduling, inventory management, and conflict resolution. Strong evidence in planning, organizing, and leadership competencies.",
                "messages": [
                    ("user", "Hi, my name is Maria Santos and my student ID is 100000001. I'd like to get credit for MGT301."),
                    ("assistant", "Welcome Maria! I've noted your student ID. Let's talk about your experience — what kind of prior learning or work experience do you have related to management?"),
                    ("user", "I've been an assistant manager at RetailCo for 5 years. I manage a team of 15, handle scheduling, inventory tracking, and resolve conflicts between staff."),
                    ("assistant", "That's excellent experience. Your responsibilities map well to several MGT301 learning outcomes — particularly Planning & Organizing, Leadership & Directing, and Controlling/Metrics. Do you have documentation like performance reviews or training materials?"),
                    ("user", "Yes, I have my annual performance reviews and a training guide I wrote for new hires on our POS system."),
                    ("assistant", "Those would be strong evidence pieces. Please upload them using the paperclip button. Your case is looking very strong — I'd estimate around 85% alignment with MGT301 outcomes."),
                ],
            },
            {
                "session_id": "demo_session_it",
                "user_id": "100000002",
                "applicant_name": "James Chen",
                "student_id": "100000002",
                "case_id": "CPL-2026-0002",
                "case_seq": 2,
                "target_course": "IT200: Introduction to Networking",
                "status": "Submitted",
                "completion_pct": 72,
                "confidence_score": 62,
                "summary": "AWS Solutions Architect certified. 3 years managing cloud infrastructure. Strong networking fundamentals but missing formal certification in routing/switching protocols.",
                "messages": [
                    ("user", "I'm James Chen, student ID 100000002. I have an AWS Solutions Architect certification and want credit for IT200."),
                    ("assistant", "Welcome James! Your AWS certification is a great start for IT200: Introduction to Networking. The course covers networking fundamentals, TCP/IP, routing, and switching. What specific networking tasks do you handle?"),
                    ("user", "I configure VPCs, manage security groups, set up load balancers, and handle DNS configuration. I also do some basic network troubleshooting."),
                    ("assistant", "That covers strong ground in TCP/IP and network architecture. The course also covers physical layer concepts and routing protocols — do you have experience with on-premises networking as well?"),
                ],
            },
            {
                "session_id": "demo_session_eng",
                "user_id": "100000003",
                "applicant_name": "Sarah Williams",
                "student_id": "100000003",
                "case_id": "CPL-2026-0003",
                "case_seq": 3,
                "target_course": "ENG101: Written Communication",
                "status": "Approved",
                "completion_pct": 95,
                "confidence_score": 92,
                "summary": "Professional technical writer for 7 years at a major tech firm. Published style guide used by 200+ writers. Portfolio includes whitepapers, user documentation, and training materials.",
                "messages": [
                    ("user", "I'm Sarah Williams, ID 100000003. I've been a professional technical writer for 7 years and want credit for ENG101."),
                    ("assistant", "Welcome Sarah! Seven years of professional writing is compelling experience for ENG101: Written Communication. What types of writing have you done?"),
                    ("user", "Whitepapers, API documentation, user guides, internal training materials. I also wrote the company style guide that 200+ writers now use."),
                    ("assistant", "That's exceptionally strong evidence spanning multiple writing competencies — technical, instructional, and editorial. Your case looks ready for submission. Please upload samples of your work and click 'Submit for Review'."),
                ],
            },
        ]

        for case in demo_data:
            cursor.execute("""
                IF NOT EXISTS (SELECT 1 FROM Sessions WHERE session_id = ?)
                INSERT INTO Sessions (session_id, user_id, role, applicant_name, student_id)
                VALUES (?, ?, 'applicant', ?, ?)
            """, (case["session_id"], case["session_id"], case["user_id"],
                  case["applicant_name"], case["student_id"]))

            cursor.execute("""
                INSERT INTO Cases (case_id, case_seq, session_id, user_id, applicant_name,
                                   student_id, target_course, status, completion_pct,
                                   confidence_score, summary)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (case["case_id"], case["case_seq"], case["session_id"], case["user_id"],
                  case["applicant_name"], case["student_id"], case["target_course"],
                  case["status"], case["completion_pct"], case["confidence_score"], case["summary"]))

            for role, content in case["messages"]:
                cursor.execute(
                    "INSERT INTO Messages (session_id, role, content) VALUES (?, ?, ?)",
                    (case["session_id"], role, content)
                )

        # Also seed the CaseSequence to avoid conflicts
        for i in range(3):
            cursor.execute("INSERT INTO CaseSequence DEFAULT VALUES")

        conn.commit()
        logger.info("Demo data seeded: 3 cases with real names and conversation histories.")
    except Exception as e:
        logger.error(f"Failed to seed demo data: {e}")
    finally:
        conn.close()
