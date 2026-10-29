import base64
import os
import time
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, Query, HTTPException, Body
from fastapi.responses import StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from detector import HumanDetector
from tracker import TrackerRegistry
from face_engine import face_engine
from recognition_service import gallery

last_gallery_sync_time: Optional[str] = None
from cctv_engine import cctv_engine, CCTVWorker

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
    device = os.getenv("YOLO_DEVICE")
    detector = HumanDetector(model_name=model_name, default_conf=default_conf, device=device)
    tracker_registry = TrackerRegistry(model_name=model_name, device=device)
    sync_gallery_from_backend()
    print(f"🚀 AI Service startup complete. Model: {model_name}, Device: {detector.device}, ByteTrack, and Facial Recognition ready.")

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
        "device": detector.device if detector else None,
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

    t0 = time.perf_counter()
    try:
        raw_b64 = payload.image
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",")[1]

        image_bytes = base64.b64decode(raw_b64)
        nparr = np.frombuffer(image_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            raise HTTPException(status_code=400, detail="Could not decode base64 image")

        decode_time_ms = round((time.perf_counter() - t0) * 1000, 2)
        session_id = payload.session_id or "default"

        if payload.enable_tracking:
            tracker = tracker_registry.get_tracker(session_id, default_conf=payload.conf_threshold or 0.40)
            result = tracker.track_frame(
                frame,
                conf_threshold=payload.conf_threshold,
                tripwire_y=payload.tripwire_y
            )
            total_time_ms = round((time.perf_counter() - t0) * 1000, 2)
            result["success"] = True
            result["inference_time_ms"] = total_time_ms
            result["image_size"] = {"width": frame.shape[1], "height": frame.shape[0]}
            if "telemetry" in result:
                result["telemetry"]["decode_time_ms"] = decode_time_ms
                result["telemetry"]["total_server_time_ms"] = total_time_ms
            return result
        else:
            # Simple YOLO detection without ByteTrack persistence
            t_det0 = time.perf_counter()
            detections, _, inf_time = detector.detect_frame(
                frame,
                conf_threshold=payload.conf_threshold,
                draw_boxes=False
            )
            t_det_ms = round((time.perf_counter() - t_det0) * 1000, 2)
            t_rec0 = time.perf_counter()
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
                    d["tracking_id"] = idx + 1
                    if rec_res.get("face_box"):
                        fb = rec_res["face_box"]
                        d["face_box"] = {
                            "x": head_x1 + fb["x"],
                            "y": head_y1 + fb["y"],
                            "width": fb["width"],
                            "height": fb["height"],
                        }
                        d["normalized_face_box"] = {
                            "x": round((head_x1 + fb["x"]) / w, 4),
                            "y": round((head_y1 + fb["y"]) / h, 4),
                            "width": round(fb["width"] / w, 4),
                            "height": round(fb["height"] / h, 4),
                        }
                    else:
                        d["face_box"] = None
                        d["normalized_face_box"] = None
                else:
                    d["tracking_id"] = idx + 1
                    d["identity_status"] = "unavailable"
                    d["label"] = "Identity unavailable"
                    d["student_id"] = None
                    d["full_name"] = None
                    d["roll_number"] = None
                    d["similarity"] = 0.0
                    d["face_box"] = None
                    d["normalized_face_box"] = None

            # Multi-person identity conflict resolution
            best_match_by_student = {}
            for d in detections:
                if d.get("identity_status") == "recognized" and d.get("student_id"):
                    sid = str(d["student_id"])
                    sim = d.get("similarity", 0.0)
                    if sid not in best_match_by_student or sim > best_match_by_student[sid]["similarity"]:
                        best_match_by_student[sid] = {
                            "tracking_id": d["tracking_id"],
                            "similarity": sim
                        }

            for d in detections:
                if d.get("identity_status") == "recognized" and d.get("student_id"):
                    sid = str(d["student_id"])
                    if best_match_by_student[sid]["tracking_id"] != d["tracking_id"]:
                        d["identity_status"] = "unknown"
                        d["label"] = "Unknown"
                        d["student_id"] = None
                        d["full_name"] = None
                        d["roll_number"] = None

            recognized_students = [
                {
                    "student_id": d["student_id"],
                    "full_name": d["full_name"],
                    "roll_number": d["roll_number"],
                    "similarity": d["similarity"],
                    "tracking_id": d["tracking_id"]
                }
                for d in detections if d.get("identity_status") == "recognized"
            ]

            t_rec_ms = round((time.perf_counter() - t_rec0) * 1000, 2)
            total_time_ms = round((time.perf_counter() - t0) * 1000, 2)

            return {
                "success": True,
                "session_id": session_id,
                "people_count": len(detections),
                "unique_ids_count": len(detections),
                "recognized_count": len(recognized_students),
                "unrecognized_count": len(detections) - len(recognized_students),
                "recognized_students": recognized_students,
                "gallery_count": len(gallery.students),
                "detections": detections,
                "inference_time_ms": total_time_ms,
                "image_size": {"width": frame.shape[1], "height": frame.shape[0]},
                "telemetry": {
                    "detection_time_ms": t_det_ms,
                    "recognition_time_ms": t_rec_ms,
                    "decode_time_ms": decode_time_ms,
                    "total_processing_time_ms": total_time_ms,
                    "device": detector.device,
                    "model_name": detector.model_name
                }
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
class AIConfigUpdatePayload(BaseModel):
    conf: Optional[float] = None
    model_name: Optional[str] = None
    device: Optional[str] = None
    face_rec_interval: Optional[int] = None
    face_rec_retry: Optional[int] = None
    max_faces_per_frame: Optional[int] = None

@app.get("/api/ai/config")
def get_config():
    if detector is None:
        raise HTTPException(status_code=503, detail="Detector not initialized")
    default_tracker = tracker_registry.get_tracker("default") if tracker_registry else None
    return {
        "model_name": detector.model_name,
        "default_conf": detector.default_conf,
        "device": detector.device,
        "tracker": "ByteTrack",
        "target_class": "person (ID 0)",
        "available_models": ["yolov8n.pt", "yolo11n.pt", "yolov8n.mlpackage", "yolo11n.mlpackage"],
        "available_devices": ["mps", "cpu", "coreml"],
        "face_rec_interval_frames": default_tracker.face_rec_interval if default_tracker else 30,
        "face_rec_retry_frames": default_tracker.face_rec_retry if default_tracker else 15,
        "max_faces_per_frame": default_tracker.max_faces_per_frame if default_tracker else 2
    }

@app.patch("/api/ai/config")
def update_config(payload: AIConfigUpdatePayload):
    global detector, tracker_registry
    if detector is None:
        raise HTTPException(status_code=503, detail="Detector not initialized")

    messages = []
    if payload.conf is not None:
        detector.default_conf = round(float(payload.conf), 2)
        messages.append(f"Confidence threshold updated to {detector.default_conf}")

    new_model = payload.model_name or detector.model_name
    new_device = payload.device or detector.device

    if (payload.model_name and payload.model_name != detector.model_name) or (payload.device and payload.device != detector.device):
        detector = HumanDetector(model_name=new_model, default_conf=detector.default_conf, device=new_device)
        tracker_registry = TrackerRegistry(model_name=new_model, device=new_device)
        messages.append(f"Model reloaded: {new_model} on device: {detector.device}")

    if tracker_registry:
        for t in tracker_registry.trackers.values():
            if payload.face_rec_interval is not None:
                t.face_rec_interval = payload.face_rec_interval
            if payload.face_rec_retry is not None:
                t.face_rec_retry = payload.face_rec_retry
            if payload.max_faces_per_frame is not None:
                t.max_faces_per_frame = payload.max_faces_per_frame

    return {
        "success": True,
        "message": " | ".join(messages) if messages else "Config unchanged",
        "config": get_config()
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
    global last_gallery_sync_time
    gallery.clear()
    for s in payload.students:
        gallery.register_student(
            student_id=s.student_id,
            roll_number=s.roll_number,
            full_name=s.full_name,
            embeddings=s.embeddings
        )
    last_gallery_sync_time = datetime.now(timezone.utc).isoformat()
    return {
        "success": True,
        "enrolled_students": len(gallery.students),
        "total_embeddings": len(gallery._index_to_student),
        "threshold": gallery.similarity_threshold,
        "last_synced_at": last_gallery_sync_time
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
        "ambiguity_margin": gallery.ambiguity_margin,
        "last_synced_at": last_gallery_sync_time
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

# ──────────────────────────────────────────
# CCTV / IP Camera RTSP Endpoints
# ──────────────────────────────────────────
class CCTVTestPayload(BaseModel):
    rtsp_url: str
    timeout_sec: Optional[float] = 4.0

class CCTVStartPayload(BaseModel):
    session_id: str
    rtsp_url: str
    fps: Optional[int] = 15

class CCTVStopPayload(BaseModel):
    session_id: str

@app.post("/api/ai/cctv/test")
def test_cctv_stream(payload: CCTVTestPayload):
    """
    Test whether an RTSP / HTTP stream is accessible and decodable.
    """
    return CCTVWorker.test_stream_connection(payload.rtsp_url, timeout_sec=payload.timeout_sec or 4.0)

@app.post("/api/ai/cctv/start")
def start_cctv_worker(payload: CCTVStartPayload):
    """
    Start continuous RTSP stream ingestion worker for a camera session.
    """
    worker = cctv_engine.start_worker(
        session_id=payload.session_id,
        rtsp_url=payload.rtsp_url,
        fps=payload.fps or 15
    )
    return {
        "success": True,
        "message": f"CCTV worker started for session {payload.session_id}",
        "status": worker.get_status()
    }

@app.post("/api/ai/cctv/stop")
def stop_cctv_worker(payload: CCTVStopPayload):
    """
    Stop continuous RTSP stream ingestion worker.
    """
    stopped = cctv_engine.stop_worker(payload.session_id)
    return {
        "success": True,
        "stopped": stopped,
        "message": f"CCTV worker stopped for session {payload.session_id}" if stopped else "Worker was not running"
    }

@app.get("/api/ai/cctv/status/{session_id}")
def get_cctv_status(session_id: str):
    """
    Get runtime health and connection status of a CCTV worker.
    """
    worker = cctv_engine.get_worker(session_id)
    if not worker:
        return {"session_id": session_id, "running": False, "connected": False, "message": "No active worker for session"}
    return worker.get_status()

@app.get("/api/ai/cctv/{session_id}/preview")
def get_cctv_preview(session_id: str):
    """
    Return the latest decoded JPEG frame from the CCTV camera as image/jpeg.
    """
    worker = cctv_engine.get_worker(session_id)
    if not worker:
        raise HTTPException(status_code=404, detail="CCTV worker not running for this session")

    _, jpeg_bytes, _ = worker.get_latest_frame()
    if not jpeg_bytes:
        raise HTTPException(status_code=503, detail="No video frame decoded yet from CCTV stream")

    return Response(content=jpeg_bytes, media_type="image/jpeg")

@app.get("/api/ai/cctv/{session_id}/stream")
def stream_cctv_mjpeg(session_id: str):
    """
    Direct low-latency multipart MJPEG streaming endpoint for HTML5 <img> tags.
    """
    worker = cctv_engine.get_worker(session_id)
    if not worker:
        raise HTTPException(status_code=404, detail="CCTV worker not running for this session")

    def mjpeg_generator():
        while worker.running:
            _, jpeg_bytes, _ = worker.get_latest_frame()
            if jpeg_bytes:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + jpeg_bytes + b"\r\n"
                )
            time.sleep(1.0 / float(worker.target_fps))

    return StreamingResponse(
        mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@app.get("/api/ai/cctv/{session_id}/detect")
def detect_cctv_frame(
    session_id: str,
    conf_threshold: Optional[float] = 0.40,
    tripwire_y: Optional[float] = 0.50,
    enable_tracking: Optional[bool] = True
):
    """
    Execute YOLO + ByteTrack + ArcFace recognition pipeline directly on the latest CCTV frame.
    Avoids base64 serialization roundtrips for CCTV cameras!
    """
    if detector is None or tracker_registry is None:
        raise HTTPException(status_code=503, detail="AI Service not initialized")

    worker = cctv_engine.get_worker(session_id)
    if not worker:
        raise HTTPException(status_code=404, detail="CCTV worker not running for this session")

    frame, _, frame_time = worker.get_latest_frame()
    if frame is None:
        raise HTTPException(status_code=503, detail="No video frame available from CCTV stream")

    t0 = time.perf_counter()
    if enable_tracking:
        tracker = tracker_registry.get_tracker(session_id, default_conf=conf_threshold or 0.40)
        result = tracker.track_frame(
            frame,
            conf_threshold=conf_threshold,
            tripwire_y=tripwire_y
        )
    else:
        dets, _, inf_time = detector.detect_frame(frame, conf_threshold=conf_threshold or 0.40, draw_boxes=False)
        result = {
            "people_count": len(dets),
            "detections": dets,
            "session_id": session_id,
            "tracking_enabled": False,
            "telemetry": {
                "detection_time_ms": inf_time,
                "recognition_time_ms": 0.0,
                "tracking_time_ms": 0.0,
                "total_processing_time_ms": inf_time,
                "device": detector.device,
                "model_name": detector.model_name
            }
        }

    total_inf_time = round((time.perf_counter() - t0) * 1000, 2)
    result["success"] = True
    result["inference_time_ms"] = total_inf_time
    result["image_size"] = {"width": frame.shape[1], "height": frame.shape[0]}
    result["frame_age_ms"] = round((time.time() - frame_time) * 1000, 1)
    if "telemetry" in result:
        result["telemetry"]["frame_age_ms"] = result["frame_age_ms"]
        result["telemetry"]["total_server_time_ms"] = total_inf_time
    return result

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("AI_SERVICE_PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
