/* =========================================================================
   SmartRoll — app.js
   Real camera + face-api.js (runs in the browser) + a live FastAPI backend.
   Now course-aware: students enroll in courses, scanning marks attendance
   for a specific course/class, and faculty get a live view during class.
   ========================================================================= */

// ---- Backend address configuration ----
// Default: auto-detects the backend based on how you opened this page.
//   - http://localhost:5500          -> backend at http://localhost:8000
//   - http://192.168.1.5:5500        -> backend at http://192.168.1.5:8000
//     (this is what makes it work from other laptops/phones on the same WiFi)
//
// If you deploy the backend online (e.g. to Render), replace the line
// below with your real backend URL instead, for example:
//   const API_BASE = "https://smartroll-backend.onrender.com";
const API_BASE = `${window.location.protocol}//${window.location.hostname}:8000`;
const MODEL_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js/weights";

let modelsLoadingPromise = null;

// ---------------------------------------------------------------------
// Screen navigation
// ---------------------------------------------------------------------
const screens = document.querySelectorAll(".screen");

function showScreen(id) {
  screens.forEach(s => s.classList.remove("active"));
  const target = document.getElementById(id);
  if (target) target.classList.add("active");
  document.getElementById("sidebar").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });

  if (id !== "register") stopStream(regStream);
  if (id !== "scan") stopStream(scanStream);
  if (id !== "faculty") stopLiveAttendance();

  if (id === "student") loadStudentDashboard();
  if (id === "admin") loadAdminDashboard();
  if (id === "faculty") loadFacultyDashboard();
  if (id === "register") initRegisterCamera();
  if (id === "scan") initScanScreen();
  if (id === "report") loadReportCourseFilter();
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
}

// ---------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------
function saveSession(data) {
  localStorage.setItem("smartroll_token", data.access_token);
  localStorage.setItem("smartroll_role", data.role);
  localStorage.setItem("smartroll_name", data.name);
  localStorage.setItem("smartroll_id", data.id);
}

function getToken() { return localStorage.getItem("smartroll_token"); }
function getRole() { return localStorage.getItem("smartroll_role"); }

function logout() {
  stopLiveAttendance();
  localStorage.removeItem("smartroll_token");
  localStorage.removeItem("smartroll_role");
  localStorage.removeItem("smartroll_name");
  localStorage.removeItem("smartroll_id");
  showScreen("welcome");
}

async function apiFetch(path, options = {}) {
  const headers = options.headers || {};
  headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token) headers["Authorization"] = "Bearer " + token;

  const res = await fetch(API_BASE + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Request failed");
  return data;
}

// ---------------------------------------------------------------------
// API connection check
// ---------------------------------------------------------------------
async function checkApiStatus() {
  const el = document.getElementById("apiStatus");
  try {
    await fetch(API_BASE + "/");
    el.textContent = "✓ Connected to SmartRoll API";
    el.classList.add("api-ok");
  } catch {
    el.textContent = "⚠ Can't reach the backend — start it with: uvicorn main:app --reload --port 8000";
    el.classList.add("api-error");
  }
}

// ---------------------------------------------------------------------
// face-api.js model loading
// ---------------------------------------------------------------------
function loadModels() {
  if (modelsLoadingPromise) return modelsLoadingPromise;
  modelsLoadingPromise = Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
  return modelsLoadingPromise;
}

// ---------------------------------------------------------------------
// Camera helpers
// ---------------------------------------------------------------------
let regStream = null;
let scanStream = null;

async function startCamera(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: {}, audio: false });
  videoEl.srcObject = stream;
  await videoEl.play();
  return stream;
}

function stopStream(stream) {
  if (stream) stream.getTracks().forEach(t => t.stop());
}

async function initRegisterCamera() {
  const video = document.getElementById("regVideo");
  const status = document.getElementById("regStatus");
  try {
    loadModels();
    regStream = await startCamera(video);
  } catch (err) {
    status.textContent = "⚠ Camera access denied or unavailable: " + err.message;
  }
}

