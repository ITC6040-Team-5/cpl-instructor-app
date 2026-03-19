import os
import json
import uuid
import random
import logging

from flask import Blueprint, request, jsonify, current_app
from openai import AzureOpenAI
import werkzeug.utils

from db import get_db_connection
from services.auth_service import get_current_user
from services.rag_service import retrieve_policy_context

api_bp = Blueprint('api', __name__, url_prefix='/api')
logger = logging.getLogger(__name__)

# In-memory fallback for local dev without DB
mock_sessions = {}
mock_cases = {}

# ─────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────

ECHO_SYSTEM_PROMPT = """You are Echo, the NUPathway advisor-style AI assistant for Credit for Prior Learning (CPL) evaluation.

You are NOT a chatbot. You are an intelligent, patient intake advisor who guides students through a structured conversational pathway. Your job is to gather complete information for a CPL case record that human reviewers will evaluate.

## Your Conversational Pathway (follow this progression naturally):

1. **Greeting & Intent** — Welcome the student warmly. Ask what course or area they'd like to seek credit for, and what kind of prior learning they have (work experience, certifications, military training, etc.).

2. **Prior Learning Capture** — Ask about their specific experience: role, responsibilities, duration, organization. Get concrete details, not generalities. Ask follow-up questions to draw out specifics.

3. **Course Matching** — Based on what they describe, suggest which course competencies their experience might map to. Be specific about which learning outcomes align.

4. **Evidence Collection** — Ask what documentation they can provide (certificates, performance reviews, training records, employer letters). Explain what types of evidence are strongest. Remind them they can upload files using the attachment button.

5. **Review & Assessment** — When you have a good picture, summarize what you've gathered. Identify any gaps. Tell the student their case looks ready or what's still needed.

6. **Submission** — When the student confirms they want to submit, use the submit_cpl_case tool to formally create their case record. Tell them their case ID and that it will be reviewed by the evaluation team.

## Behavioral Rules:
- Be conversational and warm, never robotic or form-like
- Ask ONE or TWO questions at a time, not a long list
- Acknowledge what the student shares before asking the next question
- If the student goes off-topic, gently redirect to CPL
- NEVER fabricate policies or eligibility requirements
- NEVER approve or deny applications — you prepare cases for human reviewers
- Communicate progress: "I've noted that as evidence for [competency]"
- If uncertain, ask for clarification rather than guessing

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


def ensure_session_and_draft(session_id, user_id, role):
    """Ensure a Session exists and auto-create a Draft case on first interaction.
    Returns the case_id if one was created or already exists for this session."""
    conn = get_db_connection()
    case_id = None
    if not conn:
        # In-memory fallback
        if session_id not in mock_cases:
            case_id = f"CPL-{random.randint(1000, 9999)}"
            mock_cases[session_id] = {
                "case_id": case_id,
                "user_id": user_id,
                "applicant": f"Student #{user_id}",
                "status": "Draft",
                "target_course": None,
                "confidence_score": None,
                "summary": None,
            }
        else:
            case_id = mock_cases[session_id]["case_id"]
        return case_id

    try:
        cursor = conn.cursor()
        # Ensure session
        cursor.execute("""
            IF NOT EXISTS (SELECT 1 FROM Sessions WHERE session_id = ?)
            INSERT INTO Sessions (session_id, user_id, role) VALUES (?, ?, ?)
        """, (session_id, session_id, user_id, role))

        # Check if a case already exists for this session
        cursor.execute("SELECT case_id FROM Cases WHERE session_id = ?", (session_id,))
        row = cursor.fetchone()
        if row:
            case_id = row.case_id
        else:
            # Auto-create Draft case
            case_id = f"CPL-{random.randint(1000, 9999)}"
            cursor.execute(
                "INSERT INTO Cases (case_id, session_id, user_id, status) VALUES (?, ?, ?, ?)",
                (case_id, session_id, user_id, "Draft")
            )
        conn.commit()
    except Exception as e:
        logger.warning(f"Session/draft init failed: {e}")
    finally:
        conn.close()
    return case_id


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


# ─────────────────────────────────────────────────
# Chat API
# ─────────────────────────────────────────────────

@api_bp.post("/chat")
def api_chat():
    try:
        user = get_current_user(request)
        user_id = user["user_id"]

        data = request.get_json(silent=True) or {}
        user_message = (data.get("message") or "").strip()
        session_id = (data.get("session_id") or "anonymous_session").strip()

        if not user_message:
            return jsonify({"error": "Message is required"}), 400

        # Auto-create session + Draft case on first message
        case_id = ensure_session_and_draft(session_id, user_id, user.get("role", "applicant"))

        # Save user message
        save_message(session_id, "user", user_message)

        deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT")
        if not deployment:
            # LOCAL MOCK for UI testing without Azure keys
            if "submit" in user_message.lower():
                # Simulate case submission
                conn = get_db_connection()
                if conn:
                    try:
                        cursor = conn.cursor()
                        cursor.execute(
                            "UPDATE Cases SET status = ?, target_course = ?, summary = ? WHERE session_id = ?",
                            ("Submitted", "Course (Mock)", f"Mock submission from conversation. User said: {user_message[:200]}", session_id)
                        )
                        cursor.execute(
                            "UPDATE Evidence SET case_id = ? WHERE session_id = ? AND case_id IS NULL",
                            (case_id, session_id)
                        )
                        conn.commit()
                    except Exception as e:
                        logger.warning(f"Mock submit DB update failed: {e}")
                    finally:
                        conn.close()
                answer = f"**Mock Success!** Your case **{case_id}** has been submitted for review. (Note: Running in local mock mode — Azure OpenAI keys not configured.)"
            else:
                answer = f"[Echo Mock]: I received your message. Your draft case is **{case_id}**. Type 'submit' to simulate submission. (Azure OpenAI keys not configured for real AI responses.)"
            save_message(session_id, "assistant", answer)
            return jsonify({"answer": answer, "case_id": case_id})

        client, err = get_client()
        if err:
            return jsonify({"error": err}), 500

        # RAG: inject policy context
        policy_context = retrieve_policy_context(user_message)

        history = get_message_history(session_id)
        messages = [
            {"role": "system", "content": ECHO_SYSTEM_PROMPT.format(policy_context=policy_context)}
        ]
        messages.extend(history[-10:])

        if not history or history[-1].get("content") != user_message:
            messages.append({"role": "user", "content": user_message})

        tools = [
            {
                "type": "function",
                "function": {
                    "name": "submit_cpl_case",
                    "description": "Submits a formalized Credit for Prior Learning (CPL) case for human review. Call this ONLY when the user explicitly confirms they are ready to submit their application.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "target_course": {
                                "type": "string",
                                "description": "The course code and name the user wants credit for."
                            },
                            "confidence_score": {
                                "type": "integer",
                                "description": "1-100 score representing how well their experience aligns with the course."
                            },
                            "summary": {
                                "type": "string",
                                "description": "A structured summary of the applicant's prior learning and evidence."
                            }
                        },
                        "required": ["target_course", "confidence_score", "summary"]
                    }
                }
            }
        ]

        response = client.chat.completions.create(
            model=deployment,
            messages=messages,
            tools=tools,
            temperature=0.3,
        )

        message = response.choices[0].message

        # Handle Tool Call — submit_cpl_case
        if message.tool_calls:
            for tool_call in message.tool_calls:
                if tool_call.function.name == "submit_cpl_case":
                    args = json.loads(tool_call.function.arguments)

                    conn = get_db_connection()
                    if conn:
                        try:
                            cursor = conn.cursor()
                            # Update the Draft case to Submitted with structured data
                            cursor.execute(
                                "UPDATE Cases SET status = ?, target_course = ?, confidence_score = ?, summary = ? WHERE session_id = ?",
                                ("Submitted", args.get("target_course"), args.get("confidence_score"), args.get("summary"), session_id)
                            )
                            # Attach any orphaned evidence
                            cursor.execute(
                                "UPDATE Evidence SET case_id = ? WHERE session_id = ? AND case_id IS NULL",
                                (case_id, session_id)
                            )
                            conn.commit()
                        except Exception as e:
                            logger.error(f"Failed to update case on submission: {e}")
                        finally:
                            conn.close()

                    answer = f"**Success!** Your case **{case_id}** for *{args.get('target_course')}* has been submitted for review. The evaluation team can now access your complete case record and conversation history on their dashboard. You can check your case status anytime from the Case History page."
                    save_message(session_id, "assistant", answer)
                    return jsonify({"answer": answer, "case_id": case_id})

        answer = (message.content or "").strip()
        save_message(session_id, "assistant", answer)
        return jsonify({"answer": answer, "case_id": case_id})

    except Exception as e:
        logger.exception("Azure OpenAI call failed")
        return jsonify({
            "error": f"Azure OpenAI call failed: {type(e).__name__}"
        }), 500


# ─────────────────────────────────────────────────
# Evidence Upload
# ─────────────────────────────────────────────────

ALLOWED_EXTENSIONS = {'txt', 'pdf', 'png', 'jpg', 'jpeg', 'zip', 'doc', 'docx'}
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
        return jsonify({"error": "File type not allowed. Supported: PDF, TXT, PNG, JPG, ZIP, DOC"}), 400

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
    user_id = user["user_id"]

    # If no explicit case_id but session has a draft, link to it
    if not case_id and session_id:
        conn = get_db_connection()
        if conn:
            try:
                cursor = conn.cursor()
                cursor.execute("SELECT case_id FROM Cases WHERE session_id = ?", (session_id,))
                row = cursor.fetchone()
                if row:
                    case_id = row.case_id
            except Exception:
                pass
            finally:
                conn.close()

    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO Evidence (case_id, session_id, user_id, file_name, file_path) VALUES (?, ?, ?, ?, ?)",
                (case_id, session_id, user_id, filename, file_path)
            )
            conn.commit()
        except Exception as e:
            logger.error(f"Failed to save evidence to DB: {e}")
        finally:
            conn.close()

    return jsonify({"status": "success", "filename": filename, "case_id": case_id})


# ─────────────────────────────────────────────────
# Applicant-Facing Case APIs
# ─────────────────────────────────────────────────

@api_bp.get("/cases")
def get_my_cases():
    """Returns cases for the current user (applicant view)."""
    user = get_current_user(request)
    user_id = user["user_id"]

    conn = get_db_connection()
    if not conn:
        # Return mock cases for local dev
        cases = list(mock_cases.values())
        return jsonify({"cases": cases})

    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT case_id, target_course, status, confidence_score, summary, session_id, created_at FROM Cases WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,)
        )
        rows = cursor.fetchall()
        cases = []
        for r in rows:
            cases.append({
                "case_id": r.case_id,
                "target_course": r.target_course or "Not yet determined",
                "status": r.status,
                "confidence_score": r.confidence_score,
                "summary": r.summary,
                "session_id": r.session_id,
                "created_at": str(r.created_at) if r.created_at else None,
            })
        return jsonify({"cases": cases})
    except Exception as e:
        logger.error(f"Failed to fetch user cases: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


# ─────────────────────────────────────────────────
# Admin / Reviewer APIs
# ─────────────────────────────────────────────────

@api_bp.get("/admin/cases")
def get_admin_cases():
    """Returns all cases for admin dashboard."""
    conn = get_db_connection()
    if not conn:
        # Return mock cases for local dev
        cases = list(mock_cases.values())
        if not cases:
            cases = [
                {"case_id": "CPL-DEMO-1", "applicant": "Demo User", "target_course": "No DB Connected", "status": "N/A", "confidence_score": 0, "assignee": "—"},
            ]
        return jsonify({"cases": cases})

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT case_id, user_id, target_course, status, confidence_score, summary, created_at FROM Cases ORDER BY created_at DESC")
        rows = cursor.fetchall()
        cases = []
        for r in rows:
            cases.append({
                "case_id": r.case_id,
                "applicant": f"Student #{r.user_id}" if r.user_id else "Unknown",
                "target_course": r.target_course or "Not yet determined",
                "status": r.status,
                "confidence_score": r.confidence_score,
                "assignee": "Unassigned",
                "summary": r.summary,
                "created_at": str(r.created_at) if r.created_at else None,
            })
        return jsonify({"cases": cases})
    except Exception as e:
        logger.error(f"Failed to fetch cases: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


@api_bp.get("/case/<case_id>")
def get_case(case_id):
    """Returns full case details including evidence and messages."""
    conn = get_db_connection()
    if not conn:
        # Check in-memory
        for sid, c in mock_cases.items():
            if c["case_id"] == case_id:
                return jsonify({
                    **c,
                    "applicant": "Local User",
                    "evidence": [],
                    "messages": mock_sessions.get(sid, [])
                })
        return jsonify({"error": "Case not found"}), 404

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT case_id, user_id, target_course, status, confidence_score, summary, session_id, created_at FROM Cases WHERE case_id = ?", (case_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({"error": "Case not found"}), 404

        # Evidence
        cursor.execute("SELECT file_name, file_path, upload_time FROM Evidence WHERE case_id = ? OR (session_id = ? AND case_id IS NULL)", (case_id, row.session_id))
        evidence = [{"file_name": e.file_name, "upload_time": str(e.upload_time) if e.upload_time else None} for e in cursor.fetchall()]

        # Messages
        cursor.execute("SELECT role, content, timestamp FROM Messages WHERE session_id = ? ORDER BY timestamp ASC", (row.session_id,))
        messages = [{"role": msg.role, "content": msg.content, "timestamp": str(msg.timestamp) if msg.timestamp else None} for msg in cursor.fetchall()]

        return jsonify({
            "case_id": case_id,
            "applicant": f"Student #{row.user_id}" if row.user_id else "Unknown",
            "target_course": row.target_course or "Not yet determined",
            "status": row.status,
            "confidence_score": row.confidence_score,
            "summary": row.summary or "No summary generated yet.",
            "session_id": row.session_id,
            "created_at": str(row.created_at) if row.created_at else None,
            "evidence": evidence,
            "messages": messages,
        })
    except Exception as e:
        logger.error(f"Failed to fetch case details: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


@api_bp.post("/case/<case_id>/review")
def review_case(case_id):
    """Admin action: approve, deny, or request revision on a case."""
    data = request.get_json(silent=True) or {}
    decision = data.get("decision", "Unknown")
    notes = data.get("notes", "")

    status_map = {
        "Approve": "Approved",
        "Deny": "Denied",
        "Request Revision": "Info Requested",
    }
    new_status = status_map.get(decision, decision)

    conn = get_db_connection()
    if not conn:
        return jsonify({"status": "success", "case_id": case_id, "decision": decision, "db_updated": False})

    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE Cases SET status = ? WHERE case_id = ?", (new_status, case_id))
        conn.commit()
    except Exception as e:
        logger.error(f"Failed to update case: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

    return jsonify({"status": "success", "case_id": case_id, "decision": decision, "new_status": new_status, "db_updated": True})


# ─────────────────────────────────────────────────
# Seed Data (for MVP verification)
# ─────────────────────────────────────────────────

def seed_demo_data():
    """Insert realistic demo cases if the database is empty. Called once at startup."""
    conn = get_db_connection()
    if not conn:
        return

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM Cases")
        count = cursor.fetchone()[0]
        if count > 0:
            return  # Data already exists

        demo_data = [
            {
                "session_id": "demo_session_mgmt",
                "user_id": "100001",
                "case_id": "CPL-2025-001",
                "target_course": "MGT301: Principles of Management",
                "status": "Submitted",
                "confidence_score": 85,
                "summary": "5 years as Assistant Manager at RetailCo. Managed staff of 15, handled scheduling, inventory management, and conflict resolution. Strong evidence in planning, organizing, and leadership competencies.",
                "messages": [
                    ("user", "I'd like to get credit for MGT301. I've been an assistant manager at RetailCo for 5 years."),
                    ("assistant", "That sounds like strong experience for MGT301: Principles of Management. Can you tell me more about your day-to-day responsibilities?"),
                    ("user", "I manage a team of 15, handle scheduling, inventory tracking, and resolve conflicts between staff. I also train new hires."),
                    ("assistant", "Excellent. Your experience maps well to several course learning outcomes — particularly Planning & Organizing, Leadership & Directing, and potentially Controlling/Metrics. Do you have any documentation like performance reviews or training materials you've created?"),
                    ("user", "Yes, I have my annual performance reviews and a training guide I wrote for new hires on our POS system."),
                    ("assistant", "Those would be strong evidence pieces. Please upload them using the attachment button. I'd also recommend any inventory or scheduling reports that show your metrics-driven work."),
                ],
            },
            {
                "session_id": "demo_session_it",
                "user_id": "100002",
                "case_id": "CPL-2025-002",
                "target_course": "IT200: Introduction to Networking",
                "status": "Submitted",
                "confidence_score": 62,
                "summary": "AWS Solutions Architect certified. 3 years managing cloud infrastructure. Strong networking fundamentals but missing formal certification in routing/switching protocols specifically.",
                "messages": [
                    ("user", "I have an AWS Solutions Architect certification and 3 years of cloud infrastructure experience. Can I get credit for IT200?"),
                    ("assistant", "Your AWS certification is a great start for IT200: Introduction to Networking. The course covers networking fundamentals, TCP/IP, routing, and switching. Your cloud experience likely covers many of these. What specific networking tasks do you handle day-to-day?"),
                    ("user", "I configure VPCs, manage security groups, set up load balancers, and handle DNS configuration. I also do some basic network troubleshooting."),
                    ("assistant", "That covers strong ground in TCP/IP and network architecture. I notice the course also covers physical layer concepts and routing protocols — do you have experience with on-premises networking as well?"),
                ],
            },
            {
                "session_id": "demo_session_eng",
                "user_id": "100003",
                "case_id": "CPL-2025-003",
                "target_course": "ENG101: Written Communication",
                "status": "Approved",
                "confidence_score": 92,
                "summary": "Professional technical writer for 7 years at a major tech firm. Published style guide used by 200+ writers. Portfolio includes whitepapers, user documentation, and training materials across multiple domains.",
                "messages": [
                    ("user", "I've been a professional technical writer for 7 years. I'd like credit for ENG101."),
                    ("assistant", "Seven years of professional writing is compelling experience for ENG101: Written Communication. What types of writing have you done?"),
                    ("user", "Whitepapers, API documentation, user guides, internal training materials. I also wrote the company style guide that 200+ writers now use."),
                    ("assistant", "That's exceptionally strong evidence. Your work spans multiple writing competencies — technical, instructional, and editorial. I'd recommend uploading samples of each type, along with any recognition or reviews of your work."),
                ],
            },
        ]

        for case in demo_data:
            # Create session
            cursor.execute("""
                IF NOT EXISTS (SELECT 1 FROM Sessions WHERE session_id = ?)
                INSERT INTO Sessions (session_id, user_id, role) VALUES (?, ?, 'applicant')
            """, (case["session_id"], case["session_id"], case["user_id"]))

            # Create case
            cursor.execute(
                "INSERT INTO Cases (case_id, session_id, user_id, target_course, status, confidence_score, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (case["case_id"], case["session_id"], case["user_id"],
                 case["target_course"], case["status"], case["confidence_score"], case["summary"])
            )

            # Create messages
            for role, content in case["messages"]:
                cursor.execute(
                    "INSERT INTO Messages (session_id, role, content) VALUES (?, ?, ?)",
                    (case["session_id"], role, content)
                )

        conn.commit()
        logger.info("Demo data seeded successfully: 3 cases with conversation histories.")
    except Exception as e:
        logger.error(f"Failed to seed demo data: {e}")
    finally:
        conn.close()
