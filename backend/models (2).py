"""
models.py
---------
SQLAlchemy ORM models = the database tables.

Student.face_descriptor stores the 128-number "face fingerprint" that
face-api.js generates in the browser, saved as a JSON string like
"[0.0123, -0.0456, ...]". We never store raw face photos, which keeps
things lighter and more private.
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, Date, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base


class Student(Base):
    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    roll_no = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    department = Column(String, default="General")
    password_hash = Column(String, nullable=False)
    face_descriptor = Column(Text, nullable=True)  # JSON array of 128 floats
    created_at = Column(DateTime, default=datetime.utcnow)

    attendance_records = relationship("Attendance", back_populates="student")
    enrollments = relationship("Enrollment", back_populates="student")


class Admin(Base):
    __tablename__ = "admins"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, default="Admin")
    password_hash = Column(String, nullable=False)


class Faculty(Base):
    __tablename__ = "faculty"

    id = Column(Integer, primary_key=True, index=True)
    faculty_id = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)

    courses = relationship("Course", back_populates="faculty")


class Course(Base):
    __tablename__ = "courses"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=False)  # e.g. "CS301"
    name = Column(String, nullable=False)  # e.g. "Data Structures"
    faculty_id = Column(Integer, ForeignKey("faculty.id"), nullable=True)

    faculty = relationship("Faculty", back_populates="courses")
    enrollments = relationship("Enrollment", back_populates="course")
    attendance_records = relationship("Attendance", back_populates="course")


class Enrollment(Base):
    """Links a student to a course they're taking."""
    __tablename__ = "enrollments"
    __table_args__ = (UniqueConstraint("student_id", "course_id", name="uq_student_course"),)

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    student = relationship("Student", back_populates="enrollments")
    course = relationship("Course", back_populates="enrollments")


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (UniqueConstraint("student_id", "course_id", "date", name="uq_student_course_date"),)

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True)  # nullable = legacy/general attendance
    date = Column(Date, default=lambda: datetime.utcnow().date(), index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    status = Column(String, default="present")  # present / late / absent
    confidence = Column(Float, nullable=True)  # how close the face match was

    student = relationship("Student", back_populates="attendance_records")
    course = relationship("Course", back_populates="attendance_records")
