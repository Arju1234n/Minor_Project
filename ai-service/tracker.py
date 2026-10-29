import os
import math
import time
from collections import deque
from typing import Dict, List, Any, Optional, Tuple, Set
import numpy as np
import cv2
import torch
from ultralytics import YOLO

from recognition_service import gallery

def get_optimal_device(requested_device: str = None) -> str:
    """
    Auto-detect optimal inference device on Apple Silicon / CUDA / CPU.
    Prefers Metal Performance Shaders (MPS) on Apple Silicon M-series.
    """
    if requested_device:
        return requested_device
    env_dev = os.getenv("YOLO_DEVICE")
    if env_dev:
        return env_dev
    if torch.backends.mps.is_available() and torch.backends.mps.is_built():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"

class SessionTracker:
    """
    ByteTrack Multi-Person Tracker with Trajectory History,
    Virtual Tripwire Line Crossing, Zone Occupancy Counting,
    and High-Performance Scheduled Facial Recognition against Student Gallery.
    Supports Apple Silicon MPS/CoreML hardware acceleration.
    """
    def __init__(
        self,
        session_id: str,
        model_name: str = "yolov8n.pt",
        default_conf: float = 0.40,
        device: str = None,
        face_rec_interval: int = 30,
        face_rec_retry: int = 15,
        max_faces_per_frame: int = 2,
        min_face_crop_px: int = 40
    ):
        self.session_id = session_id
        self.model_name = os.getenv("YOLO_MODEL", model_name)
        self.default_conf = default_conf
        self.device = get_optimal_device(device)
        self.model = YOLO(self.model_name)
        self.person_class_id = 0

        # Performance tuning parameters
        self.face_rec_interval = int(os.getenv("FACE_REC_INTERVAL", str(face_rec_interval)))
        self.face_rec_retry = int(os.getenv("FACE_REC_RETRY_INTERVAL", str(face_rec_retry)))
        self.max_faces_per_frame = int(os.getenv("FACE_REC_MAX_PER_FRAME", str(max_faces_per_frame)))
        self.min_face_crop_px = int(os.getenv("MIN_FACE_CROP_PX", str(min_face_crop_px)))

        # Trajectory history: tracking_id -> deque of (norm_x, norm_y)
        self.trajectories: Dict[int, deque] = {}
        # Set of all unique tracking IDs seen across session
        self.unique_ids: Set[int] = set()

        # Virtual Tripwire state (horizontal line normalized 0.0 - 1.0)
        self.tripwire_y: float = 0.50
        self.count_entered: int = 0
        self.count_exited: int = 0
        # Tracks last known position relative to tripwire: tracking_id -> "above" | "below"
        self.tripwire_positions: Dict[int, str] = {}
        self.crossed_ids: Set[int] = set()

        # Virtual Zone (normalized rect: { x1, y1, x2, y2 })
        self.zone_rect = {"x1": 0.2, "y1": 0.2, "x2": 0.8, "y2": 0.8}
        self.zone_inside_count: int = 0

        # Biometric track identity cache and staleness tracking
        self.track_identities: Dict[int, Dict[str, Any]] = {}
        self.track_unseen_frames: Dict[int, int] = {}
        self.track_consecutive_no_faces: Dict[int, int] = {}
        self.frame_counter: int = 0

    def reset(self):
        """Reset session tracking history, counters, and identity cache"""
        self.trajectories.clear()
        self.unique_ids.clear()
        self.tripwire_positions.clear()
        self.crossed_ids.clear()
        self.count_entered = 0
        self.count_exited = 0
        self.zone_inside_count = 0
        self.track_identities.clear()
        self.track_unseen_frames.clear()
        self.track_consecutive_no_faces.clear()
        self.frame_counter = 0

    def update_tripwire_y(self, y: float):
        self.tripwire_y = max(0.05, min(0.95, y))

    def track_frame(
        self,
        frame: np.ndarray,
        conf_threshold: Optional[float] = None,
        tripwire_y: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        Runs YOLO + ByteTrack on a video frame with Apple Silicon acceleration
        and rate-limited scheduled face recognition.
        """
        t_start = time.perf_counter()
        conf = conf_threshold if conf_threshold is not None else self.default_conf
        if tripwire_y is not None:
            self.update_tripwire_y(tripwire_y)

        h, w = frame.shape[:2]
        self.frame_counter += 1

        # Run ByteTrack multi-person tracking on selected device (MPS / CoreML / CPU)
        t_det_start = time.perf_counter()
        track_kwargs = {
            "source": frame,
            "persist": True,
            "tracker": "bytetrack.yaml",
            "classes": [self.person_class_id],
            "conf": conf,
            "verbose": False
        }
        if self.device != "coreml" and not self.model_name.endswith(".mlpackage"):
            track_kwargs["device"] = self.device

        results = self.model.track(**track_kwargs)
        t_detection = (time.perf_counter() - t_det_start) * 1000

        t_track_start = time.perf_counter()
        detections = []
        active_ids = []
        zone_count = 0
        result = results[0]
        boxes = result.boxes

        parsed_boxes = []

        if boxes is not None and len(boxes) > 0:
            for idx, box in enumerate(boxes):
                xyxy = box.xyxy[0].cpu().numpy()
                x1, y1, x2, y2 = [int(v) for v in xyxy]
                conf_val = round(float(box.conf[0].cpu().numpy()), 3)

                # Tracking ID from ByteTrack
                tracking_id = int(box.id[0].cpu().numpy()) if box.id is not None else (idx + 1)
                active_ids.append(tracking_id)
                self.unique_ids.add(tracking_id)

                bbox_w = max(1, x2 - x1)
                bbox_h = max(1, y2 - y1)

                # Normalized centroid and bounding box
                norm_cx = round(((x1 + x2) / 2.0) / w, 4)
                norm_cy = round(((y1 + y2) / 2.0) / h, 4)

                norm_bbox = {
                    "x": round(x1 / w, 4),
                    "y": round(y1 / h, 4),
                    "width": round(bbox_w / w, 4),
                    "height": round(bbox_h / h, 4)
                }

                # Update trajectory history
                if tracking_id not in self.trajectories:
                    self.trajectories[tracking_id] = deque(maxlen=25)
                
                # Check velocity from previous point for motion blur detection
                velocity = 0.0
                if len(self.trajectories[tracking_id]) > 0:
                    prev_pt = self.trajectories[tracking_id][-1]
                    dx = norm_cx - prev_pt["x"]
                    dy = norm_cy - prev_pt["y"]
                    velocity = math.sqrt(dx * dx + dy * dy)

                self.trajectories[tracking_id].append({"x": norm_cx, "y": norm_cy})

                # Check Virtual Zone occupancy
                z = self.zone_rect
                if z["x1"] <= norm_cx <= z["x2"] and z["y1"] <= norm_cy <= z["y2"]:
                    zone_count += 1

                # Check Virtual Tripwire Line Crossing
                current_pos = "above" if norm_cy < self.tripwire_y else "below"
                prev_pos = self.tripwire_positions.get(tracking_id)

                if prev_pos is not None and prev_pos != current_pos:
                    if prev_pos == "above" and current_pos == "below":
                        self.count_entered += 1
                        self.crossed_ids.add(tracking_id)
                    elif prev_pos == "below" and current_pos == "above":
                        self.count_exited += 1
                        self.crossed_ids.add(tracking_id)

                self.tripwire_positions[tracking_id] = current_pos

                # Crop upper torso / head region (upper 52% of detected person)
                head_y1 = max(0, y1)
                head_y2 = min(h, y1 + max(int(bbox_h * 0.52), 40))
                margin_x = int(bbox_w * 0.05)
                head_x1 = max(0, x1 + margin_x)
                head_x2 = min(w, x2 - margin_x)

                crop_h = max(0, head_y2 - head_y1)
                crop_w = max(0, head_x2 - head_x1)

                parsed_boxes.append({
                    "tracking_id": tracking_id,
                    "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                    "bbox_w": bbox_w, "bbox_h": bbox_h,
                    "conf_val": conf_val,
                    "norm_cx": norm_cx, "norm_cy": norm_cy,
                    "norm_bbox": norm_bbox,
                    "head_x1": head_x1, "head_y1": head_y1,
                    "head_x2": head_x2, "head_y2": head_y2,
                    "crop_w": crop_w, "crop_h": crop_h,
                    "velocity": velocity
                })

        t_tracking = (time.perf_counter() - t_track_start) * 1000

        # ── Biometric Face Recognition Scheduling & Suitability Filter ──
        t_rec_start = time.perf_counter()
        candidates_to_recognize = []

        for p in parsed_boxes:
            tid = p["tracking_id"]
            cached = self.track_identities.get(tid)
            need_rec = False
            last_checked = cached.get("last_checked_frame", 0) if cached else 0
            frames_since_check = self.frame_counter - last_checked

            # Check suitability: adequate resolution, valid aspect ratio, motion stability
            crop_ok = (p["crop_h"] >= self.min_face_crop_px and p["crop_w"] >= self.min_face_crop_px)
            aspect_ratio = (p["crop_w"] / p["crop_h"]) if p["crop_h"] > 0 else 0
            aspect_ok = (0.45 <= aspect_ratio <= 1.8)
            stable_motion = (p["velocity"] <= 0.08)  # Skip if person is moving rapidly (motion blur)

            # Exponential backoff on persistent no_face failures
            consec_no_face = self.track_consecutive_no_faces.get(tid, 0)
            retry_threshold = min(60, self.face_rec_retry * (2 ** min(consec_no_face, 2)))

            if crop_ok and aspect_ok and stable_motion:
                if cached is None:
                    need_rec = True
                elif cached.get("identity_status") == "recognized":
                    if frames_since_check >= self.face_rec_interval:
                        need_rec = True
                else:
                    if frames_since_check >= retry_threshold:
                        need_rec = True

            if need_rec:
                # Priority: never checked tracks first, then tracks checked longest ago
                priority = 999999 if (cached is None) else frames_since_check
                candidates_to_recognize.append((priority, p))

        # Sort descending by priority and select up to max_faces_per_frame
        candidates_to_recognize.sort(key=lambda x: x[0], reverse=True)
        selected_to_recognize = {p["tracking_id"]: p for _, p in candidates_to_recognize[:self.max_faces_per_frame]}

        faces_analyzed_count = 0

        # Execute face recognition on selected suitable tracks
        for tid, p in selected_to_recognize.items():
            head_crop = frame[p["head_y1"]:p["head_y2"], p["head_x1"]:p["head_x2"]]
            rec_res = gallery.recognize_crop(head_crop)
            faces_analyzed_count += 1
            status = rec_res.get("status", "unknown")

            if status == "recognized":
                id_status = "recognized"
                label = rec_res.get("label", "Recognized Student")
                self.track_consecutive_no_faces[tid] = 0
            elif status == "uncertain":
                id_status = "uncertain"
                label = rec_res.get("label", "Uncertain Match")
            elif status == "no_face":
                id_status = "unavailable"
                label = "Identity unavailable"
                self.track_consecutive_no_faces[tid] = self.track_consecutive_no_faces.get(tid, 0) + 1
            else:
                id_status = "unknown"
                label = "Unknown"

            face_box = None
            norm_face_box = None
            if rec_res.get("face_box"):
                fb = rec_res["face_box"]
                face_box = {
                    "x": p["head_x1"] + fb["x"],
                    "y": p["head_y1"] + fb["y"],
                    "width": fb["width"],
                    "height": fb["height"],
                }
                norm_face_box = {
                    "x": round((p["head_x1"] + fb["x"]) / w, 4),
                    "y": round((p["head_y1"] + fb["y"]) / h, 4),
                    "width": round(fb["width"] / w, 4),
                    "height": round(fb["height"] / h, 4),
                }

            cached = self.track_identities.get(tid)
            if cached and cached.get("identity_status") == "recognized" and id_status in ("unavailable", "uncertain"):
                identity_info = {
                    "identity_status": "recognized",
                    "label": cached["label"],
                    "student_id": cached["student_id"],
                    "full_name": cached["full_name"],
                    "roll_number": cached["roll_number"],
                    "similarity": cached["similarity"],
                    "face_box": face_box or cached.get("face_box"),
                    "normalized_face_box": norm_face_box or cached.get("normalized_face_box"),
                    "last_checked_frame": self.frame_counter,
                }
            else:
                identity_info = {
                    "identity_status": id_status,
                    "label": label,
                    "student_id": rec_res.get("student_id"),
                    "full_name": rec_res.get("full_name"),
                    "roll_number": rec_res.get("roll_number"),
                    "similarity": rec_res.get("score", 0.0),
                    "face_box": face_box,
                    "normalized_face_box": norm_face_box,
                    "last_checked_frame": self.frame_counter,
                }

            self.track_identities[tid] = identity_info

        t_recognition = (time.perf_counter() - t_rec_start) * 1000

        # Assemble final detection records
        for p in parsed_boxes:
            tid = p["tracking_id"]
            identity_info = self.track_identities.get(tid) or {
                "identity_status": "unavailable",
                "label": "Identity unavailable",
                "student_id": None,
                "full_name": None,
                "roll_number": None,
                "similarity": 0.0,
                "face_box": None,
                "normalized_face_box": None,
                "last_checked_frame": 0,
            }

            detections.append({
                "tracking_id": tid,
                "class": "person",
                "confidence": p["conf_val"],
                "bbox": {
                    "x": p["x1"],
                    "y": p["y1"],
                    "width": p["bbox_w"],
                    "height": p["bbox_h"],
                },
                "normalized_bbox": p["norm_bbox"],
                "centroid": {"x": p["norm_cx"], "y": p["norm_cy"]},
                "trajectory": list(self.trajectories[tid]),
                # Recognition metadata
                "identity_status": identity_info["identity_status"],
                "label": identity_info["label"],
                "student_id": identity_info["student_id"],
                "full_name": identity_info["full_name"],
                "roll_number": identity_info["roll_number"],
                "similarity": identity_info["similarity"],
                "face_box": identity_info.get("face_box"),
                "normalized_face_box": identity_info.get("normalized_face_box"),
            })

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
                    # Demote duplicate assignment to Unknown for this frame
                    d["identity_status"] = "unknown"
                    d["label"] = "Unknown"
                    d["student_id"] = None
                    d["full_name"] = None
                    d["roll_number"] = None
                    if d["tracking_id"] in self.track_identities:
                        self.track_identities[d["tracking_id"]]["identity_status"] = "unknown"
                        self.track_identities[d["tracking_id"]]["label"] = "Unknown"
                        self.track_identities[d["tracking_id"]]["student_id"] = None
                        self.track_identities[d["tracking_id"]]["full_name"] = None
                        self.track_identities[d["tracking_id"]]["roll_number"] = None

        self.zone_inside_count = zone_count

        # Evict stale tracks absent for > 25 frames
        stale_tracks = []
        for tid in list(self.track_identities.keys()):
            if tid in active_ids:
                self.track_unseen_frames[tid] = 0
            else:
                self.track_unseen_frames[tid] = self.track_unseen_frames.get(tid, 0) + 1
                if self.track_unseen_frames[tid] > 25:
                    stale_tracks.append(tid)

        for tid in stale_tracks:
            self.track_identities.pop(tid, None)
            self.trajectories.pop(tid, None)
            self.tripwire_positions.pop(tid, None)
            self.track_unseen_frames.pop(tid, None)
            self.track_consecutive_no_faces.pop(tid, None)

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

        t_total = (time.perf_counter() - t_start) * 1000

        return {
            "session_id": self.session_id,
            "people_count": len(detections),
            "unique_ids_count": len(self.unique_ids),
            "recognized_count": len(recognized_students),
            "unrecognized_count": len(detections) - len(recognized_students),
            "recognized_students": recognized_students,
            "gallery_count": len(gallery.students),
            "active_tracking_ids": active_ids,
            "image_size": {"width": w, "height": h},
            "tripwire": {
                "entered": self.count_entered,
                "exited": self.count_exited,
                "line_y": self.tripwire_y
            },
            "zone": {
                "inside_count": self.zone_inside_count,
                "rect": self.zone_rect
            },
            "detections": detections,
            "telemetry": {
                "detection_time_ms": round(t_detection, 2),
                "tracking_time_ms": round(t_tracking, 2),
                "recognition_time_ms": round(t_recognition, 2),
                "total_processing_time_ms": round(t_total, 2),
                "faces_analyzed": faces_analyzed_count,
                "faces_queued": len(candidates_to_recognize),
                "device": self.device,
                "model_name": self.model_name
            }
        }

class TrackerRegistry:
    """
    Manages session-isolated ByteTrack trackers for multi-camera feeds.
    """
    def __init__(self, model_name: str = "yolov8n.pt", device: str = None):
        self.model_name = model_name
        self.device = device
        self.trackers: Dict[str, SessionTracker] = {}

    def get_tracker(
        self,
        session_id: str,
        default_conf: float = 0.40,
        device: str = None,
        face_rec_interval: int = 30,
        face_rec_retry: int = 15,
        max_faces_per_frame: int = 2
    ) -> SessionTracker:
        if session_id not in self.trackers:
            self.trackers[session_id] = SessionTracker(
                session_id=session_id,
                model_name=self.model_name,
                default_conf=default_conf,
                device=device or self.device,
                face_rec_interval=face_rec_interval,
                face_rec_retry=face_rec_retry,
                max_faces_per_frame=max_faces_per_frame
            )
        return self.trackers[session_id]

    def reset_session(self, session_id: str):
        if session_id in self.trackers:
            self.trackers[session_id].reset()
