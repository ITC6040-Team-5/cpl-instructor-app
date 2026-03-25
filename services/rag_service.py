import logging

logger = logging.getLogger(__name__)

import os
import json

def retrieve_policy_context(query=""):
    """
    Surgically extended: Basic text lookup from a catalog file in /knowledge/.
    Avoids full vector database overhead while injecting actual course mapping.
    
    ====================================================================
    FUTURE EXTENSION POINT: RAG & Document Grounding
    
    In the future, this module should:
    1. Translate the `query` into a vector embedding.
    2. Search Azure AI Search or a local vector store (FAISS/Chroma) 
       against the /knowledge/ directory.
    3. Retrieve the most relevant chunks of University catalogs and CPL policies.
    4. Return those chunks as injected markdown for the LLM system prompt.
    ====================================================================
    """
    base = "ECHO INSTRUCTION: Provide guidance based on general CPL best practices. If you don't know a specific institutional policy, help the user categorize their claim type (e.g. Portfolio, Exam, Military) and ask for dates/artifacts."
    
    try:
        catalog_path = os.path.join(os.path.dirname(__file__), "..", "knowledge", "catalog.json")
        if os.path.exists(catalog_path):
            with open(catalog_path, "r", encoding="utf-8") as f:
                catalog = json.load(f)
            
            # For V1, the catalog is small enough to provide to the LLM context fully.
            # This allows Echo to proactively suggest courses based on the user's described skills.
            course_list = [f"- {code}: {details}" for code, details in catalog.items()]
            
            if course_list:
                return base + "\n\nAvailable Courses for CPL (Suggest these if the student's skills align):\n" + "\n".join(course_list)
    except Exception as e:
        logger.warning(f"RAG catalog lookup failed: {e}")
        
    return base