/** Populates the course dropdown on the scan screen, then starts the camera. */
async function initScanScreen() {
  const video = document.getElementById("scanVideo");
  const statusEl = document.getElementById("scanStatus");
  const courseSelect = document.getElementById("scanCourseSelect");

  statusEl.textContent = "Loading face models…";

  // Load the student's enrolled courses (falls back to all courses if not logged in as student)
  try {
    const path = getRole() === "student" ? "/api/courses/mine" : "/api/courses";
    const courses = await apiFetch(path);
    courseSelect.innerHTML = courses.length
      ? courses.map(c => `<option value="${c.id}">${c.code} — ${c.name}</option>`).join("")
      : `<option value="">No courses available — enroll first</option>`;
  } catch {
    courseSelect.innerHTML = `<option value="">Log in to see your classes</option>`;
  }

  try {
    await loadModels();
    scanStream = await startCamera(video);
    statusEl.textContent = "Ready — click Start Scan";
  } catch (err) {
    statusEl.textContent = "⚠ " + err.message;
  }
}

async function getFaceDescriptor(videoEl) {
  const detection = await faceapi
    .detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
  return detection ? Array.from(detection.descriptor) : null;
}

// ---------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------
async function captureFace() {
  const name = document.getElementById("regName").value.trim();
  const roll = document.getElementById("regRoll").value.trim();
  const password = document.getElementById("regPassword").value;
  const status = document.getElementById("regStatus");

  if (!name || !roll || !password) {
    status.textContent = "⚠ Please fill in name, roll no, and password.";
    return;
  }

  const video = document.getElementById("regVideo");
  status.textContent = "Detecting face… hold still.";
  await loadModels();
  const descriptor = await getFaceDescriptor(video);

  if (!descriptor) {
    status.textContent = "⚠ No face detected. Make sure your face is clearly visible and try again.";
    return;
  }

  status.textContent = "Registering…";
  try {
    const data = await apiFetch("/api/students/register", {
      method: "POST",
      body: JSON.stringify({ roll_no: roll, name, password, department: "General", face_descriptor: descriptor }),
    });
    saveSession(data);
    status.textContent = "✓ Registered! Redirecting to your dashboard…";
    setTimeout(() => showScreen("student"), 800);
  } catch (err) {
    status.textContent = "⚠ " + err.message;
  }
}

// ---------------------------------------------------------------------
// Logins
// ---------------------------------------------------------------------
async function studentLogin(e) {
  e.preventDefault();
  const roll_no = document.getElementById("studentId").value.trim();
  const password = document.getElementById("studentPassword").value;
  const errorEl = document.getElementById("loginError");
  errorEl.textContent = "";
  try {
    const data = await apiFetch("/api/students/login", { method: "POST", body: JSON.stringify({ roll_no, password }) });
    saveSession(data);
    showScreen("student");
  } catch (err) {
    errorEl.textContent = "⚠ " + err.message;
  }
}

async function adminLogin(e) {
  e.preventDefault();
  const admin_id = document.getElementById("adminId").value.trim();
  const password = document.getElementById("adminPassword").value;
  const errorEl = document.getElementById("adminLoginError");
  errorEl.textContent = "";
  try {
    const data = await apiFetch("/api/admin/login", { method: "POST", body: JSON.stringify({ admin_id, password }) });
    saveSession(data);
    showScreen("admin");
  } catch (err) {
    errorEl.textContent = "⚠ " + err.message;
  }
}

async function facultyLogin(e) {
  e.preventDefault();
  const faculty_id = document.getElementById("facultyIdInput").value.trim();
  const password = document.getElementById("facultyPassword").value;
  const errorEl = document.getElementById("facultyLoginError");
  errorEl.textContent = "";
  try {
    const data = await apiFetch("/api/faculty/login", { method: "POST", body: JSON.stringify({ faculty_id, password }) });
    saveSession(data);
    showScreen("faculty");
  } catch (err) {
    errorEl.textContent = "⚠ " + err.message;
  }
}

