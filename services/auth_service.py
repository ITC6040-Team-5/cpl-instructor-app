"""
auth_service.py — User identity resolution and admin authentication.

Currently accepts identity from request headers/payload (set by frontend).
Extension point for future Entra ID / SSO integration.
"""
import logging
import secrets
from datetime import datetime, timedelta
from functools import wraps

from flask import request as flask_request, jsonify
from werkzeug.security import check_password_hash

from db import get_db_connection

logger = logging.getLogger(__name__)


def get_current_user(request):
    """
    Resolve the current user identity from the request.

    Priority order:
    1. JSON body fields (applicant_name, student_id) — set during conversation
    2. Custom headers (X-Applicant-Name, X-Student-Id) — set from localStorage
    3. Fallback to anonymous session identifier

    Future: Parse Azure Entra ID headers / JWT tokens here.
    """
    # Try to read identity from headers (set by frontend from localStorage)
    applicant_name = request.headers.get("X-Applicant-Name", "").strip()
    student_id = request.headers.get("X-Student-Id", "").strip()
    user_role = request.headers.get("X-User-Role", "applicant").strip()

    # Use student_id as user_id if available, otherwise use a session-based fallback
    user_id = student_id if student_id else "anonymous"

    return {
        "user_id": user_id,
        "applicant_name": applicant_name or None,
        "student_id": student_id or None,
        "is_authenticated": bool(student_id),
        "role": user_role,
    }


def generate_email(applicant_name, university_domain="northeastern.edu"):
    """
    Auto-generate email from applicant name.
    Format: lastname.fl@university.edu (first two letters of first name)
    Example: "Jane Doe" → "doe.ja@northeastern.edu"
    """
    if not applicant_name:
        return None

    parts = applicant_name.strip().split()
    if len(parts) < 2:
        # Single name — use as-is
        prefix = parts[0].lower()
        return f"{prefix}@{university_domain}"

    first = parts[0].lower()
    last = parts[-1].lower()
    initials = first[:2] if len(first) >= 2 else first
    return f"{last}.{initials}@{university_domain}"


def validate_student_id(student_id):
    """Validate student ID: must be 9-10 digits. Returns (valid, error)."""
    if not student_id:
        return False, "Student ID is required."
    cleaned = student_id.strip()
    if not cleaned.isdigit():
        return False, "Student ID must contain only digits."
    if len(cleaned) < 9 or len(cleaned) > 10:
        return False, "Student ID must be 9 to 10 digits."
    return True, None


def validate_applicant_name(name):
    """Validate name: must have at least first and last. Returns (valid, error)."""
    if not name:
        return False, "Full name is required."
    parts = name.strip().split()
    if len(parts) < 2:
        return False, "Please provide both first and last name."
    return True, None


def require_role(user, allowed_roles):
    """Validates if the user has correct permissions. Currently pass-through."""
    return user.get("role") in allowed_roles


# ═══════════════════════════════════════════════════
# Admin Authentication
# ═══════════════════════════════════════════════════

def authenticate_admin(email, password):
    """
    Validate admin credentials against the AdminUsers table.
    Returns (success: bool, admin_info: dict or None, error: str or None).
    """
    if not email or not password:
        return False, None, "Email and password are required."

    conn = get_db_connection()
    if not conn:
        return False, None, "Database unavailable."

    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT email, password_hash, display_name FROM AdminUsers WHERE email = ?",
            (email.strip().lower(),)
        )
        row = cursor.fetchone()
        if not row:
            return False, None, "Invalid email or password."

        if not check_password_hash(row.password_hash, password):
            return False, None, "Invalid email or password."

        return True, {
            "email": row.email,
            "display_name": row.display_name or "Admin",
        }, None
    except Exception as e:
        logger.error(f"Admin authentication failed: {e}")
        return False, None, "Authentication error."
    finally:
        conn.close()


def create_admin_session(email, hours=8):
    """
    Create a secure admin session token.
    Returns the token string, or None on failure.
    """
    token = secrets.token_urlsafe(48)
    expires = datetime.utcnow() + timedelta(hours=hours)

    conn = get_db_connection()
    if not conn:
        return None

    try:
        cursor = conn.cursor()
        # Clean up expired sessions for this admin
        cursor.execute("DELETE FROM AdminSessions WHERE admin_email = ? OR expires_at < GETDATE()", (email,))
        cursor.execute(
            "INSERT INTO AdminSessions (token, admin_email, expires_at) VALUES (?, ?, ?)",
            (token, email, expires)
        )
        conn.commit()
        return token
    except Exception as e:
        logger.error(f"Failed to create admin session: {e}")
        return None
    finally:
        conn.close()


def validate_admin_session(token):
    """
    Validate an admin session token.
    Returns (valid: bool, admin_email: str or None).
    """
    if not token:
        return False, None

    conn = get_db_connection()
    if not conn:
        return False, None

    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT admin_email FROM AdminSessions WHERE token = ? AND expires_at > GETDATE()",
            (token,)
        )
        row = cursor.fetchone()
        if row:
            return True, row.admin_email
        return False, None
    except Exception as e:
        logger.error(f"Admin session validation failed: {e}")
        return False, None
    finally:
        conn.close()


def invalidate_admin_session(token):
    """Delete an admin session (logout)."""
    if not token:
        return
    conn = get_db_connection()
    if not conn:
        return
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM AdminSessions WHERE token = ?", (token,))
        conn.commit()
    except Exception as e:
        logger.warning(f"Failed to invalidate admin session: {e}")
    finally:
        conn.close()


def require_admin(f):
    """
    Flask route decorator that enforces admin authentication.
    Checks X-Admin-Token header. Returns 401 if invalid.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        token = flask_request.headers.get("X-Admin-Token", "").strip()
        if not token:
            return jsonify({"error": "Admin authentication required."}), 401

        valid, admin_email = validate_admin_session(token)
        if not valid:
            return jsonify({"error": "Invalid or expired admin session."}), 401

        # Attach admin context to the request for downstream use
        flask_request.admin_email = admin_email
        return f(*args, **kwargs)
    return decorated

