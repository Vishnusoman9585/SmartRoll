"""
main.py
-------
The FastAPI application. Run it with:

    uvicorn main:app --reload --port 8000

Then open http://localhost:8000/docs to see (and test) every endpoint
in an interactive UI — very useful while building the frontend.
"""
import json
from datetime import datetime, date as date_type
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import Base, engine, get_db
import models
import schemas
from auth import (
    hash_password, verify_password, create_token, get_current_user, require_admin
)

# Create all tables on startup (SQLite file smartroll.db is created automatically)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="SmartRoll API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Distance below which two face descriptors are considered "the same person".
FACE_MATCH_THRESHOLD = 0.55


@app.on_event("startup")
def seed_demo_data():
    """Creates a default admin, a demo faculty, and a demo course the first time the app runs."""
    db = next(get_db())

    if not db.query(models.Admin).filter_by(admin_id="admin").first():
        db.add(models.Admin(admin_id="admin", name="Super Admin", password_hash=hash_password("admin123")))

    if not db.query(models.Faculty).filter_by(faculty_id="faculty1").first():
        db.add(models.Faculty(faculty_id="faculty1", name="Dr. Smith", password_hash=hash_password("faculty123")))

    db.commit()

    faculty = db.query(models.Faculty).filter_by(faculty_id="faculty1").first()
    if not db.query(models.Course).filter_by(code="CS101").first():
        db.add(models.Course(code="CS101", name="Intro to Computer Science", faculty_id=faculty.id))
        db.commit()


def require_role(user: dict, role: str):
    if user.get("role") != role:
        raise HTTPException(status_code=403, detail=f"{role.capitalize()} access required")


def require_admin_or_faculty(user: dict):
    if user.get("role") not in ("admin", "faculty"):
        raise HTTPException(status_code=403, detail="Admin or faculty access required")


# ---------------------------------------------------------------------------
# Student registration & login
# ---------------------------------------------------------------------------

@app.post("/api/students/register", response_model=schemas.TokenResponse)
def register_student(payload: schemas.StudentRegister, db: Session = Depends(get_db)):
    existing = db.query(models.Student).filter_by(roll_no=payload.roll_no).first()
    if existing:
        raise HTTPException(status_code=400, detail="A student with this Roll No already exists")

    student = models.Student(
        roll_no=payload.roll_no,
        name=payload.name,
        department=payload.department,
        password_hash=hash_password(payload.password),
        face_descriptor=json.dumps(payload.face_descriptor),
    )
    db.add(student)
    db.commit()
    db.refresh(student)

    token = create_token(subject=str(student.id), role="student")
    return schemas.TokenResponse(access_token=token, role="student", name=student.name, id=student.id)


@app.post("/api/students/login", response_model=schemas.TokenResponse)
def login_student(payload: schemas.StudentLogin, db: Session = Depends(get_db)):
    student = db.query(models.Student).filter_by(roll_no=payload.roll_no).first()
    if not student or not verify_password(payload.password, student.password_hash):
        raise HTTPException(status_code=401, detail="Invalid Roll No or password")

    token = create_token(subject=str(student.id), role="student")
    return schemas.TokenResponse(access_token=token, role="student", name=student.name, id=student.id)


# ---------------------------------------------------------------------------
# Admin & faculty login
# ---------------------------------------------------------------------------

@app.post("/api/admin/login", response_model=schemas.TokenResponse)
def login_admin(payload: schemas.AdminLogin, db: Session = Depends(get_db)):
    admin = db.query(models.Admin).filter_by(admin_id=payload.admin_id).first()
    if not admin or not verify_password(payload.password, admin.password_hash):
        raise HTTPException(status_code=401, detail="Invalid Admin ID or password")

    token = create_token(subject=str(admin.id), role="admin")
    return schemas.TokenResponse(access_token=token, role="admin", name=admin.name, id=admin.id)


@app.post("/api/faculty/login", response_model=schemas.TokenResponse)
def login_faculty(payload: schemas.FacultyLogin, db: Session = Depends(get_db)):
    faculty = db.query(models.Faculty).filter_by(faculty_id=payload.faculty_id).first()
    if not faculty or not verify_password(payload.password, faculty.password_hash):
        raise HTTPException(status_code=401, detail="Invalid Faculty ID or password")

    token = create_token(subject=str(faculty.id), role="faculty")
    return schemas.TokenResponse(access_token=token, role="faculty", name=faculty.name, id=faculty.id)


# ---------------------------------------------------------------------------
# Courses (admin creates/manages, faculty & students read)
# ---------------------------------------------------------------------------