// ---------------------------------------------------------------------
// Face scanning + course-aware attendance marking
// ---------------------------------------------------------------------
async function startScan() {
  const bar = document.getElementById("progress");
  const status = document.getElementById("scanStatus");
  const video = document.getElementById("scanVideo");
  const courseId = document.getElementById("scanCourseSelect").value;

  if (!courseId) {
    status.textContent = "⚠ Select a class first";
    return;
  }
  if (!bar || !video.srcObject) {
    status.textContent = "Camera not ready yet…";
    return;
  }

  bar.style.width = "0%";
  status.textContent = "Scanning…";
  bar.style.transition = "width 1.2s ease";
  setTimeout(() => (bar.style.width = "60%"), 100);

  await loadModels();
  const descriptor = await getFaceDescriptor(video);

  if (!descriptor) {
    bar.style.width = "0%";
    status.textContent = "No face detected — try again";
    return;
  }

  bar.style.width = "90%";

  try {
    const result = await apiFetch("/api/attendance/recognize", {
      method: "POST",
      body: JSON.stringify({ course_id: parseInt(courseId, 10), face_descriptor: descriptor }),
    });

    bar.style.width = "100%";

    if (!result.matched) {
      status.textContent = "Face not recognized ✗";
      return;
    }

    status.textContent = "Face matched ✓";
    document.getElementById("confirmName").textContent = result.name;
    document.getElementById("confirmRoll").textContent = result.roll_no;
    document.getElementById("confirmConfidence").textContent = Math.round((result.confidence || 0) * 100) + "%";
    document.getElementById("confirmHeadline").textContent = result.already_marked_today ? "Already Marked Today" : "Attendance Marked!";
    document.getElementById("confirmSub").textContent = result.message;
    document.getElementById("timeNow").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    setTimeout(() => showScreen("confirm"), 400);
  } catch (err) {
    status.textContent = "⚠ " + err.message;
  }
}

// ---------------------------------------------------------------------
// Student dashboard: profile + courses + enrollment
// ---------------------------------------------------------------------
async function loadStudentDashboard() {
  if (getRole() !== "student") return;
  try {
    const me = await apiFetch("/api/students/me");
    document.getElementById("studentName").textContent = me.name;
    document.getElementById("studentRoll").textContent = me.roll_no;
    document.getElementById("studentDept").textContent = me.department;
    document.getElementById("studentDaysPresent").textContent = me.total_days_present;
  } catch (err) { console.error(err); }

  try {
    const myCourses = await apiFetch("/api/courses/mine");
    const myEl = document.getElementById("myCoursesList");
    myEl.innerHTML = myCourses.length
      ? myCourses.map(c => `<p>${c.code} — ${c.name}<span>${c.faculty_name || "No instructor set"}</span></p>`).join("")
      : "<p>Not enrolled in any courses yet — enroll below.</p>";

    const allCourses = await apiFetch("/api/courses");
    const myIds = new Set(myCourses.map(c => c.id));
    const available = allCourses.filter(c => !myIds.has(c.id));
    const selectEl = document.getElementById("allCoursesSelect");
    selectEl.innerHTML = available.length
      ? available.map(c => `<option value="${c.id}">${c.code} — ${c.name}</option>`).join("")
      : `<option value="">Already enrolled in everything</option>`;
  } catch (err) { console.error(err); }

  try {
    const eligibility = await apiFetch("/api/students/me/eligibility");
    document.getElementById("myEligibilityList").innerHTML = eligibility.length
      ? eligibility.map(renderEligibilityRow).join("")
      : "<p>Enroll in a course to start tracking exam eligibility.</p>";
  } catch (err) { console.error(err); }
}

/** Renders one row for a course's attendance % + eligible/not-eligible badge. Used by
 *  both the student's own eligibility view and the faculty/admin roster view. */
