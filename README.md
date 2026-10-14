# 🎓 AI-Based Real-Time Human Detection & Tracking System

> **Smart Classroom AI** — Remote smartphone camera streaming, real-time human detection (Ultralytics YOLOv8), multi-person tracking (ByteTrack), virtual tripwire line crossing, zone occupancy counting, and an administrative monitoring dashboard.

---

## 🏆 All 8 Project Phases Completed & Operational

- [x] **Phase 1: Project Setup & Monorepo Architecture**
  - Node.js/Express REST backend with JWT authentication, role guards (`admin`, `operator`), and MongoDB Mongoose models (`User`, `CameraSession`, `DetectionEvent`, `SystemSetting`).
  - React 18 + Vite dashboard frontend with dark-themed glassmorphism, responsive drawer navigation, and seeded admin credentials.
- [x] **Phase 2: Smartphone Camera Interface & Media Capture**
  - Mobile operator view (`/camera/:sessionId`) utilizing `navigator.mediaDevices.getUserMedia`.
  - Camera device enumeration, seamless front/user and rear/environment camera toggling via RTCPeerConnection track replacement, torch/flashlight toggle, and framing grid overlay.
- [x] **Phase 3: WebRTC P2P Live Video Transmission**
  - Low-latency WebRTC peer-to-peer live media streaming directly from smartphone to admin dashboard.
  - Socket.IO signaling server managing SDP offers, answers, and ICE candidate exchanges.
  - Multi-viewer architecture supporting simultaneous administrative observation.
- [x] **Phase 4: AI Microservice & YOLOv8 Human Detection**
  - Dedicated Python 3.10 FastAPI computer vision microservice (`http://localhost:8000`).
  - Ultralytics YOLOv8n detector strictly restricted to the `person` class (COCO class ID 0).
  - High-precision confidence filtering and normalized/pixel coordinate extraction.
- [x] **Phase 5: Real-Time Frame Extraction & Canvas Bounding Boxes**
  - Client-side offscreen canvas frame sampler operating at ~3.5–5 FPS with dynamic aspect ratio preservation.
  - Neon visual bounding boxes, confidence percentage badges, and real-time people count HUD overlaid onto the live WebRTC feed.
  - Detection event persistence to MongoDB for historical tracking.
- [x] **Phase 6: Multi-Person Tracking & Spatial Analytics**
  - Persistent ID tracking powered by ByteTrack (Kalman Filter state estimation + two-stage Hungarian algorithm association).
  - Trajectory movement breadcrumbs with unique golden-angle HSL color coding per person.
  - Bidirectional virtual tripwire line crossing detection (`▲ IN` / `▼ OUT` entrance/exit counters).
  - Configurable virtual monitored zone occupancy detection.
- [x] **Phase 7: Live Statistics, Lifecycle Management & Historical Audit Logs**
  - Socket.IO bi-directional metric broadcasting for live dashboard stats (occupancy cards, hourly bar charts).
  - Event log query engine with multi-criteria filtering (Session, Min Occupancy, Date Range).
  - Expandable row drawer for bounding box coordinate inspection.
  - One-click CSV and JSON report exports and batch pruning controls.
- [x] **Phase 8: Production Hardening, Privacy Governance & Deployment**
  - Security hardening with `helmet`, `cors`, and `express-rate-limit` (brute-force defense on auth and API flooding protection).
  - Dynamic system settings synchronization (`GET /api/settings`, `PUT /api/settings`).
  - Complete Docker Compose multi-container deployment orchestration (`mongodb`, `backend`, `frontend`, `ai-service`).
- [x] **⭐ Biometric Face Recognition Upgrade (Complete & Tested)**
  - **Student Directory**: Student registration with full name, roll number, registration number, department, semester, class, and consented photo uploads (`/students`).
  - **Face Enrollment Engine**: OpenCV Zoo YuNet face detector + SFace ArcFace 128-d normalized embedding extraction with single-person validation.
  - **Sub-Millisecond Vector Gallery**: Vectorized cosine similarity matching with 0.363 FAR threshold, ambiguity margin safeguards, and backend gallery auto-sync.
  - **Tracking Pipeline Integration**: Upper-torso head cropping on YOLOv8/ByteTrack bounding boxes with per-track identity caching for real-time 4–5 FPS performance.
  - **Live Monitoring HUD & Roster**: Student name and roll number overlays above bounding boxes, glowing face bracket markers, live Identified Students sidebar roster, and real-time recognition audit events.
  - **Biometric Governance**: Admin biometrics wipe, 30-day auto-pruning TTL index on `RecognitionEvent`, and zero raw video storage.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────┐
