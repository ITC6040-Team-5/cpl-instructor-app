import os
import logging

try:
    import pyodbc
except ImportError:
    pyodbc = None

logger = logging.getLogger(__name__)


def get_db_connection():
    """Get a database connection. Returns None if pyodbc or connection string unavailable."""
    if not pyodbc:
        logger.warning("pyodbc is not installed. Database operations are disabled.")
        return None

    conn_str = os.getenv("SQL_CONNECTION_STRING")
    if not conn_str:
        logger.warning("SQL_CONNECTION_STRING is missing. Database operations are disabled.")
        return None

    try:
        conn = pyodbc.connect(conn_str, timeout=10)
        return conn
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        return None


def init_db():
    """Initialize database schema. Safe to call repeatedly — uses IF NOT EXISTS."""
    conn = get_db_connection()
    if not conn:
        return

    try:
        cursor = conn.cursor()

        # ─── Core Tables ───────────────────────────────────

        cursor.execute("""
            IF OBJECT_ID('Sessions', 'U') IS NULL
            CREATE TABLE Sessions (
                session_id VARCHAR(255) PRIMARY KEY,
                user_id VARCHAR(255),
                role VARCHAR(50),
                applicant_name NVARCHAR(200),
                student_id VARCHAR(20),
                applicant_email VARCHAR(255),
                created_at DATETIME DEFAULT GETDATE()
            )
        """)

        cursor.execute("""
            IF OBJECT_ID('CaseSequence', 'U') IS NULL
            CREATE TABLE CaseSequence (
                seq_id INT IDENTITY(1,1) PRIMARY KEY,
                created_at DATETIME DEFAULT GETDATE()
            )
        """)

        cursor.execute("""
            IF OBJECT_ID('Cases', 'U') IS NULL
            CREATE TABLE Cases (
                case_id VARCHAR(50) PRIMARY KEY,
                case_seq INT,
                session_id VARCHAR(255) FOREIGN KEY REFERENCES Sessions(session_id),
                user_id VARCHAR(255),
                applicant_name NVARCHAR(200),
                student_id VARCHAR(20),
                applicant_email VARCHAR(255),
                target_course VARCHAR(255),
                status VARCHAR(50) DEFAULT 'New',
                completion_pct INT DEFAULT 0,
                confidence_score INT,
                summary NVARCHAR(MAX),
                reviewer_notes NVARCHAR(MAX),
                created_at DATETIME DEFAULT GETDATE(),
                updated_at DATETIME DEFAULT GETDATE()
            )
        """)

        cursor.execute("""
            IF OBJECT_ID('Messages', 'U') IS NULL
            CREATE TABLE Messages (
                id INT IDENTITY(1,1) PRIMARY KEY,
                session_id VARCHAR(255) FOREIGN KEY REFERENCES Sessions(session_id),
                role VARCHAR(50),
                content NVARCHAR(MAX),
                timestamp DATETIME DEFAULT GETDATE()
            )
        """)

        cursor.execute("""
            IF OBJECT_ID('Evidence', 'U') IS NULL
            CREATE TABLE Evidence (
                id INT IDENTITY(1,1) PRIMARY KEY,
                case_id VARCHAR(50) FOREIGN KEY REFERENCES Cases(case_id),
                session_id VARCHAR(255),
                user_id VARCHAR(255),
                file_name VARCHAR(255),
                file_path VARCHAR(500),
                status VARCHAR(50) DEFAULT 'Uploaded',
                upload_time DATETIME DEFAULT GETDATE()
            )
        """)

        cursor.execute("""
            IF OBJECT_ID('Settings', 'U') IS NULL
            CREATE TABLE Settings (
                setting_key VARCHAR(100) PRIMARY KEY,
                setting_value NVARCHAR(MAX),
                updated_at DATETIME DEFAULT GETDATE()
            )
        """)

        # ─── Safe Migrations (add columns to existing tables) ──

        _safe_add_column(cursor, 'Sessions', 'user_id', 'VARCHAR(255)')
        _safe_add_column(cursor, 'Sessions', 'applicant_name', 'NVARCHAR(200)')
        _safe_add_column(cursor, 'Sessions', 'student_id', 'VARCHAR(20)')
        _safe_add_column(cursor, 'Sessions', 'applicant_email', 'VARCHAR(255)')

        _safe_add_column(cursor, 'Cases', 'user_id', 'VARCHAR(255)')
        _safe_add_column(cursor, 'Cases', 'case_seq', 'INT')
        _safe_add_column(cursor, 'Cases', 'applicant_name', 'NVARCHAR(200)')
        _safe_add_column(cursor, 'Cases', 'student_id', 'VARCHAR(20)')
        _safe_add_column(cursor, 'Cases', 'applicant_email', 'VARCHAR(255)')
        _safe_add_column(cursor, 'Cases', 'completion_pct', 'INT DEFAULT 0')
        _safe_add_column(cursor, 'Cases', 'reviewer_notes', 'NVARCHAR(MAX)')
        _safe_add_column(cursor, 'Cases', 'updated_at', 'DATETIME DEFAULT GETDATE()')

        _safe_add_column(cursor, 'Evidence', 'session_id', 'VARCHAR(255)')
        _safe_add_column(cursor, 'Evidence', 'user_id', 'VARCHAR(255)')
        _safe_add_column(cursor, 'Evidence', 'status', "VARCHAR(50) DEFAULT 'Uploaded'")

        # ─── Seed Default Settings ─────────────────────────

        _seed_default_settings(cursor)

        conn.commit()
        logger.info("Database schema initialized successfully.")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
    finally:
        conn.close()


def _safe_add_column(cursor, table, column, col_type):
    """Add a column to a table only if it doesn't already exist."""
    try:
        cursor.execute(f"""
            IF NOT EXISTS (
                SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = '{table}' AND COLUMN_NAME = '{column}'
            )
            ALTER TABLE {table} ADD {column} {col_type}
        """)
    except Exception:
        pass


def _seed_default_settings(cursor):
    """Insert default settings if they don't exist."""
    defaults = {
        'university_name': 'Northeastern University',
        'draft_save_threshold': '30',
        'submit_threshold': '80',
        'delete_allowed_below': '50',
        'strict_domain_mode': 'true',
        'require_evidence_links': 'true',
    }
    for key, value in defaults.items():
        try:
            cursor.execute("""
                IF NOT EXISTS (SELECT 1 FROM Settings WHERE setting_key = ?)
                INSERT INTO Settings (setting_key, setting_value) VALUES (?, ?)
            """, (key, key, value))
        except Exception:
            pass
