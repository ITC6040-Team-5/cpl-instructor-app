# RAG Implementation Blueprint
# This document exists to explain how the knowledge directory maps to future reasoning flows.

# Concept:
# Echo (the AI assistant) should not rely on generic LLM knowledge. 
# It must ground its conversational responses in specific university policies and catalogs.

# Types of Documents:
# 1. catalogs/: Contains JSON/CSV/PDF of active course catalogs (e.g. MGT301 description and learning outcomes).
# 2. policies/: Contains CPL limits, eligibility criteria, and evidentiary standard guidelines.
# 3. examples/: Transcripts of highly successful past CPL case interviews to use as few-shot prompting.

# Future Retrieval Flow:
# 1. User message arrives in `/api/chat`.
# 2. `rag_service.retrieve_context(message)` vector-searches the `knowledge/` directory embeddings.
# 3. The retrieved chunks are injected into the system prompt as `<context>` blocks.
# 4. Echo generates a policy-grounded response.