│     Smartphone Operator         │
│  (React PWA / Mobile Browser)   │
└──────────────┬──────────────────┘
               │ 1. WebRTC Signaling (Socket.IO)
               ▼
┌─────────────────────────────────┐           ┌─────────────────────────────┐
│    Node.js / Express Backend    │           │       MongoDB 7.0           │
│   (Port 5000: Auth, Sessions,   ├──────────►│  (Users, Sessions, Events,  │
│     Signaling & Settings)       │           │     TTL Auto-Expiry)        │
└──────────────┬──────────────────┘           └─────────────────────────────┘
               │
               │ 2. Direct WebRTC P2P Media Stream (SRTP Video)
               ▼
┌─────────────────────────────────┐
│    Admin Live Monitoring        │
│  (React 18 + Canvas HUD: 5173)  │
└──────────────┬──────────────────┘
               │ 3. Offscreen Frame Extraction (3.5 FPS Base64 JPEG)
               ▼
┌─────────────────────────────────┐
│   Python FastAPI AI Service     │
│   (Port 8000: YOLOv8 Person     │
│    Detection + ByteTrack)       │
└─────────────────────────────────┘
```

---

## 📁 Repository Structure

```
smart-classroom-ai/
├── .env.example              # Sample environment configuration
├── .gitignore                # Git exclusions
├── docker-compose.yml        # Complete Docker multi-container stack
├── README.md                 # System documentation & quickstart
├── backend/                  # Node.js + Express + Socket.IO Signaling
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── config/           # Database (db.js) & WebRTC (webrtc.js) config
│       ├── controllers/      # auth, camera, dashboard, settings controllers
│       ├── middleware/       # JWT auth & role validation
│       ├── models/           # User, CameraSession, DetectionEvent, SystemSetting
│       ├── routes/           # auth, cameras, dashboard, settings routes
│       ├── signaling/        # WebRTC P2P signaling server
│       ├── seed.js           # Default admin seeder
│       └── server.js         # HTTP server entry point with rate limiters
├── frontend/                 # React 18 + Vite Admin Dashboard & Mobile Client
│   ├── Dockerfile
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── components/       # Layout, Navigation Sidebar, ProtectedRoute
│       ├── context/          # AuthContext (JWT session management)
│       ├── pages/            # Login, Dashboard, Cameras, LiveMonitoring,
│       │                     # History, Settings, MobileCamera
│       ├── services/         # Axios/Fetch API client & WebRTC client
│       └── App.jsx           # Route definitions
└── ai-service/               # Python 3.10 + FastAPI + YOLOv8 + ByteTrack
    ├── Dockerfile
    ├── requirements.txt      # Clean vision dependencies
    ├── main.py               # FastAPI application entry point
    ├── detector.py           # YOLOv8 person detector (Class ID 0 only)
    ├── tracker.py            # ByteTrack multi-object tracking implementation
    ├── test_detector.py      # Unit test verifying YOLO detection accuracy
    └── test_tracking.py      # Multi-frame tracking association test
```

---

## ⚡ Quick Start (Local Development)

### Prerequisites
- **Node.js**: v18.x or v20.x
- **Python**: v3.10.x with `pip`
- **MongoDB**: v6.x or v7.x (running on `localhost:27017`)

---

### Step 1: Environment Configuration
From the `smart-classroom-ai/` root:
```bash
cp .env.example .env
```

---

### Step 2: Backend Setup & Seed
```bash
cd backend
npm install
npm run seed     # Seeds default admin: admin@smartclassroom.ai / admin123
npm run dev      # Starts on http://localhost:5000
```

---

### Step 3: AI Computer Vision Service
Open a new terminal:
```bash
cd ai-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
Verify the AI service:
```bash
curl http://localhost:8000/health
# Returns: {"status":"ok","service":"ai-service","detector_loaded":true,"tracker_loaded":true,...}
```

