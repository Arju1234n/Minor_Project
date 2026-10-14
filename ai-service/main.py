import base64
import os
import time
from typing import Optional, List, Dict, Any
import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, Query, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from detector import HumanDetector
from tracker import TrackerRegistry
from face_engine import face_engine
from recognition_service import gallery

# Initialize FastAPI app
app = FastAPI(
    title="Smart Classroom AI — Computer Vision Service",
    description="YOLOv8 Human Detection & ByteTrack Multi-Person Tracking Microservice",
    version="1.0.0"
)

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global instances
detector: Optional[HumanDetector] = None
tracker_registry: Optional[TrackerRegistry] = None

def sync_gallery_from_backend():
    try:
        import urllib.request
        import json
        req = urllib.request.Request("http://localhost:5000/api/students/active-gallery")
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("success") and "gallery" in data:
                count = gallery.sync_students(data["gallery"])
                print(f"✅ Auto-synced gallery from backend: {count} student(s) loaded into vector index.")
                return count
    except Exception as e:
        print(f"ℹ️ Backend gallery auto-sync notice: {e}")
        return 0

@app.on_event("startup")
def startup_event():
    global detector, tracker_registry
    model_name = os.getenv("YOLO_MODEL", "yolov8n.pt")
    default_conf = float(os.getenv("DETECTION_CONFIDENCE", "0.40"))
    detector = HumanDetector(model_name=model_name, default_conf=default_conf)
    tracker_registry = TrackerRegistry(model_name=model_name)
    sync_gallery_from_backend()
    print("🚀 AI Service startup complete. YOLOv8, ByteTrack, and Facial Recognition ready.")

@app.post("/api/ai/sync-gallery-from-backend")
def trigger_sync_from_backend():
    count = sync_gallery_from_backend()
    return {
        "success": True,
        "synced_count": count,
        "gallery_status": gallery.get_status()
    }

class Base64FramePayload(BaseModel):
    image: str # Base64 encoded JPEG/PNG frame
    session_id: Optional[str] = "default"
    conf_threshold: Optional[float] = None
    tripwire_y: Optional[float] = None
    enable_tracking: Optional[bool] = True
    return_annotated: Optional[bool] = False

# ──────────────────────────────────────────
# Health Check & Metadata
# ──────────────────────────────────────────
@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "ai-service",
        "detector_loaded": detector is not None,
        "tracker_loaded": tracker_registry is not None,
        "model": detector.model_name if detector else None,
        "default_conf": detector.default_conf if detector else None,
        "target_class": "person (ID 0)",
        "multi_person_tracking": "ByteTrack"
    }

