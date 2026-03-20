"""
auth_service.py — User identity resolution.

Currently accepts identity from request headers/payload (set by frontend).
Extension point for future Entra ID / SSO integration.
"""
import logging

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
