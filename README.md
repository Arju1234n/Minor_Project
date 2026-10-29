# Smart Classroom AI — Computer Vision & Person Identification System

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-v19-blue.svg)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-teal.svg)](https://fastapi.tiangolo.com/)
[![YOLOv8](https://img.shields.io/badge/YOLO-v8n-red.svg)](https://github.com/ultralytics/ultralytics)

> **Smart Classroom AI** is an enterprise-grade, real-time spatial vision and person identification system designed for automated classroom monitoring. It pairs smartphone cameras via low-latency WebRTC streaming, tracks multiple people using YOLOv8 + ByteTrack, and matches attendee identities against an enrolled student gallery using OpenCV YuNet and SFace (ArcFace 128-d embeddings).

---

## 📌 Table of Contents

1. [Overview & Scope](#-overview--scope)
2. [Key Features](#-key-features)
3. [Architecture](#-architecture)
4. [Technology Stack](#-technology-stack)
5. [Repository Structure](#-repository-structure)
6. [Prerequisites](#-prerequisites)
7. [Environment Variables](#-environment-variables)
8. [Local Development Setup](#-local-development-setup)
9. [Docker Deployment](#-docker-deployment)
10. [End-to-End User Workflows](#-end-to-end-user-workflows)
    - [1. Registering Students](#1-registering-students)
    - [2. Enrolling Face Photos](#2-enrolling-face-photos)
    - [3. Connecting a Phone Camera](#3-connecting-a-phone-camera)
    - [4. Live Monitoring Modes](#4-live-monitoring-modes)
11. [Testing & Quality Verification](#-testing--quality-verification)
12. [Troubleshooting Common Issues](#-troubleshooting-common-issues)
13. [Security & Biometric Privacy](#-security--biometric-privacy)
14. [Documentation Index](#-documentation-index)

---

## 🚀 Overview & Scope

Traditional classroom attendance and surveillance rely on manual roll calls or static CCTV recorders. Smart Classroom AI transforms any standard smartphone into an intelligent edge sensor:
* **No expensive hardware required**: Connects standard mobile devices over Wi-Fi via WebRTC.
* **Dual Monitoring Modes**: Seamlessly switch between **Simple Monitoring** (spatial headcount, tracking, and tripwire crossing) and **Face Identification** (biometric ArcFace matching).
* **Strict Privacy Governance**: Raw video frames are processed on-the-fly in volatile memory and never persisted to disk. Only 128-dimensional non-invertible feature vectors are stored.

---

## ✨ Key Features

* **Mobile P2P Video Transmission**: Low-latency WebRTC streaming from iOS/Android browsers with front/rear camera switching and torch control.
* **YOLOv8 Multi-Person Detection**: Nano detector model (`yolov8n.pt`) exclusively filtered for the `person` class (COCO 0).
* **ByteTrack Multi-Object Tracking**: Kalman Filter trajectory estimation providing persistent tracking IDs across occlusions.
* **Biometric Face Recognition (ArcFace)**:
  * **Face Detection**: OpenCV Zoo YuNet with 5-point landmark alignment.
  * **Feature Extraction**: OpenCV SFace generating 128-dimensional L2-normalized embeddings.
  * **Enrollment Validation**: Rejects blurry, occluded, zero-face, or multi-face portraits automatically.
  * **In-Memory Vector Gallery**: Vectorized cosine similarity matching with 0.363 FAR threshold and ambiguity safeguards.
* **Canvas Overlay Geometry Engine**: Compensates for container letterboxing (`object-fit: contain`) to keep bounding boxes and identity badges perfectly locked on moving targets across window resizes.
* **Spatial Analytics**: Bidirectional virtual tripwire crossing counters (`▲ IN` / `▼ OUT`) and monitored polygon zone occupancy.
* **Administrator Dashboard**: Real-time Socket.IO statistics, historical event logging, and student profile management.

---

## 🏛️ Architecture

```
┌─────────────────────────────────┐
│     Smartphone Operator         │
│  (Mobile Browser / getUserMedia)│
└──────────────┬──────────────────┘
               │ 1. WebRTC Signaling (Socket.IO)
               ▼
┌─────────────────────────────────┐           ┌─────────────────────────────┐
│    Node.js / Express Backend    │◄─────────►│     MongoDB (Port 27017)    │
│  - REST API & Auth (Port 5000)  │           │  - Users, Students          │
│  - WebRTC Room Signaling        │           │  - Face Embeddings          │
│  - AI Service Integration Client│           │  - Detection & Audit Events │
└──────────────┬──────────────────┘           └─────────────────────────────┘
               │
               │ 2. P2P Direct Media Stream (WebRTC)
               ▼
┌─────────────────────────────────┐           ┌─────────────────────────────┐
│     Admin Web Dashboard         │           │    FastAPI AI Microservice  │
│    (React 19 + Vite SPA)        │──────────►│   (Python 3.10, Port 8000)  │
│  - Live Video & Canvas Overlays │  Frames   │  - YOLOv8 Person Detection  │
│  - Simple Monitoring / Biometric│  (HTTP)   │  - ByteTrack Trajectories   │
│  - Real-time Roster & Events    │◄──────────│  - YuNet + SFace (ArcFace)  │
└─────────────────────────────────┘  Results  └─────────────────────────────┘
```

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 19, Vite, React Router v7, React Icons, Native HTML5 Canvas |
| **Backend** | Node.js v20, Express 4, Socket.IO, Mongoose, Multer, Helmet, Rate Limit |
| **Database** | MongoDB 7.0 |
| **AI / Computer Vision** | Python 3.10, FastAPI, Ultralytics YOLOv8, OpenCV (YuNet & SFace), NumPy, SciPy |
| **Streaming** | WebRTC (P2P), Google STUN (`stun.l.google.com:19302`) |
| **Containerization** | Docker, Docker Compose |

---

## 📂 Repository Structure

```
smart-classroom-ai/
├── frontend/                     # React 19 + Vite Web Application
│   ├── public/                   # Static assets & SVG icons
│   ├── src/
│   │   ├── components/           # Reusable UI (Sidebar, Layout, Route Guards)
│   │   ├── context/              # Auth state & session providers
│   │   ├── hooks/                # Custom React hooks (useAuth)
│   │   ├── pages/                # App views (Monitoring, Students, Cameras, etc.)
│   │   ├── services/             # HTTP API client and WebRTC signaling client
│   │   └── App.jsx               # Root routes
│   └── package.json
├── backend/                      # Node.js Express REST API & WebRTC Signaling
│   ├── src/
│   │   ├── config/               # Database, WebRTC & environment config
│   │   ├── controllers/          # Business logic handlers
│   │   ├── middleware/           # JWT auth & role guards
│   │   ├── models/               # Mongoose database models
│   │   ├── routes/               # Express endpoint routes
│   │   ├── services/             # aiService client proxy
│   │   ├── signaling/            # WebRTC Socket.IO signaling handler
│   │   ├── tests/                # Automated API & verification tests
│   │   ├── seed.js               # Admin account seeder
│   │   └── server.js             # Express application entry point
│   └── package.json
├── ai-service/                   # Python FastAPI Computer Vision Service
│   ├── models/                   # ONNX models (YuNet detector & SFace recognizer)
│   ├── detector.py               # Ultralytics YOLOv8 human detector
│   ├── face_engine.py            # OpenCV YuNet + SFace embedding extractor
│   ├── recognition_service.py    # In-memory student vector gallery
│   ├── tracker.py                # ByteTrack multi-person tracking & spatial analytics
│   ├── main.py                   # FastAPI service endpoints
│   ├── requirements.txt          # Python dependencies
│   └── yolov8n.pt                # YOLOv8 nano model weights
├── docs/                         # Architecture, API & deployment documentation
│   ├── architecture.md
│   ├── development.md
│   ├── api.md
│   └── deployment.md
├── docker-compose.yml            # Multi-container production deployment
├── .env.example                  # Environment configuration template
└── README.md
```

---

## ⚙️ Environment Variables

Copy the example configuration to initialize your local environment:

```bash
cp .env.example .env
```

| Variable | Default Value | Description |
|---|---|---|
| `PORT` | `5000` | Backend API port |
| `MONGO_URI` | `mongodb://localhost:27017/smart-classroom-ai` | MongoDB connection URI |
| `JWT_SECRET` | `change-me-to-a-random-secret-string` | Secret key for signing JWT tokens |
| `AI_SERVICE_URL` | `http://localhost:8000` | URL of the Python computer vision microservice |
| `AI_SERVICE_PORT` | `8000` | AI microservice port |
| `VITE_API_URL` | `http://localhost:5000/api` | Backend API base URL for the frontend |
| `VITE_SOCKET_URL` | `http://localhost:5000` | Socket.IO server URL for WebRTC signaling |
| `STUN_URL` | `stun:stun.l.google.com:19302` | STUN server for NAT traversal |

---

## 💻 Local Development Setup

### 1. Start MongoDB
Ensure MongoDB is running locally on port `27017`:
```bash
brew services start mongodb-community@7.0
# Or: docker run -d -p 27017:27017 --name mongo mongo:7.0
```

### 2. Start the AI Microservice
```bash
cd ai-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 3. Start the Backend API
In a new terminal:
```bash
cd backend
npm install
npm run seed     # Seeds default admin: admin@smartclassroom.ai / admin123
npm run dev
```

### 4. Start the Frontend
In a new terminal:
```bash
cd frontend
npm install
npm run dev -- --host --port 5173
```
Access the application at `http://localhost:5173`.

---

## 🐳 Docker Deployment

To launch the complete multi-tier system with a single command:

```bash
docker compose up -d --build
```
Seed the admin user inside the backend container:
```bash
docker compose exec backend npm run seed
```

---

## 📖 End-to-End User Workflows

### 1. Registering Students
1. Navigate to **[Students](http://localhost:5173/students)**.
2. Click **+ Register Student**.
3. Fill in Full Name, Roll Number, Department, Semester, and Class.
4. (Optional) Toggle **Auto-Enroll Face Photos** and upload 1–3 clear portrait photos.
5. Click **Create Student**.

### 2. Enrolling Face Photos
1. On the **Students** table, click **Edit** (pencil icon) on any student profile.
2. Click **Use Camera** to capture your face using the built-in webcam tool, or click **Upload Photos**.
3. Click **Save Changes**.
4. The system validates the photo with YuNet, generates a 128-d ArcFace vector, and updates the AI in-memory gallery. The student status will turn to **Enrolled** (Green).

### 3. Connecting a Phone Camera
1. Navigate to **[Cameras](http://localhost:5173/cameras)**.
2. Click **+ New Camera Unit** or scan the QR code displayed on screen with your phone.
3. On the phone browser (`http://<YOUR_LAN_IP>:5173/camera/:sessionId`), grant camera permissions and tap **Start Camera Stream**.

### 4. Live Monitoring Modes
Navigate to **[Live Monitoring](http://localhost:5173/monitoring)**. Use the **Monitoring Mode** toggle in the sidebar:
* **Simple Monitoring**: High-speed mode. Displays clean `Person #1 (95%)` badges, active headcount, ByteTrack motion trails, and tripwire counters. Hides recognition tags and face brackets.
* **Face Identification**: Full biometric mode. Matches detected faces against the enrolled database. Displays `✓ Roll — Student Name (Match %)` above recognized attendees in green, flags unknown individuals, and updates the live attendee roster.

---

## 🧪 Testing & Quality Verification

Run all test suites from the backend directory:

```bash
cd backend
npm run test:all
```

Test coverage includes:
* `npm run test:students` — Student CRUD, validation, duplicate prevention, and soft deactivation.
* `npm run test:enrollment` — Face detection, single-person validation, multi-face rejection, 128-d ArcFace vector persistence.
* `npm run test:recognition` — SFace cosine similarity scoring against gallery.
* `npm run test:pipeline` — Multi-frame YOLOv8 + ByteTrack + face recognition integration.
* `npm run test:events` — Recognition audit event persistence and MongoDB query filters.
* `npm run test:live` — Complete end-to-end registration, gallery sync, and multi-person identification.

Frontend code verification:
```bash
cd frontend
npm run lint    # Oxlint check (0 errors)
npm run build   # Production Vite compilation
```

---

## ❓ Troubleshooting Common Issues

* **Camera video stream shows a black box or does not connect**:
  * Verify that both your phone and PC are on the **exact same Wi-Fi subnet**.
  * Ensure the phone accessed the dashboard via your computer's local IP (e.g. `192.168.1.15`), not `localhost`.
* **Live Monitor displays "1 UNKNOWN" instead of the student's name**:
  * The person in view must have face photos enrolled. Check the **Students** tab: if the enrollment badge says `Pending`, edit the student, take a camera snapshot, and save to enroll.
* **"AI Computer Vision service unavailable at http://localhost:8000"**:
  * Ensure the FastAPI microservice is running: `cd ai-service && source .venv/bin/activate && python -m uvicorn main:app --port 8000`. Verify with `curl http://localhost:8000/health`.
* **Port 5000 / 8000 already in use**:
  * Identify and terminate lingering processes: `lsof -ti:5000,8000 | xargs kill -9`.

---

## 🔒 Security & Biometric Privacy

* **Zero Video Recording**: The system never saves continuous raw video streams to disk. Frames are analyzed in volatile memory and discarded.
* **Non-Invertible Embeddings**: Stored face templates are 128-dimensional floating point vectors. Original human faces cannot be reconstructed from feature vectors.
* **Data Erasure**: Administrators have the right to wipe biometrics for any student at any time via the one-click **Wipe Biometrics** control.
* **Protected Routes**: All operational endpoints are secured behind JWT tokens and role-based access checks (`admin`, `operator`).

---

## 📚 Documentation Index

For deeper technical details, consult the dedicated guides in the `docs/` folder:
* [Architecture Documentation](docs/architecture.md)
* [Local Development Guide](docs/development.md)
* [API Reference](docs/api.md)
* [Deployment Guide](docs/deployment.md)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