# ──────────────────────────────────────────
# Detection & Tracking via Base64 JSON Payload
# ──────────────────────────────────────────
@app.post("/api/ai/detect-frame")
async def detect_base64_frame(payload: Base64FramePayload):
    if detector is None or tracker_registry is None:
        raise HTTPException(status_code=503, detail="AI Service not initialized")

    t0 = time.time()
    try:
        raw_b64 = payload.image
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",")[1]

        image_bytes = base64.b64decode(raw_b64)
        nparr = np.frombuffer(image_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            raise HTTPException(status_code=400, detail="Could not decode base64 image")

        session_id = payload.session_id or "default"

        if payload.enable_tracking:
            tracker = tracker_registry.get_tracker(session_id, default_conf=payload.conf_threshold or 0.40)
            result = tracker.track_frame(
                frame,
                conf_threshold=payload.conf_threshold,
                tripwire_y=payload.tripwire_y
            )
            inference_time_ms = round((time.time() - t0) * 1000, 2)
            result["success"] = True
            result["inference_time_ms"] = inference_time_ms
            result["image_size"] = {"width": frame.shape[1], "height": frame.shape[0]}
            return result
        else:
            # Simple YOLO detection without ByteTrack persistence
            detections, _, inf_time = detector.detect_frame(
                frame,
                conf_threshold=payload.conf_threshold,
                draw_boxes=False
            )
            h, w = frame.shape[:2]
            for idx, d in enumerate(detections):
                x = d["bbox"]["x"]
                y = d["bbox"]["y"]
                bw = d["bbox"]["width"]
                bh = d["bbox"]["height"]
                head_y1 = max(0, y)
                head_y2 = min(h, y + max(int(bh * 0.50), 40))
                head_x1 = max(0, x)
                head_x2 = min(w, x + bw)
                if (head_y2 - head_y1) >= 25 and (head_x2 - head_x1) >= 25:
                    head_crop = frame[head_y1:head_y2, head_x1:head_x2]
                    rec_res = gallery.recognize_crop(head_crop)
                    status = rec_res.get("status", "unknown")
                    if status == "recognized":
                        id_status = "recognized"
                        label = rec_res.get("label", "Recognized Student")
                    elif status == "uncertain":
                        id_status = "uncertain"
                        label = rec_res.get("label", "Uncertain Match")
                    elif status == "no_face":
                        id_status = "unavailable"
                        label = "Identity unavailable"
                    else:
                        id_status = "unknown"
                        label = "Unknown"
                    d["identity_status"] = id_status
                    d["label"] = label
                    d["student_id"] = rec_res.get("student_id")
                    d["full_name"] = rec_res.get("full_name")
                    d["roll_number"] = rec_res.get("roll_number")
                    d["similarity"] = rec_res.get("score", 0.0)
                    if rec_res.get("face_box"):
                        fb = rec_res["face_box"]
                        d["face_box"] = {
                            "x": head_x1 + fb["x"],
                            "y": head_y1 + fb["y"],
                            "width": fb["width"],
                            "height": fb["height"],
                        }
                    else:
                        d["face_box"] = None
                else:
                    d["identity_status"] = "unavailable"
                    d["label"] = "Identity unavailable"
                    d["student_id"] = None
                    d["full_name"] = None
                    d["roll_number"] = None
                    d["similarity"] = 0.0
                    d["face_box"] = None

            recognized_students = [
                {
                    "student_id": d["student_id"],
                    "full_name": d["full_name"],
                    "roll_number": d["roll_number"],
                    "similarity": d["similarity"],
                    "tracking_id": idx + 1
                }
                for idx, d in enumerate(detections) if d.get("identity_status") == "recognized"
            ]

            return {
                "success": True,
                "session_id": session_id,
                "people_count": len(detections),
                "unique_ids_count": len(detections),
                "recognized_count": len(recognized_students),
                "unrecognized_count": len(detections) - len(recognized_students),
                "recognized_students": recognized_students,
                "detections": detections,
                "inference_time_ms": inf_time,
                "image_size": {"width": frame.shape[1], "height": frame.shape[0]}
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ──────────────────────────────────────────
# Session Reset & Metrics
# ──────────────────────────────────────────
@app.post("/api/ai/reset-session/{session_id}")
def reset_session(session_id: str):
    if tracker_registry:
        tracker_registry.reset_session(session_id)
        return {"success": True, "message": f"Session {session_id} tracker reset"}
    raise HTTPException(status_code=503, detail="Tracker registry unavailable")

@app.get("/api/ai/session/{session_id}")
def get_session_metrics(session_id: str):
    if tracker_registry and session_id in tracker_registry.trackers:
        t = tracker_registry.trackers[session_id]
        return {
            "session_id": session_id,
            "unique_ids_count": len(t.unique_ids),
            "entered": t.count_entered,
            "exited": t.count_exited,
            "active_tracks": list(t.trajectories.keys())
        }
    return {
        "session_id": session_id,
        "unique_ids_count": 0,
        "entered": 0,
        "exited": 0,
        "active_tracks": []
    }

# ──────────────────────────────────────────
# Configuration Endpoint
# ──────────────────────────────────────────
@app.get("/api/ai/config")
def get_config():
    if detector is None:
        raise HTTPException(status_code=503, detail="Detector not initialized")
    return {
        "model_name": detector.model_name,
        "default_conf": detector.default_conf,
        "tracker": "ByteTrack",
        "target_class": "person (ID 0)"
    }

@app.patch("/api/ai/config")
def update_config(conf: float = Body(..., embed=True, ge=0.1, le=0.99)):
    if detector is None:
        raise HTTPException(status_code=503, detail="Detector not initialized")
    detector.default_conf = round(conf, 2)
    return {
        "success": True,
        "message": f"Updated confidence threshold to {detector.default_conf}",
        "default_conf": detector.default_conf
    }

# ──────────────────────────────────────────
# Face Biometric Enrollment Endpoints — Phase 2
# ──────────────────────────────────────────
class FaceEnrollPayload(BaseModel):
    image: Optional[str] = None       # Base64 encoded JPEG/PNG image
    image_path: Optional[str] = None  # Local filesystem path (e.g. backend/uploads/faces/...)

@app.post("/api/ai/enroll-face")
def enroll_face(payload: FaceEnrollPayload):
    """
    Validates single-person portrait and extracts 128-d ArcFace embedding.
    Rejects:
    - Images with 0 detected faces
    - Images with >1 detected faces
    - Faces with inadequate resolution (<40x40px)
    """
    img = None
    if payload.image_path and os.path.exists(payload.image_path):
        img = cv2.imread(payload.image_path)
    elif payload.image:
        try:
            raw_b64 = payload.image
            if "," in raw_b64:
                raw_b64 = raw_b64.split(",")[1]
            img_bytes = base64.b64decode(raw_b64)
            nparr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to decode base64 image: {str(e)}")

    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image input or image file could not be read.")

    result = face_engine.enroll_single_image(img)
    if not result["valid"]:
        return {
            "success": False,
            "error": result["error"],
            "face_count": result.get("face_count", 0)
        }

    return {
        "success": True,
        "face_count": 1,
        "confidence": result["confidence"],
        "bbox": result["bbox"],
        "embedding": result["embedding"],
        "model": result["model"]
    }

class CompareEmbeddingsPayload(BaseModel):
    embedding1: List[float]
    embedding2: List[float]

@app.post("/api/ai/compare-embeddings")
def compare_embeddings(payload: CompareEmbeddingsPayload):
    """
    Compute Cosine Similarity between two face embeddings.
    Cosine score threshold >= 0.363 indicates positive match (FAR 0.1%).
    """
    if len(payload.embedding1) != 128 or len(payload.embedding2) != 128:
        raise HTTPException(status_code=400, detail="Embeddings must be 128-dimensional vectors.")

    sim = face_engine.compute_similarity(np.array(payload.embedding1), np.array(payload.embedding2))
    return {
        "similarity": round(sim, 4),
        "is_match": sim >= 0.363,
        "threshold": 0.363
    }

# ──────────────────────────────────────────
# Face Recognition & Gallery Matching — Phase 3
# ──────────────────────────────────────────
class SyncGalleryStudent(BaseModel):
    student_id: str
    roll_number: str
    full_name: str
    embeddings: List[List[float]]

class SyncGalleryPayload(BaseModel):
    students: List[SyncGalleryStudent]

@app.post("/api/ai/sync-gallery")
def sync_gallery(payload: SyncGalleryPayload):
    """
    Syncs in-memory student face gallery vectors.
    """
    gallery.clear()
    for s in payload.students:
        gallery.register_student(
            student_id=s.student_id,
            roll_number=s.roll_number,
            full_name=s.full_name,
            embeddings=s.embeddings
        )
    return {
        "success": True,
        "enrolled_students": len(gallery.students),
        "total_embeddings": len(gallery._index_to_student),
        "threshold": gallery.similarity_threshold
    }

@app.get("/api/ai/gallery-status")
def get_gallery_status():
    """
    Returns current in-memory face gallery metrics
    """
    return {
        "enrolled_students_count": len(gallery.students),
        "total_embeddings_count": len(gallery._index_to_student),
        "similarity_threshold": gallery.similarity_threshold,
        "ambiguity_margin": gallery.ambiguity_margin
    }

class RecognizeFacePayload(BaseModel):
    image: Optional[str] = None          # Base64 image or crop
    image_path: Optional[str] = None     # Local image file path
    embedding: Optional[List[float]] = None # Precomputed 128-d embedding
    threshold: Optional[float] = None

@app.post("/api/ai/recognize-face")
def recognize_face(payload: RecognizeFacePayload):
    """
    Recognize a face against the enrolled gallery.
    Returns:
    - status: 'recognized' | 'unknown' | 'uncertain' | 'no_face'
    - label: student identity string (e.g. 'CS2026-01 — Arjun Kumar') or 'Unknown'
    - student_id: str or None
    - score: float similarity score
    """
    if payload.embedding:
        if len(payload.embedding) != 128:
            raise HTTPException(status_code=400, detail="Embedding must be 128-dimensional vector.")
        return gallery.identify_embedding(np.array(payload.embedding), custom_threshold=payload.threshold)

    img = None
    if payload.image_path and os.path.exists(payload.image_path):
        img = cv2.imread(payload.image_path)
    elif payload.image:
        try:
            raw_b64 = payload.image
            if "," in raw_b64:
                raw_b64 = raw_b64.split(",")[1]
            img_bytes = base64.b64decode(raw_b64)
            nparr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to decode base64: {str(e)}")

    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image input")

    return gallery.recognize_crop(img, custom_threshold=payload.threshold)

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("AI_SERVICE_PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
