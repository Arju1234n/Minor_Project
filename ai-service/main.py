import base64
import io
import os
from typing import Optional
import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, Query, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from detector import HumanDetector

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

# Global HumanDetector instance (lazy/startup loaded)
detector: Optional[HumanDetector] = None

@app.on_event("startup")
def startup_event():
    global detector
    model_name = os.getenv("YOLO_MODEL", "yolov8n.pt")
    default_conf = float(os.getenv("DETECTION_CONFIDENCE", "0.45"))
    detector = HumanDetector(model_name=model_name, default_conf=default_conf)
    print("🚀 AI Service startup complete. Ready for detection requests.")

class Base64FramePayload(BaseModel):
    image: str # Base64 encoded JPEG/PNG frame
    conf_threshold: Optional[float] = None
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
        "model": detector.model_name if detector else None,
        "default_conf": detector.default_conf if detector else None,
        "target_class": "person (ID 0)"
    }

# ──────────────────────────────────────────
# Detection via Multipart Form Upload
# ──────────────────────────────────────────
@app.post("/api/ai/detect-file")
async def detect_uploaded_file(
    file: UploadFile = File(...),
    conf_threshold: Optional[float] = Query(None, ge=0.1, le=0.99),
    return_annotated: bool = Query(False)
):
    if detector is None:
        raise HTTPException(status_code=503, detail="Detector not initialized")

    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            raise HTTPException(status_code=400, detail="Invalid image file or format")

        detections, annotated_frame, inference_time_ms = detector.detect_frame(
            frame, conf_threshold=conf_threshold, draw_boxes=return_annotated
        )

        response_data = {
            "success": True,
            "people_count": len(detections),
            "detections": detections,
            "inference_time_ms": inference_time_ms,
            "image_size": {
                "width": frame.shape[1],
                "height": frame.shape[0]
            }
        }

        if return_annotated:
            _, buffer = cv2.imencode(".jpg", annotated_frame)
            b64_img = base64.b64encode(buffer).decode("utf-8")
            response_data["annotated_image"] = f"data:image/jpeg;base64,{b64_img}"

        return response_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ──────────────────────────────────────────
# Detection via Base64 JSON Payload (WebRTC / Canvas snapshots)
# ──────────────────────────────────────────
@app.post("/api/ai/detect-frame")
async def detect_base64_frame(payload: Base64FramePayload):
    if detector is None:
        raise HTTPException(status_code=503, detail="Detector not initialized")

    try:
        raw_b64 = payload.image
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",")[1]

        image_bytes = base64.b64decode(raw_b64)
        nparr = np.frombuffer(image_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            raise HTTPException(status_code=400, detail="Could not decode base64 image")

        detections, annotated_frame, inference_time_ms = detector.detect_frame(
            frame,
            conf_threshold=payload.conf_threshold,
            draw_boxes=payload.return_annotated
        )

        response_data = {
            "success": True,
            "people_count": len(detections),
            "detections": detections,
            "inference_time_ms": inference_time_ms,
            "image_size": {
                "width": frame.shape[1],
                "height": frame.shape[0]
            }
        }

        if payload.return_annotated:
            _, buffer = cv2.imencode(".jpg", annotated_frame)
            b64_img = base64.b64encode(buffer).decode("utf-8")
            response_data["annotated_image"] = f"data:image/jpeg;base64,{b64_img}"

        return response_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("AI_SERVICE_PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
