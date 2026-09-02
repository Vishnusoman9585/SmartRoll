"""
auth.py
-------
Handles password hashing (bcrypt) and JWT tokens so we're not storing
plain-text passwords or trusting the frontend to say "yes I'm logged in".
"""
import os
from datetime import datetime, timedelta
from typing import Optional
import bcrypt
from jose import jwt, JWTError
from fastapi import HTTPException, Header, status

# In production (e.g. Render), set a SECRET_KEY environment variable.
# Locally, this fallback is fine for development/demo use.
SECRET_KEY = os.environ.get("SECRET_KEY")

if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is not set")
TOKEN_EXPIRE_HOURS = 12

ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 12
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_token(subject: str, role: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    payload = {"sub": subject, "role": role, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")


def get_current_user(authorization: str = Header(default=None)) -> dict:
    """Reads 'Authorization: Bearer <token>' header and returns the decoded payload."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    return decode_token(token)


def require_admin(user: dict = None):
    if user is None or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
