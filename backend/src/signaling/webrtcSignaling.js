const CameraSession = require('../models/CameraSession');
const { getIceServers } = require('../config/webrtc');

/**
 * WebRTC Signaling & Real-Time Session Manager
 */
function setupWebRTCSignaling(io) {
  // In-memory session registry: sessionId -> { broadcasterId, viewers: Set, isStreaming: boolean }
  const activeSessions = new Map();

  function getOrCreateSession(sessionId) {
    if (!activeSessions.has(sessionId)) {
      activeSessions.set(sessionId, {
        broadcasterId: null,
        viewers: new Set(),
        isStreaming: false,
      });
    }
    return activeSessions.get(sessionId);
  }

  io.on('connection', (socket) => {
    console.log(`🔌 WebRTC socket connected: ${socket.id}`);

    // Provide ICE servers on request
    socket.on('get-ice-servers', (callback) => {
      if (typeof callback === 'function') {
        callback({ success: true, iceServers: getIceServers() });
      }
    });

    // ──────────────────────────────────────────
    // Join a Camera Session
    // ──────────────────────────────────────────
    socket.on('join-session', async ({ sessionId, role, cameraName }) => {
      if (!sessionId) return;

      socket.sessionId = sessionId;
      socket.role = role; // 'broadcaster' or 'viewer'
      const room = `session:${sessionId}`;
      socket.join(room);

      const session = getOrCreateSession(sessionId);

      if (role === 'broadcaster') {
        console.log(`📹 Broadcaster joined session [${sessionId}]: ${socket.id}`);
        session.broadcasterId = socket.id;

        // Update DB camera session status
        try {
          await CameraSession.findOneAndUpdate(
            { sessionId },
            { status: 'online', name: cameraName || undefined },
            { upsert: false }
          );
        } catch (dbErr) {
          console.warn('Could not update camera status in DB:', dbErr.message);
        }

        // Notify viewers in the room that broadcaster is online
        socket.to(room).emit('broadcaster-connected', {
          sessionId,
          broadcasterId: socket.id,
          isStreaming: session.isStreaming,
        });

        // Request broadcaster to initiate connection for any already connected viewers
        if (session.viewers.size > 0 && session.isStreaming) {
          Array.from(session.viewers).forEach((viewerId) => {
            socket.emit('viewer-joined', { viewerId });
          });
        }
      } else if (role === 'viewer') {
        console.log(`👁️ Viewer joined session [${sessionId}]: ${socket.id}`);
        session.viewers.add(socket.id);

        // Notify the viewer of current session status
        socket.emit('session-status', {
          sessionId,
          isBroadcasterOnline: Boolean(session.broadcasterId),
          isStreaming: session.isStreaming,
          iceServers: getIceServers(),
        });

        // If broadcaster is online and streaming, tell broadcaster to create offer for this viewer
        if (session.broadcasterId) {
          io.to(session.broadcasterId).emit('viewer-joined', {
            viewerId: socket.id,
          });
        }
      }
    });

    // ──────────────────────────────────────────
    // Broadcaster Stream Status (Start/Stop)
    // ──────────────────────────────────────────
    socket.on('broadcaster-stream-status', async ({ sessionId, isStreaming }) => {
      const session = getOrCreateSession(sessionId);
      session.isStreaming = Boolean(isStreaming);

      try {
        await CameraSession.findOneAndUpdate(
          { sessionId },
          { status: isStreaming ? 'streaming' : 'online' }
        );
      } catch (err) {
        console.warn('DB stream status update error:', err.message);
      }

      // Broadcast to all viewers in room
      socket.to(`session:${sessionId}`).emit('broadcaster-stream-status', {
        sessionId,
        isStreaming,
      });

      // If streaming just started, notify broadcaster for all connected viewers
      if (isStreaming) {
        session.viewers.forEach((viewerId) => {
          socket.emit('viewer-joined', { viewerId });
        });
      }
    });

    // ──────────────────────────────────────────
    // WebRTC Signaling: SDP Offer
    // ──────────────────────────────────────────
    socket.on('webrtc-offer', ({ targetId, offer, sessionId }) => {
      if (!targetId || !offer) return;
      io.to(targetId).emit('webrtc-offer', {
        from: socket.id,
        offer,
        sessionId,
      });
    });

    // ──────────────────────────────────────────
    // WebRTC Signaling: SDP Answer
    // ──────────────────────────────────────────
    socket.on('webrtc-answer', ({ targetId, answer, sessionId }) => {
      if (!targetId || !answer) return;
      io.to(targetId).emit('webrtc-answer', {
        from: socket.id,
        answer,
        sessionId,
      });
    });

    // ──────────────────────────────────────────
    // WebRTC Signaling: ICE Candidate
    // ──────────────────────────────────────────
    socket.on('webrtc-ice-candidate', ({ targetId, candidate, sessionId }) => {
      if (!targetId || !candidate) return;
      io.to(targetId).emit('webrtc-ice-candidate', {
        from: socket.id,
        candidate,
        sessionId,
      });
    });

    // ──────────────────────────────────────────
    // Handle Disconnect & Cleanup
    // ──────────────────────────────────────────
    socket.on('disconnect', async () => {
      const { sessionId, role } = socket;
      if (!sessionId) return;

      const session = activeSessions.get(sessionId);
      if (!session) return;

      const room = `session:${sessionId}`;

      if (role === 'broadcaster' && session.broadcasterId === socket.id) {
        console.log(`📹 Broadcaster disconnected from [${sessionId}]`);
        session.broadcasterId = null;
        session.isStreaming = false;

        try {
          await CameraSession.findOneAndUpdate(
            { sessionId },
            { status: 'offline' }
          );
        } catch (dbErr) {
          console.warn('Could not update camera offline status in DB:', dbErr.message);
        }

        // Notify all viewers
        socket.to(room).emit('broadcaster-disconnected', { sessionId });
      } else if (role === 'viewer') {
        console.log(`👁️ Viewer disconnected from [${sessionId}]: ${socket.id}`);
        session.viewers.delete(socket.id);

        if (session.broadcasterId) {
          io.to(session.broadcasterId).emit('viewer-left', {
            viewerId: socket.id,
          });
        }
      }

      // Cleanup empty session map entries if completely empty
      if (!session.broadcasterId && session.viewers.size === 0) {
        activeSessions.delete(sessionId);
      }
    });
  });
}

module.exports = { setupWebRTCSignaling };
