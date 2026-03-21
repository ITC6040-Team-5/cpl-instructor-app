"""
case_service.py — Case lifecycle management.

Owns: sequential ID generation, completion scoring, state transitions, CRUD.
Does NOT own: LLM calls, message storage, or HTTP concerns.
"""
import logging
import threading
from datetime import datetime

from db import get_db_connection

logger = logging.getLogger(__name__)

# ─── In-Memory Fallback State ──────────────────────────────
_mem_lock = threading.Lock()
_mem_seq_counter = 0
_mem_cases = {}       # session_id → case dict
_mem_sessions = {}    # session_id → session dict


# ─── Sequential Case ID ───────────────────────────────────

def _next_case_id_db(cursor):
    """Generate sequential case ID from CaseSequence IDENTITY table."""
    cursor.execute("INSERT INTO CaseSequence DEFAULT VALUES")
    cursor.execute("SELECT SCOPE_IDENTITY()")
    seq = int(cursor.fetchone()[0])
    year = datetime.utcnow().year
    return f"CPL-{year}-{seq:04d}", seq


def _next_case_id_mem():
    """Thread-safe in-memory sequential ID for local dev."""
    global _mem_seq_counter
    with _mem_lock:
        _mem_seq_counter += 1
        seq = _mem_seq_counter
    year = datetime.utcnow().year
    return f"CPL-{year}-{seq:04d}", seq


# ─── Completion Scoring ───────────────────────────────────

def compute_completion(case_data, message_count=0, evidence_count=0):
    """
    Compute case completion percentage (0–100) based on 6 criteria:
      1. Name provided (15%)
      2. Student ID provided (10%)
      3. Target course / area identified (15%)
      4. Prior learning described — message depth (20%)
      5. Evidence attached (15%)
      6. Summary / conversational completeness (25%)

    Realistic case with name + ID + messages + 1 file + summary = 85%
    Adding course identification brings it to 100%.
    """
    pct = 0

    # 1. Name provided (15%)
    name = case_data.get("applicant_name")
    if name and len(name.strip()) >= 2:
        pct += 15

    # 2. Student ID provided (10%)
    sid = case_data.get("student_id")
    if sid:
        pct += 10

    # 3. Target course / area (15%)
    course = case_data.get("target_course")
    if course and course not in ("Not yet determined", "—", None, ""):
        pct += 15

    # 4. Prior learning described (20%)
    if message_count >= 6:
        pct += 20
    elif message_count >= 4:
        pct += 15
    elif message_count >= 2:
        pct += 10

    # 5. Evidence attached (15%)
    if evidence_count >= 1:
        pct += 15

    # 6. Summary / conversational completeness (25%)
    summary = case_data.get("summary")
    if summary and len(summary) > 100:
        pct += 25
    elif summary and len(summary) > 30:
        pct += 15
    elif message_count >= 8:
        pct += 10

    return min(pct, 100)


# ─── Session Management ───────────────────────────────────

def ensure_session(session_id, user_id, role, applicant_info=None):
    """Ensure a Session row exists. Returns session dict."""
    applicant_info = applicant_info or {}
    conn = get_db_connection()

    if not conn:
        if session_id not in _mem_sessions:
            _mem_sessions[session_id] = {
                "session_id": session_id,
                "user_id": user_id,
                "role": role,
                **applicant_info,
            }
        else:
            # Update identity if new info provided
            for k in ("applicant_name", "student_id", "applicant_email"):
                if applicant_info.get(k):
                    _mem_sessions[session_id][k] = applicant_info[k]
        return _mem_sessions[session_id]

    try:
        cursor = conn.cursor()

        cursor.execute("SELECT session_id FROM Sessions WHERE session_id = ?", (session_id,))
        exists = cursor.fetchone()

        if not exists:
            cursor.execute("""
                INSERT INTO Sessions (session_id, user_id, role, applicant_name, student_id, applicant_email)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                session_id, user_id, role,
                applicant_info.get("applicant_name"),
                applicant_info.get("student_id"),
                applicant_info.get("applicant_email"),
            ))
        else:
            # Update identity fields if newly provided
            for col in ("applicant_name", "student_id", "applicant_email"):
                val = applicant_info.get(col)
                if val:
                    cursor.execute(f"UPDATE Sessions SET {col} = ? WHERE session_id = ? AND ({col} IS NULL OR {col} = '')", (val, session_id))

        conn.commit()
        return {"session_id": session_id, "user_id": user_id, "role": role, **applicant_info}
    except Exception as e:
        logger.error(f"Session ensure failed: {e}")
        return {"session_id": session_id, "user_id": user_id, "role": role}
    finally:
        conn.close()


# ─── Case CRUD ─────────────────────────────────────────────

def get_case_for_session(session_id):
    """Return the case dict for a session, or None."""
    conn = get_db_connection()
    if not conn:
        return _mem_cases.get(session_id)

    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT case_id, case_seq, session_id, user_id, applicant_name, student_id,
                   applicant_email, target_course, status, completion_pct, confidence_score,
                   summary, reviewer_notes, created_at, updated_at
            FROM Cases WHERE session_id = ?
        """, (session_id,))
        row = cursor.fetchone()
        if not row:
            return None
        return _row_to_case(row)
    except Exception as e:
        logger.error(f"get_case_for_session failed: {e}")
        return None
    finally:
        conn.close()


