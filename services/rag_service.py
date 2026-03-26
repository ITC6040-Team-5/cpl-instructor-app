"""
rag_service.py — Smart conditional RAG context injection.

Routes through the knowledge base ONLY when the conversation phase calls for it.
Phase detection → keyword matching → inject only relevant entries (~50-100ms overhead max).

Future: replace keyword matching with vector embeddings + Azure AI Search.
"""
import logging
import os
import json

from db import get_db_connection

logger = logging.getLogger(__name__)

# ── Department keyword map ──────────────────────────────────────────
DOMAIN_MAP = {
    "DGM": ["design", "ux", "ui", "graphic", "animation", "web design", "digital media",
             "multimedia", "3d", "game design", "video", "compositing", "storytelling"],
    "ITC": ["programming", "software", "networking", "database", "it ", "information technology",
             "web development", "security", "cloud", "aws", "python", "java", "sql"],
    "MGT": ["management", "manager", "leadership", "business", "strategy", "operations",
             "project management", "organizational", "planning"],
    "LDR": ["leadership", "leader", "team lead", "change management", "organizational"],
    "HRM": ["human resources", "hr ", "talent", "recruitment", "compensation", "hiring", "workforce"],
    "AAI": ["artificial intelligence", "machine learning", "ai ", " ml ", "deep learning",
             "neural", "nlp", "computer vision", "reinforcement learning"],
    "EAI": ["enterprise ai", "ai system", "applied ai", "ai application"],
    "ALY": ["analytics", "data analysis", "data science", "statistics", "r programming",
             "data mining", "business intelligence", "tableau", "visualization"],
    "HMG": ["healthcare", "health management", "medical", "clinical", "hospital", "health informatics"],
    "TCC": ["technical writing", "documentation", "communication", "instructional design",
             "writing", "content"],
    "CET": ["computer engineering", "robotics", "embedded", "hardware", "circuits"],
    "MGT_LDR": ["management", "leadership"],  # combined for broad queries
}

BASE_INSTRUCTION = (
    "ECHO INSTRUCTION: You are guiding a CPL (Credit for Prior Learning) evaluation. "
    "Help the student articulate their prior learning experience clearly. "
    "If you don't know a specific institutional policy, help them categorize their claim "
    "(e.g. Portfolio, Exam, Military) and ask for dates/artifacts."
)


def _detect_phase(case_data):
    """Detect the conversation phase based on case data."""
    if not case_data:
        return "identity"
    has_identity = bool(case_data.get("applicant_name") or case_data.get("student_id"))
    has_course = bool(case_data.get("target_course") and
                      case_data.get("target_course") not in ("Not yet determined", "—", None, ""))
    if not has_identity:
        return "identity"
    if not has_course:
        return "exploration"
    if case_data.get("summary"):
        return "evidence"
    return "course_matching"


def _match_domains(query):
    """Return matching department codes for the query."""
    q = query.lower()
    matched = set()
    for dept, keywords in DOMAIN_MAP.items():
        if any(kw in q for kw in keywords):
            matched.add(dept[:3])  # normalize to 3-char code
    return matched


def _load_courses_from_db(dept_codes=None):
    """Load courses from KnowledgeBase table. Falls back to catalog.json."""
    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor()
            if dept_codes:
                placeholders = ",".join("?" for _ in dept_codes)
                # Match entry_key prefix against dept codes
                rows = []
                for code in dept_codes:
                    cursor.execute(
                        "SELECT entry_key, title, content FROM KnowledgeBase "
                        "WHERE is_active=1 AND entry_type='course' AND entry_key LIKE ?",
                        (f"{code}%",)
                    )
                    rows.extend(cursor.fetchall())
            else:
                cursor.execute(
                    "SELECT entry_key, title, content FROM KnowledgeBase "
                    "WHERE is_active=1 AND entry_type='course'"
                )
                rows = cursor.fetchall()
            return {row.entry_key: row.content for row in rows}
        except Exception as e:
            logger.warning(f"KnowledgeBase query failed, falling back to catalog.json: {e}")
        finally:
            conn.close()

    # Fallback: read from catalog.json
    return _load_courses_from_file(dept_codes)


def _load_courses_from_file(dept_codes=None):
    """Read courses from catalog.json as fallback."""
    try:
        catalog_path = os.path.join(os.path.dirname(__file__), "..", "knowledge", "catalog.json")
        if not os.path.exists(catalog_path):
            return {}
        with open(catalog_path, "r", encoding="utf-8") as f:
            catalog = json.load(f)
        if dept_codes:
            return {k: v for k, v in catalog.items()
                    if any(k.startswith(code) for code in dept_codes)}
        return catalog
    except Exception as e:
        logger.warning(f"catalog.json read failed: {e}")
        return {}


def _load_policies(domain_hint=None):
    """Load relevant policy entries from KnowledgeBase."""
    conn = get_db_connection()
    if not conn:
        return ""
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT title, content FROM KnowledgeBase "
            "WHERE is_active=1 AND entry_type='policy' "
            "ORDER BY created_at DESC"
        )
        rows = cursor.fetchall()
        if not rows:
            return ""
        return "\n\nCPL Policy Guidelines:\n" + "\n".join(
            f"• {row.title}: {row.content}" for row in rows[:5]
        )
    except Exception as e:
        logger.warning(f"Policy load failed: {e}")
        return ""
    finally:
        conn.close()


def retrieve_policy_context(query="", case_data=None):
    """
    Smart conditional RAG injection.

    Detects conversation phase → injects only what's needed:
    - identity phase: nothing (Echo just needs to gather identity)
    - exploration phase: brief CPL overview only
    - course_matching phase: relevant department courses (~8-15 entries)
    - evidence phase: course detail + policy guidelines

    RAG overhead: ≤50ms when triggered, 0ms otherwise.
    """
    phase = _detect_phase(case_data)

    # Identity phase — inject nothing, keep prompt minimal
    if phase == "identity":
        return BASE_INSTRUCTION

    # Exploration phase — brief overview, no course dump
    if phase == "exploration":
        return (
            BASE_INSTRUCTION +
            "\n\nThe student is in the early exploration stage. "
            "Help them identify which course their experience might map to. "
            "Ask about their role, skills, and what subject area they want credit for."
        )

    # Course matching / evidence phase — inject relevant courses
    matched_domains = _match_domains(query)
    if not matched_domains and case_data:
        # Try matching from the known target course
        course = case_data.get("target_course", "")
        if course:
            matched_domains = _match_domains(course)

    if not matched_domains:
        # No domain detected — inject nothing beyond base
        return BASE_INSTRUCTION

    courses = _load_courses_from_db(matched_domains)
    if not courses:
        return BASE_INSTRUCTION

    course_lines = [f"- {code}: {desc}" for code, desc in courses.items()]
    context = (
        BASE_INSTRUCTION +
        f"\n\nRelevant courses for CPL consideration:\n" +
        "\n".join(course_lines)
    )

    # Evidence phase — also inject policies
    if phase == "evidence":
        context += _load_policies()

    return context
