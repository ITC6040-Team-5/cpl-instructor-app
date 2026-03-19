import logging

logger = logging.getLogger(__name__)

def get_current_user(request):
    """
    FUTURE EXTENSION POINT: Authentication Module
    
    This function currently returns a stubbed user identity.
    In the future (Phase 3/4), this will:
    1. Parse headers/cookies (e.g., Bearer token or Azure Entra ID headers).
    2. Verify the JWT token via Microsoft Identity or University SSO.
    3. Return a rich User object containing institutional IDs and claims.
    """
    
    # Read the mock user_id from headers/json if provided for MVP testing.
    # If none is provided, return a hardcoded test user.
    user_id = request.headers.get("X-Mock-User-Id", "999999999")
    role = request.headers.get("X-Mock-Role", "applicant")
    
    return {
        "user_id": user_id,
        "is_authenticated": True,
        "role": role,
        "email": f"student_{user_id}@university.edu"
    }

def require_role(user, allowed_roles):
    """
    Validates if the user has correct permissions.
    Currently a pass-through stub.
    """
    return user.get("role") in allowed_roles
