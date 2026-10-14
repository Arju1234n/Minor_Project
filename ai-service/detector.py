import time
from typing import List, Dict, Any, Tuple
import cv2
import numpy as np
from ultralytics import YOLO

class HumanDetector:
    """
    YOLOv8 Human Detector (Person Class Only)
    Specialized for smart classroom human detection and spatial tracking.
    """
    def __init__(self, model_name: str = "yolov8n.pt", default_conf: float = 0.45):
        self.model_name = model_name
        self.default_conf = default_conf
        print(f"Loading YOLO model: {self.model_name}...")
        self.model = YOLO(self.model_name)
        # Class 0 in COCO is 'person'
        self.person_class_id = 0
        print(f"YOLO model {self.model_name} initialized. Target class: person (ID {self.person_class_id})")

    def detect_frame(
        self,
        frame: np.ndarray,
        conf_threshold: float = None,
        draw_boxes: bool = True
    ) -> Tuple[List[Dict[str, Any]], np.ndarray, float]:
        """
        Process a single image frame (BGR format from OpenCV)
        Returns:
            detections: List of detected people with coordinates and confidence
            annotated_frame: Frame with visual bounding boxes drawn
            inference_time_ms: Processing time in milliseconds
        """
        conf = conf_threshold if conf_threshold is not None else self.default_conf
        t0 = time.time()

        # Run inference filtering only for 'person' (class 0)
        results = self.model.predict(
            source=frame,
            classes=[self.person_class_id],
            conf=conf,
            verbose=False,
            device='cpu' # Runs on Apple CPU/MPS
        )

        inference_time_ms = round((time.time() - t0) * 1000, 2)
        detections = []
        result = results[0]
        h, w = frame.shape[:2]

        boxes = result.boxes
        if boxes is not None and len(boxes) > 0:
            for box in boxes:
                # xyxy format: [x1, y1, x2, y2]
                xyxy = box.xyxy[0].cpu().numpy()
                x1, y1, x2, y2 = [int(v) for v in xyxy]
                confidence = round(float(box.conf[0].cpu().numpy()), 3)

                bbox_w = x2 - x1
                bbox_h = y2 - y1

                detections.append({
                    "class": "person",
                    "confidence": confidence,
                    "bbox": {
                        "x": x1,
                        "y": y1,
                        "width": bbox_w,
                        "height": bbox_h,
                        "x2": x2,
                        "y2": y2
                    },
                    "normalized_bbox": {
                        "x": round(x1 / w, 4),
                        "y": round(y1 / h, 4),
                        "width": round(bbox_w / w, 4),
                        "height": round(bbox_h / h, 4)
                    }
                })

        # Draw polished visual bounding boxes if requested
        if draw_boxes:
            annotated_frame = frame.copy()
            for idx, det in enumerate(detections):
                bbox = det["bbox"]
                x1, y1, x2, y2 = bbox["x"], bbox["y"], bbox["x2"], bbox["y2"]
                conf = det["confidence"]

                # Modern emerald green bounding box
                box_color = (0, 230, 118) # BGR
                cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), box_color, 2)

                # Label tag banner
                label = f"Person #{idx + 1} ({int(conf * 100)}%)"
                (label_w, label_h), baseline = cv2.getTextSize(
                    label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1
                )
                tag_y1 = max(0, y1 - label_h - 8)
                cv2.rectangle(
                    annotated_frame,
                    (x1, tag_y1),
                    (x1 + label_w + 10, y1),
                    box_color,
                    -1
                )
                cv2.putText(
                    annotated_frame,
                    label,
                    (x1 + 5, y1 - 5),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    (0, 0, 0),
                    1,
                    cv2.LINE_AA
                )
        else:
            annotated_frame = frame

        return detections, annotated_frame, inference_time_ms
