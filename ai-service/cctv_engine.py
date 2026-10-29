"""
CCTV / IP Camera Ingestion Engine for SmartClassAI.
Decodes RTSP / HTTP video streams using OpenCV + FFmpeg in dedicated worker threads.
Provides low-latency multipart MJPEG streaming and frame access for AI detection.
"""

import cv2
import time
import threading
import logging
import os
import socket
from urllib.parse import urlparse
from typing import Dict, Optional, Tuple, Any

logger = logging.getLogger("smartclassroom.cctv")

# Ensure OpenCV uses TCP for RTSP and sets 3-second network timeout
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|stimeout;3000000"


class CCTVWorker:
    """
    Dedicated background worker thread for a single CCTV/IP camera RTSP stream.
    """

    def __init__(self, session_id: str, rtsp_url: str, target_fps: int = 15):
        self.session_id = session_id
        self.rtsp_url = rtsp_url
        self.target_fps = max(1, min(30, target_fps))
        self.frame_interval = 1.0 / float(self.target_fps)

        self.running = False
        self.is_connected = False
        self.thread: Optional[threading.Thread] = None

        self.lock = threading.Lock()
        self.latest_frame = None       # cv2 BGR numpy array
        self.latest_jpeg: Optional[bytes] = None  # encoded JPEG bytes
        self.last_frame_time: float = 0.0

        self.frames_decoded = 0
        self.reconnect_count = 0
        self.last_error: Optional[str] = None
        self.resolution: Tuple[int, int] = (0, 0)
        self.started_at: float = 0.0

    def start(self):
        """Start the background ingestion thread."""
        if self.running:
            return
        self.running = True
        self.started_at = time.time()
        self.thread = threading.Thread(
            target=self._ingest_loop,
            name=f"CCTV-Worker-{self.session_id}",
            daemon=True
        )
        self.thread.start()
        logger.info(f"▶️ CCTV worker started for session: {self.session_id}")

    def stop(self):
        """Gracefully stop the background worker and release video capture."""
        self.running = False
        self.is_connected = False
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2.0)
        logger.info(f"⏹️ CCTV worker stopped for session: {self.session_id}")

    def _ingest_loop(self):
        """Continuous ingestion loop with auto-reconnection."""
        retry_delay = 1.0

        while self.running:
            cap = None
            try:
                logger.info(f"Connecting to RTSP stream for session {self.session_id}...")
                cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

                # Verify stream opened
                if not cap.isOpened():
                    raise RuntimeError("Failed to open RTSP stream. Camera may be offline or URL/credentials invalid.")

                # Read initial test frame
                ret, frame = cap.read()
                if not ret or frame is None:
                    raise RuntimeError("Connected to stream but failed to read initial frame.")

                h, w = frame.shape[:2]
                self.resolution = (w, h)
                self.is_connected = True
                self.last_error = None
                retry_delay = 1.0  # Reset retry delay on successful connection
                logger.info(f"✅ CCTV stream connected [{self.session_id}]: {w}x{h} @ target {self.target_fps}fps")

                # Store first frame
                self._update_frame(frame)

                # Main stream decoding loop
                while self.running and cap.isOpened():
                    loop_start = time.time()

                    ret, frame = cap.read()
                    if not ret or frame is None:
                        logger.warning(f"RTSP stream read returned empty frame on [{self.session_id}]. Triggering reconnect...")
                        break

                    self._update_frame(frame)
                    self.frames_decoded += 1

                    # Regulate frame rate
                    elapsed = time.time() - loop_start
                    sleep_time = self.frame_interval - elapsed
                    if sleep_time > 0:
                        time.sleep(sleep_time)

            except Exception as e:
                self.last_error = str(e)
                logger.warning(f"CCTV stream error on [{self.session_id}]: {e}")
            finally:
                self.is_connected = False
                if cap is not None:
                    try:
                        cap.release()
                    except Exception:
                        pass

            if self.running:
                self.reconnect_count += 1
                logger.info(f"Reconnecting to [{self.session_id}] in {retry_delay:.1f}s (attempt #{self.reconnect_count})...")
                time.sleep(retry_delay)
                retry_delay = min(10.0, retry_delay * 1.5)  # Exponential backoff up to 10s

    def _update_frame(self, frame):
        """Thread-safe update of latest BGR and JPEG frames."""
        # Encode JPEG for fast preview
        encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), 72]
        success, encoded = cv2.imencode(".jpg", frame, encode_params)
        jpeg_bytes = encoded.tobytes() if success else None

        with self.lock:
            self.latest_frame = frame
            self.latest_jpeg = jpeg_bytes
            self.last_frame_time = time.time()

    def get_latest_frame(self) -> Tuple[Optional[Any], Optional[bytes], float]:
        """Returns (numpy_frame, jpeg_bytes, timestamp)."""
        with self.lock:
            return self.latest_frame, self.latest_jpeg, self.last_frame_time

    def get_status(self) -> Dict[str, Any]:
        """Return operational status dictionary."""
        age_sec = time.time() - self.last_frame_time if self.last_frame_time > 0 else -1.0
        return {
            "session_id": self.session_id,
            "running": self.running,
            "connected": self.is_connected,
            "frames_decoded": self.frames_decoded,
            "reconnect_count": self.reconnect_count,
            "target_fps": self.target_fps,
            "resolution": {"width": self.resolution[0], "height": self.resolution[1]},
            "last_error": self.last_error,
            "frame_age_sec": round(age_sec, 2),
            "uptime_sec": round(time.time() - self.started_at, 1) if self.started_at else 0,
        }

    @staticmethod
    def test_stream_connection(rtsp_url: str, timeout_sec: float = 4.0) -> Dict[str, Any]:
        start = time.time()
        cap = None
        # Quick socket pre-flight check for network streams (avoiding slow OS socket timeouts)
        parsed = urlparse(rtsp_url)
        if parsed.hostname:
            port = parsed.port or (554 if parsed.scheme in ('rtsp', 'rtsps') else 80)
            probe_timeout = max(1.0, min(2.5, float(timeout_sec)))
            try:
                probe_sock = socket.create_connection((parsed.hostname, port), timeout=probe_timeout)
                probe_sock.close()
            except Exception as sock_err:
                return {
                    "reachable": False,
                    "error": f"Camera host unreachable ({parsed.hostname}:{port}): {str(sock_err)}",
                    "latency_ms": round((time.time() - start) * 1000, 1),
                }

        try:
            cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

            if not cap.isOpened():
                return {
                    "reachable": False,
                    "error": "Could not connect to stream. Verify the IP address, port, and credentials.",
                    "latency_ms": round((time.time() - start) * 1000, 1),
                }

            ret, frame = cap.read()
            if not ret or frame is None:
                return {
                    "reachable": False,
                    "error": "Stream opened, but no video frames could be decoded.",
                    "latency_ms": round((time.time() - start) * 1000, 1),
                }

            h, w = frame.shape[:2]
            return {
                "reachable": True,
                "width": w,
                "height": h,
                "latency_ms": round((time.time() - start) * 1000, 1),
                "message": f"Successfully connected and decoded {w}x{h} video frame.",
            }
        except Exception as err:
            return {
                "reachable": False,
                "error": str(err),
                "latency_ms": round((time.time() - start) * 1000, 1),
            }
        finally:
            if cap is not None:
                try:
                    cap.release()
                except Exception:
                    pass


