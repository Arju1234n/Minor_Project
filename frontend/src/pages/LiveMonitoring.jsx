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
  HiOutlineUsers,
  HiOutlineAdjustments,
  HiOutlineLightningBolt,
  HiOutlineSparkles,
} from 'react-icons/hi';
import { cameraAPI, dashboardAPI, aiAPI } from '../services/api';
import { getSocket, fetchIceServers, DEFAULT_ICE_SERVERS } from '../services/webrtc';
import './LiveMonitoring.css';

/**
 * Live Monitoring Page — Phase 5:
 * - Real-time WebRTC peer connection from smartphone camera
 * - Automated frame extraction & YOLOv8 human detection (person class only)
 * - Canvas overlay with responsive neon bounding boxes & confidence score tags
 * - Live people count counter and inference latency metrics
 * - Configurable detection threshold & overlay visibility controls
 * - Detection events recording into MongoDB for session history
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

  // ── Phase 5: AI Computer Vision State ────────────────
  const [aiEnabled, setAiEnabled] = useState(true);
  const [showBoxes, setShowBoxes] = useState(true);
  const [showConfidence, setShowConfidence] = useState(true);
  const [confThreshold, setConfThreshold] = useState(0.45);
  const [peopleCount, setPeopleCount] = useState(0);
  const [inferenceTimeMs, setInferenceTimeMs] = useState(0);
  const [aiServiceStatus, setAiServiceStatus] = useState('checking'); // 'online' | 'offline' | 'checking'
  const [activeDetections, setActiveDetections] = useState([]);

  const isDetectingRef = useRef(false);
  const lastRecordTimeRef = useRef(0);
  const lastRecordedCountRef = useRef(-1);

  // Check AI Service Health on mount
  useEffect(() => {
    aiAPI.getConfig()
      .then((cfg) => {
        setAiServiceStatus('online');
        if (cfg.default_conf) setConfThreshold(cfg.default_conf);
      })
      .catch(() => setAiServiceStatus('offline'));
  }, []);

  // Fetch camera list
  const loadCameras = useCallback(async () => {
    try {
      setLoadingCameras(true);
      const res = await cameraAPI.list();
      const sessions = res.sessions || [];
      setCameras(sessions);

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
   * Reset existing WebRTC peer connection & overlays
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
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    setConnectionStatus('disconnected');
    setStreamStats(null);
    setPeopleCount(0);
    setActiveDetections([]);
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

    socket.emit('join-session', {
      sessionId: selectedSessionId,
      role: 'viewer',
    });

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

    const handleBroadcasterConnected = ({ isStreaming }) => {
      setIsBroadcasterOnline(true);
      setConnectionStatus(isStreaming ? 'connecting' : 'paused');
    };

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

    const handleBroadcasterDisconnected = () => {
      setIsBroadcasterOnline(false);
      setConnectionStatus('disconnected');
      cleanupPeerConnection();
    };

    const handleWebRTCOffer = async ({ from, offer, sessionId }) => {
      if (sessionId && sessionId !== selectedSessionId) return;

      cleanupPeerConnection();

      try {
        const pc = new RTCPeerConnection({
          iceServers: iceServersRef.current,
          iceCandidatePoolSize: 2,
        });
        peerConnectionRef.current = pc;

        pc.ontrack = (event) => {
          if (remoteVideoRef.current && event.streams[0]) {
            remoteVideoRef.current.srcObject = event.streams[0];
            remoteVideoRef.current.play().catch((e) => console.warn('Play error:', e));
            setConnectionStatus('connected');
          }
        };

        pc.onicecandidate = (event) => {
          if (event.candidate && socket.connected) {
            socket.emit('webrtc-ice-candidate', {
              targetId: from,
              candidate: event.candidate,
              sessionId: selectedSessionId,
            });
          }
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'connected') {
            setConnectionStatus('connected');
          } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            setConnectionStatus('disconnected');
          }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('webrtc-answer', {
          targetId: from,
          answer,
          sessionId: selectedSessionId,
        });
      } catch (err) {
        console.error('Error handling WebRTC offer:', err);
        setErrorMessage('Failed to establish WebRTC connection: ' + err.message);
        setConnectionStatus('disconnected');
      }
    };

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

  // ──────────────────────────────────────────
  // Phase 5: Draw Bounding Boxes on Overlay Canvas
  // ──────────────────────────────────────────
  const drawDetections = useCallback((detections) => {
    const canvas = canvasRef.current;
    const video = remoteVideoRef.current;
    if (!canvas || !video) return;

    // Synchronize internal canvas resolution with rendered viewport size
    const rect = video.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!showBoxes || !detections || detections.length === 0) return;

    detections.forEach((det, idx) => {
      let x = det.bbox.x;
      let y = det.bbox.y;
      let boxW = det.bbox.width;
      let boxH = det.bbox.height;

      // Use normalized coordinates scaled to rendered canvas viewport
      if (det.normalized_bbox) {
        x = det.normalized_bbox.x * w;
        y = det.normalized_bbox.y * h;
        boxW = det.normalized_bbox.width * w;
        boxH = det.normalized_bbox.height * h;
      }

      const confPercent = Math.round((det.confidence || 0) * 100);

      // Neon Emerald Green bounding box with glow
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = 'rgba(16, 185, 129, 0.7)';
      ctx.shadowBlur = 8;

      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, boxW, boxH, 6);
      } else {
        ctx.rect(x, y, boxW, boxH);
      }
      ctx.stroke();

      ctx.shadowBlur = 0; // reset shadow

      // Draw Badge Tag
      if (showConfidence) {
        const tagText = `Person #${idx + 1} (${confPercent}%)`;
        ctx.font = 'bold 11px Inter, system-ui, sans-serif';
        const textMetrics = ctx.measureText(tagText);
        const tagW = textMetrics.width + 12;
        const tagH = 20;
        const tagY = Math.max(0, y - tagH);

        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x, tagY, tagW, tagH, [4, 4, 0, 0]);
        } else {
          ctx.fillRect(x, tagY, tagW, tagH);
        }
        ctx.fill();

        ctx.fillStyle = '#0f172a';
        ctx.fillText(tagText, x + 6, tagY + 14);
      }
    });
  }, [showBoxes, showConfidence]);

  // Re-render bounding boxes if display settings change
  useEffect(() => {
    drawDetections(activeDetections);
  }, [drawDetections, activeDetections]);

  // ──────────────────────────────────────────
  // Phase 5: Real-time Frame Extraction & YOLO Detection Pipeline
  // ──────────────────────────────────────────
  useEffect(() => {
    if (connectionStatus !== 'connected' || !aiEnabled) {
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      setPeopleCount(0);
      setActiveDetections([]);
      return;
    }

    // Hidden extraction canvas (640x360 for high-speed inference)
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = 640;
    offscreenCanvas.height = 360;
    const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

    const detectionInterval = setInterval(async () => {
      const video = remoteVideoRef.current;
      if (!video || video.readyState < 2 || isDetectingRef.current) return;

      isDetectingRef.current = true;

      try {
        offscreenCtx.drawImage(video, 0, 0, 640, 360);
        const base64Data = offscreenCanvas.toDataURL('image/jpeg', 0.65);

        const data = await aiAPI.detectFrame(base64Data, confThreshold);
        setAiServiceStatus('online');

        if (data.success) {
          const detections = data.detections || [];
          setPeopleCount(detections.length);
          setActiveDetections(detections);
          setInferenceTimeMs(data.inference_time_ms || 0);

          drawDetections(detections);

          // Periodically log detection events into database (every 4 seconds or on people count change)
          const now = Date.now();
          const countChanged = lastRecordedCountRef.current !== detections.length;
          const timeElapsed = now - lastRecordTimeRef.current > 4000;

          if (selectedSessionId && (countChanged || timeElapsed)) {
            lastRecordTimeRef.current = now;
            lastRecordedCountRef.current = detections.length;
            dashboardAPI.recordEvent({
              sessionId: selectedSessionId,
              peopleCount: detections.length,
              detections: detections.map((d, i) => ({
                trackingId: i + 1,
                confidence: d.confidence,
                bbox: d.bbox,
              })),
            }).catch(() => {});
          }
        }
      } catch (err) {
        console.warn('AI Frame inference error:', err.message);
        setAiServiceStatus('offline');
      } finally {
        isDetectingRef.current = false;
      }
    }, 280); // Run inference ~3.5 times per second

    return () => clearInterval(detectionInterval);
  }, [connectionStatus, aiEnabled, confThreshold, selectedSessionId, drawDetections]);

  // Update metadata when video dimensions change
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

  const handleCopyMobileUrl = () => {
    if (!selectedSessionId) return;
    const url = `${window.location.origin}/camera/${selectedSessionId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

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
            Real-time WebRTC video feed with live YOLOv8 human detection overlays
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
                {aiEnabled && (
                  <div className="hud-badge ai-badge">
                    <HiOutlineUsers size={14} />
                    <strong>{peopleCount}</strong> {peopleCount === 1 ? 'PERSON' : 'PEOPLE'}
                  </div>
                )}
                {aiEnabled && inferenceTimeMs > 0 && (
                  <div className="hud-badge fps-badge">
                    <HiOutlineLightningBolt size={14} />
                    {inferenceTimeMs}ms
                  </div>
                )}
                {streamStats && (
                  <div className="hud-badge">
                    {streamStats.width}×{streamStats.height}
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
                <button
                  type="button"
                  className={`control-btn ${aiEnabled ? 'active-glow' : ''}`}
                  onClick={() => setAiEnabled(!aiEnabled)}
                  title={aiEnabled ? 'Pause AI Detection' : 'Enable AI Detection'}
                >
                  <HiOutlineEye size={18} />
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
            <span>AI Model: <strong>YOLOv8 Nano (Person Only)</strong></span>
            <span>Status: <strong className={aiServiceStatus === 'online' ? 'text-success' : 'text-danger'}>{aiServiceStatus.toUpperCase()}</strong></span>
          </div>
        </div>

        {/* Right Sidebar: Camera Selection & AI Controls */}
        <div className="monitoring-sidebar">
          {/* Phase 5: Real-Time AI Detection Control Card */}
          <div className="glass-card ai-control-card">
            <h3 className="sidebar-card-title">
              <HiOutlineSparkles size={18} /> AI Detection Controls
            </h3>
            <p className="sidebar-card-desc">
              YOLOv8 neural network inference on incoming live frames:
            </p>

            {/* AI Toggle Switch */}
            <div className="control-toggle-row">
              <span className="control-toggle-label">Human Detection:</span>
              <button
                type="button"
                className={`btn btn-sm ${aiEnabled ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setAiEnabled(!aiEnabled)}
              >
                {aiEnabled ? 'ENABLED' : 'PAUSED'}
              </button>
            </div>

            {/* Confidence Threshold Slider */}
            <div className="slider-control-group">
              <div className="slider-label-row">
                <span>Confidence Threshold:</span>
                <span className="slider-value">{Math.round(confThreshold * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.20"
                max="0.85"
                step="0.05"
                value={confThreshold}
                onChange={(e) => setConfThreshold(parseFloat(e.target.value))}
                className="ai-slider"
              />
            </div>

            {/* Bounding Box Visibility Checkboxes */}
            <div className="checkbox-control-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showBoxes}
                  onChange={(e) => setShowBoxes(e.target.checked)}
                />
                Show Bounding Boxes
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showConfidence}
                  onChange={(e) => setShowConfidence(e.target.checked)}
                />
                Show Confidence Scores
              </label>
            </div>

            {/* AI Stats Pill Box */}
            <div className="ai-stats-pill-box">
              <div className="stat-pill">
                <span className="stat-pill-label">Detected Now</span>
                <span className="stat-pill-val text-success">{peopleCount}</span>
              </div>
              <div className="stat-pill">
                <span className="stat-pill-label">Inference Time</span>
                <span className="stat-pill-val text-info">{inferenceTimeMs}ms</span>
              </div>
              <div className="stat-pill">
                <span className="stat-pill-label">AI Engine</span>
                <span className={`stat-pill-val ${aiServiceStatus === 'online' ? 'text-success' : 'text-danger'}`}>
                  {aiServiceStatus}
                </span>
              </div>
            </div>
          </div>

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
              Open this link on your smartphone's browser to stream video into this AI monitor:
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
        </div>
      </div>
    </div>
  );
}
