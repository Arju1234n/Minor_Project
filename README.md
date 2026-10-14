# AI-Based Real-Time Human Detection & Tracking Website

> **Smart Classroom AI** — Remote smartphone camera streaming, real-time human detection (YOLO), and multi-person tracking (ByteTrack) with an administrative monitoring dashboard.

---

## 🚀 Current Milestone: Phase 2 Completed

In accordance with the incremental development plan:
- **Phase 1**: Monorepo structure, Express backend, MongoDB models, JWT auth, and React admin dashboard.
- **Phase 2**: Smartphone camera access (`navigator.mediaDevices.getUserMedia`), front/rear camera toggle, device selection, local video preview with iOS/Android compatibility, framing grid, torch control, and error handling.
  - JWT-based authentication with bcrypt password hashing
  - Role-based route protection (`admin`, `operator`)
  - MongoDB models for `User`, `CameraSession`, and `DetectionEvent` (with automatic TTL cleanup)
  - RESTful APIs for auth, camera sessions, and dashboard metrics
  - Socket.IO setup for real-time signaling & statistics
  - Database seeder (`npm run seed`)
- **React + Vite Frontend**:
  - Polished modern dark-themed UI with custom glassmorphism and responsive layout
  - JWT auth context and protected routes
  - **Login page** with validation & feedback
  - **Admin Dashboard** with stats cards, live camera grid placeholder, recent activity feeds, and quick actions
  - **Cameras page** for managing remote camera sessions
  - **Live Monitoring page** with video viewport and detection overlays layout
  - **History page** with event filtering and statistics
  - **Settings page** for AI thresholds, retention policy, and WebRTC STUN/TURN configuration
  - **Mobile Camera page** (public route `/camera/:sessionId` for smartphone operators)

---

## 📁 Repository Structure

```
smart-classroom-ai/
├── .env.example              # Sample environment configuration
├── .gitignore                # Global gitignore
├── docker-compose.yml        # Multi-container orchestration (MongoDB, Backend, Frontend)
├── README.md                 # Project documentation & setup instructions
├── backend/                  # Node.js + Express API & Socket.IO server
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── config/           # Database configuration (Mongoose)
│       ├── controllers/      # Auth, camera, and dashboard controllers
│       ├── middleware/       # JWT auth & role-based validation middleware
│       ├── models/           # User, CameraSession, DetectionEvent schemas
│       ├── routes/           # Express API endpoints
│       ├── seed.js           # Database seeder script
│       └── server.js         # Express app & HTTP/Socket server
├── frontend/                 # React 18 + Vite dashboard & smartphone camera client
│   ├── Dockerfile
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── components/       # Sidebar, DashboardLayout, ProtectedRoute
│       ├── context/          # AuthContext (state & token management)
│       ├── pages/            # Login, Dashboard, Cameras, LiveMonitoring, History, Settings, MobileCamera
│       ├── services/         # Axios API client & endpoints
│       ├── App.jsx           # React Router route definitions
│       ├── index.css         # Modern design tokens & global CSS
│       └── main.jsx          # React DOM entry point
└── ai-service/               # Python + FastAPI + YOLOv8 + ByteTrack (Phases 4–6)
    └── README.md
```

---

## 🛠️ Prerequisites

- **Node.js**: v18.x or v20.x
- **npm**: v9.x or later
- **MongoDB**: v6.x or v7.x (local service or Docker)
- Modern web browser (Chrome, Safari, Edge, or Firefox)

---

## ⚙️ Quick Start (Local Development)

### 1. Environment Configuration

From the root directory (`smart-classroom-ai`):
```bash
cp .env.example .env
```

Default settings in `.env`:
- `MONGO_URI=mongodb://localhost:27017/smart-classroom-ai`
- `PORT=5000`
- `JWT_SECRET=change-me-to-a-random-secret-string`
- `VITE_API_URL=http://localhost:5000/api`
- `VITE_SOCKET_URL=http://localhost:5000`

### 2. Start MongoDB

Ensure MongoDB is running locally:
```bash
# macOS (Homebrew):
brew services start mongodb-community@7.0

# Linux (systemd):
sudo systemctl start mongod

# Or via Docker:
docker run -d -p 27017:27017 --name mongo mongo:7.0
```

### 3. Seed Database & Start Backend

```bash
cd backend
npm install
npm run seed     # Creates default admin user: admin@smartclassroom.ai / admin123
npm run dev      # Or: npm start
```
The backend will be running at `http://localhost:5000`.

### 4. Start Frontend

Open a new terminal window:
```bash
cd frontend
npm install
npm run dev
```
The frontend will be running at `http://localhost:5173`.

---

## 🧪 Testing Phase 1

### Default Admin Credentials
- **Email**: `admin@smartclassroom.ai`
- **Password**: `admin123`

### Verification Steps:
1. **Health Check**:
   ```bash
   curl http://localhost:5000/api/health
   # Returns: {"status":"ok","timestamp":"..."}
   ```
2. **Open the Frontend**:
   Navigate to `http://localhost:5173` in your browser.
3. **Login**:
   Enter `admin@smartclassroom.ai` and `admin123`.
4. **Explore the Dashboard**:
   - Check real-time stats cards (Active Cameras, People Present, Unique IDs, System Status).
   - Test navigation via the sidebar:
     - **Cameras**: View camera sessions, generate new session tokens/links.
     - **Live Monitoring**: View layout for live video streams & AI tracking status.
     - **History**: Check detection event logs and session history.
     - **Settings**: Review detection thresholds, STUN/TURN parameters, and data retention controls.
     - **Mobile Camera preview**: Navigate to `/camera/:sessionId` to inspect the responsive operator UI.

---

## 🌐 WebRTC STUN/TURN Architecture (Context for Phase 3)

WebRTC establishes direct peer-to-peer media transmission between the smartphone camera and the admin dashboard:
- **STUN (Session Traversal Utilities for NAT)**: Discovers the public IP and port of each peer behind regular NATs. Free public STUN servers (e.g. `stun:stun.l.google.com:19302`) work seamlessly for devices on open or residential networks.
- **TURN (Traversal Using Relays around NAT)**: Acts as a relay fallback when peers are behind strict symmetric NATs or corporate cellular firewalls where direct P2P connections cannot be negotiated.
- The `.env.example` file contains pre-configured STUN settings and placeholders for TURN credentials.

---

## 🗺️ Incremental Development Roadmap

- [x] **Phase 1**: Monorepo structure, Express backend, MongoDB models, JWT auth, and React admin dashboard.
- [x] **Phase 2**: Smartphone camera access (`navigator.mediaDevices.getUserMedia`), device selection (front/rear), and local video preview.
- [x] **Phase 3**: WebRTC signaling server & peer connection for remote live video transmission between phone and laptop.
- [x] **Phase 4**: Python FastAPI service with YOLOv8 human detection (person class only).
- [x] **Phase 5**: Real-time video frame pipeline integration with detection bounding boxes & confidence scores.
- [x] **Phase 6**: ByteTrack multi-person tracking with persistent IDs and virtual tripwire/zone counting.
- [ ] **Phase 7**: Live statistics streaming, camera session lifecycle management, and event history aggregation.
- [ ] **Phase 8**: Production hardening, privacy safeguards, rate limiting, and deployment guides.
