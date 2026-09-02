# SmartRoll — Real Classroom Attendance System

A working attendance system with:
- **Real camera + face recognition** (face-api.js, runs in the browser)
- **Real backend** (FastAPI + SQLite locally / PostgreSQL when deployed)
- **Courses & faculty** — attendance tracked per class
- **Live view** — faculty watch attendance come in during class
- **Bulk enrollment** — paste a class roster to enroll everyone at once
- **75% exam eligibility** — automatically flags students below the attendance threshold

## Folder structure
```
SmartRoll-Beginner-FINAL/
├── backend/       # FastAPI + SQLAlchemy
├── public/        # HTML/CSS/JS frontend
└── DEPLOY.md       # Step-by-step guide to host this online for free
```

## Running locally
```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
In a second terminal:
```bash
cd public
python -m http.server 5500
```
Open **http://localhost:5500**.

Seeded demo accounts: **Admin** `admin`/`admin123` · **Faculty** `faculty1`/`faculty123`

## Hosting it online (so students can use it from anywhere)
See **DEPLOY.md** for the full walkthrough. Short version: free Postgres
database on Supabase + free backend hosting on Render + free frontend
hosting on Netlify.

## Exam eligibility (75% rule)
"Classes held" for a course = the number of distinct days attendance was
taken for it. A student's eligibility = (days they were present ÷ classes
held) × 100. Below 75% shows as "Not Eligible" — visible on the student's
own dashboard and on a searchable roster for faculty/admin.

## What's still simplified
- Face matching threshold is a simple distance cutoff (0.55) — good for
  classroom use, no liveness detection (a photo could fool it).
- "Live" updates poll every 5 seconds, not instant push.
- No password-reset flow yet.
