import os
from flask import Blueprint, jsonify, render_template

try:
    import pyodbc
except ImportError:
    pyodbc = None

system_bp = Blueprint('system', __name__)

@system_bp.get("/admin")
def admin_page():
    # Diagnostic config status page (not the product's Reviewer Portal)
    status = {
        "AZURE_OPENAI_ENDPOINT": "✅ set" if os.getenv("AZURE_OPENAI_ENDPOINT") else "❌ missing",
        "AZURE_OPENAI_API_KEY": "✅ set" if os.getenv("AZURE_OPENAI_API_KEY") else "❌ missing",
        "AZURE_OPENAI_API_VERSION": os.getenv("AZURE_OPENAI_API_VERSION") or "(default: 2024-12-01-preview)",
        "AZURE_OPENAI_DEPLOYMENT": "✅ set" if os.getenv("AZURE_OPENAI_DEPLOYMENT") else "❌ missing",
        "SQL_CONNECTION_STRING": "✅ set" if os.getenv("SQL_CONNECTION_STRING") else "❌ missing",
    }
    return render_template("admin.html", status=status)

@system_bp.get("/health")
def health():
    return jsonify({"status": "ok"})

@system_bp.get("/versions")
def versions():
    try:
        import openai
        import httpx
        return jsonify({
            "openai_version": getattr(openai, "__version__", "unknown"),
            "httpx_version": getattr(httpx, "__version__", "unknown"),
            "python_version": os.sys.version,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@system_bp.get("/dbcheck")
def dbcheck():
    conn_str = os.getenv("SQL_CONNECTION_STRING")
    if not conn_str:
        return jsonify({"error": "Missing SQL_CONNECTION_STRING"}), 500

    try:
        if not pyodbc:
            return jsonify({"error": "pyodbc module not installed or missing dependencies"}), 500
            
        conn = pyodbc.connect(conn_str, timeout=10)
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        row = cursor.fetchone()
        conn.close()

        return jsonify({"status": "DB Connected", "result": int(row[0])})
    except Exception as e:
        from flask import current_app
        current_app.logger.exception("DB connection check failed")
        return jsonify({
            "error": f"DB check failed: {type(e).__name__}",
            "details": str(e),
        }), 500