def create_case(session_id, user_id, applicant_info=None):
    """Create a new case with a sequential ID. Returns case dict."""
    applicant_info = applicant_info or {}
    conn = get_db_connection()

    if not conn:
        case_id, seq = _next_case_id_mem()
        case = {
            "case_id": case_id,
            "case_seq": seq,
            "session_id": session_id,
            "user_id": user_id,
            "applicant_name": applicant_info.get("applicant_name"),
            "student_id": applicant_info.get("student_id"),
            "applicant_email": applicant_info.get("applicant_email"),
            "target_course": None,
            "status": "New",
            "completion_pct": 0,
            "confidence_score": None,
            "summary": None,
            "reviewer_notes": None,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }
        _mem_cases[session_id] = case
        return case

    try:
        cursor = conn.cursor()
        case_id, seq = _next_case_id_db(cursor)
        cursor.execute("""
            INSERT INTO Cases (case_id, case_seq, session_id, user_id, applicant_name,
                               student_id, applicant_email, status, completion_pct)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'New', 0)
        """, (
            case_id, seq, session_id, user_id,
            applicant_info.get("applicant_name"),
            applicant_info.get("student_id"),
            applicant_info.get("applicant_email"),
        ))
        conn.commit()
        return {
            "case_id": case_id, "case_seq": seq, "session_id": session_id,
            "user_id": user_id, "status": "New", "completion_pct": 0,
            **applicant_info,
        }
    except Exception as e:
        logger.error(f"create_case failed: {e}")
        return None
    finally:
        conn.close()


def update_case(case_id, updates):
    """Update case fields. `updates` is a dict of column → value."""
    conn = get_db_connection()

    if not conn:
        # In-memory fallback
        for sid, case in _mem_cases.items():
            if case["case_id"] == case_id:
                case.update(updates)
                case["updated_at"] = datetime.utcnow().isoformat()
                return case
        return None

    try:
        cursor = conn.cursor()
        allowed = {
            "user_id", "applicant_name", "student_id", "applicant_email",
            "target_course", "status", "completion_pct",
            "confidence_score", "summary", "reviewer_notes",
        }
        filtered = {k: v for k, v in updates.items() if k in allowed}
        if not filtered:
            return None

        set_clause = ", ".join(f"{k} = ?" for k in filtered)
        set_clause += ", updated_at = GETDATE()"
        values = list(filtered.values()) + [case_id]

        cursor.execute(f"UPDATE Cases SET {set_clause} WHERE case_id = ?", values)
        conn.commit()
        return filtered
    except Exception as e:
        logger.error(f"update_case failed: {e}")
        return None
    finally:
        conn.close()


