# SmartClassAI Monitor — Frontend Web Application

[![React](https://img.shields.io/badge/React-v19.2-blue.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-v8.3-646CFF.svg)](https://vitejs.dev/)
[![WebRTC](https://img.shields.io/badge/WebRTC-P2P%20Streaming-orange.svg)](https://webrtc.org/)
[![HTML5 Canvas](https://img.shields.io/badge/HTML5-Canvas%2060FPS-E34F26.svg)](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-v4.8-black.svg)](https://socket.io/)

> The frontend client for **SmartClassAI Monitor**: a modern, real-time spatial computer vision and biometric identification dashboard built with **React 19** and **Vite**. It features decoupled 60 FPS canvas rendering, WebRTC peer-to-peer smartphone streaming, a real-time Performance & Latency HUD, and dynamic AI model and hardware acceleration controls.

---

## 📌 Table of Contents

1. [Architectural Overview](#-architectural-overview)
2. [Key Performance Optimizations](#-key-performance-optimizations)
   - [Decoupled 60 FPS Rendering Loop](#1-decoupled-60-fps-rendering-loop)
   - [Bounded Latest-Frame Queue](#2-bounded-latest-frame-queue)
   - [Real-Time Performance & Latency HUD](#3-real-time-performance--latency-hud)
   - [Canvas Letterbox Compensation Engine](#4-canvas-letterbox-compensation-engine)
3. [Page Directory & Feature Modules](#-page-directory--feature-modules)
4. [Hardware & Model Switching Controls](#-hardware--model-switching-controls)
5. [Reverse Proxy & Tunnel Architecture](#-reverse-proxy--tunnel-architecture)
6. [Component & Project Structure](#-component--project-structure)
7. [Environment Configuration](#-environment-configuration)
8. [Getting Started & Local Development](#-getting-started--local-development)
9. [Production Build & Quality Assurance](#-production-build--quality-assurance)

---

## 🏛️ Architectural Overview

The frontend serves as the central command console and video ingestion surface:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        React 19 Client SPA                             │
│                                                                        │
│  ┌─────────────────────────┐            ┌───────────────────────────┐  │
│  │   Video Ingest Stream   │            │   Independent Render Loop │  │
│  │ (WebRTC / Local / CCTV) │            │  (requestAnimationFrame)  │  │
│  └────────────┬────────────┘            └─────────────▲─────────────┘  │
│               │                                       │                │
│               │ Grab Frame                            │ Draw Boxes,    │
│               ▼                                       │ Trails & HUD   │
│  ┌─────────────────────────┐            ┌─────────────┴─────────────┐  │
│  │   Bounded Frame Queue   │            │  activeDetectionsRef []   │  │
│  │ (Drops if AI in-flight) │            │    (Latest Spatial Data)  │  │
│  └────────────┬────────────┘            └─────────────▲─────────────┘  │
│               │                                       │                │
└───────────────┼───────────────────────────────────────┼────────────────┘
                │ HTTP POST /api/ai/detect-frame        │
                ▼                                       │ Result Coordinates
┌───────────────────────────────────────────────────────┴────────────────┐
│               FastAPI AI Microservice (Apple MPS GPU)                  │
│       YOLOv8/YOLO11 Detection + ByteTrack + YuNet & SFace ArcFace      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## ⚡ Key Performance Optimizations

### 1. Decoupled 60 FPS Rendering Loop
* **Problem**: In naive computer vision web interfaces, bounding box rendering is tied to inference callbacks. When AI inference takes 40–150 ms, on-screen video overlays stutter at 6–15 FPS.
* **Solution**: In `LiveMonitoring.jsx`, the canvas rendering engine is completely decoupled into an independent `requestAnimationFrame` loop running at a steady **60 FPS**. Bounding boxes, identity badges, and motion vectors smoothly track moving subjects using the latest available detection snapshot held in `activeDetectionsRef.current`.

### 2. Bounded Latest-Frame Queue
* **Problem**: Firing AI inference requests on every video frame creates network and GPU backlog queues, causing latency lag where bounding boxes reflect reality from 1–3 seconds in the past.
* **Solution**: A bounded concurrency gate (`isDetectingRef.current`) evaluates incoming frames. If an inference request is currently in-flight across the HTTP bridge, intermediate frames are intentionally dropped. The AI service always receives the **freshest camera frame**, guaranteeing end-to-end responsiveness under heavy multi-person loads.

### 3. Real-Time Performance & Latency HUD
The live monitoring view includes a real-time telemetry HUD tracking each stage of the pipeline independently:

| HUD Metric | Measurement Technique | Target |
| :--- | :--- | :--- |
| **Transport Latency** | `RTCPeerConnection.getStats()` (round-trip time + jitter buffer) | `< 15 ms` (LAN / Tunnel) |
| **Rendering FPS** | `requestVideoFrameCallback()` with rAF fallback | `30–60 FPS` |
| **AI Throughput** | Rolling cycle frequency of completed AI inference requests | `20–30 FPS` |
| **YOLO Detection** | Server-reported hardware execution time on GPU / ANE | `12–18 ms` (Apple MPS) |
| **Face Recognition** | Server-reported OpenCV YuNet alignment + SFace ArcFace matching | `8–15 ms` (bounded $\le 2$ faces) |
| **Total Processing** | End-to-end frame capture, network transit, inference, and response | `< 45 ms` |

### 4. Canvas Letterbox Compensation Engine
* Modern camera streams (4:3, 16:9, portrait mobile) rarely match the container aspect ratio.
* `getMediaDisplayRect()` calculates exact horizontal letterboxing and vertical pillarboxing offsets applied by CSS `object-fit: contain`.
* Normalized bounding box coordinates `[0.0, 1.0]` are mapped directly onto the rendered media rectangle, preventing bounding box drift during window resizes or full-screen toggles.

---

## 📱 Page Directory & Feature Modules

### `LiveMonitoring.jsx`
* **Multi-Source Switching**: Toggle seamlessly between:
  1. 💻 **Local Device Webcam**: Instant direct browser `getUserMedia` feed.
  2. 📱 **Smartphone Camera Unit**: Low-latency P2P WebRTC stream paired via QR code.
  3. 📹 **Classroom CCTV**: IP camera MJPEG / snapshot streaming.
* **Spatial Visualizations**:
  - **Color-Coded Bounding Boxes**: Cyan for tracked individuals; emerald green for recognized students with confidence percentages.
  - **Motion Trajectory Trails**: 25-frame historical motion vectors showing person pathways.
  - **Bidirectional Virtual Tripwire**: Adjustable tripwire threshold (`5%–95%`) with separate `▲ Crossed In` and `▼ Crossed Out` counters.
  - **Monitored Zone**: Polygonal room region tracking simultaneous occupants.
* **Real-Time Attendance Roster**: Displays identified students, roll numbers, confidence levels, and detection timestamps live in the view.
* **One-Click Session Tracker Reset**: Instantly resets ByteTrack Kalman filters and counters with interactive feedback.

### `MobileCamera.jsx`
* Designed specifically for mobile smartphone browsers (`/camera/:sessionId`).
* Automatic WebRTC peer connection creation with STUN fallback (`stun.l.google.com:19302`).
* Camera toggle (front selfie vs. rear classroom view using `facingMode`).
* Hardware torch/flashlight toggle using MediaTrackConstraints.
* Visual connection state indicators (`connecting`, `live`, `failed`).

### `Dashboard.jsx`
* High-level executive overview of classroom occupancy and camera node availability.
* Real-time headcount counters, active session badges, and automated attendance statistics.
* Direct navigation cards to live monitoring, student directory, and camera setup.

### `Students.jsx`
* Complete student directory management with search and department filtering.
* **Biometric Face Enrollment Modal**:
  - Upload up to 5 reference portraits per student.
  - Pre-enrollment quality checks: automatic rejection of blurry, low-resolution, occluded, or multi-face images.
  - In-memory vector gallery synchronization indicator.

### `Cameras.jsx`
* Smartphone pairing hub: generates unique session IDs, direct connection URLs, and dynamic QR codes (`qrcode.react`) for instant phone scanning.
* CCTV camera stream manager: add, edit, test, and activate RTSP/HTTP camera endpoints.

### `History.jsx`
* Audit trail and detection event history log.
* Query recognition events by date range, camera source, student name, and attendance status.
* CSV export capabilities for attendance record keeping.

### `Settings.jsx`
* Configure global AI confidence thresholds, face recognition intervals, tripwire default positions, and theme preferences.

### `Login.jsx`
* Secure administrative authentication gateway featuring glassmorphic styling and JWT session management.

---

## 🎛️ Hardware & Model Switching Controls

The **Advanced Tracking & Settings Drawer** in the live monitor allows dynamic reconfiguration without restarting the server:

* **Detection Model**:
  - `yolov8n.pt`: Ultra-fast inference (~17 ms on MPS), recommended for standard classrooms.
  - `yolo11n.pt`: High-recall architecture (~20 ms on MPS), detects small or partially occluded students.
* **Hardware Device**:
  - `Apple MPS (GPU)`: Metal Performance Shaders for Apple Silicon MacBooks (M1/M2/M3/M4).
  - `Core ML (ANE)`: Apple Neural Engine compilation (`.mlpackage`).
  - `CPU Fallback`: Universal compatibility mode.
* **Face Recognition Scheduling**:
  - **Re-verify Interval**: Configurable rate limit (10–120 frames) determining how often recognized tracks are re-checked against SFace.
  - **Max Faces / Frame**: Limits biometric extraction to $\le 2$ suitable tracks per frame to prevent sequential latency spikes with 10–20 people in view.

---

## 🌐 Reverse Proxy & Tunnel Architecture

To support smartphone streaming and public tunnels (such as **ngrok**) without Mixed Content blocks or CORS failures, Vite acts as the unified reverse proxy in development:

```javascript
// vite.config.js
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: true, // Permits *.ngrok-free.dev and custom domains
    proxy: {
      '/api/ai': {
        target: 'http://localhost:8000', // FastAPI AI Microservice
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:5000', // Node.js Express Backend
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:5000', // WebRTC Signaling
        ws: true,
      },
      '/uploads': {
        target: 'http://localhost:5000', // Enrolled student photos
        changeOrigin: true,
      },
    },
  },
});
```

* When accessed via `https://<domain>.ngrok-free.dev`, all API calls and WebRTC signaling pass through the single origin on port `5173`.
* Remote smartphones do not attempt to contact `localhost:5000` or `localhost:8000` on their own local loopback network.

---

## 📂 Component & Project Structure

```
frontend/
├── public/                       # Static public assets
├── src/
│   ├── assets/                   # Images, logos, and UI backgrounds
│   ├── components/               # Shared interface components
│   │   ├── DashboardLayout.jsx   # Common header, navigation, and sidebar wrapper
│   │   ├── DashboardLayout.css
│   │   ├── ProtectedRoute.jsx    # Auth guard protecting authenticated routes
│   │   ├── Sidebar.jsx           # Application navigation sidebar
│   │   └── Sidebar.css
│   ├── context/                  # Global React context
│   │   └── AuthContext.jsx       # Authentication state, login, and token handling
│   ├── hooks/                    # Custom React hooks
│   │   └── useAuth.js            # Consumer hook for AuthContext
│   ├── pages/                    # Core application views
│   │   ├── Cameras.jsx           # QR code pairing & CCTV management
│   │   ├── Cameras.css
│   │   ├── Dashboard.jsx         # Executive overview & real-time metrics
│   │   ├── Dashboard.css
│   │   ├── History.jsx           # Historical detection & attendance logs
│   │   ├── History.css
│   │   ├── LiveMonitoring.jsx    # 60 FPS video monitor, canvas overlays & HUD
│   │   ├── LiveMonitoring.css
│   │   ├── Login.jsx             # Admin authentication view
│   │   ├── Login.css
│   │   ├── MobileCamera.jsx      # Mobile WebRTC streaming operator view
│   │   ├── MobileCamera.css
│   │   ├── Settings.jsx          # AI and application settings
│   │   ├── Settings.css
│   │   ├── Students.jsx          # Student directory & face enrollment
│   │   └── Students.css
│   ├── services/                 # Network clients
│   │   ├── api.js                # Authenticated REST client (Backend & AI Service)
│   │   └── webrtc.js             # Socket.IO connection & WebRTC peer helpers
│   ├── App.jsx                   # React Router v7 route definitions
│   ├── index.css                 # Global CSS variables, reset, and base themes
│   └── main.jsx                  # React application entry point
├── package.json
├── vite.config.js
└── README.md
```

---

## ⚙️ Environment Configuration

By default, Vite proxies requests automatically. For custom deployments, configure variables in `.env` inside `frontend/`:

| Environment Variable | Default Value | Description |
| :--- | :--- | :--- |
| `VITE_API_URL` | `http://localhost:5000/api` | Node.js backend REST API base URL |
| `VITE_SOCKET_URL` | `http://localhost:5000` | Socket.IO server for WebRTC room signaling |
| `VITE_AI_URL` | `http://localhost:8000` | Direct AI service URL (leave unset to use proxy) |

---

## 🚀 Getting Started & Local Development

### Prerequisites
* **Node.js**: `v20.x` or higher
* **npm**: `v10.x` or higher

### Installation
```bash
cd frontend
npm install
```

### Start Development Server
```bash
npm run dev
```
The app will be available at:
* Local: `http://localhost:5173`
* Network: `http://<LAN_IP>:5173`

---

## 🔨 Production Build & Quality Assurance

### Build for Production
```bash
npm run build
```
Generates an optimized client bundle inside the `dist/` folder:
* CSS minification and tree shaking
* Asset hashing for long-term caching
* Oxlint static code verification

### Preview Production Build Locally
```bash
npm run preview
```

### Run Linter
```bash
npm run lint
```
