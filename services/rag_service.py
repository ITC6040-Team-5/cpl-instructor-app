import logging

logger = logging.getLogger(__name__)

def retrieve_policy_context(query=""):
    """
    FUTURE EXTENSION POINT: RAG & Document Grounding
    
    This function currently returns a static fallback string defining the 
    core product boundaries for Echo. 
    
    In the future, this module will:
    1. Translate the `query` into a vector embedding.
    2. Search Azure AI Search or a local vector store (FAISS/Chroma) 
       against the /knowledge/ directory.
    3. Retrieve the most relevant chunks of University catalogs and CPL policies.
    4. Return those chunks as injected markdown for the LLM system prompt.
    """
    
    return "ECHO INSTRUCTION: Provide guidance based on general CPL best practices. If you don't know a specific institutional policy, help the user categorize their claim type (e.g. Portfolio, Exam, Military) and ask for dates/artifacts."
