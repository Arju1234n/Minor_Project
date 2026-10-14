import os
import cv2
import numpy as np
from typing import Dict, Any, List, Optional, Tuple

class FaceEngine:
    """
    OpenCV Zoo YuNet Face Detector + SFace (ArcFace-based) Feature Extractor
    - Sub-millisecond face localization & 5-point facial landmark alignment
    - 128-dimensional L2-normalized deep face embedding vector
    - Strict validation for biometric enrollment (rejects 0 faces or multi-face portraits)
    """

    def __init__(
        self,
        detector_path: str = "models/face_detection_yunet_2023mar.onnx",
        recognizer_path: str = "models/face_recognition_sface_2021dec.onnx",
        score_threshold: float = 0.65,
        nms_threshold: float = 0.30
    ):
        base_dir = os.path.dirname(os.path.abspath(__file__))
        self.detector_path = os.path.join(base_dir, detector_path)
        self.recognizer_path = os.path.join(base_dir, recognizer_path)

        os.makedirs(os.path.dirname(self.detector_path), exist_ok=True)
        if not os.path.exists(self.detector_path):
            import urllib.request
            print(f"Downloading YuNet Face Detector to {self.detector_path}...")
            urllib.request.urlretrieve("https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx", self.detector_path)

        if not os.path.exists(self.recognizer_path):
            import urllib.request
            print(f"Downloading SFace ArcFace model to {self.recognizer_path}...")
            urllib.request.urlretrieve("https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx", self.recognizer_path)

        # Initialize detector with default input size (will be updated dynamically per image)
        self.detector = cv2.FaceDetectorYN.create(
            model=self.detector_path,
            config="",
            input_size=(320, 320),
            score_threshold=score_threshold,
            nms_threshold=nms_threshold,
            top_k=5000
        )

        # Initialize ArcFace / SFace recognizer
        self.recognizer = cv2.FaceRecognizerSF.create(
            model=self.recognizer_path,
            config=""
        )

    def detect_faces(self, image: np.ndarray, score_threshold: Optional[float] = None) -> List[np.ndarray]:
        """
        Detect all faces in an image with 5-point landmarks
        Returns list of face parameter arrays: [x, y, w, h, x_re, y_re, x_le, y_le, x_nt, y_nt, x_rcm, y_rcm, x_lcm, y_lcm, score]
        """
        h, w = image.shape[:2]
        self.detector.setInputSize((w, h))
        if score_threshold is not None:
            self.detector.setScoreThreshold(score_threshold)

        _, faces = self.detector.detect(image)
        if faces is None or len(faces) == 0:
            return []
        return [f for f in faces]

    def extract_embedding(self, image: np.ndarray, face_data: np.ndarray) -> np.ndarray:
        """
        Align face using 5 facial landmarks and extract 128-dimensional normalized embedding
        """
        aligned_face = self.recognizer.alignCrop(image, face_data)
        embedding = self.recognizer.feature(aligned_face)
        # Ensure unit L2 norm
        norm = np.linalg.norm(embedding)
        if norm > 1e-6:
            embedding = embedding / norm
        return embedding.flatten()

    def enroll_single_image(self, image: np.ndarray) -> Dict[str, Any]:
        """
        Enroll face from single-person photograph.
        Enforces:
        - Exactly ONE face must be present
        - Face must meet minimum quality threshold
        """
        faces = self.detect_faces(image)

        if len(faces) == 0:
            return {
                "valid": False,
                "error": "No face detected in photograph. Please provide a clear, well-lit, front-facing portrait.",
                "face_count": 0
            }

        if len(faces) > 1:
            return {
                "valid": False,
                "error": f"Multiple faces ({len(faces)}) detected. Enrollment photograph must contain exactly one student.",
                "face_count": len(faces)
            }

        face = faces[0]
        conf = float(face[-1])
        x, y, w, h = int(face[0]), int(face[1]), int(face[2]), int(face[3])

        # Minimum resolution check (face must be at least 30x30 pixels)
        if w < 30 or h < 30:
            return {
                "valid": False,
                "error": "Face resolution is too low. Please upload a closer, higher-resolution portrait.",
                "face_count": 1,
                "confidence": conf
            }

        embedding = self.extract_embedding(image, face)

        return {
            "valid": True,
            "face_count": 1,
            "confidence": round(conf, 4),
            "bbox": {"x": x, "y": y, "width": w, "height": h},
            "embedding": [float(v) for v in embedding],
            "model": "SFace-ArcFace"
        }

    def compute_similarity(self, embedding1: np.ndarray, embedding2: np.ndarray) -> float:
        """
        Compute Cosine Similarity between two face embeddings.
        Returns score in range [-1.0, 1.0], where 1.0 is identical face.
        Standard SFace threshold for match: cosine_similarity >= 0.363 (at 0.1% FAR)
        """
        feat1 = np.asarray(embedding1, dtype=np.float32).reshape(1, -1)
        feat2 = np.asarray(embedding2, dtype=np.float32).reshape(1, -1)
        score = self.recognizer.match(feat1, feat2, cv2.FaceRecognizerSF_FR_COSINE)
        return float(score)

# Global singleton
face_engine = FaceEngine()
