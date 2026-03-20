"""
settings_service.py — System settings CRUD.

Reads/writes configurable settings from the Settings table.
Provides defaults for when DB is unavailable.
"""
import logging
from db import get_db_connection

logger = logging.getLogger(__name__)

# Defaults used when DB is unavailable or setting is missing
DEFAULTS = {
    "university_name": "Northeastern University",
    "draft_save_threshold": "30",
    "submit_threshold": "80",
    "delete_allowed_below": "50",
    "strict_domain_mode": "true",
    "require_evidence_links": "true",
}

# In-memory fallback for local dev
_mem_settings = dict(DEFAULTS)


def get_setting(key):
    """Get a single setting value. Returns the default if not found."""
    conn = get_db_connection()
    if not conn:
        return _mem_settings.get(key, DEFAULTS.get(key))

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT setting_value FROM Settings WHERE setting_key = ?", (key,))
        row = cursor.fetchone()
        if row:
            return row.setting_value
        return DEFAULTS.get(key)
    except Exception as e:
        logger.error(f"get_setting({key}) failed: {e}")
        return DEFAULTS.get(key)
    finally:
        conn.close()


def get_all_settings():
    """Get all settings as a dict."""
    conn = get_db_connection()
    if not conn:
        return dict(_mem_settings)

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT setting_key, setting_value FROM Settings")
        result = dict(DEFAULTS)  # Start with defaults
        for row in cursor.fetchall():
            result[row.setting_key] = row.setting_value
        return result
    except Exception as e:
        logger.error(f"get_all_settings failed: {e}")
        return dict(DEFAULTS)
    finally:
        conn.close()


def update_settings(updates):
    """Update multiple settings. `updates` is a dict of key → value.
    Returns the updated settings dict."""
    conn = get_db_connection()
    if not conn:
        _mem_settings.update(updates)
        return dict(_mem_settings)

    try:
        cursor = conn.cursor()
        for key, value in updates.items():
            cursor.execute("""
                IF EXISTS (SELECT 1 FROM Settings WHERE setting_key = ?)
                    UPDATE Settings SET setting_value = ?, updated_at = GETDATE() WHERE setting_key = ?
                ELSE
                    INSERT INTO Settings (setting_key, setting_value) VALUES (?, ?)
            """, (key, value, key, key, value))
        conn.commit()
        return get_all_settings()
    except Exception as e:
        logger.error(f"update_settings failed: {e}")
        return None
    finally:
        conn.close()


def get_threshold(key):
    """Get a numeric threshold setting. Returns int."""
    val = get_setting(key)
    try:
        return int(val)
    except (TypeError, ValueError):
        return int(DEFAULTS.get(key, 0))