---

### Step 4: React Dashboard Frontend
Open a new terminal:
```bash
cd frontend
npm install
npm run dev -- --host --port 5173
```
Access the dashboard at `http://localhost:5173`.

---

## 🐳 Docker Compose Deployment (One-Command Run)

To run the entire distributed microservice stack via Docker:

```bash
docker-compose up --build
```

This launches:
1. `mongodb` on port `27017` with persistent volume `mongo_data`
2. `backend` on port `5000`
3. `ai-service` on port `8000`
4. `frontend` on port `5173`

---

## 📱 Smartphone Camera Streaming Guide

### Testing on Local Network (LAN)
1. Find your laptop's local IP address (e.g. `192.168.1.50` on macOS via `ipconfig getifaddr en0`).
2. Ensure your smartphone and laptop are connected to the same Wi-Fi network.
3. Modern mobile browsers require a **Secure Context** (HTTPS or `localhost`) to access `navigator.mediaDevices.getUserMedia`. For local network testing:
   - **Option A (Chrome Flag)**: On Android Chrome, navigate to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add `http://192.168.1.50:5173`, and relaunch.
   - **Option B (Tunnels / Ngrok / Cloudflare)**: Run `npx ngrok http 5173` or use Vite HTTPS (`vite --https`) for valid SSL certificates on iOS Safari / Android Chrome.
4. On the Admin Dashboard (`http://localhost:5173`), navigate to **Cameras**, click **Create Camera** (e.g. `Classroom 101`), and click **Copy Operator Link**.
5. Open the operator link on the smartphone. Grant camera permissions and tap **Start Broadcasting**.
6. On your laptop, navigate to **Live Monitoring** to observe the incoming WebRTC video stream with real-time YOLOv8 bounding boxes, ByteTrack IDs, trajectory trails, and entrance/exit tripwire statistics.

---

## 🛡️ Privacy by Design & Biometric Security Safeguards

1. **Zero Video Persistence**: Raw camera video frames are transmitted strictly peer-to-peer over WebRTC (encrypted with SRTP/DTLS) and are **never** written to database or disk. Only temporary in-memory canvas frames are evaluated by the AI detector.
2. **Consented Enrollment**: Face photographs and extracted 128-d ArcFace embeddings are captured only for enrolled students with explicit administrative consent.
3. **Biometric Wipe on Demand**: Admins can permanently wipe student face embeddings at any time (`DELETE /api/students/:id/enrollment`), immediately removing biometric vectors from MongoDB and clearing them from the AI vector gallery.
4. **Data Retention & TTL**: The `RecognitionEvent` audit collection features an automatic 30-day MongoDB TTL expiry index.
5. **No False Certainty**: When student faces are occluded, poorly lit, or lack sufficient cosine similarity (< 0.363), they are strictly labeled "Unknown" or "Identity unavailable" rather than guessing.
6. **Rate Limiting**: Express backend enforces rate limits on authentication attempts (max 20 per 15 minutes) and API endpoints to prevent brute-force attacks and abuse.

---

## 🧪 Automated Test Suites

Run the end-to-end verification suite across all 5 upgrade phases:

```bash
cd backend
npm test
```

Or execute individual phase test suites:

```bash
npm run test:students     # Phase 1: Student CRUD, constraints & duplicate validation
npm run test:enrollment   # Phase 2: Single-face validation, YuNet detection & 128-d SFace extraction
npm run test:recognition  # Phase 3: Sub-millisecond vector gallery, similarity threshold & matching
npm run test:pipeline     # Phase 4: YOLOv8 + ByteTrack + Facial recognition pipeline integration
npm run test:events       # Phase 5: Recognition audit events, populated querying & TTL retention
```

---

## 🔑 Default Credentials

- **Admin Email**: `admin@smartclassroom.ai`
- **Password**: `admin123`