def transition_status(case_id, new_status, notes=None):
    """Safely transition case status. Returns success boolean."""
    valid_transitions = {
        "New": ["Draft"],
        "Draft": ["In Progress", "Draft"],
        "In Progress": ["Ready for Review", "In Progress"],
        "Ready for Review": ["Submitted", "Ready for Review"],
        "Submitted": ["Under Review"],
        "Under Review": ["Approved", "Denied", "Revision Requested"],
        "Revision Requested": ["In Progress", "Submitted"],
    }

    conn = get_db_connection()
    if not conn:
        for sid, case in _mem_cases.items():
            if case["case_id"] == case_id:
                current = case.get("status", "New")
                if new_status in valid_transitions.get(current, [new_status]):
                    case["status"] = new_status
                    if notes:
                        case["reviewer_notes"] = notes
                    return True
                return False
        return False

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT status FROM Cases WHERE case_id = ?", (case_id,))
        row = cursor.fetchone()
        if not row:
            return False

        current = row.status
        if new_status not in valid_transitions.get(current, [new_status]):
            logger.warning(f"Invalid transition: {current} → {new_status} for {case_id}")
            return False

        if notes:
            cursor.execute(
                "UPDATE Cases SET status = ?, reviewer_notes = ?, updated_at = GETDATE() WHERE case_id = ?",
                (new_status, notes, case_id)
            )
        else:
            cursor.execute(
                "UPDATE Cases SET status = ?, updated_at = GETDATE() WHERE case_id = ?",
                (new_status, case_id)
            )
        conn.commit()
        return True
    except Exception as e:
        logger.error(f"transition_status failed: {e}")
        return False
    finally:
        conn.close()


def delete_case(case_id, max_completion=50):
    """Delete a case if it's Draft/New and below completion threshold.
    Returns (success, error_message)."""
    conn = get_db_connection()
    if not conn:
        for sid, case in list(_mem_cases.items()):
            if case["case_id"] == case_id:
                if case.get("status") not in ("New", "Draft", "In Progress"):
                    return False, "Only Draft cases can be deleted."
                if (case.get("completion_pct") or 0) >= max_completion:
                    return False, f"Case is above {max_completion}% completion."
                del _mem_cases[sid]
                return True, None
        return False, "Case not found."

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT status, completion_pct FROM Cases WHERE case_id = ?", (case_id,))
        row = cursor.fetchone()
        if not row:
            return False, "Case not found."
        if row.status not in ("New", "Draft", "In Progress"):
            return False, "Only Draft/In Progress cases can be deleted."
        if (row.completion_pct or 0) >= max_completion:
            return False, f"Case is above {max_completion}% completion."

        # Delete related records first
        cursor.execute("DELETE FROM Evidence WHERE case_id = ?", (case_id,))
        cursor.execute("DELETE FROM Messages WHERE session_id = (SELECT session_id FROM Cases WHERE case_id = ?)", (case_id,))
        cursor.execute("DELETE FROM Cases WHERE case_id = ?", (case_id,))
        conn.commit()
        return True, None
    except Exception as e:
        logger.error(f"delete_case failed: {e}")
        return False, str(e)
    finally:
        conn.close()