def _course_to_out(db: Session, course: models.Course) -> schemas.CourseOut:
    student_count = db.query(models.Enrollment).filter_by(course_id=course.id).count()
    return schemas.CourseOut(
        id=course.id, code=course.code, name=course.name,
        faculty_name=course.faculty.name if course.faculty else None,
        student_count=student_count,
    )


@app.post("/api/courses", response_model=schemas.CourseOut)
def create_course(payload: schemas.CourseCreate, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    require_role(user, "admin")
    if db.query(models.Course).filter_by(code=payload.code).first():
        raise HTTPException(status_code=400, detail="A course with this code already exists")
    course = models.Course(code=payload.code, name=payload.name, faculty_id=payload.faculty_id)
    db.add(course)
    db.commit()
    db.refresh(course)
    return _course_to_out(db, course)


@app.get("/api/courses", response_model=List[schemas.CourseOut])
def list_all_courses(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Any logged-in role can see the full course catalog (e.g. so students can enroll)."""
    courses = db.query(models.Course).all()
    return [_course_to_out(db, c) for c in courses]


@app.get("/api/faculty/list", response_model=List[schemas.FacultyOut])
def list_faculty(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    require_role(user, "admin")
    return db.query(models.Faculty).all()


@app.get("/api/courses/mine", response_model=List[schemas.CourseOut])
def my_courses(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """For faculty: courses they teach. For students: courses they're enrolled in."""
    if user["role"] == "faculty":
        courses = db.query(models.Course).filter_by(faculty_id=int(user["sub"])).all()
        return [_course_to_out(db, c) for c in courses]
    elif user["role"] == "student":
        enrollments = db.query(models.Enrollment).filter_by(student_id=int(user["sub"])).all()
        return [_course_to_out(db, e.course) for e in enrollments]
    raise HTTPException(status_code=403, detail="Not applicable for this role")


@app.post("/api/courses/{course_id}/enroll")
def enroll_self(course_id: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """A logged-in student enrolls themself in a course."""
    require_role(user, "student")
    course = db.query(models.Course).get(course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    existing = db.query(models.Enrollment).filter_by(student_id=int(user["sub"]), course_id=course_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Already enrolled in this course")

    db.add(models.Enrollment(student_id=int(user["sub"]), course_id=course_id))
    db.commit()
    return {"message": f"Enrolled in {course.name}"}


@app.post("/api/courses/{course_id}/bulk-enroll", response_model=schemas.BulkEnrollResult)
def bulk_enroll(course_id: int, payload: schemas.BulkEnrollRequest, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """
    Admin or faculty pastes a whole class roster (one roll number per line)
    and everyone who's already registered their face gets enrolled at once.
    Roll numbers that don't match any registered student are reported back
    so the teacher knows who still needs to register.
    """
    require_admin_or_faculty(user)
    course = db.query(models.Course).get(course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if user["role"] == "faculty" and course.faculty_id != int(user["sub"]):
        raise HTTPException(status_code=403, detail="You can only manage your own courses")

    enrolled, already_enrolled, not_found = [], [], []
    seen_in_this_batch = set()

    for raw in payload.roll_numbers:
        roll = raw.strip()
        if not roll or roll in seen_in_this_batch:
            continue
        seen_in_this_batch.add(roll)

        student = db.query(models.Student).filter_by(roll_no=roll).first()
        if not student:
            not_found.append(roll)
            continue
        existing = db.query(models.Enrollment).filter_by(student_id=student.id, course_id=course_id).first()
        if existing:
            already_enrolled.append(roll)
            continue
        db.add(models.Enrollment(student_id=student.id, course_id=course_id))
        enrolled.append(roll)

    db.commit()
    return schemas.BulkEnrollResult(enrolled=enrolled, already_enrolled=already_enrolled, not_found=not_found)


@app.get("/api/courses/{course_id}/students", response_model=List[schemas.StudentOut])
def course_roster(course_id: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    require_admin_or_faculty(user)
    enrollments = db.query(models.Enrollment).filter_by(course_id=course_id).all()
    return [
        schemas.StudentOut(
            id=e.student.id, roll_no=e.student.roll_no, name=e.student.name,
            department=e.student.department, has_face_sample=bool(e.student.face_descriptor),
        ) for e in enrollments
    ]


# ---------------------------------------------------------------------------
# Face recognition + per-course attendance marking
# ---------------------------------------------------------------------------

@app.post("/api/attendance/recognize", response_model=schemas.RecognizeResponse)
def recognize_and_mark(payload: schemas.RecognizeRequest, db: Session = Depends(get_db)):
    """
    Receives a 128-number face descriptor + a course_id, compares the
    descriptor against every registered student's stored descriptor
    (Euclidean distance), and marks attendance FOR THAT COURSE if the
    closest match is within FACE_MATCH_THRESHOLD.
    """
    course = db.query(models.Course).get(payload.course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    incoming = np.array(payload.face_descriptor)
    students = db.query(models.Student).filter(models.Student.face_descriptor.isnot(None)).all()
    if not students:
        return schemas.RecognizeResponse(matched=False, message="No registered faces yet")

    best_student = None
    best_distance = float("inf")
    for student in students:
        stored = np.array(json.loads(student.face_descriptor))
        distance = float(np.linalg.norm(incoming - stored))
        if distance < best_distance:
            best_distance = distance
            best_student = student

    if best_student is None or best_distance > FACE_MATCH_THRESHOLD:
        return schemas.RecognizeResponse(matched=False, message="Face not recognized. Try registering first.")

    today = date_type.today()
    already = db.query(models.Attendance).filter_by(
        student_id=best_student.id, course_id=course.id, date=today
    ).first()

    if already:
        return schemas.RecognizeResponse(
            matched=True, student_id=best_student.id, name=best_student.name, roll_no=best_student.roll_no,
            confidence=round(1 - best_distance, 3), already_marked_today=True,
            message=f"{best_student.name} already marked present in {course.name} today",
        )

    record = models.Attendance(
        student_id=best_student.id, course_id=course.id, date=today,
        status="present", confidence=round(1 - best_distance, 3),
    )
    db.add(record)
    db.commit()

    return schemas.RecognizeResponse(
        matched=True, student_id=best_student.id, name=best_student.name, roll_no=best_student.roll_no,
        confidence=round(1 - best_distance, 3), already_marked_today=False,
        message=f"Attendance marked for {best_student.name} in {course.name}",
    )


# ---------------------------------------------------------------------------
# Students list (admin) & self profile
# ---------------------------------------------------------------------------

@app.get("/api/students", response_model=List[schemas.StudentOut])
def list_students(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    require_admin_or_faculty(user)
    students = db.query(models.Student).all()
    return [
        schemas.StudentOut(
            id=s.id, roll_no=s.roll_no, name=s.name, department=s.department,
            has_face_sample=bool(s.face_descriptor),
        ) for s in students
    ]


@app.get("/api/students/me")
def my_profile(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    require_role(user, "student")
    student = db.query(models.Student).get(int(user["sub"]))
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    total_days = db.query(models.Attendance).filter_by(student_id=student.id).count()
    return {
        "id": student.id, "roll_no": student.roll_no, "name": student.name,
        "department": student.department, "total_days_present": total_days,
    }


# ---------------------------------------------------------------------------
# Attendance report & analytics (course-aware)
# ---------------------------------------------------------------------------

@app.get("/api/attendance/report", response_model=List[schemas.AttendanceRecord])
def attendance_report(
    start: Optional[str] = None, end: Optional[str] = None, course_id: Optional[int] = None,
    db: Session = Depends(get_db), user: dict = Depends(get_current_user),
):
    require_admin_or_faculty(user)
    query = db.query(models.Attendance).join(models.Student)

    # Faculty can only see their own courses' records
    if user["role"] == "faculty":
        faculty_course_ids = [c.id for c in db.query(models.Course).filter_by(faculty_id=int(user["sub"])).all()]
        query = query.filter(models.Attendance.course_id.in_(faculty_course_ids))

    if course_id:
        query = query.filter(models.Attendance.course_id == course_id)
    if start:
        query = query.filter(models.Attendance.date >= datetime.strptime(start, "%Y-%m-%d").date())
    if end:
        query = query.filter(models.Attendance.date <= datetime.strptime(end, "%Y-%m-%d").date())

    records = query.order_by(models.Attendance.timestamp.desc()).all()
    return [
        schemas.AttendanceRecord(
            id=r.id, student_id=r.student_id, name=r.student.name, roll_no=r.student.roll_no,
            course_id=r.course_id, course_name=r.course.name if r.course else None,
            date=r.date, timestamp=r.timestamp, status=r.status, confidence=r.confidence,
        ) for r in records
    ]


@app.get("/api/analytics/summary", response_model=schemas.AnalyticsSummary)
def analytics_summary(course_id: Optional[int] = None, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    require_admin_or_faculty(user)
    today = date_type.today()

    if course_id:
        total_students = db.query(models.Enrollment).filter_by(course_id=course_id).count()
        total_records = db.query(models.Attendance).filter_by(course_id=course_id).count()
        present_today = db.query(models.Attendance).filter_by(course_id=course_id, date=today).count()
    else:
        total_students = db.query(models.Student).count()
        total_records = db.query(models.Attendance).count()
        present_today = db.query(models.Attendance).filter_by(date=today).count()

    avg_pct = round((present_today / total_students) * 100, 1) if total_students else 0.0

    return schemas.AnalyticsSummary(
        total_students=total_students, total_attendance_records=total_records,
        present_today=present_today, average_attendance_pct=avg_pct,
    )


# ---------------------------------------------------------------------------
# Faculty dashboard
# ---------------------------------------------------------------------------

@app.get("/api/faculty/dashboard", response_model=schemas.FacultyDashboard)
def faculty_dashboard(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    require_role(user, "faculty")
    faculty = db.query(models.Faculty).get(int(user["sub"]))
    courses = db.query(models.Course).filter_by(faculty_id=faculty.id).all()
    course_ids = [c.id for c in courses]

    total_students = db.query(models.Enrollment).filter(models.Enrollment.course_id.in_(course_ids)).count() if course_ids else 0
    today = date_type.today()
    todays_marked = db.query(models.Attendance).filter(
        models.Attendance.course_id.in_(course_ids), models.Attendance.date == today
    ).count() if course_ids else 0

    return schemas.FacultyDashboard(
        faculty_name=faculty.name,
        total_courses=len(courses),
        total_students=total_students,
        todays_classes_marked=todays_marked,
        courses=[_course_to_out(db, c) for c in courses],
    )


@app.get("/")
def root():
    return {"message": "SmartRoll API is running. Visit /docs for interactive API docs."}


# ---------------------------------------------------------------------------
# Exam eligibility (75% attendance rule)
# ---------------------------------------------------------------------------

ELIGIBILITY_THRESHOLD_PCT = 75.0


def _classes_held_for_course(db: Session, course_id: int) -> int:
    """
    A 'class held' = a distinct date on which at least one student was
    marked present for this course. This is a simple, real-data-driven way
    to estimate total sessions without needing a separate class-schedule
    model.
    """
    return (
        db.query(models.Attendance.date)
        .filter(models.Attendance.course_id == course_id)
        .distinct()
        .count()
    )


@app.get("/api/courses/{course_id}/eligibility", response_model=schemas.CourseEligibility)
def course_eligibility(course_id: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """For faculty/admin: exam eligibility (75% rule) for every student enrolled in a course."""
    require_admin_or_faculty(user)
    course = db.query(models.Course).get(course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    if user["role"] == "faculty" and course.faculty_id != int(user["sub"]):
        raise HTTPException(status_code=403, detail="You don't teach this course")

    classes_held = _classes_held_for_course(db, course_id)
    enrollments = db.query(models.Enrollment).filter_by(course_id=course_id).all()

    students_out = []
    for e in enrollments:
        attended = db.query(models.Attendance).filter_by(student_id=e.student_id, course_id=course_id).count()
        pct = round((attended / classes_held) * 100, 1) if classes_held else 0.0
        students_out.append(schemas.StudentEligibility(
            student_id=e.student.id, roll_no=e.student.roll_no, name=e.student.name,
            classes_held=classes_held, classes_attended=attended, attendance_pct=pct,
            # Nobody is unfairly flagged before any class has actually happened yet
            eligible=(pct >= ELIGIBILITY_THRESHOLD_PCT) if classes_held else True,
        ))

    # Sort lowest attendance first so at-risk students are easy to spot
    students_out.sort(key=lambda s: s.attendance_pct)

    return schemas.CourseEligibility(
        course_id=course.id, course_name=course.name, classes_held=classes_held,
        threshold_pct=ELIGIBILITY_THRESHOLD_PCT, students=students_out,
    )


@app.get("/api/students/me/eligibility", response_model=List[schemas.MyEligibility])
def my_eligibility(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """For a logged-in student: their own exam eligibility across every enrolled course."""
    require_role(user, "student")
    student_id = int(user["sub"])
    enrollments = db.query(models.Enrollment).filter_by(student_id=student_id).all()

    results = []
    for e in enrollments:
        classes_held = _classes_held_for_course(db, e.course_id)
        attended = db.query(models.Attendance).filter_by(student_id=student_id, course_id=e.course_id).count()
        pct = round((attended / classes_held) * 100, 1) if classes_held else 0.0
        results.append(schemas.MyEligibility(
            course_id=e.course.id, course_name=e.course.name, classes_held=classes_held,
            classes_attended=attended, attendance_pct=pct,
            eligible=(pct >= ELIGIBILITY_THRESHOLD_PCT) if classes_held else True,
            threshold_pct=ELIGIBILITY_THRESHOLD_PCT,
        ))
    return results
