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
  HiOutlineArrowNarrowUp,
  HiOutlineArrowNarrowDown,
  HiOutlineBadgeCheck,
  HiOutlineIdentification,
} from 'react-icons/hi';
import { cameraAPI, dashboardAPI, aiAPI, settingsAPI, studentAPI } from '../services/api';
import { getSocket, fetchIceServers, DEFAULT_ICE_SERVERS } from '../services/webrtc';
import './LiveMonitoring.css';

/**
 * Generate a consistent, vibrant HSL color for a given tracking ID
 */
function getTrackingColor(id) {
  const hue = ((id || 1) * 137.508) % 360; // Golden angle for optimal visual distinctiveness
  return `hsl(${hue}, 85%, 55%)`;
}

/**
 * Live Monitoring Page — Phase 6:
 * - Real-time WebRTC live video receiver from smartphone
 * - ByteTrack multi-person tracking with persistent IDs
 * - Movement trajectory trails (breadcrumbs) per person
 * - Virtual Tripwire line crossing analysis (IN / OUT counters)
 * - Virtual Zone occupancy detection
 * - Real-time session analytics & MongoDB persistence
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

  // ── Phase 5 & 6: AI Detection & ByteTrack Tracking State ──
  const [aiEnabled, setAiEnabled] = useState(true);
  const [enableTracking, setEnableTracking] = useState(true);
  const [showBoxes, setShowBoxes] = useState(true);
  const [showConfidence, setShowConfidence] = useState(true);
  const [showTrails, setShowTrails] = useState(true);
  const [showTripwire, setShowTripwire] = useState(true);
  const [showZone, setShowZone] = useState(false);
  const [confThreshold, setConfThreshold] = useState(0.40);
  const [tripwireY, setTripwireY] = useState(0.50);

  // ── Phase 5: Face Recognition Overlays & Real-Time Roster ──
  const [showRecognitionNames, setShowRecognitionNames] = useState(true);
  const [recognizedCount, setRecognizedCount] = useState(0);
  const [unrecognizedCount, setUnrecognizedCount] = useState(0);
  const [recognizedStudents, setRecognizedStudents] = useState([]);
  const lastRecognizedLogRef = useRef(new Map()); // studentId -> lastLoggedTime

  // Real-time tracking counters
  const [peopleCount, setPeopleCount] = useState(0);
  const [uniqueIdsCount, setUniqueIdsCount] = useState(0);
  const [tripwireEntered, setTripwireEntered] = useState(0);
  const [tripwireExited, setTripwireExited] = useState(0);
  const [zoneCount, setZoneCount] = useState(0);
  const [inferenceTimeMs, setInferenceTimeMs] = useState(0);
  const [aiServiceStatus, setAiServiceStatus] = useState('checking'); // 'online' | 'offline' | 'checking'
  const [activeDetections, setActiveDetections] = useState([]);

  const isDetectingRef = useRef(false);
  const lastRecordTimeRef = useRef(0);
  const lastRecordedCountRef = useRef(-1);

  // Check AI Service Health and Load System Settings on mount
  useEffect(() => {
    aiAPI.getConfig()
      .then((cfg) => {
        setAiServiceStatus('online');
        if (cfg.default_conf) setConfThreshold(cfg.default_conf);
      })
      .catch(() => setAiServiceStatus('offline'));

    settingsAPI.get()
      .then((res) => {
        if (res.settings) {
          if (res.settings.confidenceThreshold != null) setConfThreshold(res.settings.confidenceThreshold);
          if (res.settings.virtualTripwireY != null) setTripwireY(res.settings.virtualTripwireY);
          if (res.settings.enableBreadcrumbs != null) setShowTrails(res.settings.enableBreadcrumbs);
        }
      })
      .catch(() => {});
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
   * Reset ByteTrack tracking state and counters for active session
   */
  const handleResetTracking = async () => {
    if (!selectedSessionId) return;
    try {
      await aiAPI.resetSession(selectedSessionId);
      setUniqueIdsCount(0);
      setTripwireEntered(0);
      setTripwireExited(0);
      setZoneCount(0);
      setActiveDetections([]);
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    } catch (err) {
      console.warn('Failed to reset tracker:', err.message);
    }
  };

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
  // Phase 6: Canvas Overlays — Bounding Boxes, IDs, Trails, Tripwire & Zone
  // ──────────────────────────────────────────
  const drawDetections = useCallback((detections) => {
    const canvas = canvasRef.current;
    const video = remoteVideoRef.current;
    if (!canvas || !video) return;

    const rect = video.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // 1. Draw Virtual Tripwire Line (if enabled)
    if (showTripwire) {
      const lineYPixel = tripwireY * h;

      ctx.save();
      ctx.strokeStyle = '#f59e0b'; // Amber tripwire
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(0, lineYPixel);
      ctx.lineTo(w, lineYPixel);
      ctx.stroke();
      ctx.setLineDash([]);

      // Tripwire Badge Label
      const lineTag = `TRIPWIRE (▲ IN: ${tripwireEntered} | ▼ OUT: ${tripwireExited})`;
      ctx.font = 'bold 11px Inter, system-ui, sans-serif';
      const twMetrics = ctx.measureText(lineTag);
      const twW = twMetrics.width + 16;
      const twX = w / 2 - twW / 2;
      const twY = Math.max(4, lineYPixel - 22);

      ctx.fillStyle = 'rgba(245, 158, 11, 0.9)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(twX, twY, twW, 20, 4);
      else ctx.fillRect(twX, twY, twW, 20);
      ctx.fill();

      ctx.fillStyle = '#0f172a';
      ctx.fillText(lineTag, twX + 8, twY + 14);
      ctx.restore();
    }

    // 2. Draw Virtual Zone (if enabled)
    if (showZone) {
      const zx1 = 0.2 * w;
      const zy1 = 0.2 * h;
      const zw = 0.6 * w;
      const zh = 0.6 * h;

      ctx.save();
      ctx.strokeStyle = '#38bdf8'; // Sky blue
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(zx1, zy1, zw, zh, 8);
      else ctx.rect(zx1, zy1, zw, zh);
      ctx.fill();
      ctx.stroke();

      const zoneTag = `MONITORED ZONE (${zoneCount} INSIDE)`;
      ctx.font = 'bold 10px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(zoneTag, zx1 + 10, zy1 + 18);
      ctx.restore();
    }

    if (!detections || detections.length === 0) return;

    // 3. Draw Trajectory Trails (Breadcrumbs)
    if (showTrails) {
      detections.forEach((det) => {
        const id = det.tracking_id || 1;
        const color = getTrackingColor(id);
        const trail = det.trajectory || [];

        if (trail.length > 1) {
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          trail.forEach((pt, i) => {
            const px = pt.x * w;
            const py = pt.y * h;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.stroke();

          // Draw small glow dots along path
          trail.forEach((pt) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(pt.x * w, pt.y * h, 3, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.restore();
        }
      });
    }

    // 4. Draw Bounding Boxes and Tracking ID Badges
    if (showBoxes) {
      const scaleX = w / (video.videoWidth || 640);
      const scaleY = h / (video.videoHeight || 360);

      detections.forEach((det) => {
        const id = det.tracking_id || 1;
        const color = getTrackingColor(id);

        let x = det.bbox.x * scaleX;
        let y = det.bbox.y * scaleY;
        let boxW = det.bbox.width * scaleX;
        let boxH = det.bbox.height * scaleY;

        if (det.normalized_bbox) {
          x = det.normalized_bbox.x * w;
          y = det.normalized_bbox.y * h;
          boxW = det.normalized_bbox.width * w;
          boxH = det.normalized_bbox.height * h;
        }

        const confPercent = Math.round((det.confidence || 0) * 100);
        const isRecognized = det.identity_status === 'recognized';
        const isUncertain = det.identity_status === 'uncertain';
        const isUnknown = det.identity_status === 'unknown';

        ctx.save();
        // High-tech person bounding box with glow
        const strokeColor = isRecognized ? '#10b981' : color;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = isRecognized ? 3 : 2.5;
        ctx.shadowColor = strokeColor;
        ctx.shadowBlur = isRecognized ? 10 : 6;

        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, boxW, boxH, 6);
        else ctx.rect(x, y, boxW, boxH);
        ctx.stroke();

        ctx.shadowBlur = 0;

        // Draw detected Face Box bracket if present
        if (det.face_box) {
          const fx = det.face_box.x * scaleX;
          const fy = det.face_box.y * scaleY;
          const fw = det.face_box.width * scaleX;
          const fh = det.face_box.height * scaleY;

          ctx.strokeStyle = isRecognized ? '#34d399' : '#38bdf8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(fx, fy, fw, fh, 4);
          else ctx.rect(fx, fy, fw, fh);
          ctx.stroke();
        }

        // Tracking ID + Biometric Recognition Name Badge
        if (showConfidence) {
          let tagText = `ID #${id} (${confPercent}%)`;
          let tagBg = color;
          let textColor = '#0f172a';

          if (showRecognitionNames && isRecognized) {
            const simScore = Math.round((det.similarity || 0) * 100);
            tagText = `✓ ${det.label} [${simScore}%]`;
            tagBg = '#10b981';
            textColor = '#ffffff';
          } else if (showRecognitionNames && isUncertain) {
            tagText = `? ID #${id} • Uncertain [${Math.round((det.similarity || 0) * 100)}%]`;
            tagBg = '#f59e0b';
            textColor = '#0f172a';
          } else if (showRecognitionNames && isUnknown) {
            tagText = `ID #${id} • Unknown (${confPercent}%)`;
            tagBg = '#6366f1';
            textColor = '#ffffff';
          }

          ctx.font = 'bold 11px Inter, system-ui, sans-serif';
          const textMetrics = ctx.measureText(tagText);
          const tagW = textMetrics.width + 16;
          const tagH = 22;
          const tagY = Math.max(0, y - tagH);

          ctx.fillStyle = tagBg;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(x, tagY, tagW, tagH, [5, 5, 0, 0]);
          else ctx.fillRect(x, tagY, tagW, tagH);
          ctx.fill();

          ctx.fillStyle = textColor;
          ctx.fillText(tagText, x + 8, tagY + 15);
        }
        ctx.restore();
      });
    }
  }, [showBoxes, showConfidence, showTrails, showTripwire, showZone, tripwireY, tripwireEntered, tripwireExited, zoneCount, showRecognitionNames]);

  // Re-render canvas overlays if settings change
  useEffect(() => {
    drawDetections(activeDetections);
  }, [drawDetections, activeDetections]);

  // ──────────────────────────────────────────
  // Phase 6: Frame Extraction & ByteTrack Tracking Loop
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

    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = 640;
    offscreenCanvas.height = 360;
    const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

    const trackingInterval = setInterval(async () => {
      const video = remoteVideoRef.current;
      if (!video || video.readyState < 2 || isDetectingRef.current) return;

      isDetectingRef.current = true;

      try {
        offscreenCtx.drawImage(video, 0, 0, 640, 360);
        const base64Data = offscreenCanvas.toDataURL('image/jpeg', 0.65);

        const data = await aiAPI.detectFrame(
          base64Data,
          confThreshold,
          selectedSessionId || 'default',
          tripwireY,
          enableTracking
        );
        setAiServiceStatus('online');

        if (data.success) {
          const detections = data.detections || [];
          setPeopleCount(detections.length);
          setActiveDetections(detections);
          setInferenceTimeMs(data.inference_time_ms || 0);

          if (data.unique_ids_count !== undefined) {
            setUniqueIdsCount(data.unique_ids_count);
          }
          if (data.tripwire) {
            setTripwireEntered(data.tripwire.entered);
            setTripwireExited(data.tripwire.exited);
          }
          if (data.zone) {
            setZoneCount(data.zone.inside_count);
          }

          // ── Phase 5: Face Recognition Telemetry & Audit Events ──
          if (data.recognized_count !== undefined) {
            setRecognizedCount(data.recognized_count);
          }
          if (data.unrecognized_count !== undefined) {
            setUnrecognizedCount(data.unrecognized_count);
          }
          if (data.recognized_students) {
            setRecognizedStudents(data.recognized_students);
          }

          drawDetections(detections);

          // Periodically log tracking event into MongoDB
          const now = Date.now();
          const countChanged = lastRecordedCountRef.current !== detections.length;
          const timeElapsed = now - lastRecordTimeRef.current > 4000;

          if (selectedSessionId && (countChanged || timeElapsed)) {
            lastRecordTimeRef.current = now;
            lastRecordedCountRef.current = detections.length;
            dashboardAPI.recordEvent({
              sessionId: selectedSessionId,
              peopleCount: detections.length,
              detections: detections.map((d) => ({
                trackingId: d.tracking_id || 1,
                confidence: d.confidence,
                bbox: d.bbox,
                studentId: d.student_id,
                identityStatus: d.identity_status,
                label: d.label,
                similarity: d.similarity,
              })),
            }).catch(() => {});
          }

          // Debounced audit logging of recognized students
          detections.forEach((d) => {
            if (d.identity_status === 'recognized' && d.student_id) {
              const lastLogged = lastRecognizedLogRef.current.get(d.student_id) || 0;
              if (now - lastLogged > 30000) {
                lastRecognizedLogRef.current.set(d.student_id, now);
                studentAPI.recordRecognitionEvent({
                  sessionId: selectedSessionId || 'default',
                  studentId: d.student_id,
                  trackingId: d.tracking_id,
                  confidence: d.similarity || 0,
                  bbox: d.bbox,
                  status: 'recognized',
                }).catch(() => {});
              }
            }
          });
        }
      } catch (err) {
        console.warn('ByteTrack inference error:', err.message);
        setAiServiceStatus('offline');
      } finally {
        isDetectingRef.current = false;
      }
    }, 280);

    return () => clearInterval(trackingInterval);
  }, [connectionStatus, aiEnabled, enableTracking, confThreshold, tripwireY, selectedSessionId, drawDetections]);

  // Loaded metadata
  const handleLoadedMetadata = () => {
    if (!remoteVideoRef.current) return;
    const width = remoteVideoRef.current.videoWidth;
    const height = remoteVideoRef.current.videoHeight;
    setStreamStats({ width, height });
  };

  /**
   * Toggle fullscreen
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
          <h1 className="page-title">Live Remote Monitoring & Tracking</h1>
          <p className="page-subtitle">
            Real-time WebRTC video stream with YOLOv8 human detection & ByteTrack multi-person trajectory tracking
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

            {/* Canvas overlay for Phase 6 bounding boxes, IDs, trails, & tripwire */}
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
                    <strong>{peopleCount}</strong> IN VIEW
                  </div>
                )}
                {aiEnabled && (
                  <div className="hud-badge recognized-hud-badge">
                    <HiOutlineIdentification size={14} />
                    <strong>{recognizedCount}</strong> RECOGNIZED
                  </div>
                )}
                {aiEnabled && unrecognizedCount > 0 && (
                  <div className="hud-badge unrecognized-hud-badge">
                    <span>{unrecognizedCount} UNKNOWN</span>
                  </div>
                )}
                {aiEnabled && enableTracking && (
                  <div className="hud-badge unique-badge">
                    <HiOutlineBadgeCheck size={14} />
                    <strong>{uniqueIdsCount}</strong> UNIQUE IDS
                  </div>
                )}
                {aiEnabled && showTripwire && (
                  <div className="hud-badge tripwire-badge">
                    <span>▲ IN: {tripwireEntered}</span>
                    <span>▼ OUT: {tripwireExited}</span>
                  </div>
                )}
                {aiEnabled && inferenceTimeMs > 0 && (
                  <div className="hud-badge fps-badge">
                    <HiOutlineLightningBolt size={14} />
                    {inferenceTimeMs}ms
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
            <span>Tracker: <strong>YOLOv8 + ByteTrack (Persistent IDs)</strong></span>
            <span>Status: <strong className={aiServiceStatus === 'online' ? 'text-success' : 'text-danger'}>{aiServiceStatus.toUpperCase()}</strong></span>
          </div>
        </div>

        {/* Right Sidebar: AI & Tracking Controls */}
        <div className="monitoring-sidebar">
          {/* Phase 6: ByteTrack Multi-Person Tracking Card */}
          <div className="glass-card tracking-control-card">
            <h3 className="sidebar-card-title">
              <HiOutlineSparkles size={18} /> ByteTrack & Spatial Analytics
            </h3>
            <p className="sidebar-card-desc">
              Multi-person tracking, persistent IDs, and virtual line crossing:
            </p>

            {/* Tracking Toggle */}
            <div className="control-toggle-row">
              <span className="control-toggle-label">ByteTrack Multi-Person:</span>
              <button
                type="button"
                className={`btn btn-sm ${enableTracking ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setEnableTracking(!enableTracking)}
              >
                {enableTracking ? 'TRACKING ON' : 'DETECTION ONLY'}
              </button>
            </div>

            {/* Tripwire Line Position Slider */}
            <div className="slider-control-group">
              <div className="slider-label-row">
                <span>Virtual Tripwire Position:</span>
                <span className="slider-value">{Math.round(tripwireY * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.10"
                max="0.90"
                step="0.05"
                value={tripwireY}
                onChange={(e) => setTripwireY(parseFloat(e.target.value))}
                className="ai-slider"
              />
            </div>

            {/* Overlays Visibility Toggles */}
            <div className="checkbox-control-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showBoxes}
                  onChange={(e) => setShowBoxes(e.target.checked)}
                />
                Show Bounding Boxes & IDs
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showTrails}
                  onChange={(e) => setShowTrails(e.target.checked)}
                />
                Show Trajectory Trails (Breadcrumbs)
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showTripwire}
                  onChange={(e) => setShowTripwire(e.target.checked)}
                />
                Show Virtual Tripwire (In / Out)
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showZone}
                  onChange={(e) => setShowZone(e.target.checked)}
                />
                Show Monitored Zone
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showRecognitionNames}
                  onChange={(e) => setShowRecognitionNames(e.target.checked)}
                />
                Show Student Name Badges
              </label>
            </div>

            {/* Session Tracking KPI Metrics */}
            <div className="tracking-metrics-grid">
              <div className="metric-box">
                <span className="metric-title">Active People</span>
                <span className="metric-val text-success">{peopleCount}</span>
              </div>
              <div className="metric-box">
                <span className="metric-title">Identified</span>
                <span className="metric-val text-emerald">{recognizedCount}</span>
              </div>
              <div className="metric-box">
                <span className="metric-title">Unidentified</span>
                <span className="metric-val text-warning">{unrecognizedCount}</span>
              </div>
              <div className="metric-box">
                <span className="metric-title">Unique IDs</span>
                <span className="metric-val text-info">{uniqueIdsCount}</span>
              </div>
              <div className="metric-box">
                <span className="metric-title">Crossed (In)</span>
                <span className="metric-val text-warning">{tripwireEntered}</span>
              </div>
              <div className="metric-box">
                <span className="metric-title">Crossed (Out)</span>
                <span className="metric-val text-danger">{tripwireExited}</span>
              </div>
            </div>

            {/* Reset Tracker Button */}
            <button
              type="button"
              className="btn btn-secondary btn-sm btn-block"
              onClick={handleResetTracking}
              title="Reset tracking IDs, trajectories, and tripwire counts for this session"
            >
              <HiOutlineRefresh size={14} /> Reset Session Tracking
            </button>
          </div>

          {/* Phase 5: Live Recognized Students Roster Card */}
          <div className="glass-card live-roster-card">
            <div className="sidebar-card-header-flex">
              <h3 className="sidebar-card-title">
                <HiOutlineBadgeCheck size={18} /> Identified Students ({recognizedStudents.length})
              </h3>
              <span className="live-status-pill">
                <span className="live-dot" /> LIVE
              </span>
            </div>

            {recognizedStudents.length === 0 ? (
              <div className="empty-roster-state">
                <p>No enrolled students currently identified in camera view.</p>
                <span className="empty-roster-hint">Ensure smartphone camera is pointed at attendees.</span>
              </div>
            ) : (
              <div className="live-roster-list">
                {recognizedStudents.map((st, idx) => (
                  <div key={st.student_id || idx} className="roster-item">
                    <div className="roster-item-avatar">
                      {st.full_name ? st.full_name.charAt(0) : 'S'}
                    </div>
                    <div className="roster-item-info">
                      <span className="roster-item-name">{st.full_name}</span>
                      <div className="roster-item-meta">
                        <span className="roster-roll">{st.roll_number}</span>
                        <span className="roster-track-id">Track #{st.tracking_id}</span>
                      </div>
                    </div>
                    <div className="roster-item-score">
                      <span className="score-badge">
                        {Math.round((st.similarity || 0) * 100)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