class CCTVEngine:
    """
    Singleton manager for all active CCTV stream workers.
    """

    def __init__(self):
        self.workers: Dict[str, CCTVWorker] = {}
        self.lock = threading.Lock()

    def start_worker(self, session_id: str, rtsp_url: str, fps: int = 15) -> CCTVWorker:
        """Start or retrieve worker for session."""
        with self.lock:
            existing = self.workers.get(session_id)
            if existing:
                if existing.rtsp_url == rtsp_url and existing.running:
                    return existing
                existing.stop()

            worker = CCTVWorker(session_id=session_id, rtsp_url=rtsp_url, target_fps=fps)
            self.workers[session_id] = worker
            worker.start()
            return worker

    def stop_worker(self, session_id: str) -> bool:
        """Stop worker for a session."""
        with self.lock:
            worker = self.workers.pop(session_id, None)
            if worker:
                worker.stop()
                return True
            return False

    def get_worker(self, session_id: str) -> Optional[CCTVWorker]:
        """Get active worker by session_id."""
        with self.lock:
            return self.workers.get(session_id)

    def get_all_statuses(self) -> Dict[str, Any]:
        """Get dictionary of all active workers' statuses."""
        with self.lock:
            return {sid: w.get_status() for sid, w in self.workers.items()}

    def shutdown_all(self):
        """Stop all workers upon application exit."""
        with self.lock:
            for worker in self.workers.values():
                worker.stop()
            self.workers.clear()


# Global CCTV Engine instance
cctv_engine = CCTVEngine()
