"""
Phase 4 Verification Script: YOLOv8 Human Detection
Tests model loading, frame inference, person class filtering, and bounding box rendering.
"""
import os
import sys
import time
import urllib.request
import cv2
import numpy as np

# Ensure ai-service root is in python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from detector import HumanDetector

def get_sample_image(output_path: str = "sample_test.jpg") -> np.ndarray:
    """
    Provides a real test image containing multiple people for detector verification.
    Attempts to download a standard COCO/Wikimedia sample or generates a realistic scene.
    """
    if os.path.exists(output_path):
        frame = cv2.imread(output_path)
        if frame is not None:
            return frame

    # Standard public test photo containing multiple people
    sample_url = "https://raw.githubusercontent.com/ultralytics/ultralytics/main/ultralytics/assets/bus.jpg"
    print(f"📥 Fetching test image from: {sample_url}")
    try:
        urllib.request.urlretrieve(sample_url, output_path)
        frame = cv2.imread(output_path)
        if frame is not None:
            print(f"✅ Loaded test image: {output_path} ({frame.shape[1]}x{frame.shape[0]})")
            return frame
    except Exception as e:
        print(f"⚠️ Network fetch failed ({e}), generating local test image...")

    # Fallback: create synthetic frame
    frame = np.full((720, 1280, 3), 40, dtype=np.uint8)
    cv2.putText(frame, "Smart Classroom AI Test Frame", (50, 60), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
    cv2.imwrite(output_path, frame)
    return frame

def run_test():
    print("=" * 60)
    print("🧪 Phase 4: YOLOv8 Human Detection Verification Test")
    print("=" * 60)

    # 1. Initialize detector
    print("\n[Step 1] Initializing YOLOv8 Human Detector...")
    t0 = time.time()
    detector = HumanDetector(model_name="yolov8n.pt", default_conf=0.40)
    load_time = round((time.time() - t0) * 1000, 2)
    print(f"✅ Detector loaded successfully in {load_time}ms")

    # 2. Load test frame
    print("\n[Step 2] Loading test frame...")
    frame = get_sample_image("sample_classroom_test.jpg")
    print(f"Frame resolution: {frame.shape[1]}x{frame.shape[0]} (Channels: {frame.shape[2]})")

    # 3. Run human detection
    print("\n[Step 3] Running inference (Person class only)...")
    detections, annotated_frame, inf_time = detector.detect_frame(frame, conf_threshold=0.35, draw_boxes=True)

    print(f"\n📊 Detection Results:")
    print(f"  • People Detected: {len(detections)}")
    print(f"  • Inference Time:  {inf_time}ms ({round(1000 / max(inf_time, 1), 1)} FPS)")

    for i, d in enumerate(detections, 1):
        b = d["bbox"]
        print(f"  [{i}] Class: {d['class']} | Confidence: {round(d['confidence'] * 100, 1)}% | BBox: [x={b['x']}, y={b['y']}, w={b['width']}, h={b['height']}]")

    # 4. Save visual output
    out_img_path = "detected_output.jpg"
    cv2.imwrite(out_img_path, annotated_frame)
    print(f"\n✅ Visual output with bounding boxes saved to: {out_img_path}")

    # Verify criteria
    assert len(detections) > 0, "Expected at least 1 person detected in sample image"
    assert all(d["class"] == "person" for d in detections), "Only person class should be detected"
    print("\n🎉 Phase 4 verification PASSED! YOLO human detection is working perfectly.")

if __name__ == "__main__":
    run_test()
