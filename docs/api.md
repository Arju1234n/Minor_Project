# API Reference

Comprehensive reference for the Backend REST API and the AI Computer Vision Microservice.

---

## 1. Authentication Endpoints (`/api/auth`)

### POST `/api/auth/login`
Authenticates an administrator and issues a JWT token.
* **Headers**: `Content-Type: application/json`
* **Body**:
  ```json
  {
    "email": "admin@smartclassroom.ai",
    "password": "admin123"
  }
  ```
* **Response `200 OK`**:
  ```json
  {
    "success": true,
    "token": "eyJhbGciOi...",
    "user": {
      "id": "60d0fe4f5311236168a109ca",
      "name": "Admin",
      "email": "admin@smartclassroom.ai",
      "role": "admin"
    }
  }
  ```

### GET `/api/auth/me`
Returns details of the currently authenticated administrator.
* **Headers**: `Authorization: Bearer <JWT_TOKEN>`
* **Response `200 OK`**: Current user profile.

---

## 2. Student Management Endpoints (`/api/students`)

All `/api/students` endpoints require `Authorization: Bearer <TOKEN>`.

### GET `/api/students`
Search, filter, and paginate student records.
* **Query Params**:
  * `page` (default: 1)
  * `limit` (default: 25)
  * `search` (name, rollNumber, or registrationNumber)
  * `department` (CSE, ECE, ME, etc.)
  * `semester` (1-8)
  * `enrollmentStatus` (`all`, `enrolled`, `pending`, `failed`)
  * `status` (`active`, `inactive`)
* **Response `200 OK`**: Paginated student list and metadata.

### POST `/api/students`
Register a new student profile with optional face photo uploads.
* **Headers**: `Content-Type: multipart/form-data`
* **Body**:
  * `fullName` (string, required)
  * `rollNumber` (string, required)
  * `department` (string, required)
  * `semester` (integer, required)
  * `className` (string, required)
  * `autoEnroll` (`"true"` | `"false"`)
  * `photos` (file array, up to 5 portrait images)
* **Response `201 Created`**: Student profile and enrollment status.

### POST `/api/students/:id/enroll`
Upload face photographs and enroll 128-d ArcFace embeddings for an existing student.
* **Headers**: `Content-Type: multipart/form-data`
* **Files**: `photos` (1 to 5 images)
* **Response `200 OK`**: Enrolled embeddings count, quality scores, and synced status.

### DELETE `/api/students/:id/enrollment`
Wipes all biometric face embeddings for a student and sets `enrollmentStatus = 'pending'`.
* **Response `200 OK`**: Confirmation message and count of removed embeddings.

### POST `/api/students/sync-gallery`
Forces synchronization of all active, enrolled students into the AI in-memory gallery.
* **Response `200 OK`**: Synced student count and timestamp.

---

## 3. Camera Session Endpoints (`/api/cameras`)

### GET `/api/cameras`
List all active and recent camera broadcasting sessions.

### POST `/api/cameras`
Register or heartbeat a camera broadcasting session.
* **Body**:
  ```json
  {
    "sessionId": "room_12345",
    "name": "Front Classroom Camera",
    "deviceInfo": {
      "facingMode": "environment",
      "resolution": "1280x720"
    }
  }
  ```

### GET `/api/cameras/ice-servers`
Retrieve WebRTC STUN and TURN server credentials for P2P connection establishment.

---

## 4. AI Computer Vision Microservice Endpoints (`http://localhost:8000`)

### GET `/health`
Health check and loaded model information.
* **Response `200 OK`**:
  ```json
  {
    "status": "healthy",
    "models": {
      "yolo": "yolov8n.pt",
      "face_detector": "YuNet (face_detection_yunet_2023mar.onnx)",
      "face_recognizer": "SFace (face_recognition_sface_2021dec.onnx)"
    }
  }
  ```

### POST `/api/ai/detect-frame`
Processes a video frame with YOLOv8 human detection, ByteTrack tracking, and biometric face identification.
* **Body**:
  ```json
  {
    "image": "data:image/jpeg;base64,...",
    "conf_threshold": 0.40,
    "session_id": "camera_session_1",
    "tripwire_y": 0.50,
    "enable_tracking": true
  }
  ```
* **Response `200 OK`**:
  ```json
  {
    "success": true,
    "people_count": 2,
    "recognized_count": 1,
    "unrecognized_count": 1,
    "unique_ids_count": 4,
    "tripwire": { "entered": 1, "exited": 0 },
    "inference_time_ms": 142.5,
    "detections": [
      {
        "tracking_id": 1,
        "confidence": 0.89,
        "identity_status": "recognized",
        "student_id": "60d0fe4f5311236168a109ca",
        "full_name": "Arjun Kumar",
        "roll_number": "CS2026-01",
        "similarity": 0.94,
        "bbox": { "x": 100, "y": 80, "width": 120, "height": 300 },
        "normalized_bbox": { "x": 0.156, "y": 0.166, "width": 0.187, "height": 0.625 },
        "normalized_face_box": { "x": 0.18, "y": 0.17, "width": 0.08, "height": 0.10 }
      }
    ]
  }
  ```

### POST `/api/ai/enroll-face`
Validates a single face in a portrait image and generates a 128-d ArcFace vector.
* **Body**: `{"image_path": "/absolute/path/to/image.jpg"}`
* **Response `200 OK`**:
  ```json
  {
    "success": true,
    "embedding": [0.024, -0.115, ...],
    "confidence": 0.965,
    "model": "SFace-ArcFace",
    "face_box": { "x": 45, "y": 50, "width": 80, "height": 95 }
  }
  ```

### POST `/api/ai/sync-gallery`
Prime the in-memory vector gallery with student embeddings.
* **Body**:
  ```json
  {
    "students": [
      {
        "student_id": "60d0fe...",
        "full_name": "Arjun Kumar",
        "roll_number": "CS2026-01",
        "embeddings": [[0.024, -0.115, ...]]
      }
    ]
  }
  ```

### GET `/api/ai/gallery-status`
Inspect the in-memory vector index capacity and student counts.
* **Response `200 OK`**: `{"active_students": 1, "total_embeddings": 3}`
