"""
Test suite for CCTV Ingestion Engine and Computer Vision Integration.
"""

import time
import os
import cv2
import numpy as np
import requests
from cctv_engine import cctv_engine, CCTVWorker

AI_URL = "http://localhost:8000"

def run_tests():
    print("============================================================")
    print("🧪 CCTV / IP Camera Ingestion & Shared AI Pipeline Test")
    print("============================================================")

    # 1. Test offline / unreachable RTSP probe
    print("\n[Step 1] Testing probe against unreachable RTSP camera...")
    probe = CCTVWorker.test_stream_connection("rtsp://admin:pass@192.0.2.1:554/stream1", timeout_sec=1.5)
    print(f"  • Result: reachable={probe['reachable']} | error={probe.get('error')}")
    assert probe["reachable"] is False, "Probe should fail for unreachable IP"
    print("✅ Unreachable camera correctly diagnosed as offline.")

    # 2. Generate a valid local test video feed containing human portraits
    print("\n[Step 2] Creating test video stream file containing a human subject...")
    test_video_path = os.path.abspath("test_stream.mp4")
    portrait_path = os.path.abspath("test_subject_a.jpg")

    # Read human portrait
    portrait = cv2.imread(portrait_path)
    if portrait is None:
        portrait = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.putText(portrait, "Test Subject", (150, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
    else:
        portrait = cv2.resize(portrait, (640, 480))

    # Write 30 frames at 15 FPS (2 seconds of looping footage)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(test_video_path, fourcc, 15.0, (640, 480))
    for _ in range(30):
        writer.write(portrait)
    writer.release()
    print(f"✅ Test video created at: {test_video_path}")

    # 3. Test CCTV worker ingestion on the test feed via HTTP API
    print("\n[Step 3] Starting CCTVWorker on test feed via AI microservice API...")
    session_id = "test_cctv_session_01"
    start_res = requests.post(f"{AI_URL}/api/ai/cctv/start", json={
        "session_id": session_id,
        "rtsp_url": test_video_path,
        "fps": 15
    })
    assert start_res.status_code == 200, f"Start failed: {start_res.text}"
    time.sleep(1.0)  # Allow worker thread to decode initial frames

    status_res = requests.get(f"{AI_URL}/api/ai/cctv/status/{session_id}")
    assert status_res.status_code == 200, "Get status failed"
    status = status_res.json()
    print(f"  • Worker status: running={status.get('running')} | frames_decoded={status.get('frames_decoded')} | resolution={status.get('resolution')}")
    assert status.get("running") is True, "Worker should be running"
    assert status.get("frames_decoded", 0) > 0, "Worker should have decoded at least 1 frame"
    print(f"✅ Ingestion verified: {status['frames_decoded']} frames decoded, resolution {status['resolution']}")

    # 4. Test AI detection on the CCTV worker's decoded frame via HTTP endpoint
    print("\n[Step 4] Executing YOLO + ByteTrack + ArcFace on CCTV stream frame...")
    detect_res = requests.get(f"{AI_URL}/api/ai/cctv/{session_id}/detect")
    assert detect_res.status_code == 200, f"Detection failed with status: {detect_res.status_code}"
    det_data = detect_res.json()
    print(f"  • Inference Success: {det_data.get('success')}")
    print(f"  • Inference Time:    {det_data.get('inference_time_ms')}ms")
    print(f"  • People Detected:   {det_data.get('people_count')}")
    print(f"  • Detections:        {det_data.get('detections')}")
    assert det_data.get("success") is True, "Detection should report success"
    print("✅ CCTV frame processed through shared YOLOv8 + ByteTrack + ArcFace pipeline.")

    # 5. Test Live Preview MJPEG / Single Frame Endpoint
    print("\n[Step 5] Testing single JPEG frame preview endpoint...")
    prev_res = requests.get(f"{AI_URL}/api/ai/cctv/{session_id}/preview")
    assert prev_res.status_code == 200, "Preview endpoint failed"
    assert prev_res.headers.get("content-type") == "image/jpeg"
    assert len(prev_res.content) > 1000, "Preview image too small"
    print(f"✅ Preview JPEG fetched: {len(prev_res.content)} bytes (image/jpeg)")

    # 6. Stop worker via API and verify cleanup
    print("\n[Step 6] Stopping CCTV worker and cleaning up...")
    stop_res = requests.post(f"{AI_URL}/api/ai/cctv/stop", json={"session_id": session_id})
    assert stop_res.status_code == 200, "Stop request failed"
    time.sleep(0.5)

    status_after = requests.get(f"{AI_URL}/api/ai/cctv/status/{session_id}").json()
    assert status_after.get("running") is False, "Worker should report not running"

    if os.path.exists(test_video_path):
        os.remove(test_video_path)

    print("✅ Worker cleanly stopped and test artifacts removed.")
    print("\n🎉 ALL CCTV INGESTION & PIPELINE TESTS PASSED!")

if __name__ == "__main__":
    run_tests()
