import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  HiOutlineVideoCamera,
  HiOutlineRefresh,
  HiOutlineEye,
  HiOutlineExternalLink,
  HiOutlineClipboardCopy,
  HiOutlineVolumeUp,
  HiOutlineVolumeOff,
  HiOutlineArrowsExpand,
  HiOutlineExclamationCircle,
  HiOutlineCheckCircle,
  HiOutlineDeviceMobile,
} from 'react-icons/hi';
import { cameraAPI } from '../services/api';
import { getSocket, fetchIceServers, DEFAULT_ICE_SERVERS } from '../services/webrtc';
import './LiveMonitoring.css';

/**
 * Live Monitoring Page — Phase 3:
 * - Select and switch between camera sessions
 * - Receive WebRTC video stream from smartphone camera
 * - Low-latency P2P streaming via STUN/TURN ICE negotiation
 * - Interactive video player with fullscreen, volume, diagnostics, and snapshot
 * - Canvas overlay layer ready for Phase 5 YOLO bounding boxes
 */
export default function LiveMonitoring() {
  const [searchParams] = useSearchParams();
  const initialSession = searchParams.get('session') || '';

  // Camera list & selection
  const [cameras, setCameras] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(initialSession);
  const [customSessionId, setCustomSessionId] = useState('');
  const [loadingCameras, setLoadingCameras] = useState(true);

  // Video & WebRTC state
  const remoteVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const socketRef = useRef(null);
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);

  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // 'disconnected' | 'connecting' | 'connected' | 'paused'
  const [isBroadcasterOnline, setIsBroadcasterOnline] = useState(false);
  const [streamStats, setStreamStats] = useState(null);
  const [isMuted, setIsMuted] = useState(true);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch camera list
  const loadCameras = useCallback(async () => {
    try {
      setLoadingCameras(true);
      const res = await cameraAPI.list();
      const sessions = res.sessions || [];
      setCameras(sessions);

      // Auto-select session if none selected
      if (!selectedSessionId && sessions.length > 0) {
        setSelectedSessionId(sessions[0].sessionId);
      }
    } catch (err) {
      console.warn('Failed to load cameras:', err.message);
    } finally {
      setLoadingCameras(false);
    }
  }, [selectedSessionId]);

  useEffect(() => {
    loadCameras();
    fetchIceServers().then((servers) => {
      iceServersRef.current = servers;
    });
  }, [loadCameras]);

  /**
   * Reset existing WebRTC peer connection
   */
  const cleanupPeerConnection = useCallback(() => {
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch (err) {
        console.warn('Error closing peer connection:', err);
      }
      peerConnectionRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setConnectionStatus('disconnected');
    setStreamStats(null);
  }, []);

  /**
   * Initialize Socket.IO connection & WebRTC listener for the selected session
   */
  useEffect(() => {
    if (!selectedSessionId) return;

    cleanupPeerConnection();
    setErrorMessage('');
    setConnectionStatus('connecting');

    const socket = getSocket();
    socketRef.current = socket;

    console.log(`👁️ LiveMonitoring joining room as viewer for: [${selectedSessionId}]`);

    // Join room as viewer
    socket.emit('join-session', {
      sessionId: selectedSessionId,
      role: 'viewer',
    });

    // Session status received from signaling server
    const handleSessionStatus = ({ isBroadcasterOnline, isStreaming, iceServers }) => {
      setIsBroadcasterOnline(isBroadcasterOnline);
      if (iceServers && iceServers.length > 0) {
        iceServersRef.current = iceServers;
      }
      if (!isBroadcasterOnline) {
        setConnectionStatus('disconnected');
      } else if (!isStreaming) {
        setConnectionStatus('paused');
      }
    };

    // Broadcaster came online
    const handleBroadcasterConnected = ({ isStreaming }) => {
      setIsBroadcasterOnline(true);
      setConnectionStatus(isStreaming ? 'connecting' : 'paused');
    };

    // Broadcaster stream status changed (started/stopped)
    const handleBroadcasterStreamStatus = ({ isStreaming }) => {
      if (isStreaming) {
        setConnectionStatus('connecting');
      } else {
        setConnectionStatus('paused');
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = null;
        }
      }
    };

    // Broadcaster disconnected
    const handleBroadcasterDisconnected = () => {
      setIsBroadcasterOnline(false);
      setConnectionStatus('disconnected');
      cleanupPeerConnection();
    };

    // ──────────────────────────────────────────
    // Handle Incoming WebRTC Offer from Broadcaster
    // ──────────────────────────────────────────
    const handleWebRTCOffer = async ({ from, offer, sessionId }) => {
      if (sessionId && sessionId !== selectedSessionId) return;

      console.log(`📩 Received WebRTC offer from broadcaster [${from}]`);
      cleanupPeerConnection();

      try {
        const pc = new RTCPeerConnection({
          iceServers: iceServersRef.current,
          iceCandidatePoolSize: 2,
        });
        peerConnectionRef.current = pc;

        // When remote track arrives, attach to video element
        pc.ontrack = (event) => {
          console.log('🎥 Remote track received:', event.streams);
          if (remoteVideoRef.current && event.streams[0]) {
            remoteVideoRef.current.srcObject = event.streams[0];
            remoteVideoRef.current.play().catch((e) => console.warn('Play error:', e));
            setConnectionStatus('connected');
          }
        };

        // Forward ICE candidates back to broadcaster
        pc.onicecandidate = (event) => {
          if (event.candidate && socket.connected) {
            socket.emit('webrtc-ice-candidate', {
              targetId: from,
              candidate: event.candidate,
              sessionId: selectedSessionId,
            });
          }
        };

        // Connection state changes
        pc.onconnectionstatechange = () => {
          console.log('Viewer RTCPeerConnection state:', pc.connectionState);
          if (pc.connectionState === 'connected') {
            setConnectionStatus('connected');
          } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            setConnectionStatus('disconnected');
          }
        };

        // Set remote offer & send SDP answer
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('webrtc-answer', {
          targetId: from,
          answer,
          sessionId: selectedSessionId,
        });

        console.log(`📤 Sent WebRTC answer back to broadcaster [${from}]`);
      } catch (err) {
        console.error('Error handling WebRTC offer:', err);
        setErrorMessage('Failed to establish WebRTC connection: ' + err.message);
        setConnectionStatus('disconnected');
      }
    };

    // Handle ICE Candidate from broadcaster
    const handleWebRTCIceCandidate = async ({ candidate }) => {
      const pc = peerConnectionRef.current;
      if (pc && candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('Error adding ICE candidate:', err);
        }
      }
    };

    socket.on('session-status', handleSessionStatus);
    socket.on('broadcaster-connected', handleBroadcasterConnected);
    socket.on('broadcaster-stream-status', handleBroadcasterStreamStatus);
    socket.on('broadcaster-disconnected', handleBroadcasterDisconnected);
    socket.on('webrtc-offer', handleWebRTCOffer);
    socket.on('webrtc-ice-candidate', handleWebRTCIceCandidate);

    return () => {
      socket.off('session-status', handleSessionStatus);
      socket.off('broadcaster-connected', handleBroadcasterConnected);
      socket.off('broadcaster-stream-status', handleBroadcasterStreamStatus);
      socket.off('broadcaster-disconnected', handleBroadcasterDisconnected);
      socket.off('webrtc-offer', handleWebRTCOffer);
      socket.off('webrtc-ice-candidate', handleWebRTCIceCandidate);
      cleanupPeerConnection();
    };
  }, [selectedSessionId, cleanupPeerConnection]);

  // Update metadata / resolution when video loads
  const handleLoadedMetadata = () => {
    if (!remoteVideoRef.current) return;
    const width = remoteVideoRef.current.videoWidth;
    const height = remoteVideoRef.current.videoHeight;
    setStreamStats({ width, height });
  };

  /**
   * Toggle fullscreen for video container
   */
  const handleToggleFullscreen = () => {
    const el = document.getElementById('monitoring-player-container');
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch((err) => console.warn(err));
    } else {
      document.exitFullscreen().catch((err) => console.warn(err));
    }
  };

  /**
   * Copy mobile streaming URL
   */
  const handleCopyMobileUrl = () => {
    if (!selectedSessionId) return;
    const url = `${window.location.origin}/camera/${selectedSessionId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  /**
   * Open mobile camera page in new tab for testing
   */
  const handleOpenMobileView = () => {
    if (!selectedSessionId) return;
    window.open(`/camera/${selectedSessionId}`, '_blank');
  };

  const currentCamera = cameras.find((c) => c.sessionId === selectedSessionId);

  return (
    <div className="monitoring-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Live Remote Monitoring</h1>
          <p className="page-subtitle">
            Real-time WebRTC video stream received directly from smartphone camera units
          </p>
        </div>

        {/* Quick Actions */}
        <div className="header-actions">
          <button className="btn btn-secondary btn-sm" onClick={loadCameras} title="Refresh sessions">
            <HiOutlineRefresh size={16} /> Refresh
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleOpenMobileView} disabled={!selectedSessionId}>
            <HiOutlineExternalLink size={16} /> Open Smartphone View
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="dashboard-error animate-fade-in">
          <HiOutlineExclamationCircle size={18} /> {errorMessage}
        </div>
      )}

      {/* Main Monitoring Grid */}
      <div className="monitoring-layout">
        {/* Left: Video Player */}
        <div className="monitoring-main glass-card">
          {/* Stream Header Bar */}
          <div className="stream-header-bar">
            <div className="stream-header-info">
              <span className={`pulse-dot ${connectionStatus === 'connected' ? 'online' : connectionStatus === 'connecting' ? 'idle' : 'offline'}`} />
              <span className="stream-name">
                {currentCamera ? currentCamera.name : selectedSessionId || 'No Camera Selected'}
              </span>
              <code className="stream-session-tag">{selectedSessionId}</code>
            </div>

            {/* Connection Status Badge */}
            <div className="stream-status-badge-wrap">
              {connectionStatus === 'connected' && (
                <span className="badge badge-online">
                  <span className="live-dot" /> LIVE P2P STREAM
                </span>
              )}
              {connectionStatus === 'connecting' && (
                <span className="badge badge-warning">
                  <span className="spinner-sm" /> CONNECTING P2P…
                </span>
              )}
              {connectionStatus === 'paused' && (
                <span className="badge badge-warning">
                  CAMERA PAUSED
                </span>
              )}
              {connectionStatus === 'disconnected' && (
                <span className="badge badge-offline">
                  OFFLINE
                </span>
              )}
            </div>
          </div>

          {/* Interactive Player Viewport */}
          <div id="monitoring-player-container" className="monitoring-viewport-container">
            {/* Remote WebRTC Video */}
            <video
              ref={remoteVideoRef}
              className={`remote-video-feed ${connectionStatus === 'connected' ? 'active' : 'hidden'}`}
              autoPlay
              playsInline
              muted={isMuted}
              onLoadedMetadata={handleLoadedMetadata}
            />

            {/* Canvas overlay for Phase 5 bounding boxes */}
            <canvas ref={canvasRef} className="detection-canvas-overlay" />

            {/* Fallback Viewport when Stream is Offline or Connecting */}
            {connectionStatus !== 'connected' && (
              <div className="viewport-placeholder">
                <div className="placeholder-content">
                  <div className="placeholder-icon-ring">
                    <HiOutlineVideoCamera size={48} />
                  </div>
                  <h3>
                    {connectionStatus === 'connecting'
                      ? 'Establishing WebRTC Peer Connection…'
                      : connectionStatus === 'paused'
                      ? 'Smartphone Camera Paused'
                      : 'Waiting for Smartphone Video Feed'}
                  </h3>
                  <p>
                    {isBroadcasterOnline
                      ? 'The smartphone unit is online. Start the camera on the phone to broadcast video.'
                      : `Open the camera link on your phone for session: ${selectedSessionId || '...'}`}
                  </p>

                  <div className="placeholder-actions">
                    <button className="btn btn-primary btn-sm" onClick={handleOpenMobileView}>
                      <HiOutlineExternalLink size={14} /> Open Camera in Tab
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={handleCopyMobileUrl}>
                      <HiOutlineClipboardCopy size={14} /> {copied ? 'Copied!' : 'Copy Mobile Link'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Viewport HUD Overlays (when connected) */}
            {connectionStatus === 'connected' && (
              <div className="viewport-hud">
                <div className="hud-badge live">
                  <span className="live-dot" /> WEBRTC LIVE
                </div>
                {streamStats && (
                  <div className="hud-badge">
                    {streamStats.width}×{streamStats.height} px
                  </div>
                )}
              </div>
            )}

            {/* Player Controls Bar */}
            <div className="player-controls-bar">
              <div className="controls-left">
                <button
                  type="button"
                  className="control-btn"
                  onClick={() => setIsMuted(!isMuted)}
                  title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
                >
                  {isMuted ? <HiOutlineVolumeOff size={18} /> : <HiOutlineVolumeUp size={18} />}
                </button>
              </div>

              <div className="controls-right">
                <button
                  type="button"
                  className="control-btn"
                  onClick={handleToggleFullscreen}
                  title="Toggle Fullscreen"
                >
                  <HiOutlineArrowsExpand size={18} />
                </button>
              </div>
            </div>
          </div>

          {/* Quick Stream Info Footer */}
          <div className="stream-footer-info">
            <span>Transmission: <strong>Direct WebRTC (P2P)</strong></span>
            <span>ICE Relay: <strong>Google STUN (Port 19302)</strong></span>
            <span>Security: <strong>DTLS-SRTP Encrypted</strong></span>
          </div>
        </div>

        {/* Right Sidebar: Camera Selection & Stream Diagnostics */}
        <div className="monitoring-sidebar">
          {/* Active Session Switcher Card */}
          <div className="glass-card session-switcher-card">
            <h3 className="sidebar-card-title">
              <HiOutlineVideoCamera size={18} /> Available Cameras
            </h3>

            {loadingCameras ? (
              <div className="loading-state-sm">
                <span className="spinner-sm" /> Loading registered sessions…
              </div>
            ) : cameras.length === 0 ? (
              <div className="empty-state-sm">
                <p>No camera sessions created yet.</p>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => (window.location.href = '/cameras')}
                >
                  Go to Cameras Page
                </button>
              </div>
            ) : (
              <div className="session-list">
                {cameras.map((cam) => (
                  <button
                    key={cam.sessionId}
                    type="button"
                    className={`session-item ${selectedSessionId === cam.sessionId ? 'selected' : ''}`}
                    onClick={() => setSelectedSessionId(cam.sessionId)}
                  >
                    <div className="session-item__info">
                      <span className={`pulse-dot ${cam.status}`} />
                      <div className="session-item__text">
                        <span className="session-item__name">{cam.name}</span>
                        <code className="session-item__id">{cam.sessionId.slice(0, 10)}…</code>
                      </div>
                    </div>
                    <span className={`badge badge-${cam.status}`}>{cam.status}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Custom Session Input */}
            <div className="custom-session-box">
              <label htmlFor="customId" className="custom-session-label">
                Or Connect to Custom Session ID:
              </label>
              <div className="custom-session-input-row">
                <input
                  id="customId"
                  type="text"
                  className="form-input"
                  placeholder="e.g., room_abc123"
                  value={customSessionId}
                  onChange={(e) => setCustomSessionId(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!customSessionId.trim()}
                  onClick={() => {
                    setSelectedSessionId(customSessionId.trim());
                    setCustomSessionId('');
                  }}
                >
                  Connect
                </button>
              </div>
            </div>
          </div>

          {/* Smartphone QR / Access Card */}
          <div className="glass-card mobile-connect-card">
            <h3 className="sidebar-card-title">
              <HiOutlineDeviceMobile size={18} /> Connect Smartphone
            </h3>
            <p className="sidebar-card-desc">
              To stream from your smartphone, open this camera unit link on the phone's browser:
            </p>

            <div className="share-link-box">
              <input
                type="text"
                readOnly
                className="share-link-input"
                value={`${window.location.origin}/camera/${selectedSessionId || ''}`}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleCopyMobileUrl}
                title="Copy URL"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>

            <button
              type="button"
              className="btn btn-secondary btn-sm btn-block"
              style={{ marginTop: '8px' }}
              onClick={handleOpenMobileView}
            >
              <HiOutlineExternalLink size={14} /> Open Mobile View on this Machine
            </button>
          </div>

          {/* AI Detection Preview (Phase 4-6 Ready) */}
          <div className="glass-card ai-status-card">
            <h3 className="sidebar-card-title">
              <HiOutlineEye size={18} /> AI Computer Vision
            </h3>
            <p className="sidebar-card-desc">
              Real-time human detection (YOLOv8) and multi-person tracking (ByteTrack):
            </p>
            <div className="ai-stat-row">
              <span className="ai-stat-label">YOLO Human Detection:</span>
              <span className="badge badge-warning">Ready for Phase 4</span>
            </div>
            <div className="ai-stat-row">
              <span className="ai-stat-label">ByteTrack Multi-Person:</span>
              <span className="badge badge-warning">Ready for Phase 6</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
