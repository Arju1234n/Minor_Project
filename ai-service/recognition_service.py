import os
import json
import numpy as np
from typing import Dict, Any, List, Optional, Tuple
from face_engine import face_engine

class StudentGallery:
    """
    In-memory vector gallery of enrolled students for sub-millisecond face matching.
    Uses Cosine Similarity on normalized 128-d ArcFace embeddings.
    Enforces strict thresholding and ambiguity margins to prevent false identity claims.
    Automatically self-heals by loading persistent vector cache on restart.
    """

    def __init__(
        self,
        similarity_threshold: float = 0.363, # Official OpenCV SFace threshold for 0.1% FAR
        ambiguity_margin: float = 0.06       # Difference between best & second-best match
    ):
        self.similarity_threshold = similarity_threshold
        self.ambiguity_margin = ambiguity_margin
        # student_id -> { "roll_number": str, "full_name": str, "embeddings": List[np.ndarray] }
        self.students: Dict[str, Dict[str, Any]] = {}
        # Precomputed matrix for vectorized batch dot products
        self._embedding_matrix: Optional[np.ndarray] = None
        self._index_to_student: List[Tuple[str, str, str]] = [] # [(student_id, roll_number, full_name)]

        # Automatically recover gallery on startup if persistent cache exists
        self._load_cache()

    def register_student(
        self,
        student_id: str,
        roll_number: str,
        full_name: str,
        embeddings: List[List[float]]
    ):
        """
        Register or update a student's enrolled face embeddings in the gallery.
        """
        if not embeddings:
            return

        norm_embeddings = []
        for emb in embeddings:
            arr = np.array(emb, dtype=np.float32)
            norm = np.linalg.norm(arr)
            if norm > 1e-6:
                arr = arr / norm
            norm_embeddings.append(arr)

        self.students[str(student_id)] = {
            "roll_number": roll_number,
            "full_name": full_name,
            "embeddings": norm_embeddings
        }
        self._rebuild_matrix()

    def remove_student(self, student_id: str):
        """
        Remove student embeddings from the gallery
        """
        if str(student_id) in self.students:
            del self.students[str(student_id)]
            self._rebuild_matrix()

    def clear(self):
        """
        Clear entire gallery
        """
        self.students.clear()
        self._embedding_matrix = None
        self._index_to_student.clear()

    def get_status(self) -> Dict[str, Any]:
        """
        Returns status metrics of in-memory face vector gallery
        """
        return {
            "enrolled_students_count": len(self.students),
            "total_embeddings_count": len(self._index_to_student),
            "similarity_threshold": self.similarity_threshold,
            "ambiguity_margin": self.ambiguity_margin
        }

    def _get_cache_path(self) -> str:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        return os.path.join(base_dir, "models", "gallery_cache.json")

    def _save_cache(self, students_list: List[Dict[str, Any]]):
        try:
            cache_path = self._get_cache_path()
            os.makedirs(os.path.dirname(cache_path), exist_ok=True)
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(students_list, f)
        except Exception as err:
            print(f"Notice: Failed to write gallery cache: {err}")

    def _load_cache(self):
        try:
            cache_path = self._get_cache_path()
            if os.path.exists(cache_path):
                with open(cache_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list) and len(data) > 0:
                        self.sync_students(data, save_cache=False)
                        print(f"✅ Self-healed AI gallery from disk cache: {len(self.students)} student(s) loaded")
        except Exception as err:
            print(f"Notice: Failed to read gallery cache: {err}")

    def sync_students(self, students_list: List[Dict[str, Any]], save_cache: bool = True) -> int:
        """
        Atomically replaces gallery with provided students and their embeddings.
        Supports both snake_case (student_id) and camelCase (studentId) schemas.
        """
        self.clear()
        count = 0
        for s in students_list:
            sid = s.get("student_id") or s.get("studentId") or s.get("_id")
            roll = s.get("roll_number") or s.get("rollNumber") or ""
            name = s.get("full_name") or s.get("fullName") or ""
            embs = s.get("embeddings") or []
            if sid and embs:
                self.register_student(
                    student_id=str(sid),
                    roll_number=roll,
                    full_name=name,
                    embeddings=embs
                )
                count += 1

        if save_cache:
            self._save_cache(students_list)

        return count

    def _rebuild_matrix(self):
        """
        Flatten all student embeddings into a 2D matrix for vectorized similarity search.
        """
        matrix_rows = []
        mapping = []

        for sid, data in self.students.items():
            for emb in data["embeddings"]:
                matrix_rows.append(emb)
                mapping.append((sid, data["roll_number"], data["full_name"]))

        if matrix_rows:
            self._embedding_matrix = np.vstack(matrix_rows) # Shape: (N, 128)
            self._index_to_student = mapping
        else:
            self._embedding_matrix = None
            self._index_to_student.clear()

    def identify_embedding(
        self,
        query_embedding: np.ndarray,
        custom_threshold: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        Identify a query embedding against the enrolled gallery.
        Returns:
        - status: "recognized" | "unknown" | "uncertain"
        - student_id: str or None
        - roll_number: str or None
        - full_name: str or None
        - score: float (cosine similarity)
        """
        threshold = custom_threshold if custom_threshold is not None else self.similarity_threshold

        if self._embedding_matrix is None or len(self._index_to_student) == 0:
            return {
                "status": "unknown",
                "label": "Unknown",
                "student_id": None,
                "roll_number": None,
                "full_name": None,
                "score": 0.0,
                "detail": "No enrolled students in gallery"
            }

        # Query vector normalization
        q = np.array(query_embedding, dtype=np.float32).flatten()
        norm = np.linalg.norm(q)
        if norm > 1e-6:
            q = q / norm

        # Compute cosine similarity across all enrolled vectors: dot product of normalized vectors
        scores = np.dot(self._embedding_matrix, q) # Shape: (N,)

        # Aggregate max score per unique student
        student_scores: Dict[str, Tuple[float, str, str]] = {} # sid -> (max_score, roll, name)
        for i, score in enumerate(scores):
            sid, roll, name = self._index_to_student[i]
            if sid not in student_scores or score > student_scores[sid][0]:
                student_scores[sid] = (float(score), roll, name)

        sorted_candidates = sorted(student_scores.items(), key=lambda x: x[1][0], reverse=True)

        if not sorted_candidates:
            return {
                "status": "unknown",
                "label": "Unknown",
                "student_id": None,
                "score": 0.0
            }

        best_sid, (best_score, best_roll, best_name) = sorted_candidates[0]

        # 1. Threshold check: if best match is below confidence threshold, reject as Unknown
        if best_score < threshold:
            return {
                "status": "unknown",
                "label": "Unknown",
                "student_id": None,
                "roll_number": None,
                "full_name": None,
                "score": round(best_score, 4),
                "detail": f"Score {round(best_score, 4)} is below match threshold {round(threshold, 4)}"
            }

        # 2. Ambiguity check: if multiple distinct students have almost identical scores
        if len(sorted_candidates) > 1:
            second_score = sorted_candidates[1][1][0]
            if (best_score - second_score) < self.ambiguity_margin and second_score >= threshold:
                return {
                    "status": "uncertain",
                    "label": "Uncertain Match",
                    "student_id": None,
                    "roll_number": None,
                    "full_name": None,
                    "score": round(best_score, 4),
                    "detail": f"Ambiguous between top two candidates ({round(best_score, 4)} vs {round(second_score, 4)})"
                }

        # 3. Confident, unambiguous match
        return {
            "status": "recognized",
            "label": f"{best_roll} — {best_name}",
            "student_id": best_sid,
            "roll_number": best_roll,
            "full_name": best_name,
            "score": round(best_score, 4),
            "detail": f"Matched with confidence {round(best_score, 4)}"
        }

    def recognize_crop(
        self,
        image_or_crop: np.ndarray,
        custom_threshold: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        Locates face in image/crop, extracts ArcFace embedding, and identifies student.
        """
        faces = face_engine.detect_faces(image_or_crop)
        if not faces:
            return {
                "status": "no_face",
                "label": "Identity unavailable",
                "detail": "No detectable face in image/crop",
                "score": 0.0,
                "face_box": None
            }

        # Select the most prominent face in crop (highest confidence / largest box)
        best_face = max(faces, key=lambda f: float(f[-1]) * float(f[2]) * float(f[3]))
        face_conf = float(best_face[-1])
        x, y, w, h = int(best_face[0]), int(best_face[1]), int(best_face[2]), int(best_face[3])

        if w < 25 or h < 25:
            return {
                "status": "no_face",
                "label": "Identity unavailable",
                "detail": "Face resolution too small for reliable recognition",
                "score": 0.0,
                "face_box": {"x": x, "y": y, "width": w, "height": h}
            }

        emb = face_engine.extract_embedding(image_or_crop, best_face)
        match_result = self.identify_embedding(emb, custom_threshold=custom_threshold)
        match_result["face_box"] = {"x": x, "y": y, "width": w, "height": h}
        match_result["face_confidence"] = round(face_conf, 4)
        return match_result

# Global singleton
gallery = StudentGallery()
