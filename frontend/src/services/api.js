const isClient = typeof window !== 'undefined' && window.location;
const BACKEND_HOST = isClient ? window.location.hostname : 'localhost';
const isLocalhost = BACKEND_HOST === 'localhost' || BACKEND_HOST === '127.0.0.1';

// In browser context, route through the Vite development proxy (/api -> localhost:5000)
// to prevent phone browsers from querying their own localhost:5000 and avoid Mixed Content blocks.
const envApiUrl = import.meta.env.VITE_API_URL;
const isEnvApiLocalhost = envApiUrl && (envApiUrl.includes('localhost') || envApiUrl.includes('127.0.0.1'));

const API_URL = isClient
  ? (!isLocalhost && isEnvApiLocalhost ? '/api' : (envApiUrl || '/api'))
  : 'http://localhost:5000/api';

/**
 * Make an authenticated API request.
 */
async function request(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  const headers = {
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const config = {
    ...options,
    headers,
  };

  const res = await fetch(`${API_URL}${endpoint}`, config);
  const data = await res.json();

  if (!res.ok) {
    // Prefer the human-readable message; if a per-item errors[] array exists
    // (e.g. face enrollment validation failures), append each reason so the
    // user knows exactly which photo failed and why.
    let errorMsg =
      data.message ||
      (Array.isArray(data.errors) && data.errors[0]?.msg) ||
      'Request failed';

    if (Array.isArray(data.errors) && data.errors.length > 0 &&
        typeof data.errors[0] === 'string') {
      errorMsg += '\n' + data.errors.join('\n');
    }
    throw new Error(errorMsg);
  }

  return data;
}

// ── Auth ───────────────────────────────────────────────
export const authAPI = {
  login: (email, password) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (name, email, password) =>
    request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),

  getMe: () => request('/auth/me'),
};

