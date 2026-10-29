# Local Development Guide

This guide walks through setting up and running Smart Classroom AI locally on your development machine.

---

## 1. Prerequisites

Ensure the following tools are installed:
* **Node.js**: v18+ or v20+ (LTS recommended)
* **npm**: v9+
* **Python**: v3.10 or v3.11
* **MongoDB**: v6.0+ or v7.0+ (running locally on port 27017 or via Docker)
* **Git**: v2.30+

---

## 2. Environment Setup

Copy `.env.example` to `.env` in the project root:

```bash
cp .env.example .env
```

Verify the key configurations:
```env
MONGO_URI=mongodb://localhost:27017/smart-classroom-ai
PORT=5000
JWT_SECRET=supersecretdevkey
AI_SERVICE_URL=http://localhost:8000
AI_SERVICE_PORT=8000
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

---

## 3. Step-by-Step Service Startup

### Step A: Start MongoDB
Ensure MongoDB is running locally:
```bash
# macOS (Homebrew)
brew services start mongodb-community@7.0

# Or via Docker
docker run -d --name smart-classroom-mongo -p 27017:27017 mongo:7.0
```

### Step B: Start AI Computer Vision Microservice
```bash
cd ai-service

# Create virtual environment if not already present
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start FastAPI server on port 8000
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
*Health Check*: Open `http://localhost:8000/health` in your browser. It should respond `{"status": "healthy"}`.

### Step C: Start Backend Server
In a new terminal:
```bash
cd backend

# Install dependencies
npm install

# Seed the default admin user
npm run seed

# Start Express server with nodemon
npm run dev
```
*Verification*: Backend will connect to MongoDB and listen on `http://localhost:5000`.

### Step D: Start Frontend Application
In a new terminal:
```bash
cd frontend

# Install dependencies
npm install

# Start Vite development server
npm run dev -- --host --port 5173
```
*Access*: Open `http://localhost:5173` in your browser.

---

## 4. Running Automated Tests

Run the full end-to-end verification suite:

```bash
cd backend

# Run all backend and integration tests
npm run test:all
```

Individual test suites:
```bash
# Student database operations & model validations
npm run test:students

# Face photo validation (single-face, multi-face rejection, 128-d extraction)
npm run test:enrollment

# SFace ArcFace cosine similarity matching
npm run test:recognition

# YOLOv8 + ByteTrack + Recognition multi-frame pipeline
npm run test:pipeline

# Recognition audit events & MongoDB logging
npm run test:events

# Complete end-to-end registration & multi-person live identification
npm run test:live
```

Python tests:
```bash
cd ai-service
source .venv/bin/activate
python test_detector.py
python test_tracking.py
python test_recognition.py
python test_pipeline_integration.py
```

Frontend build & lint verification:
```bash
cd frontend
npm run lint
npm run build
```

---

## 5. Connecting a Smartphone Camera

1. Ensure your phone and development computer are connected to the **same Wi-Fi network**.
2. Find your computer's local IP (e.g. `192.168.1.5`):
   ```bash
   ipconfig getifaddr en0
   ```
3. Open `http://<YOUR_LOCAL_IP>:5173/camera/<SESSION_ID>` on your phone's browser.
4. Allow camera permissions and click **Start Camera Stream**.
5. In your desktop browser, navigate to **Live Monitor** (`http://localhost:5173/monitoring`) and select the matching Camera Unit to observe live P2P video and AI tracking overlays!