def get_case_by_id(case_id):
    """Get full case details including messages and evidence."""
    conn = get_db_connection()
    if not conn:
        for sid, c in _mem_cases.items():
            if c["case_id"] == case_id:
                from routes.api import mock_sessions
                return {
                    **c,
                    "evidence": [],
                    "messages": mock_sessions.get(sid, []),
                }
        return None

    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT case_id, case_seq, session_id, user_id, applicant_name, student_id,
                   applicant_email, target_course, status, completion_pct, confidence_score,
                   summary, reviewer_notes, created_at, updated_at
            FROM Cases WHERE case_id = ?
        """, (case_id,))
        row = cursor.fetchone()
        if not row:
            return None

        case = _row_to_case(row)

        # Evidence
        cursor.execute("""
            SELECT file_name, file_path, status, upload_time
            FROM Evidence WHERE case_id = ? OR (session_id = ? AND case_id IS NULL)
        """, (case_id, case["session_id"]))
        case["evidence"] = [{
            "file_name": e.file_name,
            "status": e.status or "Uploaded",
            "upload_time": str(e.upload_time) if e.upload_time else None,
        } for e in cursor.fetchall()]

        # Messages
        cursor.execute("""
            SELECT role, content, timestamp
            FROM Messages WHERE session_id = ? ORDER BY timestamp ASC
        """, (case["session_id"],))
        case["messages"] = [{
            "role": msg.role,
            "content": msg.content,
            "timestamp": str(msg.timestamp) if msg.timestamp else None,
        } for msg in cursor.fetchall()]

        return case
    except Exception as e:
        logger.error(f"get_case_by_id failed: {e}")
        return None
    finally:
        conn.close()


def get_cases_for_user(user_id, student_id=None):
    """Get all cases for an applicant. Queries by user_id OR student_id
    to handle cases created before identity was linked."""
    conn = get_db_connection()
    if not conn:
        return [c for c in _mem_cases.values() if c.get("status") != "New"]

    try:
        cursor = conn.cursor()
        if student_id and student_id != "anonymous":
            # Query by both user_id and student_id to catch orphaned cases
            cursor.execute("""
                SELECT case_id, case_seq, session_id, user_id, applicant_name, student_id,
                       applicant_email, target_course, status, completion_pct, confidence_score,
                       summary, reviewer_notes, created_at, updated_at
                FROM Cases
                WHERE (user_id = ? OR student_id = ?) AND status != 'New'
                ORDER BY created_at DESC
            """, (user_id, student_id))
        else:
            cursor.execute("""
                SELECT case_id, case_seq, session_id, user_id, applicant_name, student_id,
                       applicant_email, target_course, status, completion_pct, confidence_score,
                       summary, reviewer_notes, created_at, updated_at
                FROM Cases
                WHERE user_id = ? AND status != 'New'
                ORDER BY created_at DESC
            """, (user_id,))
        return [_row_to_case(r) for r in cursor.fetchall()]
    except Exception as e:
        logger.error(f"get_cases_for_user failed: {e}")
        return []
    finally:
        conn.close()


def get_all_cases():
    """Get all cases for admin dashboard."""
    conn = get_db_connection()
    if not conn:
        return [c for c in _mem_cases.values() if c.get("status") != "New"]

    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT case_id, case_seq, session_id, user_id, applicant_name, student_id,
                   applicant_email, target_course, status, completion_pct, confidence_score,
                   summary, reviewer_notes, created_at, updated_at
            FROM Cases
            WHERE status != 'New'
            ORDER BY created_at DESC
        """)
        return [_row_to_case(r) for r in cursor.fetchall()]
    except Exception as e:
        logger.error(f"get_all_cases failed: {e}")
        return []
    finally:
        conn.close()


def get_message_count(session_id):
    """Count messages for a session."""
    conn = get_db_connection()
    if not conn:
        from routes.api import mock_sessions
        return len(mock_sessions.get(session_id, []))

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM Messages WHERE session_id = ?", (session_id,))
        return cursor.fetchone()[0]
    except Exception:
        return 0
    finally:
        conn.close()


def get_evidence_count(case_id=None, session_id=None):
    """Count evidence files for a case or session."""
    conn = get_db_connection()
    if not conn:
        return 0

    try:
        cursor = conn.cursor()
        if case_id:
            cursor.execute("SELECT COUNT(*) FROM Evidence WHERE case_id = ?", (case_id,))
        elif session_id:
            cursor.execute("SELECT COUNT(*) FROM Evidence WHERE session_id = ?", (session_id,))
        else:
            return 0
        return cursor.fetchone()[0]
    except Exception:
        return 0
    finally:
        conn.close()


# ─── Helpers ───────────────────────────────────────────────

def _row_to_case(row):
    """Convert a pyodbc Row to a dict."""
    return {
        "case_id": row.case_id,
        "case_seq": getattr(row, 'case_seq', None),
        "session_id": row.session_id,
        "user_id": row.user_id,
        "applicant_name": getattr(row, 'applicant_name', None),
        "student_id": getattr(row, 'student_id', None),
        "applicant_email": getattr(row, 'applicant_email', None),
        "target_course": row.target_course,
        "status": row.status,
        "completion_pct": getattr(row, 'completion_pct', 0) or 0,
        "confidence_score": row.confidence_score,
        "summary": row.summary,
        "reviewer_notes": getattr(row, 'reviewer_notes', None),
        "created_at": str(row.created_at) if row.created_at else None,
        "updated_at": str(getattr(row, 'updated_at', None)) if getattr(row, 'updated_at', None) else None,
    }
