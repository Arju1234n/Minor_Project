const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

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
    const errorMsg =
      data.message ||
      (Array.isArray(data.errors) && data.errors[0]?.msg) ||
      'Request failed';
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

  create: (name) =>
    request('/cameras', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  get: (sessionId) => request(`/cameras/${sessionId}`),

  updateStatus: (sessionId, status) =>
    request(`/cameras/${sessionId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  delete: (sessionId) =>
    request(`/cameras/${sessionId}`, { method: 'DELETE' }),

  getPublicConfig: (sessionId) => request(`/cameras/public/${sessionId}`),
  getIceServers: () => request('/cameras/public/ice-servers'),
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
};

// ── AI Computer Vision Microservice ────────────────────
const AI_URL = import.meta.env.VITE_AI_URL || 'http://localhost:8000';

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

  updateConfig: async (conf) => {
    const res = await fetch(`${AI_URL}/api/ai/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conf }),
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
};