function renderEligibilityRow(e) {
  const pct = e.attendance_pct;
  const barColor = pct >= 75 ? "#21b86b" : pct >= 50 ? "#f5a623" : "#ef4444";
  const label = e.course_name ? `${e.course_name}` : `${e.name} <small>(${e.roll_no})</small>`;
  const detail = e.classes_held
    ? `${e.classes_attended}/${e.classes_held} classes`
    : "No classes held yet";

  return `
    <div class="eligibility-row">
      <span>${label}<br><small>${detail}</small></span>
      <span>
        <span class="elig-bar-track"><span class="elig-bar-fill" style="width:${Math.min(pct, 100)}%;background:${barColor}"></span></span>
        ${pct}%
        <span class="badge ${e.eligible ? "badge-eligible" : "badge-ineligible"}">${e.eligible ? "Eligible" : "Not Eligible"}</span>
      </span>
    </div>`;
}

async function enrollInCourse() {
  const select = document.getElementById("allCoursesSelect");
  const status = document.getElementById("enrollStatus");
  const courseId = select.value;
  if (!courseId) { status.textContent = "⚠ Choose a course first"; return; }

  try {
    const result = await apiFetch(`/api/courses/${courseId}/enroll`, { method: "POST" });
    status.textContent = "✓ " + result.message;
    loadStudentDashboard();
  } catch (err) {
    status.textContent = "⚠ " + err.message;
  }
}

// ---------------------------------------------------------------------
// Admin dashboard: stats, course management, student list
// ---------------------------------------------------------------------
async function loadAdminDashboard() {
  if (getRole() !== "admin") return;
  try {
    const summary = await apiFetch("/api/analytics/summary");
    document.getElementById("adminTotalStudents").textContent = summary.total_students;
    document.getElementById("adminPresentToday").textContent = summary.present_today;
    document.getElementById("adminAttendancePct").textContent = summary.average_attendance_pct + "%";

    const students = await apiFetch("/api/students");
    document.getElementById("adminStudentList").innerHTML = students.length
      ? students.map(s => `<p>${s.roll_no} — ${s.name} <span>${s.has_face_sample ? "✓ face on file" : "no face"}</span></p>`).join("")
      : "<p>No students registered yet.</p>";

    const courses = await apiFetch("/api/courses");
    document.getElementById("adminCourseList").innerHTML = courses.length
      ? courses.map(c => `<p>${c.code} — ${c.name} <span>${c.faculty_name || "unassigned"} · ${c.student_count} students</span></p>`).join("")
      : "<p>No courses yet — create one above.</p>";

    const facultyList = await apiFetch("/api/faculty/list");
    const facSelect = document.getElementById("newCourseFaculty");
    facSelect.innerHTML = `<option value="">No faculty assigned</option>` +
      facultyList.map(f => `<option value="${f.id}">${f.name} (${f.faculty_id})</option>`).join("");

    const bulkSelect = document.getElementById("bulkEnrollCourseSelect");
    bulkSelect.innerHTML = courses.length
      ? courses.map(c => `<option value="${c.id}">${c.code} — ${c.name}</option>`).join("")
      : `<option value="">Create a course first</option>`;

    const eligSelect = document.getElementById("adminEligibilityCourseSelect");
    eligSelect.innerHTML = courses.length
      ? courses.map(c => `<option value="${c.id}">${c.code} — ${c.name}</option>`).join("")
      : `<option value="">Create a course first</option>`;
  } catch (err) { console.error(err); }
}

async function createCourse() {
  const code = document.getElementById("newCourseCode").value.trim();
  const name = document.getElementById("newCourseName").value.trim();
  const facultyId = document.getElementById("newCourseFaculty").value;
  const status = document.getElementById("createCourseStatus");

  if (!code || !name) { status.textContent = "⚠ Enter both a course code and name"; return; }

  try {
    await apiFetch("/api/courses", {
      method: "POST",
      body: JSON.stringify({ code, name, faculty_id: facultyId ? parseInt(facultyId, 10) : null }),
    });
    status.textContent = "✓ Course created";
    document.getElementById("newCourseCode").value = "";
    document.getElementById("newCourseName").value = "";
    loadAdminDashboard();
  } catch (err) {
    status.textContent = "⚠ " + err.message;
  }
}

