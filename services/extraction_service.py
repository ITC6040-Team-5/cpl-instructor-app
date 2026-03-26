"""
extraction_service.py — Progressive case data extraction from conversation.

After each chat exchange, this service makes a lightweight LLM call to extract
structured case data (target course, applicant info, summary) from the conversation.
"""
import os
import json
import logging

from openai import AzureOpenAI

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT = """You are a structured data extraction assistant. You are given a conversation between a student and an AI advisor about Credit for Prior Learning (CPL).

Extract the following fields from the conversation. Return ONLY valid JSON with these keys:
- "target_course": the course code and name the student wants credit for (null if not yet mentioned)
- "applicant_name": the student's full name (null if not yet shared)
- "student_id": university/student ID number (null if not yet shared)
- "prior_learning_summary": a 1-2 sentence summary of their relevant prior experience (null if not discussed yet)
- "completion_assessment": a brief assessment of how complete this case is (1 sentence)
- "confidence_score": 0-100 score of how well their experience aligns with the course (null if insufficient info)
- "claimed_competencies": list of specific competency tags the student has claimed (e.g. ["Agile Methodologies", "Team Leadership", "Budget Management"]). Only include competencies explicitly mentioned. Empty list if none yet.

Be precise. Only extract what is explicitly stated. Do not infer or fabricate.

CONVERSATION:
{conversation}

Respond with ONLY the JSON object, nothing else."""


def extract_case_data(messages):
    """
    Run a lightweight LLM extraction over the conversation history.
    Returns a dict with extracted fields, or empty dict on failure.
    """
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    api_key = os.getenv("AZURE_OPENAI_API_KEY")
    deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT")
    api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-12-01-preview")

    if not all([endpoint, api_key, deployment]):
        # Local mock: do basic text scanning
        return _mock_extraction(messages)

    try:
        client = AzureOpenAI(
            azure_endpoint=endpoint,
            api_key=api_key,
            api_version=api_version,
        )

        # Build conversation text
        conversation_text = "\n".join(
            f"{m.get('role', 'unknown').upper()}: {m.get('content', '')}"
            for m in messages[-12:]  # Last 12 messages for context window efficiency
        )

        response = client.chat.completions.create(
            model=deployment,
            messages=[{
                "role": "user",
                "content": EXTRACTION_PROMPT.format(conversation=conversation_text)
            }],
            temperature=0.0,
            max_tokens=500,
        )

        raw = (response.choices[0].message.content or "").strip()

        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1]
            if raw.endswith("```"):
                raw = raw[:-3]
            raw = raw.strip()

        data = json.loads(raw)
        import json as _json
        raw_competencies = data.get("claimed_competencies", [])
        if isinstance(raw_competencies, list):
            competencies_json = _json.dumps(raw_competencies) if raw_competencies else None
        else:
            competencies_json = None

        extracted = {
            "target_course": data.get("target_course"),
            "applicant_name": data.get("applicant_name"),
            "student_id": data.get("student_id"),
            "summary": data.get("prior_learning_summary"),
            "confidence_score": data.get("confidence_score"),
            "claimed_competencies": competencies_json,
        }

        # Name normalization: trim, title-case, prefer more complete names
        if extracted.get("applicant_name"):
            extracted["applicant_name"] = _normalize_name(extracted["applicant_name"])

        return extracted

    except json.JSONDecodeError as e:
        logger.warning(f"Extraction returned invalid JSON: {e}")
        return {}
    except Exception as e:
        logger.error(f"Extraction LLM call failed: {e}")
        return {}


def _normalize_name(name):
    """Normalize an extracted name: trim whitespace, title-case, strip artifacts."""
    if not name:
        return name
    # Remove common LLM artifacts
    cleaned = name.strip().strip('"').strip("'").strip()
    # Title-case each word
    parts = cleaned.split()
    normalized = " ".join(p.capitalize() for p in parts if p)
    return normalized if len(normalized) >= 2 else name


def _mock_extraction(messages):
    """Simple keyword-based extraction for local dev without Azure keys."""
    result = {}
    full_text = " ".join(m.get("content", "") for m in messages).lower()

    # Try to find course mentions
    import re
    course_match = re.search(r'([A-Z]{2,4}\s?\d{3}[A-Z]?)', " ".join(m.get("content", "") for m in messages))
    if course_match:
        result["target_course"] = course_match.group(1)

    # Simple name detection (if someone says "my name is X Y")
    name_match = re.search(r"my name is ([A-Z][a-z]+ [A-Z][a-z]+)", " ".join(m.get("content", "") for m in messages))
    if name_match:
        result["applicant_name"] = name_match.group(1)

    # Student ID detection
    id_match = re.search(r'\b(\d{9,10})\b', " ".join(m.get("content", "") for m in messages))
    if id_match:
        result["student_id"] = id_match.group(1)

    # Generate summary from user messages
    user_msgs = [m.get("content", "") for m in messages if m.get("role") == "user"]
    if len(user_msgs) >= 2:
        result["summary"] = ". ".join(user_msgs[:3])[:200]

    return result
