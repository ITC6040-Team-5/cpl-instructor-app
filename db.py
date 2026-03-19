import os
import logging

try:
    import pyodbc
except ImportError:
    pyodbc = None

logger = logging.getLogger(__name__)

def get_db_connection():
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
    conn = get_db_connection()
    if not conn:
        return
        
    try:
        cursor = conn.cursor()
        
        # Create Sessions table
        cursor.execute("""
            IF OBJECT_ID('Sessions', 'U') IS NULL 
            CREATE TABLE Sessions (
                session_id VARCHAR(255) PRIMARY KEY,
                user_id VARCHAR(255),
                role VARCHAR(50),
                created_at DATETIME DEFAULT GETDATE()
            )
        """)
        
        # Create Cases table
        cursor.execute("""
            IF OBJECT_ID('Cases', 'U') IS NULL
            CREATE TABLE Cases (
                case_id VARCHAR(50) PRIMARY KEY,
                session_id VARCHAR(255) FOREIGN KEY REFERENCES Sessions(session_id),
                user_id VARCHAR(255),
                target_course VARCHAR(255),
                status VARCHAR(50) DEFAULT 'Draft',
                confidence_score INT,
                summary NVARCHAR(MAX),
                created_at DATETIME DEFAULT GETDATE()
            )
        """)
        
        # Create Messages table
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
        
        # Create Evidence table
        cursor.execute("""
            IF OBJECT_ID('Evidence', 'U') IS NULL
            CREATE TABLE Evidence (
                id INT IDENTITY(1,1) PRIMARY KEY,
                case_id VARCHAR(50) FOREIGN KEY REFERENCES Cases(case_id),
                session_id VARCHAR(255),
                user_id VARCHAR(255),
                file_name VARCHAR(255),
                file_path VARCHAR(500),
                upload_time DATETIME DEFAULT GETDATE()
            )
        """)
        
        # SAFE MIGRATIONS: Add new columns to existing tables in Azure
        try:
            cursor.execute("ALTER TABLE Sessions ADD user_id VARCHAR(255)")
        except Exception: pass
        try:
            cursor.execute("ALTER TABLE Cases ADD user_id VARCHAR(255)")
        except Exception: pass
        try:
            cursor.execute("ALTER TABLE Evidence ADD session_id VARCHAR(255)")
        except Exception: pass
        try:
            cursor.execute("ALTER TABLE Evidence ADD user_id VARCHAR(255)")
        except Exception: pass
        
        conn.commit()
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
    finally:
        conn.close()
