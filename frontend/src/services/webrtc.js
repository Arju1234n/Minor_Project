import { io } from 'socket.io-client';

const isClient = typeof window !== 'undefined' && window.location;
const BACKEND_HOST = isClient ? window.location.hostname : 'localhost';
const isLocalhost = BACKEND_HOST === 'localhost' || BACKEND_HOST === '127.0.0.1';

// When running in the browser, always route through the Vite development proxy
// by connecting to '/' (same origin). Vite upgrades and forwards /socket.io to localhost:5000.
// This prevents smartphones from attempting to connect to their own localhost:5000
// or causing Mixed Content errors when accessed via an HTTPS tunnel.
const envSocketUrl = import.meta.env.VITE_SOCKET_URL;
const isEnvSocketLocalhost = envSocketUrl && (envSocketUrl.includes('localhost') || envSocketUrl.includes('127.0.0.1'));

const SOCKET_URL = isClient
  ? (!isLocalhost && isEnvSocketLocalhost ? '/' : (envSocketUrl || '/'))
  : 'http://localhost:5000';

let socket = null;

/**
 * Returns a shared Socket.IO instance
 */
export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  }
  return socket;
}

/**
 * Fallback ICE servers (Google STUN)
 */
export const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * Helper to fetch ICE servers from backend configuration
 */
export async function fetchIceServers() {
  try {
    const envApiUrl = import.meta.env.VITE_API_URL;
    const isEnvApiLocalhost = envApiUrl && (envApiUrl.includes('localhost') || envApiUrl.includes('127.0.0.1'));
    const apiBase = isClient
      ? (!isLocalhost && isEnvApiLocalhost ? '/api' : (envApiUrl || '/api'))
      : 'http://localhost:5000/api';

    const res = await fetch(`${apiBase}/cameras/public/ice-servers`);
    if (res.ok) {
      const data = await res.json();
      if (data.iceServers && data.iceServers.length > 0) {
        return data.iceServers;
      }
    }
  } catch (err) {
    console.warn('Could not fetch custom ICE servers from API, using default STUN:', err.message);
  }
  return DEFAULT_ICE_SERVERS;
}
