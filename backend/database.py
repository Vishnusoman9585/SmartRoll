"""
database.py
-----------
Sets up the database connection using SQLAlchemy.

Locally, this defaults to SQLite (a single file, smartroll.db) — no setup
needed. For real deployment, set a DATABASE_URL environment variable
pointing to a real Postgres database (e.g. from Supabase or Render) and
this automatically switches to that instead. SQLite is fine for learning
and testing, but most free hosting platforms don't keep its file around
between restarts — Postgres does.
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./smartroll.db")

# Some hosts (e.g. Supabase) hand out URLs starting with "postgres://",
# but SQLAlchemy 2.x requires the "postgresql://" form — fix it up here
# so people don't have to remember to edit the URL themselves.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI dependency: gives each request its own DB session, then closes it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
