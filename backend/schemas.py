"""
schemas.py
----------
Pydantic models define the "shape" of JSON going in and out of the API.
FastAPI uses these to validate requests automatically and to generate
the interactive docs at /docs.
"""
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, date


class StudentRegister(BaseModel):
    roll_no: str
    name: str
    password: str
    department: str = "General"
    face_descriptor: List[float] = Field(..., min_items=128, max_items=128)


class StudentLogin(BaseModel):
    roll_no: str
    password: str


class AdminLogin(BaseModel):
    admin_id: str
    password: str


class FacultyLogin(BaseModel):
    faculty_id: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    name: str
    id: int


class CourseCreate(BaseModel):
    code: str
    name: str
    faculty_id: Optional[int] = None


class CourseOut(BaseModel):
    id: int
    code: str
    name: str
    faculty_name: Optional[str] = None
    student_count: int = 0

    class Config:
        from_attributes = True


class EnrollRequest(BaseModel):
    roll_no: str


class BulkEnrollRequest(BaseModel):
    roll_numbers: List[str]


class BulkEnrollResult(BaseModel):
    enrolled: List[str]
    already_enrolled: List[str]
    not_found: List[str]


class RecognizeRequest(BaseModel):
    course_id: int
    face_descriptor: List[float] = Field(..., min_items=128, max_items=128)


class RecognizeResponse(BaseModel):
    matched: bool
    student_id: Optional[int] = None
    name: Optional[str] = None
    roll_no: Optional[str] = None
    confidence: Optional[float] = None
    already_marked_today: bool = False
    message: str


class AttendanceRecord(BaseModel):
    id: int
    student_id: int
    name: str
    roll_no: str
    course_id: Optional[int] = None
    course_name: Optional[str] = None
    date: date
    timestamp: datetime
    status: str
    confidence: Optional[float] = None

    class Config:
        from_attributes = True


class StudentOut(BaseModel):
    id: int
    roll_no: str
    name: str
    department: str
    has_face_sample: bool

    class Config:
        from_attributes = True


class AnalyticsSummary(BaseModel):
    total_students: int
    total_attendance_records: int
    present_today: int
    average_attendance_pct: float


class FacultyOut(BaseModel):
    id: int
    faculty_id: str
    name: str

    class Config:
        from_attributes = True


class FacultyDashboard(BaseModel):
    faculty_name: str
    total_courses: int
    total_students: int
    todays_classes_marked: int
    courses: List[CourseOut]


class StudentEligibility(BaseModel):
    student_id: int
    roll_no: str
    name: str
    classes_held: int
    classes_attended: int
    attendance_pct: float
    eligible: bool


class CourseEligibility(BaseModel):
    course_id: int
    course_name: str
    classes_held: int
    threshold_pct: float
    students: List[StudentEligibility]


class MyEligibility(BaseModel):
    course_id: int
    course_name: str
    classes_held: int
    classes_attended: int
    attendance_pct: float
    eligible: bool
    threshold_pct: float
