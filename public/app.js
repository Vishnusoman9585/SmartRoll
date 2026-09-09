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
const API_BASE = "https://smartroll-backend-u26h.onrender.com";
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
    : "No