// ── Cameras ────────────────────────────────────────────
export const cameraAPI = {
  list: () => request('/cameras'),

  create: (data) =>
    request('/cameras', {
      method: 'POST',
      body: JSON.stringify(typeof data === 'string' ? { name: data } : data),
    }),

  get: (sessionId) => request(`/cameras/${sessionId}`),

  updateStatus: (sessionId, status) =>
    request(`/cameras/${sessionId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  delete: (sessionId) =>
    request(`/cameras/${sessionId}`, { method: 'DELETE' }),

  testStream: (rtspUrl, username, password) =>
    request('/cameras/test-stream', {
      method: 'POST',
      body: JSON.stringify({ rtspUrl, username, password }),
    }),

  startCctv: (sessionId) =>
    request(`/cameras/${sessionId}/start-cctv`, { method: 'POST' }),

  stopCctv: (sessionId) =>
    request(`/cameras/${sessionId}/stop-cctv`, { method: 'POST' }),

  getCctvStatus: (sessionId) =>
    request(`/cameras/${sessionId}/cctv-status`),

  getPublicConfig: (sessionId) => request(`/cameras/public/${sessionId}`),
  getIceServers: () => request('/cameras/public/ice-servers'),
  getNetworkInfo: () => request('/cameras/network-info'),
};

// ── Dashboard ──────────────────────────────────────────
export const dashboardAPI = {
  getStats: () => request('/dashboard/stats'),
  getEvents: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/dashboard/events${query ? `?${query}` : ''}`);
  },
  recordEvent: (eventData) =>
    request('/dashboard/events', {
      method: 'POST',
      body: JSON.stringify(eventData),
    }),
  deleteEvents: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/dashboard/events${query ? `?${query}` : ''}`, {
      method: 'DELETE',
    });
  },
  // Gallery status — real counts from MongoDB + AI microservice
  getGalleryStatus: () => request('/dashboard/gallery-status'),
  // Manual gallery sync trigger
  syncGallery: () =>
    request('/dashboard/sync-gallery', { method: 'POST' }),
};


// ── AI Computer Vision Microservice ────────────────────
// In the browser, route through Vite proxy (/api/ai -> localhost:8000)
// by setting AI_URL to '' (relative path). This prevents phones from querying localhost:8000
// on their own device and avoids HTTPS mixed content blocks.
const envAiUrl = import.meta.env.VITE_AI_URL;
const isEnvAiLocalhost = envAiUrl && (envAiUrl.includes('localhost') || envAiUrl.includes('127.0.0.1'));

const AI_URL = isClient
  ? (!isLocalhost || isEnvAiLocalhost || !envAiUrl ? '' : envAiUrl)
  : 'http://localhost:8000';

export const aiAPI = {
  detectFrame: async (base64Image, confThreshold = 0.40, sessionId = 'default', tripwireY = 0.50, enableTracking = true) => {
    const res = await fetch(`${AI_URL}/api/ai/detect-frame`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: base64Image,
        session_id: sessionId,
        conf_threshold: confThreshold,
        tripwire_y: tripwireY,
        enable_tracking: enableTracking,
        return_annotated: false,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'AI detection failed');
    }
    return res.json();
  },

  detectCctvFrame: async (sessionId, confThreshold = 0.40, tripwireY = 0.50, enableTracking = true) => {
    const params = new URLSearchParams({
      conf_threshold: confThreshold,
      tripwire_y: tripwireY,
      enable_tracking: enableTracking,
    });
    const res = await fetch(`${AI_URL}/api/ai/cctv/${sessionId}/detect?${params.toString()}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'CCTV AI detection failed');
    }
    return res.json();
  },

  resetSession: async (sessionId) => {
    const res = await fetch(`${AI_URL}/api/ai/reset-session/${sessionId}`, {
      method: 'POST',
    });
    return res.json();
  },

  getSessionMetrics: async (sessionId) => {
    const res = await fetch(`${AI_URL}/api/ai/session/${sessionId}`);
    return res.json();
  },

  getConfig: async () => {
    const res = await fetch(`${AI_URL}/api/ai/config`);
    return res.json();
  },

  updateConfig: async (confOrPayload) => {
    const payload = typeof confOrPayload === 'object' ? confOrPayload : { conf: confOrPayload };
    const res = await fetch(`${AI_URL}/api/ai/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },
};

// ── Settings & Retention ───────────────────────────────
export const settingsAPI = {
  get: () => request('/settings'),
  update: (settings) =>
    request('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  purgeRetention: () =>
    request('/settings/purge', {
      method: 'POST',
    }),
};

// ── Students & Face Enrollment ─────────────────────────
export const studentAPI = {
  list: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/students${query ? `?${query}` : ''}`);
  },
  getById: (id) => request(`/students/${id}`),
  create: (formData) =>
    request('/students', {
      method: 'POST',
      body: formData,
    }),
  update: (id, formData) =>
    request(`/students/${id}`, {
      method: 'PUT',
      body: formData,
    }),
  delete: (id, permanent = false) =>
    request(`/students/${id}${permanent ? '?permanent=true' : ''}`, {
      method: 'DELETE',
    }),
  toggleStatus: (id) =>
    request(`/students/${id}/status`, {
      method: 'PATCH',
    }),
  enroll: (id, formData = new FormData()) =>
    request(`/students/${id}/enroll`, {
      method: 'POST',
      body: formData,
    }),
  getEnrollment: (id) => request(`/students/${id}/enrollment`),
  deleteEnrollment: (id) =>
    request(`/students/${id}/enrollment`, {
      method: 'DELETE',
    }),
  syncGallery: () => request('/students/sync-gallery', { method: 'POST' }),
  getGalleryStatus: () => request('/dashboard/gallery-status'),
  getCandidateTestRecords: () => request('/students/candidate-test-records'),
  cleanupTestRecords: (studentIds) =>
    request('/students/cleanup-test-records', {
      method: 'POST',
      body: JSON.stringify({ studentIds }),
    }),
  getRecognitionEvents: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/students/recognition-events${query ? `?${query}` : ''}`);
  },
  recordRecognitionEvent: (eventData) =>
    request('/students/recognition-events', {
      method: 'POST',
      body: JSON.stringify(eventData),
    }),
};

