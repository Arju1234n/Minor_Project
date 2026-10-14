import os
import cv2
import numpy as np
import requests

BASE_URL = "http://localhost:8000"

def run_tests():
    print("🧪 Starting Phase 3: Face Recognition Service & Matching Tests...\n")

    # 1. Health & gallery status check
    health = requests.get(f"{BASE_URL}/health").json()
    assert health["status"] == "ok", "AI service not healthy"
    print("✅ 1. AI service is online and healthy")

    # 2. Extract embeddings from test face crops
    base_dir = os.path.dirname(os.path.abspath(__file__))
    crop0_path = os.path.join(base_dir, "face_crop_0.jpg")
    crop1_path = os.path.join(base_dir, "face_crop_1.jpg")
    noface_path = os.path.join(base_dir, "test_no_face_wall.jpg")

    # If test crops don't exist, generate them automatically
    if not os.path.exists(noface_path):
        cv2.imwrite(noface_path, np.full((300, 300, 3), 160, dtype=np.uint8))

    assert os.path.exists(crop0_path), f"{crop0_path} missing"
    assert os.path.exists(crop1_path), f"{crop1_path} missing"
    assert os.path.exists(noface_path), f"{noface_path} missing"

    enroll0 = requests.post(f"{BASE_URL}/api/ai/enroll-face", json={"image_path": crop0_path}).json()
    enroll1 = requests.post(f"{BASE_URL}/api/ai/enroll-face", json={"image_path": crop1_path}).json()

    assert enroll0["success"], f"Failed to extract face 0: {enroll0}"
    assert enroll1["success"], f"Failed to extract face 1: {enroll1}"

    emb_student_a = enroll0["embedding"]
    emb_student_b = enroll1["embedding"]
    print("✅ 2. Extracted valid 128-d embeddings for test subjects A and B")

    # 3. Synchronize Gallery with Student A only
    sync_payload = {
        "students": [
            {
                "student_id": "std_001_arjun",
                "roll_number": "CS2026-01",
                "full_name": "Arjun Kumar",
                "embeddings": [emb_student_a]
            }
        ]
    }
    sync_res = requests.post(f"{BASE_URL}/api/ai/sync-gallery", json=sync_payload).json()
    assert sync_res["success"], "Gallery sync failed"
    assert sync_res["enrolled_students"] == 1
    print("✅ 3. In-memory gallery synchronized with Student A (CS2026-01 — Arjun Kumar)")

    # 4. Test Positive Recognition: Query Student A against gallery
    rec_pos = requests.post(
        f"{BASE_URL}/api/ai/recognize-face",
        json={"embedding": emb_student_a}
    ).json()

    assert rec_pos["status"] == "recognized", f"Expected 'recognized', got {rec_pos}"
    assert rec_pos["student_id"] == "std_001_arjun"
    assert rec_pos["roll_number"] == "CS2026-01"
    assert rec_pos["score"] >= 0.90, f"Expected near-perfect score for identical embedding, got {rec_pos['score']}"
    print(f"✅ 4. Positive match verified: '{rec_pos['label']}' with score {rec_pos['score']}")

    # 5. Test Unknown Face: Query Student B (NOT enrolled in gallery)
    rec_unk = requests.post(
        f"{BASE_URL}/api/ai/recognize-face",
        json={"embedding": emb_student_b}
    ).json()

    assert rec_unk["status"] == "unknown", f"Expected 'unknown', got {rec_unk}"
    assert rec_unk["student_id"] is None
    assert rec_unk["label"] == "Unknown"
    print(f"✅ 5. Unknown student correctly classified as '{rec_unk['label']}' (Score {rec_unk['score']} < threshold)")

    # 6. Test Image-based recognition directly from file
    rec_img = requests.post(
        f"{BASE_URL}/api/ai/recognize-face",
        json={"image_path": crop0_path}
    ).json()

    assert rec_img["status"] == "recognized", f"Direct image recognition failed: {rec_img}"
    assert rec_img["student_id"] == "std_001_arjun"
    assert "face_box" in rec_img
    print(f"✅ 6. Direct image crop recognition verified: '{rec_img['label']}' (Face box: {rec_img['face_box']})")

    # 7. Test No Face / Obscured condition
    rec_noface = requests.post(
        f"{BASE_URL}/api/ai/recognize-face",
        json={"image_path": noface_path}
    ).json()

    assert rec_noface["status"] == "no_face"
    assert rec_noface["label"] == "Identity unavailable"
    print(f"✅ 7. Obscured/no-face condition verified: '{rec_noface['label']}'")

    print("\n🎉 ALL PHASE 3 RECOGNITION TESTS PASSED SUCCESSFULLY!\n")

if __name__ == "__main__":
    run_tests()
