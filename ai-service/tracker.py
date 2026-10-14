from collections import deque
from typing import Dict, List, Any, Optional, Tuple, Set
import numpy as np
import cv2
from ultralytics import YOLO

class SessionTracker:
    """
    ByteTrack Multi-Person Tracker with Trajectory History,
    Virtual Tripwire Line Crossing, and Zone Occupancy Counting.
    """
    def __init__(self, session_id: str, model_name: str = "yolov8n.pt", default_conf: float = 0.40):
        self.session_id = session_id
        self.model_name = model_name
        self.default_conf = default_conf
        self.model = YOLO(model_name)
        self.person_class_id = 0

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

    def reset(self):
        """Reset session tracking history and counters"""
        self.trajectories.clear()
        self.unique_ids.clear()
        self.tripwire_positions.clear()
        self.crossed_ids.clear()
        self.count_entered = 0
        self.count_exited = 0
        self.zone_inside_count = 0

    def update_tripwire_y(self, y: float):
        self.tripwire_y = max(0.05, min(0.95, y))

    def track_frame(
        self,
        frame: np.ndarray,
        conf_threshold: Optional[float] = None,
        tripwire_y: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        Runs YOLOv8 + ByteTrack on a video frame.
        Associates persistent tracking IDs, updates trajectory paths,
        and computes virtual line crossings.
        """
        conf = conf_threshold if conf_threshold is not None else self.default_conf
        if tripwire_y is not None:
            self.update_tripwire_y(tripwire_y)

        h, w = frame.shape[:2]

        # Run ByteTrack multi-person tracking
        results = self.model.track(
            source=frame,
            persist=True,
            tracker="bytetrack.yaml",
            classes=[self.person_class_id],
            conf=conf,
            verbose=False,
            device="cpu"
        )

        detections = []
        active_ids = []
        zone_count = 0
        result = results[0]
        boxes = result.boxes

        if boxes is not None and len(boxes) > 0:
            for idx, box in enumerate(boxes):
                xyxy = box.xyxy[0].cpu().numpy()
                x1, y1, x2, y2 = [int(v) for v in xyxy]
                conf_val = round(float(box.conf[0].cpu().numpy()), 3)

                # Tracking ID from ByteTrack
                tracking_id = int(box.id[0].cpu().numpy()) if box.id is not None else (idx + 1)
                active_ids.append(tracking_id)
                self.unique_ids.add(tracking_id)

                bbox_w = x2 - x1
                bbox_h = y2 - y1

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

                detections.append({
                    "tracking_id": tracking_id,
                    "class": "person",
                    "confidence": conf_val,
                    "bbox": {
                        "x": x1,
                        "y": y1,
                        "width": bbox_w,
                        "height": bbox_h,
                    },
                    "normalized_bbox": norm_bbox,
                    "centroid": {"x": norm_cx, "y": norm_cy},
                    "trajectory": list(self.trajectories[tracking_id])
                })

        self.zone_inside_count = zone_count

        return {
            "session_id": self.session_id,
            "people_count": len(detections),
            "unique_ids_count": len(self.unique_ids),
            "active_tracking_ids": active_ids,
            "tripwire": {
                "entered": self.count_entered,
                "exited": self.count_exited,
                "line_y": self.tripwire_y
            },
            "zone": {
                "inside_count": self.zone_inside_count,
                "rect": self.zone_rect
            },
            "detections": detections
        }

class TrackerRegistry:
    """
    Manages session-isolated ByteTrack trackers for multi-camera feeds.
    """
    def __init__(self, model_name: str = "yolov8n.pt"):
        self.model_name = model_name
        self.trackers: Dict[str, SessionTracker] = {}

    def get_tracker(self, session_id: str, default_conf: float = 0.40) -> SessionTracker:
        if session_id not in self.trackers:
            self.trackers[session_id] = SessionTracker(
                session_id=session_id,
                model_name=self.model_name,
                default_conf=default_conf
            )
        return self.trackers[session_id]

    def reset_session(self, session_id: str):
        if session_id in self.trackers:
            self.trackers[session_id].reset()
