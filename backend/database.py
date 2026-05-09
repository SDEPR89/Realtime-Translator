import sqlite3
import os
from datetime import datetime

DB_PATH = "translator.db"

def get_connection():
    """Get a database connection"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # returns rows as dicts
    return conn

def init_db():
    """Create tables if they don't exist"""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pdf_path TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            assignment_id INTEGER,
            word TEXT NOT NULL,
            pdf_page INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            audio_offset REAL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (assignment_id) REFERENCES assignments(id)
        )
    """)

    conn.commit()
    conn.close()
    print("✅ Database initialized")

def create_assignment(pdf_path: str) -> int:
    """Create a new assignment session, return its ID"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO assignments (pdf_path, created_at) VALUES (?, ?)",
        (pdf_path, datetime.now().isoformat())
    )
    assignment_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return assignment_id

def save_note(assignment_id: int, word: str, pdf_page: int,
              timestamp: str, audio_offset: float):
    """Save a pinned word to the database"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO notes
        (assignment_id, word, pdf_page, timestamp, audio_offset, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (assignment_id, word, pdf_page, timestamp,
          audio_offset, datetime.now().isoformat()))
    conn.commit()
    conn.close()

def get_notes(assignment_id: int) -> list:
    """Get all pinned words for a session"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM notes WHERE assignment_id = ? ORDER BY created_at",
        (assignment_id,)
    )
    notes = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return notes

def get_assignments() -> list:
    """Get all past sessions"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM assignments ORDER BY created_at DESC")
    assignments = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return assignments