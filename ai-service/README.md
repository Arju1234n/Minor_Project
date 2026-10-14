# AI Computer Vision Service (FastAPI + YOLOv8)

> **Smart Classroom AI — Microservice for Computer Vision & Spatial Human Detection**

---

## 📌 Overview
This microservice provides real-time human detection powered by **Ultralytics YOLOv8**:
- **Target Class**: Exclusively filters for the `person` class (COCO class ID 0)
- **Configurable Confidence**: Dynamic threshold adjustments (`conf_threshold`, default 0.45)
- **Output Data**: Pixel bounding boxes, normalized coordinates, detection confidence scores, and visual annotated frames
- **Fast Inference**: Lightweight nano model (`yolov8n.pt`) optimized for low-latency processing

---

## 🛠️ Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check & model metadata |
| `POST` | `/api/ai/detect-file` | Detect humans from multipart image upload (JPEG/PNG) |
| `POST` | `/api/ai/detect-frame` | Detect humans with ByteTrack tracking & biometric face recognition |
| `POST` | `/api/ai/enroll-face` | Validate portrait & extract 128-d ArcFace embedding |
| `POST` | `/api/ai/compare-embeddings` | Compute cosine similarity between two 128-d vectors |
| `POST` | `/api/ai/sync-gallery` | Prime the in-memory vector gallery with student embeddings |
| `GET` | `/api/ai/gallery-status` | Inspect current vector index capacity and student counts |
| `POST` | `/api/ai/recognize-face` | Query query vector against gallery with 0.363 FAR threshold |
| `GET` | `/api/ai/config` | Retrieve current confidence and model parameters |
| `PATCH` | `/api/ai/config` | Dynamically update confidence threshold |

---

## 🚀 Running Locally

```bash
cd ai-service

# Activate virtual environment
source .venv/bin/activate

# Install dependencies (if not already installed)
pip install -r requirements.txt

# Start the FastAPI service
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

---

## 🧪 Testing the Detector

Run the automated verification suite:
```bash
python test_detector.py
```
This test:
1. Loads `yolov8n.pt`.
2. Downloads/loads a multi-person test image (`sample_classroom_test.jpg`).
3. Runs inference filtering exclusively for humans.
4. Generates an annotated image with bounding box badges (`detected_output.jpg`).
5. Validates person counts and output bounding box schemas.
