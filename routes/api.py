import os
from flask import Blueprint, request, jsonify, current_app
from openai import AzureOpenAI
from db import get_db_connection

api_bp = Blueprint('api', __name__, url_prefix='/api')

mock_sessions = {}

def save_message(session_id, role, content):
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
        current_app.logger.error(f"Failed to save message: {e}")
    finally:
        conn.close()

def get_message_history(session_id):
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
        current_app.logger.error(f"Failed to fetch history: {e}")
        return []
    finally:
        conn.close()

def get_client():
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

import json
import random

from services.auth_service import get_current_user
from services.rag_service import retrieve_policy_context

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

        deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT")
        if not deployment:
            # FALLBACK MOCK FOR LOCAL UI TESTING WITHOUT AZURE KEYS
            if "submit" in user_message.lower():
                case_id = f"CPL-MOCK-{random.randint(100, 999)}"
                answer = f"**Mock Success!** I have formally submitted your case. Your reference number is **{case_id}**. Notice: Real DB insertion is disabled locally due to missing drivers."
            else:
                answer = "[Local Mock]: AZURE_OPENAI_DEPLOYMENT env var is missing. I am simulating the Echo assistant. Please type 'submit' to simulate a case submission."
            save_message(session_id, "assistant", answer)
            return jsonify({"answer": answer})

        client, err = get_client()
        if err:
            return jsonify({"error": err}), 500
            
        # CRITICAL FIX: Ensure the session exists in DB before saving messages
        conn = get_db_connection()
        if conn:
            try:
                cursor = conn.cursor()
                cursor.execute("""
                    IF NOT EXISTS (SELECT * FROM Sessions WHERE session_id = ?)
                    INSERT INTO Sessions (session_id, user_id, role) VALUES (?, ?, ?)
                """, (session_id, session_id, user_id, user["role"]))
                conn.commit()
            except Exception as e:
                current_app.logger.warning(f"Session init failed: {e}")
            finally:
                conn.close()

        save_message(session_id, "user", user_message)

        # RAG EXTENSION: Inject policy constraints into the system prompt gracefully
        policy_context = retrieve_policy_context(user_message)

        history = get_message_history(session_id)
        messages = [
            {"role": "system", "content": f"You are Echo, a friendly conversational AI coach for the NUPathway Credit for Prior Learning (CPL) program. Do not act like a static form. Guide the student to describe their experience, identify a target course, and upload evidence. When they are ready to submit, use the submit_cpl_case tool to generate their official case record.\n\nInstitutional Policy Context:\n{policy_context}"}
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
                                "description": "The course code and name the user wants credit for (e.g., 'MGT301: Principles of Management')."
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
        
        # Handle Tool Call
        if message.tool_calls:
            for tool_call in message.tool_calls:
                if tool_call.function.name == "submit_cpl_case":
                    args = json.loads(tool_call.function.arguments)
                    case_id = f"CPL-{random.randint(1000, 9999)}"
                    
                    conn = get_db_connection()
                    if conn:
                        try:
                            cursor = conn.cursor()
                            # 1. Insert the formal Case bound to the User & Session
                            cursor.execute(
                                "INSERT INTO Cases (case_id, session_id, user_id, target_course, status, confidence_score, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
                                (case_id, session_id, user_id, args.get("target_course"), "Needs Review", args.get("confidence_score"), args.get("summary"))
                            )
                            # 2. Attach any orphaned evidence uploaded during this session to this Case
                            cursor.execute(
                                "UPDATE Evidence SET case_id = ? WHERE session_id = ? AND case_id IS NULL",
                                (case_id, session_id)
                            )
                            conn.commit()
                        except Exception as e:
                            current_app.logger.error(f"Failed to insert case: {e}")
                        finally:
                            conn.close()
                    
                    answer = f"**Success!** I have formally submitted your case. Your reference number is **{case_id}** for the course *{args.get('target_course')}*. It is now out of my hands and pending review with the evaluation team on the administrative dashboard. You can return anytime to check your status."
                    save_message(session_id, "assistant", answer)
                    return jsonify({"answer": answer})

        answer = (message.content or "").strip()
        save_message(session_id, "assistant", answer)
        return jsonify({"answer": answer})

    except Exception as e:
        current_app.logger.exception("Azure OpenAI call failed")
        return jsonify({
            "error": f"Azure OpenAI call failed: {type(e).__name__}"
        }), 500

import uuid
import werkzeug.utils

ALLOWED_EXTENSIONS = {'txt', 'pdf', 'png', 'jpg', 'jpeg', 'zip', 'doc', 'docx'}
MAX_FILE_SIZE = 10 * 1024 * 1024 # 10MB

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
    
    # Optional mappings for strict attachment
    case_id = request.form.get("case_id")
    session_id = request.form.get("session_id")
    
    # Read user context if provided (Auth stub)
    user = get_current_user(request)
    user_id = user["user_id"]
    
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
            current_app.logger.error(f"Failed to save evidence to DB: {e}")
        finally:
            conn.close()

    return jsonify({"status": "success", "filename": filename})

@api_bp.get("/admin/cases")
def get_cases():
    conn = get_db_connection()
    if not conn:
        return jsonify({"cases": [
            {"case_id": "CPL-8991", "applicant": "Alex Doe", "target_course": "MGT301: Principles of Management", "status": "Needs Review", "confidence_score": 85, "assignee": "Unassigned"},
            {"case_id": "CPL-8985", "applicant": "Maria Jenkins", "target_course": "IT200: Intro to Networking", "status": "Needs Review", "confidence_score": 60, "assignee": "You"},
            {"case_id": "CPL-8950", "applicant": "Tom Smith", "target_course": "ENG101: Composition", "status": "SME Review", "confidence_score": 95, "assignee": "Prof. Higgins"}
        ]})
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT case_id, target_course, status, confidence_score FROM Cases ORDER BY created_at DESC")
        rows = cursor.fetchall()
        cases = []
        for r in rows:
            cases.append({
                "case_id": r.case_id,
                "target_course": r.target_course,
                "status": r.status,
                "confidence_score": r.confidence_score,
                "applicant": "Student (Auth pending)",
                "assignee": "Unassigned"
            })
        return jsonify({"cases": cases})
    except Exception as e:
        current_app.logger.error(f"Failed to fetch cases: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@api_bp.get("/case/<case_id>")
def get_case(case_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({
            "case_id": case_id,
            "applicant": "Mock Applicant (No DB)",
            "target_course": "MGT301: Mock Course",
            "status": "Needs Review",
            "confidence_score": 85,
            "summary": "This is a local DB-less mock summary.",
            "evidence": [],
            "messages": mock_sessions.get("session_mock", [])
        })
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT target_course, status, confidence_score, summary, session_id FROM Cases WHERE case_id = ?", (case_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({"error": "Case not found"}), 404
        
        cursor.execute("SELECT file_name, file_path, upload_time FROM Evidence WHERE case_id = ?", (case_id,))
        evidence = [{"file_name": getattr(e, 'file_name', ''), "upload_time": str(getattr(e, 'upload_time', ''))} for e in cursor.fetchall()]
        
        cursor.execute("SELECT role, content FROM Messages WHERE session_id = ? ORDER BY timestamp ASC", (row.session_id,))
        messages = [{"role": getattr(msg, 'role', ''), "content": getattr(msg, 'content', '')} for msg in cursor.fetchall()]

        return jsonify({
            "case_id": case_id,
            "applicant": "Student (Auth pending)",
            "target_course": getattr(row, 'target_course', ''),
            "status": getattr(row, 'status', ''),
            "confidence_score": getattr(row, 'confidence_score', ''),
            "summary": getattr(row, 'summary', ''),
            "evidence": evidence,
            "messages": messages
        })
    except Exception as e:
        current_app.logger.error(f"Failed to fetch case details: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@api_bp.post("/case/<case_id>/review")
def review_case(case_id):
    data = request.get_json(silent=True) or {}
    decision = data.get("decision", "Unknown")
    
    new_status = "Approved" if decision == "Approve" else "Denied"
    
    conn = get_db_connection()
    if not conn:
        return jsonify({"status": "success", "case_id": case_id, "decision": decision, "db_updated": False})
        
    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE Cases SET status = ? WHERE case_id = ?", (new_status, case_id))
        conn.commit()
    except Exception as e:
        current_app.logger.error(f"Failed to update case: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

    return jsonify({"status": "success", "case_id": case_id, "decision": decision, "db_updated": True})
