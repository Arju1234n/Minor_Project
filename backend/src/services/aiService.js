/**
 * AI Service Client
 * Encapsulates all HTTP communications with the FastAPI Computer Vision Microservice.
 */

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Helper to perform fetch with timeout
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validate a student face photograph and extract a 128-d ArcFace embedding
 * @param {string} imagePath - Absolute path to face image on disk
 * @returns {Promise<{success: boolean, embedding?: number[], confidence?: number, model?: string, error?: string, detail?: string}>}
 */
async function enrollFace(imagePath) {
  const url = `${AI_SERVICE_URL}/api/ai/enroll-face`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_path: imagePath }),
  });

  const data = await res.json();
  return {
    ok: res.ok,
    status: res.status,
    ...data,
  };
}

/**
 * Sync the active enrolled student embeddings to the AI in-memory gallery
 * @param {Array<object>} galleryPayload - List of students with 128-d embeddings
 * @returns {Promise<{success: boolean, count?: number}>}
 */
async function syncGallery(galleryPayload) {
  const url = `${AI_SERVICE_URL}/api/ai/sync-gallery`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ students: galleryPayload }),
  });

  const data = await res.json();
  return {
    ok: res.ok,
    status: res.status,
    ...data,
  };
}

/**
 * Retrieve the current vector gallery status from the AI microservice
 * @returns {Promise<{success: boolean, active_students?: number, total_embeddings?: number}>}
 */
async function getGalleryStatus() {
  const url = `${AI_SERVICE_URL}/api/ai/gallery-status`;
  const res = await fetchWithTimeout(url, { method: 'GET' });
  const data = await res.json();
  return {
    ok: res.ok,
    status: res.status,
    ...data,
  };
}

/**
 * Probe an RTSP or HTTP video stream via the AI microservice
 * @param {string} rtspUrl
 * @param {number} timeoutSec
 */
async function testCctvStream(rtspUrl, timeoutSec = 4.0) {
  const url = `${AI_SERVICE_URL}/api/ai/cctv/test`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rtsp_url: rtspUrl, timeout_sec: timeoutSec }),
  }, 10000);

  const data = await res.json();
  return { ok: res.ok, status: res.status, ...data };
}

/**
 * Start a continuous RTSP stream ingestion worker in the AI service
 * @param {string} sessionId
 * @param {string} rtspUrl
 * @param {number} fps
 */
async function startCctvWorker(sessionId, rtspUrl, fps = 15) {
  const url = `${AI_SERVICE_URL}/api/ai/cctv/start`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, rtsp_url: rtspUrl, fps }),
  }, 10000);

  const data = await res.json();
  return { ok: res.ok, status: res.status, ...data };
}

/**
 * Stop a continuous RTSP stream ingestion worker
 * @param {string} sessionId
 */
async function stopCctvWorker(sessionId) {
  const url = `${AI_SERVICE_URL}/api/ai/cctv/stop`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  }, 5000);

  const data = await res.json();
  return { ok: res.ok, status: res.status, ...data };
}

/**
 * Get runtime status of a CCTV worker
 * @param {string} sessionId
 */
async function getCctvStatus(sessionId) {
  const url = `${AI_SERVICE_URL}/api/ai/cctv/status/${sessionId}`;
  const res = await fetchWithTimeout(url, { method: 'GET' }, 4000);
  const data = await res.json();
  return { ok: res.ok, status: res.status, ...data };
}

/**
 * Check AI service health
 * @returns {Promise<boolean>}
 */
async function checkHealth() {
  try {
    const res = await fetchWithTimeout(`${AI_SERVICE_URL}/health`, { method: 'GET' }, 3000);
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = {
  AI_SERVICE_URL,
  enrollFace,
  syncGallery,
  getGalleryStatus,
  checkHealth,
  testCctvStream,
  startCctvWorker,
  stopCctvWorker,
  getCctvStatus,
};