// ---------------------------------------------------------------------
// Faculty dashboard: overview + live attendance polling
// ---------------------------------------------------------------------
let liveAttendanceTimer = null;

async function loadFacultyDashboard() {
  if (getRole() !== "faculty") return;
  try {
    const dash = await apiFetch("/api/faculty/dashboard");
    document.getElementById("facultyName").textContent = dash.faculty_name;
    document.getElementById("facultyTotalCourses").textContent = dash.total_courses;
    document.getElementById("facultyTotalStudents").textContent = dash.total_students;
    document.getElementById("facultyMarkedToday").textContent = dash.todays_classes_marked;

    document.getElementById("facultyCourseList").innerHTML = dash.courses.length
      ? dash.courses.map(c => `<p>${c.code} — ${c.name} <span>${c.student_count} enrolled</span></p>`).join("")
      : "<p>No courses assigned to you yet — ask an admin to assign one.</p>";

    const facBulkSelect = document.getElementById("facultyBulkEnrollCourseSelect");
    facBulkSelect.innerHTML = dash.courses.length
      ? dash.courses.map(c => `<option value="${c.id}">${c.code} — ${c.name}</option>`).join("")
      : `<option value="">No courses assigned yet</option>`;

    const facEligSelect = document.getElementById("facultyEligibilityCourseSelect");
    facEligSelect.innerHTML = dash.courses.length
      ? dash.courses.map(c => `<option value="${c.id}">${c.code} — ${c.name}</option>`).join("")
      : `<option value="">No courses assigned yet</option>`;
  } catch (err) { console.error(err); }
}

/** Shared by both admin and faculty dashboards — pass in the ids of the
 *  course <select>, the roster <textarea>, and the result <div>. */
async function bulkEnroll(courseSelectId, textareaId, resultId) {
  const courseId = document.getElementById(courseSelectId).value;
  const raw = document.getElementById(textareaId).value;
  const resultEl = document.getElementById(resultId);

  if (!courseId) { resultEl.textContent = "⚠ Choose a course first"; return; }

  const rollNumbers = raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  if (!rollNumbers.length) { resultEl.textContent = "⚠ Paste at least one roll number"; return; }

  resultEl.textContent = `Enrolling ${rollNumbers.length} student(s)…`;

  try {
    const result = await apiFetch(`/api/courses/${courseId}/bulk-enroll`, {
      method: "POST",
      body: JSON.stringify({ roll_numbers: rollNumbers }),
    });

    const parts = [];
    if (result.enrolled.length) parts.push(`✓ Enrolled: ${result.enrolled.join(", ")}`);
    if (result.already_enrolled.length) parts.push(`— Already enrolled: ${result.already_enrolled.join(", ")}`);
    if (result.not_found.length) parts.push(`⚠ Not found (ask them to register first): ${result.not_found.join(", ")}`);
    resultEl.innerHTML = parts.map(p => `<div>${p}</div>`).join("") || "Nothing to enroll.";

    document.getElementById(textareaId).value = "";
    if (getRole() === "admin") loadAdminDashboard(); else loadFacultyDashboard();
  } catch (err) {
    resultEl.textContent = "⚠ " + err.message;
  }
}

/** Shared by both admin and faculty dashboards — shows the 75% exam
 *  eligibility roster for whichever course is picked in the given select. */
