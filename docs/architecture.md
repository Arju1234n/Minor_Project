# Smart Classroom AI — System Architecture

This document describes the high-level system architecture, service interactions, data flow, and computer vision pipelines of Smart Classroom AI.

---

## 1. High-Level Architecture Overview

Smart Classroom AI is architected as a microservices-based monorepo consisting of three core tiers and a database:

```
┌─────────────────────────────────────────────────────────────┐
│                       Client Layer                          │
│  ┌──────────────────────────────┐  ┌──────────────────────┐ │
│  │    Admin Web Dashboard       │  │ Mobile Camera Client │ │
│  │   (React 19 + Vite SPA)      │  │ (getUserMedia WebRTC)│ │
│  └──────────────┬───────────────┘  └──────────┬───────────┘ │
└─────────────────┼─────────────────────────────┼─────────────┘
                  │ HTTPS/WSS (API & Signaling) │ WebRTC P2P
                  ▼                             │ Media Stream
┌───────────────────────────────────────────────▼─────────────┐
│                      Backend Layer                          │
│  Node.js + Express REST API & Socket.IO Signaling           │
│  - Session management & WebRTC ICE/SDP exchange             │
│  - Student registry & face embedding storage                │
│  - AI Service client proxy & gallery synchronization        │
│  - JWT Authentication & RBAC                                │
└───────────────────────┬──────────────────────┬──────────────┘
                        │                      │
       MongoDB (Port 27017)                    │ Internal HTTP REST
   - Students, Users, Embeddings               │ (Port 8000)
   - Sessions, Audit Events                    ▼
                        ┌─────────────────────────────────────┐
                        │          AI Microservice            │
                        │  Python 3.10 + FastAPI Server       │
                        │  - YOLOv8 (Person Class COCO 0)     │
                        │  - ByteTrack Multi-Person Tracking  │
                        │  - OpenCV YuNet (Face Detection)    │
                        │  - SFace / ArcFace (128-d Vector)   │
                        │  - In-Memory Cosine Similarity Index│
                        └─────────────────────────────────────┘
```

---

## 2. Component Descriptions

### A. Frontend (React 19 + Vite)
* **Single Page Application (SPA)** using React 19, React Router v7, and Vanilla CSS.
* **WebRTC Consumer**: Receives P2P H.264/VP8 video streams directly from registered phone cameras.
* **Canvas Overlay Pipeline**: Dynamically calculates letterbox geometry (`getVideoDisplayRect`) to project detection boxes, tracking IDs, face brackets, and student identification tags onto the video viewport in real time.
* **Operational Modes**:
  * **Simple Monitoring**: High-speed YOLOv8 human detection & ByteTrack tracking badges (`Person #1 (94%)`).
  * **Face Identification**: Full biometric verification against the enrolled student gallery.

### B. Mobile Camera Broadcaster
* Runs on any modern smartphone browser (Chrome Android, Safari iOS) within the local Wi-Fi network.
* Uses `navigator.mediaDevices.getUserMedia` with front/rear lens selection and torch control.
* Establishes a WebRTC peer-to-peer connection with the Admin Dashboard via Socket.IO signaling.

### C. Backend API (Node.js / Express)
* **REST API**: Handles student lifecycle, face enrollment uploads, settings, and detection audit events.
* **Signaling Server**: Socket.IO room-based WebRTC signaling (`join-as-broadcaster`, `join-as-viewer`, `offer`, `answer`, `ice-candidate`).
* **AI Service Client (`src/services/aiService.js`)**: Encapsulates microservice communication with timeouts, health checks, and vector payload synchronization.
* **Database**: MongoDB via Mongoose ORM.

### D. AI Microservice (Python / FastAPI)
* **Ultralytics YOLOv8**: Real-time object detection filtered strictly for COCO class ID 0 (`person`).
* **ByteTrack Multi-Object Tracking**: Kalman filter and Hungarian bipartite matching algorithm for persistent IDs across frame occlusions.
* **OpenCV YuNet**: Deep learning face detection with 5-point facial landmark alignment.
* **OpenCV SFace (ArcFace-based)**: Generates 128-dimensional L2-normalized deep feature vectors.
* **StudentGallery**: In-memory vector index performing vectorized matrix dot-product operations for sub-millisecond 1:N face matching with an FAR threshold of 0.363.

---

## 3. Data Flow & Lifecycles

### A. Student Face Enrollment Flow
1. Admin uploads 1–5 portraits or captures directly via webcam on the `/students` page.
2. Express receives files via `multer` and calls `aiService.enrollFace(filePath)`.
3. The AI service runs **YuNet**:
   - Rejects images with 0 faces ("No face detected").
   - Rejects images with >1 faces ("Multiple faces detected").
4. **SFace** extracts the 128-d ArcFace vector and returns the embedding + quality score.
5. Backend stores the vector in MongoDB `FaceEmbedding` collection and updates `Student.enrollmentStatus = 'enrolled'`.
6. Backend pushes the active gallery payload to the AI service `/api/ai/sync-gallery`.

### B. Live Person Tracking & Face Recognition Flow
1. Mobile camera streams video to the Admin Dashboard via WebRTC.
2. Dashboard captures frames at up to 3.5 FPS and submits them to `/api/ai/detect-frame`.
3. AI Service runs **YOLOv8** to locate all humans in the frame.
4. **ByteTrack** correlates bounding boxes with past trajectories and assigns persistent IDs (`Track #1`, `Track #2`).
5. For each detected human, the upper head region is cropped and passed to **YuNet + SFace**.
6. The 128-d crop vector is queried against `StudentGallery`:
   - If cosine similarity $\ge 0.363$, status is `recognized` with the student's name, roll number, and match percentage.
   - If cosine similarity $< 0.363$, status is `unknown`.
   - If no face is visible (turned away/obscured), status is `unavailable`.
7. Conflict resolution ensures no two tracks in the same frame claim the same student identity simultaneously.
8. The dashboard canvas renders bounding boxes, tracking trails, and student identity badges.

### C. CCTV / IP Camera RTSP Ingestion & Shared Pipeline Flow
1. Admin configures an RTSP/HTTP camera in the Cameras page or via `/api/cameras`.
2. **SSRF Validator (`src/utils/urlValidator.js`)**:
   - Rejects cloud metadata addresses (`169.254.169.254`, `metadata.google.internal`).
   - Blocks internal infrastructure ports (`27017`, `6379`, `5432`, `22`).
   - Sanitizes embedded credentials (`rtsp://admin:******@ip:port/path`) for safe storage and logging.
3. Express stores raw credentials securely in MongoDB with `{ select: false }` to prevent leakage.
4. **CCTV Ingestion Worker (`ai-service/cctv_engine.py`)**:
   - OpenCV `VideoCapture` decodes live H.264/H.265 RTSP streams via TCP transport in a background thread.
   - Decoded BGR frames are buffered in volatile memory and exposed via an authenticated multipart MJPEG stream (`/api/ai/cctv/:sessionId/stream`).
5. **Zero-Copy AI Execution**:
   - Live Monitor requests `/api/ai/cctv/:sessionId/detect`, which directly processes the cached BGR frame in AI service memory without client roundtrip encoding.
   - The same YOLOv8 human detection, ByteTrack trajectory tracking, and ArcFace face matching pipeline executes identically for both CCTV and Smartphone sources.
6. Responsive canvas overlays use letterbox calculations (`getMediaDisplayRect`) to accurately project bounding boxes onto both HTML5 `<video>` and `<img>` elements.
