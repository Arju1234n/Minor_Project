import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  HiOutlineVideoCamera,
  HiOutlineSwitchHorizontal,
  HiOutlineRefresh,
  HiOutlineExclamationCircle,
  HiOutlineCheckCircle,
  HiOutlineDeviceMobile,
  HiOutlinePlay,
  HiOutlineStop,
  HiOutlineClipboardCopy,
  HiOutlineLightningBolt,
} from 'react-icons/hi';
import { getSocket, fetchIceServers, DEFAULT_ICE_SERVERS } from '../services/webrtc';
import './MobileCamera.css';

/**
 * Mobile Camera Page — Phase 2 & Phase 3:
 * - Direct navigator.mediaDevices.getUserMedia integration
 * - Front (user) and Rear (environment) camera switching with track replacement
 * - Device selection & capabilities discovery
 * - Touch-optimized live local video preview with iOS/Android compatibility
 * - Torch / Flashlight control (where hardware supported)
 * - WebRTC Signaling & P2P video broadcasting to Admin Dashboard
 * - Multi-viewer peer connection management
 */
export default function MobileCamera() {
  const { sessionId: paramSessionId } = useParams();

  // Session state
  const [sessionId, setSessionId] = useState(
    () => paramSessionId || 'room_' + Math.random().toString(36).substring(2, 8)
  );
  const [copied, setCopied] = useState(false);

  // Video & Device state
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [facingMode, setFacingMode] = useState('environment'); // 'environment' (rear) or 'user' (front)
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [mirrored, setMirrored] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [supportsTorch, setSupportsTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  // Diagnostics & error states
  const [streamStats, setStreamStats] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSecureContext, setIsSecureContext] = useState(true);

  // WebRTC & Peer Connection state
  const socketRef = useRef(null);
  const peerConnections = useRef(new Map()); // viewerId -> RTCPeerConnection
  const pendingCandidatesByPeer = useRef(new Map()); // viewerId -> [candidates]
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
  const [connectedViewers, setConnectedViewers] = useState(0);
  const [_webrtcStatus, setWebrtcStatus] = useState('idle'); // 'idle' | 'signaling' | 'broadcasting'

  // Check secure context on mount (getUserMedia requires HTTPS or localhost)
  useEffect(() => {
    const isSecure = window.isSecureContext !== false || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    setIsSecureContext(isSecure);
  }, []);

  // Update session ID if URL parameter changes
  useEffect(() => {
    if (paramSessionId) {
      setSessionId(paramSessionId);
    }
  }, [paramSessionId]);

  // Fetch configured ICE servers on mount
  useEffect(() => {
    fetchIceServers().then((servers) => {
      iceServersRef.current = servers;
    });
  }, []);

  // Enumerate video input devices
  const enumerateVideoDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return;
      }
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = allDevices.filter((d) => d.kind === 'videoinput');
      setDevices(videoInputs);
    } catch (err) {
      console.warn('Failed to enumerate devices:', err);
    }
  }, []);

  useEffect(() => {
    enumerateVideoDevices();
  }, [enumerateVideoDevices]);

  /**
   * Create an RTCPeerConnection for a specific viewer and initiate an SDP Offer
   */
  const createPeerConnectionForViewer = useCallback(async (viewerId) => {
    if (!streamRef.current) {
      console.warn('Cannot create peer connection: stream is not active yet');
      return;
    }

    // Close any prior connection for this viewer
    if (peerConnections.current.has(viewerId)) {
      try {
        peerConnections.current.get(viewerId).close();
      } catch (e) {
        console.warn('Error closing prior PC:', e);
      }
      peerConnections.current.delete(viewerId);
    }

    const socket = socketRef.current;
    if (!socket) return;

    console.log(`📡 Creating RTCPeerConnection for viewer: ${viewerId}`);

    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      iceCandidatePoolSize: 2,
    });

    peerConnections.current.set(viewerId, pc);

    // Add local tracks to peer connection
    streamRef.current.getTracks().forEach((track) => {
      pc.addTrack(track, streamRef.current);
    });

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && socket.connected) {
        socket.emit('webrtc-ice-candidate', {
          targetId: viewerId,
          candidate: event.candidate,
          sessionId,
        });
      }
    };

    // Monitor connection state
    pc.onconnectionstatechange = () => {
      console.log(`WebRTC state with viewer [${viewerId}]:`, pc.connectionState);
      if (pc.connectionState === 'connected') {
        setWebrtcStatus('broadcasting');
      }

      // Count active connected peers
      let activeCount = 0;
      peerConnections.current.forEach((conn) => {
        if (conn.connectionState === 'connected') activeCount++;
      });
      setConnectedViewers(activeCount);
    };

    try {
      // Create and send SDP Offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);

      socket.emit('webrtc-offer', {
        targetId: viewerId,
        offer,
        sessionId,
      });
    } catch (err) {
      console.error('Failed to create WebRTC offer for viewer:', err);
    }
  }, [sessionId]);

  /**
   * Set up WebRTC Signaling via Socket.IO
   */
  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    // Join room as broadcaster (and re-join whenever socket reconnects)
    const registerBroadcaster = () => {
      console.log(`📡 Registering broadcaster for session [${sessionId}]`);
      socket.emit('join-session', {
        sessionId,
        role: 'broadcaster',
        cameraName: 'Smartphone Camera Unit',
      });
      if (streamRef.current) {
        socket.emit('broadcaster-stream-status', {
          sessionId,
          isStreaming: true,
        });
      }
    };

    if (socket.connected) {
      registerBroadcaster();
    }
    socket.on('connect', registerBroadcaster);

    // Viewer joined — if we have active stream, start P2P negotiation
    const handleViewerJoined = ({ viewerId }) => {
      console.log('👁️ Viewer joined notification received:', viewerId);
      if (streamRef.current) {
        createPeerConnectionForViewer(viewerId);
      }
    };

    // Viewer left — close and clean up PC
    const handleViewerLeft = ({ viewerId }) => {
      console.log('Viewer left:', viewerId);
      if (peerConnections.current.has(viewerId)) {
        try {
          peerConnections.current.get(viewerId).close();
        } catch (e) {
          console.warn('Error closing PC:', e);
        }
        peerConnections.current.delete(viewerId);
      }
      let activeCount = 0;
      peerConnections.current.forEach((conn) => {
        if (conn.connectionState === 'connected') activeCount++;
      });
      setConnectedViewers(activeCount);
    };

    // Receive SDP Answer from viewer
    const handleWebRTCAnswer = async ({ from, answer }) => {
      const pc = peerConnections.current.get(from);
      if (pc && pc.signalingState !== 'closed') {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          console.log(`✅ Set remote description (answer) for viewer: ${from}`);

          // Drain queued ICE candidates received before answer description was set
          const queued = pendingCandidatesByPeer.current.get(from) || [];
          while (queued.length > 0) {
            const cand = queued.shift();
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
              console.warn('Error adding queued ICE candidate on broadcaster:', e);
            }
          }
        } catch (err) {
          console.error('Failed to set remote description answer:', err);
        }
      }
    };

    // Receive ICE Candidate from viewer
    const handleWebRTCIceCandidate = async ({ from, candidate }) => {
      const pc = peerConnections.current.get(from);
      if (pc && candidate) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.warn('Failed to add remote ICE candidate:', err);
          }
        } else {
          if (!pendingCandidatesByPeer.current.has(from)) {
            pendingCandidatesByPeer.current.set(from, []);
          }
          pendingCandidatesByPeer.current.get(from).push(candidate);
        }
      }
    };

    socket.on('viewer-joined', handleViewerJoined);
    socket.on('viewer-left', handleViewerLeft);
    socket.on('webrtc-answer', handleWebRTCAnswer);
    socket.on('webrtc-ice-candidate', handleWebRTCIceCandidate);

    return () => {
      socket.off('connect', registerBroadcaster);
      socket.off('viewer-joined', handleViewerJoined);
      socket.off('viewer-left', handleViewerLeft);
      socket.off('webrtc-answer', handleWebRTCAnswer);
      socket.off('webrtc-ice-candidate', handleWebRTCIceCandidate);

      // Close all peer connections on unmount
      peerConnections.current.forEach((pc) => {
        try {
          pc.close();
        } catch (e) {
          console.warn('PC close error:', e);
        }
      });
      peerConnections.current.clear();
    };
  }, [sessionId, createPeerConnectionForViewer]);

  // Clean up media tracks when component unmounts
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (socketRef.current) {
        socketRef.current.emit('broadcaster-stream-status', {
          sessionId,
          isStreaming: false,
        });
      }
    };
  }, [sessionId]);

  // Update stream stats once video metadata loads
  const handleLoadedMetadata = () => {
    if (!videoRef.current || !streamRef.current) return;

    const track = streamRef.current.getVideoTracks()[0];
    const settings = track?.getSettings() || {};
    const width = videoRef.current.videoWidth || settings.width || 0;
    const height = videoRef.current.videoHeight || settings.height || 0;
    const frameRate = Math.round(settings.frameRate || 30);
    const label = track?.label || (facingMode === 'user' ? 'Front Camera' : 'Rear Camera');

    setStreamStats({ width, height, frameRate, label });

    // Check torch / flash support
    try {
      const capabilities = track?.getCapabilities?.() || {};
      setSupportsTorch(Boolean(capabilities.torch));
    } catch {
      setSupportsTorch(false);
    }
  };

  /**
   * Start local camera stream and notify signaling server
   */
  const startCamera = async (overrideFacingMode, overrideDeviceId) => {
    setIsLoading(true);
    setErrorMessage('');

    // Stop existing stream if any
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    const targetFacingMode = overrideFacingMode || facingMode;
    const targetDeviceId = overrideDeviceId !== undefined ? overrideDeviceId : selectedDeviceId;

    // Build constraints
    const videoConstraints = {};
    if (targetDeviceId) {
      videoConstraints.deviceId = { exact: targetDeviceId };
    } else {
      videoConstraints.facingMode = { ideal: targetFacingMode };
    }
    videoConstraints.width = { ideal: 1280 };
    videoConstraints.height = { ideal: 720 };
    videoConstraints.frameRate = { ideal: 30 };

    try {
      const isSecure = window.isSecureContext !== false || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (!isSecure) {
        setIsSecureContext(false);
        throw new Error('Insecure Origin: Mobile browsers prohibit camera access over unencrypted HTTP. Please connect via your secure HTTPS tunnel (e.g. ngrok).');
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('MediaDevices API not supported in this browser. Please ensure you are using a modern browser (Safari on iOS, Chrome on Android) over HTTPS.');
      }

      let newStream;
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
      } catch (constraintErr) {
        console.warn('Ideal constraints failed, attempting basic fallback:', constraintErr);
        newStream = await navigator.mediaDevices.getUserMedia({
          video: targetFacingMode ? { facingMode: targetFacingMode } : true,
          audio: false,
        });
      }

      streamRef.current = newStream;
      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        await videoRef.current.play().catch((e) => console.warn('AutoPlay handled:', e));
      }

      setIsStreaming(true);
      setMirrored(targetFacingMode === 'user');
      setTorchOn(false);

      // Re-enumerate devices so permission-revealed labels populate
      await enumerateVideoDevices();

      // Notify signaling server that broadcaster stream is active
      if (socketRef.current) {
        socketRef.current.emit('broadcaster-stream-status', {
          sessionId,
          isStreaming: true,
        });
      }
    } catch (err) {
      console.error('Camera access error:', err);
      let userFriendlyMsg = 'Could not access camera.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        userFriendlyMsg = 'Camera permission was denied. Please tap the lock or settings icon in your browser address bar to allow Camera access, then tap Retry.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        userFriendlyMsg = 'No camera device detected on this smartphone or computer.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        userFriendlyMsg = 'Camera is already in use by another application or background tab. Please close other camera apps and retry.';
      } else if (err.name === 'OverconstrainedError') {
        userFriendlyMsg = 'Requested camera resolution is not supported by your camera hardware.';
      } else if (err.name === 'SecurityError') {
        userFriendlyMsg = 'Security Error: Camera access was blocked by browser security. An HTTPS origin is required.';
      } else {
        userFriendlyMsg = err.message || userFriendlyMsg;
      }
      setErrorMessage(userFriendlyMsg);
      setIsStreaming(false);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Stop local camera stream and notify signaling server
   */
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    setStreamStats(null);
    setTorchOn(false);
    setSupportsTorch(false);
    setConnectedViewers(0);
    setWebrtcStatus('idle');

    // Close all viewer peer connections
    peerConnections.current.forEach((pc) => {
      try {
        pc.close();
      } catch (e) {
        console.warn('Error closing PC on stop:', e);
      }
    });
    peerConnections.current.clear();

    // Inform server that stream stopped
    if (socketRef.current) {
      socketRef.current.emit('broadcaster-stream-status', {
        sessionId,
        isStreaming: false,
      });
    }
  };

  /**
   * Toggle between front and rear cameras seamlessly via track replacement
   */
  const handleToggleFacingMode = async () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    setSelectedDeviceId('');

    if (isStreaming) {
      try {
        // Obtain new track
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: nextMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        const newTrack = newStream.getVideoTracks()[0];

        // Replace track on all existing peer connections without renegotiating
        peerConnections.current.forEach((pc) => {
          const senders = pc.getSenders();
          const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(newTrack);
          }
        });

        // Stop old track
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }

        streamRef.current = newStream;
        if (videoRef.current) {
          videoRef.current.srcObject = newStream;
        }

        setMirrored(nextMode === 'user');
        setTorchOn(false);
      } catch (err) {
        console.warn('Track replacement failed, falling back to full restart:', err);
        await startCamera(nextMode, '');
      }
    }
  };

  /**
   * Handle dropdown device switch
   */
  const handleDeviceChange = async (e) => {
    const newDeviceId = e.target.value;
    setSelectedDeviceId(newDeviceId);
    if (isStreaming) {
      await startCamera(facingMode, newDeviceId);
    }
  };

  /**
   * Toggle Torch / Flashlight (where supported)
   */
  const handleToggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    try {
      const nextTorch = !torchOn;
      await track.applyConstraints({
        advanced: [{ torch: nextTorch }],
      });
      setTorchOn(nextTorch);
    } catch (err) {
      console.warn('Failed to toggle torch:', err);
    }
  };

  /**
   * Copy session link to clipboard
   */
  const handleCopyLink = () => {
    const url = `${window.location.origin}/camera/${sessionId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="mobile-camera-page">
      <div className="mobile-camera-container animate-fade-in">
        {/* Header / Brand */}
        <header className="mobile-camera-header">
          <div className="mobile-camera-header__brand">
            <div className="mobile-camera-logo">
              <HiOutlineDeviceMobile size={24} />
            </div>
            <div>
              <h1 className="mobile-camera-title">Smart Classroom AI</h1>
              <p className="mobile-camera-subtitle">Smartphone Remote Camera Unit</p>
            </div>
          </div>

          {/* Session Pill */}
          <div className="session-pill">
            <span className="session-pill__label">Session:</span>
            <code className="session-pill__code">{sessionId}</code>
            <button
              className="session-pill__copy-btn"
              onClick={handleCopyLink}
              title="Copy camera session link"
            >
              {copied ? <HiOutlineCheckCircle size={14} className="text-success" /> : <HiOutlineClipboardCopy size={14} />}
            </button>
          </div>
        </header>

        {/* Insecure Context Warning */}
        {!isSecureContext && (
          <div className="mobile-camera-alert warning animate-slide-up">
            <HiOutlineExclamationCircle size={20} />
            <div>
              <strong>Insecure Context:</strong> Camera access requires HTTPS when accessed remotely over the network. If connecting from a smartphone, ensure you are using an HTTPS reverse proxy (e.g., ngrok/Cloudflare tunnel) or testing via localhost.
            </div>
          </div>
        )}

        {/* Error Notification */}
        {errorMessage && (
          <div className="mobile-camera-alert error animate-slide-up" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
              <HiOutlineExclamationCircle size={20} style={{ flexShrink: 0 }} />
              <div>
                <strong>Camera Error:</strong> {errorMessage}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ flexShrink: 0, padding: '4px 10px', fontSize: 12 }}
              onClick={() => startCamera()}
            >
              <HiOutlineRefresh size={14} /> Retry
            </button>
          </div>
        )}

        {/* Video Viewport Container */}
        <div className={`mobile-camera-viewport ${mirrored ? 'is-mirrored' : ''}`}>
          {/* Active Video Element */}
          <video
            ref={videoRef}
            className={`mobile-camera-video ${isStreaming ? 'visible' : 'hidden'}`}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={handleLoadedMetadata}
          />

          {/* Alignment Grid Overlay */}
          {isStreaming && showGrid && (
            <div className="mobile-camera-grid">
              <div className="grid-line horizontal h1" />
              <div className="grid-line horizontal h2" />
              <div className="grid-line vertical v1" />
              <div className="grid-line vertical v2" />
            </div>
          )}

          {/* Fallback Viewport Placeholder when Camera is stopped */}
          {!isStreaming && (
            <div className="mobile-camera-viewport__placeholder">
              <div className="placeholder-icon-wrap">
                <HiOutlineVideoCamera size={52} />
              </div>
              <h3>Camera is Offline</h3>
              <p>Tap "Start Camera" to start the preview and broadcast live video to the Admin Dashboard via WebRTC.</p>
              <div className="feature-tags">
                <span>✓ WebRTC P2P Live</span>
                <span>✓ STUN / NAT Traversal</span>
                <span>✓ Front / Rear Switch</span>
              </div>
            </div>
          )}

          {/* Viewport Floating HUD Overlays (when streaming) */}
          {isStreaming && (
            <div className="mobile-camera-hud">
              <div className="hud-top">
                <span className={`hud-badge ${connectedViewers > 0 ? 'live' : 'waiting'}`}>
                  <span className={`live-dot ${connectedViewers > 0 ? 'connected' : 'waiting'}`} />
                  {connectedViewers > 0
                    ? `BROADCASTING (${connectedViewers} VIEWER${connectedViewers > 1 ? 'S' : ''})`
                    : 'PREVIEW READY (WAITING FOR ADMIN)'}
                </span>
                {streamStats && (
                  <span className="hud-badge resolution">
                    {streamStats.width}×{streamStats.height} • {streamStats.frameRate}fps
                  </span>
                )}
              </div>

              {/* Viewport Floating Action Bar */}
              <div className="hud-actions">
                <button
                  type="button"
                  className={`hud-btn ${showGrid ? 'active' : ''}`}
                  onClick={() => setShowGrid(!showGrid)}
                  title="Toggle Framing Grid"
                >
                  Grid
                </button>
                <button
                  type="button"
                  className={`hud-btn ${mirrored ? 'active' : ''}`}
                  onClick={() => setMirrored(!mirrored)}
                  title="Mirror Preview"
                >
                  Flip
                </button>
                {supportsTorch && (
                  <button
                    type="button"
                    className={`hud-btn ${torchOn ? 'active' : ''}`}
                    onClick={handleToggleTorch}
                    title="Toggle Flash / Torch"
                  >
                    <HiOutlineLightningBolt size={14} /> Flash
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Device Selection & Controls Card */}
        <div className="mobile-camera-controls-card">
          {devices.length > 1 && (
            <div className="device-selector-group">
              <label htmlFor="cameraSelect" className="control-label">
                Select Camera Sensor:
              </label>
              <select
                id="cameraSelect"
                className="device-select"
                value={selectedDeviceId}
                onChange={handleDeviceChange}
              >
                <option value="">Default ({facingMode === 'environment' ? 'Rear' : 'Front'})</option>
                {devices.map((device, idx) => (
                  <option key={device.deviceId || idx} value={device.deviceId}>
                    {device.label || `Camera ${idx + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Primary Action Buttons */}
          <div className="primary-actions">
            {!isStreaming ? (
              <button
                type="button"
                className="btn btn-primary btn-lg action-btn"
                onClick={() => startCamera()}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <span className="spinner-sm" /> Initializing…
                  </>
                ) : (
                  <>
                    <HiOutlinePlay size={20} /> Start Camera
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-danger btn-lg action-btn"
                onClick={stopCamera}
              >
                <HiOutlineStop size={20} /> Stop Camera
              </button>
            )}

            {/* Quick Switch Front/Back Camera */}
            <button
              type="button"
              className="btn btn-secondary action-btn-switch"
              onClick={handleToggleFacingMode}
              title={`Switch to ${facingMode === 'environment' ? 'Front' : 'Rear'} Camera`}
            >
              <HiOutlineSwitchHorizontal size={20} />
              <span>{facingMode === 'environment' ? 'Front' : 'Rear'}</span>
            </button>
          </div>
        </div>

        {/* Connection & Status Card */}
        <div className="mobile-camera-status-card">
          <div className="status-item">
            <span className="status-label">Local Camera:</span>
            <span className={`status-val ${isStreaming ? 'text-success' : 'text-muted'}`}>
              <span className={`pulse-dot ${isStreaming ? 'online' : 'offline'}`} />
              {isStreaming ? 'Hardware Active' : 'Stopped'}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">WebRTC P2P Stream:</span>
            <span className={`status-val ${connectedViewers > 0 ? 'text-success' : isStreaming ? 'text-warning' : 'text-muted'}`}>
              <span className={`pulse-dot ${connectedViewers > 0 ? 'online' : isStreaming ? 'idle' : 'offline'}`} />
              {connectedViewers > 0 ? `Live Stream (${connectedViewers} Admin Active)` : isStreaming ? 'Ready / Waiting for Admin' : 'Idle'}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">Signaling Server:</span>
            <span className="status-val text-info">
              Socket.IO Connected
            </span>
          </div>
        </div>

        {/* Instructions */}
        <div className="mobile-camera-guide">
          <h3>📱 Live Streaming Instructions:</h3>
          <ul>
            <li>Open the <strong>Admin Dashboard &gt; Live Monitoring</strong> on your laptop and select session <code>{sessionId}</code>.</li>
            <li>Video is streamed directly peer-to-peer using WebRTC without routing raw frames through the database.</li>
            <li>In Phase 4, YOLO detection and ByteTrack multi-person tracking will analyze the incoming stream in real time.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
