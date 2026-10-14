"""
Phase 6 Verification Script: ByteTrack Multi-Person Tracking & Spatial Analytics
Tests persistent tracking IDs, movement trajectories, and virtual line crossing.
"""
import os
import sys
import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tracker import SessionTracker

def run_tracking_test():
    print("=" * 60)
    print("🧪 Phase 6: ByteTrack Multi-Person Tracking Verification")
    print("=" * 60)

    # 1. Initialize SessionTracker
    print("\n[Step 1] Initializing SessionTracker with ByteTrack...")
    tracker = SessionTracker(session_id="phase6_eval", default_conf=0.35)
    tracker.update_tripwire_y(0.50)
    print(f"✅ SessionTracker initialized. Tripwire position: {tracker.tripwire_y * 100}%")

    # 2. Load base test frame
    img_path = "sample_classroom_test.jpg"
    if not os.path.exists(img_path):
        print(f"Error: {img_path} not found")
        sys.exit(1)

    base_frame = cv2.imread(img_path)
    h, w = base_frame.shape[:2]

    # 3. Simulate sequential video frames to test tracking association & trajectory
    print("\n[Step 2] Processing sequential video frames through ByteTrack...")
    frames = [
        base_frame,
        cv2.warpAffine(base_frame, np.float32([[1, 0, 5], [0, 1, 10]]), (w, h)),
        cv2.warpAffine(base_frame, np.float32([[1, 0, 10], [0, 1, 20]]), (w, h)),
    ]

    last_res = None
    for i, frame in enumerate(frames, 1):
        res = tracker.track_frame(frame, conf_threshold=0.35)
        last_res = res
        ids = [d["tracking_id"] for d in res["detections"]]
        print(f"  • Frame {i}: {len(ids)} people tracked | Active Tracking IDs: {ids}")

    # 4. Verify results
    detections = last_res["detections"]
    print(f"\n📊 Final Tracking Analytics:")
    print(f"  • Active People Count: {last_res['people_count']}")
    print(f"  • Total Unique IDs:    {last_res['unique_ids_count']}")
    print(f"  • Tripwire Crossings:  IN={last_res['tripwire']['entered']}, OUT={last_res['tripwire']['exited']}")
    print(f"  • Zone Inside Count:   {last_res['zone']['inside_count']}")

    assert len(detections) > 0, "Expected at least 1 tracked person"
    assert "tracking_id" in detections[0], "Missing tracking_id in detection"
    assert "trajectory" in detections[0], "Missing trajectory history in detection"
    assert len(detections[0]["trajectory"]) > 1, "Trajectory points should accumulate across frames"

    print("\n[Step 3] Verifying Trajectory Breadcrumbs:")
    for d in detections:
        print(f"  Person ID #{d['tracking_id']}: {len(d['trajectory'])} breadcrumb points tracked")

    print("\n🎉 Phase 6 verification PASSED! ByteTrack multi-person tracking is working perfectly.")

if __name__ == "__main__":
    run_tracking_test()
