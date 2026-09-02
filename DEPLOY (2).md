# Deploying SmartRoll Online (Free)

This puts your app on the real internet so any student's laptop or phone
can reach it with a link — not just devices on your WiFi.

**The three free services you'll use:**
| Service | What it hosts | Why |
|---|---|---|
| [Supabase](https://supabase.com) | Your database | Free Postgres that doesn't wipe your data on restart (unlike SQLite on most free hosts) |
| [Render](https://render.com) | Your backend (FastAPI) | Free web service hosting, deploys straight from GitHub |
| [Netlify](https://netlify.com) | Your frontend (HTML/JS) | Free static hosting, drag-and-drop deploy |

**Honest limitation:** free Render backends "sleep" after 15 minutes of no
traffic and take ~30-60 seconds to wake up on the next request — so the
first scan of the day might feel slow. Free Supabase projects pause after
7 days of *total* inactivity (one click to resume, no data lost). For a
class that meets regularly, this is a non-issue.

---

## Phase 1 — Create your database (Supabase)

1. Go to supabase.com and sign up (free, no card required).
2. Click **New Project**. Pick any name (e.g. "smartroll"), set a database
   password (**save it somewhere** — you'll need it), pick the region
   closest to you, click **Create new project**. Wait ~2 minutes.
3. Once it's ready, go to **Project Settings → Database**.
4. Under **Connection string**, choose the **URI** tab and copy it. It
   looks like:
   `postgresql://postgres:[YOUR-PASSWORD]@db.xxxx.supabase.co:5432/postgres`
5. Replace `[YOUR-PASSWORD]` in that string with the real password you set
   in step 2. **Save this full string** — it's your `DATABASE_URL`, needed
   in Phase 2.

## Phase 2 — Deploy the backend (Render)

1. Put your project on GitHub: go to github.com, sign up if needed, click
   **New repository**, name it `smartroll`, and upload your whole
   `SmartRoll-Beginner-FINAL` folder to it (the "uploading an existing
   file" option in GitHub's web UI works for this — drag the folder in).
2. Go to render.com and sign up (you can sign up with your GitHub account
   — this also connects them automatically).
3. Click **New → Web Service**, pick your `smartroll` repo.
4. Fill in:
   - **Root Directory:** `backend`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type:** Free
5. Under **Environment Variables**, add:
   - `DATABASE_URL` = the connection string you saved from Phase 1
   - `SECRET_KEY` = any random long string you make up (e.g. mash your
     keyboard for 40 characters) — this signs login tokens
6. Click **Create Web Service**. Wait for the build to finish (a few
   minutes). You'll get a URL like `https://smartroll-xxxx.onrender.com`.
7. Visit `https://smartroll-xxxx.onrender.com/docs` to confirm it's alive
   — you should see the interactive API docs page.

## Phase 3 — Deploy the frontend (Netlify)

1. Open `public/app.js` and find this line near the top:
   ```js
   const API_BASE = `${window.location.protocol}//${window.location.hostname}:8000`;
   ```
   Replace it with your actual Render URL from Phase 2:
   ```js
   const API_BASE = "https://smartroll-xxxx.onrender.com";
   ```
2. Save the file, and update it on GitHub too (upload the changed file
   again, or push via git if you're comfortable with that).
3. Go to netlify.com and sign up (free).
4. On the dashboard, find **"Deploy manually"** / drag-and-drop area, and
   drag your local `public` folder onto it.
5. Netlify gives you a link like `https://smartroll-demo.netlify.app` —
   **this is the link you share with your class.**

## Phase 4 — Test it

1. Open your Netlify link on your own phone (use mobile data, not WiFi,
   to prove it's really on the internet).
2. Check the welcome screen says "✓ Connected to SmartRoll API". If it
   doesn't, double check the `API_BASE` value in `app.js` exactly matches
   your Render URL (no trailing slash).
3. Register a face, enroll in a course, mark attendance — same as testing
   locally.

## Updating the app later
Whenever you change backend code: upload the changed files to GitHub —
Render redeploys automatically. Whenever you change frontend code:
re-drag the `public` folder onto Netlify.