async function loadCourseEligibility(selectId, resultId) {
  const courseId = document.getElementById(selectId).value;
  const resultEl = document.getElementById(resultId);
  if (!courseId) { resultEl.textContent = "⚠ Choose a course first"; return; }

  resultEl.textContent = "Loading…";
  try {
    const data = await apiFetch(`/api/courses/${courseId}/eligibility`);
    if (!data.students.length) {
      resultEl.innerHTML = "<p>No students enrolled in this course yet.</p>";
      return;
    }
    const header = `<p style="color:var(--muted);font-size:13px;margin-bottom:8px">
      ${data.classes_held} class${data.classes_held === 1 ? "" : "es"} held so far · need ${data.threshold_pct}% to be exam-eligible</p>`;
    resultEl.innerHTML = header + data.students.map(s => renderEligibilityRow({
      ...s, course_name: null,
    })).join("");
  } catch (err) {
    resultEl.textContent = "⚠ " + err.message;
  }
}

async function refreshLiveAttendance() {
  const listEl = document.getElementById("liveAttendanceList");
  try {
    const records = await apiFetch("/api/attendance/report");
    const today = new Date().toISOString().slice(0, 10);
    const todaysRecords = records.filter(r => r.date === today);
    listEl.innerHTML = todaysRecords.length
      ? todaysRecords.map(r => `
          <div class="live-feed-item">
            <span>${r.name} <small>(${r.roll_no})</small></span>
            <span>${r.course_name || "—"} · <small>${new Date(r.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></span>
          </div>`).join("")
      : "<p>No attendance marked yet today.</p>";
  } catch (err) {
    listEl.innerHTML = `<p>⚠ ${err.message}</p>`;
  }
}

function toggleLiveAttendance() {
  const btn = document.getElementById("liveToggleBtn");
  const dot = document.getElementById("liveDot");
  if (liveAttendanceTimer) {
    stopLiveAttendance();
  } else {
    refreshLiveAttendance();
    liveAttendanceTimer = setInterval(refreshLiveAttendance, 5000);
    btn.textContent = "Stop Live View";
    dot.classList.add("on");
  }
}

function stopLiveAttendance() {
  if (liveAttendanceTimer) {
    clearInterval(liveAttendanceTimer);
    liveAttendanceTimer = null;
    const btn = document.getElementById("liveToggleBtn");
    const dot = document.getElementById("liveDot");
    if (btn) btn.textContent = "Start Live View";
    if (dot) dot.classList.remove("on");
  }
}

// ---------------------------------------------------------------------
// Attendance report (admin or faculty) — course filterable
// ---------------------------------------------------------------------
async function loadReportCourseFilter() {
  if (!["admin", "faculty"].includes(getRole())) return;
  try {
    const courses = getRole() === "faculty" ? await apiFetch("/api/courses/mine") : await apiFetch("/api/courses");
    const select = document.getElementById("reportCourseSelect");
    select.innerHTML = `<option value="">All courses</option>` +
      courses.map(c => `<option value="${c.id}">${c.code} — ${c.name}</option>`).join("");
  } catch (err) { console.error(err); }
}

async function generateReport() {
  const start = document.getElementById("reportStart").value;
  const end = document.getElementById("reportEnd").value;
  const courseId = document.getElementById("reportCourseSelect").value;
  const body = document.getElementById("reportBody");
  body.innerHTML = `<tr><td colspan="7">Loading…</td></tr>`;

  const params = new URLSearchParams();
  if (start) params.append("start", start);
  if (end) params.append("end", end);
  if (courseId) params.append("course_id", courseId);

  try {
    const records = await apiFetch("/api/attendance/report?" + params.toString());
    if (!records.length) {
      body.innerHTML = `<tr><td colspan="7">No attendance records found for this range.</td></tr>`;
      return;
    }
    body.innerHTML = records.map(r => `
      <tr>
        <td>${r.roll_no}</td>
        <td>${r.name}</td>
        <td>${r.course_name || "—"}</td>
        <td>${r.date}</td>
        <td>${new Date(r.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
        <td>${r.status}</td>
        <td>${r.confidence != null ? Math.round(r.confidence * 100) + "%" : "—"}</td>
      </tr>
    `).join("");
  } catch (err) {
    body.innerHTML = `<tr><td colspan="7">⚠ ${err.message}</td></tr>`;
  }
}

// ---------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  checkApiStatus();
});
