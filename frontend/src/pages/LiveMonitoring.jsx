import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  HiOutlineVideoCamera,
  HiOutlineRefresh,
  HiOutlineEye,
  HiOutlineEyeOff,
  HiOutlineExternalLink,
  HiOutlineClipboardCopy,
  HiOutlineVolumeUp,
  HiOutlineVolumeOff,
  HiOutlineArrowsExpand,
  HiOutlineExclamationCircle,
  HiOutlineDeviceMobile,
  HiOutlineUsers,
  HiOutlineLightningBolt,
  HiOutlineSparkles,
  HiOutlineBadgeCheck,
  HiOutlineIdentification,
  HiOutlinePlay,
  HiOutlineStop,
  HiOutlineChevronDown,
  HiOutlineChevronUp,
  HiOutlineAdjustments,
} from 'react-icons/hi';
import { QRCodeSVG } from 'qrcode.react';
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
  const cctvImageRef = useRef(null);
  const canvasRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const socketRef = useRef(null);
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);

  const [isLocalWebcam, setIsLocalWebcam] = useState(false);
  const [streamStats, setStreamStats] = useState(null);

  const currentCamera = cameras.find((c) => c.sessionId === selectedSessionId);
  const isCctv = !isLocalWebcam && currentCamera?.type === 'cctv';

  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // 'disconnected' | 'connecting' | 'connected' | 'paused'
  const [isBroadcasterOnline, setIsBroadcasterOnline] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lanIp, setLanIp] = useState('');

  // ── Phase 5 & 6: AI Detection & ByteTrack Tracking State ──
  const [aiEnabled, setAiEnabled] = useState(true);
  const [enableTracking, setEnableTracking] = useState(true);
  const [showBoxes, setShowBoxes] = useState(true);
  const [showTrails, setShowTrails] = useState(true);
  const [showTripwire, setShowTripwire] = useState(true);
  const [showZone, setShowZone] = useState(false);
  const [confThreshold, setConfThreshold] = useState(0.40);
  const [tripwireY, setTripwireY] = useState(0.50);

  // ── Phase 5: Face Recognition Overlays & Real-Time Roster ──
  const [simpleMonitoringMode, setSimpleMonitoringMode] = useState(false);
  const [showRecognitionNames, setShowRecognitionNames] = useState(true);
  const [recognizedCount, setRecognizedCount] = useState(0);
  const [unrecognizedCount, setUnrecognizedCount] = useState(0);
  const [recognizedStudents, setRecognizedStudents] = useState([]);
  const [galleryCount, setGalleryCount] = useState(null);
  const lastRecognizedLogRef = useRef(new Map()); // studentId -> lastLoggedTime
  const lastAutoSyncTimeRef = useRef(0);

  // Real-time tracking counters
  const [peopleCount, setPeopleCount] = useState(0);
  const [uniqueIdsCount, setUniqueIdsCount] = useState(0);
  const [tripwireEntered, setTripwireEntered] = useState(0);
  const [tripwireExited, setTripwireExited] = useState(0);
  const [zoneCount, setZoneCount] = useState(0);
  const [inferenceTimeMs, setInferenceTimeMs] = useState(0);
  const [aiServiceStatus, setAiServiceStatus] = useState('checking'); // 'online' | 'offline' | 'checking'
  const [activeDetections, setActiveDetections] = useState([]);

  // ── Hardware Acceleration & Telemetry State ──
  const [telemetry, setTelemetry] = useState({
    transportLatencyMs: 0,
    renderingFps: 30,
    detectionLatencyMs: 0,
    recognitionLatencyMs: 0,
    totalProcessingMs: 0,
    aiFps: 0,
    device: 'mps',
    modelName: 'yolov8n.pt',
    facesAnalyzed: 0,
  });

  const [aiConfig, setAiConfig] = useState({
    model_name: 'yolov8n.pt',
    device: 'mps',
    face_rec_interval_frames: 30,
    face_rec_retry_frames: 15,
    max_faces_per_frame: 2,
    available_models: ['yolov8n.pt', 'yolo11n.pt'],
    available_devices: ['mps', 'coreml', 'cpu'],
  });

  const isDetectingRef = useRef(false);
  const lastRecordTimeRef = useRef(0);
  const lastRecordedCountRef = useRef(-1);

  // Check AI Service Health, Load Settings, and Fetch LAN IP on mount
  useEffect(() => {
    aiAPI.getConfig()
      .then((cfg) => {
        setAiServiceStatus('online');
        if (cfg.default_conf) setConfThreshold(cfg.default_conf);
        setAiConfig((prev) => ({
          ...prev,
          model_name: cfg.model_name || prev.model_name,
          device: cfg.device || prev.device,
          face_rec_interval_frames: cfg.face_rec_interval_frames || prev.face_rec_interval_frames,
          face_rec_retry_frames: cfg.face_rec_retry_frames || prev.face_rec_retry_frames,
          max_faces_per_frame: cfg.max_faces_per_frame || prev.max_faces_per_frame,
          available_models: cfg.available_models || prev.available_models,
          available_devices: cfg.available_devices || prev.available_devices,
        }));
        setTelemetry((prev) => ({
          ...prev,
          device: cfg.device || prev.device,
          modelName: cfg.model_name || prev.modelName,
        }));
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

    cameraAPI.getNetworkInfo()
      .then((res) => {
        if (res?.primaryIp) {
          setLanIp(res.primaryIp);
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

      if (!selectedSessionId && sessions.length > 0 && !isLocalWebcam) {
        // If an online or streaming session exists, prioritize it
        const active = sessions.find((s) => s.status === 'streaming' || s.status === 'online');
        if (active) {
          setSelectedSessionId(active.sessionId);
        } else {
          // Default to phone camera over CCTV to avoid probing offline CCTV RTSP
          const phoneCam = sessions.find((s) => s.type === 'phone');
          setSelectedSessionId(phoneCam ? phoneCam.sessionId : sessions[0].sessionId);
        }
      }
    } catch (err) {
      console.warn('Failed to load cameras:', err.message);
    } finally {
      setLoadingCameras(false);
    }
  }, [selectedSessionId, isLocalWebcam]);

  useEffect(() => {
    loadCameras();
    fetchIceServers().then((servers) => {
      iceServersRef.current = servers;
    });
  }, [loadCameras]);

  /**
   * Reset existing WebRTC peer connection, local webcam, & overlays
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
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    setIsLocalWebcam(false);
    setConnectionStatus('disconnected');
    setStreamStats(null);
    setPeopleCount(0);
    setActiveDetections([]);
  }, []);

  /**
   * Start local device webcam (built-in or USB webcam) for direct real-time testing and monitoring
   */
  const startLocalWebcam = async () => {
    try {
      setErrorMessage('');
      setConnectionStatus('connecting');
      cleanupPeerConnection();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Webcam API is not supported in this browser. Please ensure HTTPS or localhost.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: false,
      });

      localStreamRef.current = stream;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.muted = true;
        await remoteVideoRef.current.play().catch((e) => console.warn('Play error:', e));
      }

      setIsLocalWebcam(true);
      setConnectionStatus('connected');
    } catch (err) {
      console.error('Failed to start local webcam:', err);
      setErrorMessage('Could not access local webcam: ' + (err.message || 'Permission denied'));
      setConnectionStatus('disconnected');
      setIsLocalWebcam(false);
    }
  };

  /**
   * Stop local device webcam
   */
  const stopLocalWebcam = () => {
    cleanupPeerConnection();
  };

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
    if (isLocalWebcam || !selectedSessionId || isCctv) return;

    cleanupPeerConnection();
    setErrorMessage('');
    setConnectionStatus('connecting');

    const socket = getSocket();
    socketRef.current = socket;

    // Join room as viewer (and re-join whenever socket reconnects)
    const registerViewer = () => {
      socket.emit('join-session', {
        sessionId: selectedSessionId,
        role: 'viewer',
      });
    };

    if (socket.connected) {
      registerViewer();
    }
    socket.on('connect', registerViewer);

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

    let pendingIceCandidates = [];

    const handleWebRTCOffer = async ({ from, offer, sessionId }) => {
      if (isLocalWebcam) return;
      if (sessionId && sessionId !== selectedSessionId) return;

      cleanupPeerConnection();
      pendingIceCandidates = [];

      try {
        const pc = new RTCPeerConnection({
          iceServers: iceServersRef.current,
          iceCandidatePoolSize: 2,
        });
        peerConnectionRef.current = pc;

        pc.ontrack = (event) => {
          if (remoteVideoRef.current && event.streams[0]) {
            remoteVideoRef.current.srcObject = event.streams[0];
            remoteVideoRef.current.muted = true;
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
          } else if (pc.connectionState === 'failed') {
            setConnectionStatus('disconnected');
          }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        // Process any queued early ICE candidates
        while (pendingIceCandidates.length > 0) {
          const cand = pendingIceCandidates.shift();
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch (e) {
            console.warn('Error adding queued ICE candidate on viewer:', e);
          }
        }

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
      if (isLocalWebcam) return;
      const pc = peerConnectionRef.current;
      if (!pc || !candidate) return;
      if (pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('Error adding ICE candidate:', err);
        }
      } else {
        pendingIceCandidates.push(candidate);
      }
    };

    socket.on('session-status', handleSessionStatus);
    socket.on('broadcaster-connected', handleBroadcasterConnected);
    socket.on('broadcaster-stream-status', handleBroadcasterStreamStatus);
    socket.on('broadcaster-disconnected', handleBroadcasterDisconnected);
    socket.on('webrtc-offer', handleWebRTCOffer);
    socket.on('webrtc-ice-candidate', handleWebRTCIceCandidate);

    return () => {
      socket.off('connect', registerViewer);
      socket.off('session-status', handleSessionStatus);
      socket.off('broadcaster-connected', handleBroadcasterConnected);
      socket.off('broadcaster-stream-status', handleBroadcasterStreamStatus);
      socket.off('broadcaster-disconnected', handleBroadcasterDisconnected);
      socket.off('webrtc-offer', handleWebRTCOffer);
      socket.off('webrtc-ice-candidate', handleWebRTCIceCandidate);
      cleanupPeerConnection();
    };
  }, [selectedSessionId, isCctv, isLocalWebcam, cleanupPeerConnection]);

  // ──────────────────────────────────────────
  // CCTV Stream Ingestion Management
  // ──────────────────────────────────────────
  useEffect(() => {
    if (isLocalWebcam || !selectedSessionId || !isCctv) return;

    cleanupPeerConnection();
    setErrorMessage('');
    setConnectionStatus('connecting');

    // Automatically trigger CCTV worker start
    cameraAPI.startCctv(selectedSessionId)
      .then((res) => {
        if (res.ok || res.success) {
          setConnectionStatus('connected');
        } else {
          setConnectionStatus('disconnected');
          setErrorMessage(res.message || 'CCTV camera stream offline or unreachable');
        }
      })
      .catch((err) => {
        console.warn('CCTV auto-start note:', err.message);
        setConnectionStatus('disconnected');
      });
  }, [selectedSessionId, isCctv, isLocalWebcam, cleanupPeerConnection]);

  const handleToggleCctvStream = async () => {
    if (!selectedSessionId) return;
    try {
      if (connectionStatus === 'connected') {
        await cameraAPI.stopCctv(selectedSessionId);
        setConnectionStatus('disconnected');
      } else {
        setConnectionStatus('connecting');
        await cameraAPI.startCctv(selectedSessionId);
        setConnectionStatus('connected');
      }
      await loadCameras();
    } catch (err) {
      setErrorMessage(err.message);
    }
  };

/**
 * Calculate the exact rendered sub-rectangle of video or CCTV image within the container
 * when using CSS object-fit: contain (accounting for letterboxing / pillarboxing).
 */
function getMediaDisplayRect(mediaEl, containerWidth, containerHeight) {
  if (!mediaEl) return { rx: 0, ry: 0, rw: containerWidth, rh: containerHeight, vw: 640, vh: 360 };
  const vw = mediaEl.videoWidth || mediaEl.naturalWidth || 640;
  const vh = mediaEl.videoHeight || mediaEl.naturalHeight || 360;
  const mediaAspect = vw / vh;
  const containerAspect = containerWidth / containerHeight;

  let rw = containerWidth;
  let rh = containerHeight;
  let rx = 0;
  let ry = 0;

  if (mediaAspect > containerAspect) {
    // Media is wider than element: top/bottom letterboxing
    rw = containerWidth;
    rh = containerWidth / mediaAspect;
    rx = 0;
    ry = (containerHeight - rh) / 2;
  } else {
    // Media is taller than element: left/right pillarboxing
    rh = containerHeight;
    rw = containerHeight * mediaAspect;
    rx = (containerWidth - rw) / 2;
    ry = 0;
  }

  return { rx, ry, rw, rh, vw, vh };
}

  // ──────────────────────────────────────────
  // Canvas Overlays — Bounding Boxes, IDs, Trails, Tripwire & Recognition
  // ──────────────────────────────────────────
  const drawDetections = useCallback((detections) => {
    const canvas = canvasRef.current;
    const mediaEl = isCctv ? cctvImageRef.current : remoteVideoRef.current;
    if (!canvas || !mediaEl) return;

    const rect = mediaEl.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (w === 0 || h === 0) return;

    const { rx, ry, rw, rh, vw, vh } = getMediaDisplayRect(mediaEl, w, h);

    // 1. Draw Virtual Tripwire Line (if enabled)
    if (showTripwire) {
      const lineYPixel = ry + tripwireY * rh;

      ctx.save();
      ctx.strokeStyle = '#f59e0b'; // Amber tripwire
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(rx, lineYPixel);
      ctx.lineTo(rx + rw, lineYPixel);
      ctx.stroke();
      ctx.setLineDash([]);

      // Tripwire Badge Label
      const lineTag = `TRIPWIRE (▲ IN: ${tripwireEntered} | ▼ OUT: ${tripwireExited})`;
      ctx.font = 'bold 11px Inter, system-ui, sans-serif';
      const twMetrics = ctx.measureText(lineTag);
      const twW = twMetrics.width + 16;
      const twX = rx + rw / 2 - twW / 2;
      const twY = Math.max(ry + 4, lineYPixel - 22);

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
      const zx1 = rx + 0.2 * rw;
      const zy1 = ry + 0.2 * rh;
      const zw = 0.6 * rw;
      const zh = 0.6 * rh;

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

    // Draw on-canvas People Detected badge (top-left of video viewport)
    ctx.save();
    const countTag = `People Detected: ${detections.length}`;
    ctx.font = 'bold 12px Inter, system-ui, sans-serif';
    const tagMetrics = ctx.measureText(countTag);
    const badgeW = tagMetrics.width + 20;
    const badgeH = 26;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(rx + 14, ry + 14, badgeW, badgeH, 6);
    else ctx.fillRect(rx + 14, ry + 14, badgeW, badgeH);
    ctx.fill();
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.fillText(countTag, rx + 24, ry + 31);
    ctx.restore();

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
            const px = rx + pt.x * rw;
            const py = ry + pt.y * rh;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.stroke();

          // Draw small glow dots along path
          trail.forEach((pt) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(rx + pt.x * rw, ry + pt.y * rh, 3, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.restore();
        }
      });
    }

    // 4. Draw Bounding Boxes, Student Names, and Tracking ID Badges
    if (showBoxes) {
      detections.forEach((det) => {
        const id = det.tracking_id || 1;
        const color = getTrackingColor(id);

        let x, y, boxW, boxH;
        if (det.normalized_bbox) {
          x = rx + det.normalized_bbox.x * rw;
          y = ry + det.normalized_bbox.y * rh;
          boxW = det.normalized_bbox.width * rw;
          boxH = det.normalized_bbox.height * rh;
        } else {
          const scaleX = rw / vw;
          const scaleY = rh / vh;
          x = rx + det.bbox.x * scaleX;
          y = ry + det.bbox.y * scaleY;
          boxW = det.bbox.width * scaleX;
          boxH = det.bbox.height * scaleY;
        }

        const confPercent = Math.round((det.confidence || 0) * 100);
        const isRecognized = det.identity_status === 'recognized';

        ctx.save();
        // High-tech person bounding box with glow
        const strokeColor = (!simpleMonitoringMode && isRecognized) ? '#10b981' : color;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = (!simpleMonitoringMode && isRecognized) ? 3 : 2.5;
        ctx.shadowColor = strokeColor;
        ctx.shadowBlur = (!simpleMonitoringMode && isRecognized) ? 10 : 6;

        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, boxW, boxH, 6);
        else ctx.rect(x, y, boxW, boxH);
        ctx.stroke();

        ctx.shadowBlur = 0;

        // Draw detected Face Box bracket if present (only when face identification mode is enabled)
        if (!simpleMonitoringMode) {
          if (det.normalized_face_box) {
            const fx = rx + det.normalized_face_box.x * rw;
            const fy = ry + det.normalized_face_box.y * rh;
            const fw = det.normalized_face_box.width * rw;
            const fh = det.normalized_face_box.height * rh;

            ctx.strokeStyle = isRecognized ? '#34d399' : '#38bdf8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(fx, fy, fw, fh, 4);
            else ctx.rect(fx, fy, fw, fh);
            ctx.stroke();
          } else if (det.face_box) {
            const scaleX = rw / vw;
            const scaleY = rh / vh;
            const fx = rx + det.face_box.x * scaleX;
            const fy = ry + det.face_box.y * scaleY;
            const fw = det.face_box.width * scaleX;
            const fh = det.face_box.height * scaleY;

            ctx.strokeStyle = isRecognized ? '#34d399' : '#38bdf8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(fx, fy, fw, fh, 4);
            else ctx.rect(fx, fy, fw, fh);
            ctx.stroke();
          }
        }

        // Person Identification Badge
        let tagText = `Person #${id} (${confPercent}%)`;
        let tagBg = color;
        let textColor = '#ffffff';

        if (!simpleMonitoringMode) {
          if (isRecognized && showRecognitionNames) {
            const simScore = Math.round((det.similarity || 0) * 100);
            const studentText = det.roll_number && det.full_name
              ? `${det.roll_number} — ${det.full_name}`
              : det.label || 'Recognized Student';
            tagText = `✓ ${studentText} (${simScore}%) • Track #${id}`;
            tagBg = '#10b981';
            textColor = '#ffffff';
          } else {
            tagText = `Unknown • Track #${id} (${confPercent}%)`;
            tagBg = '#475569';
            textColor = '#f8fafc';
          }
        }

        ctx.font = 'bold 11px Inter, system-ui, sans-serif';
        const textMetrics = ctx.measureText(tagText);
        const tagW = textMetrics.width + 16;
        const tagH = 22;
        const tagY = Math.max(ry, y - tagH);

        ctx.fillStyle = tagBg;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, tagY, tagW, tagH, [5, 5, 0, 0]);
        else ctx.fillRect(x, tagY, tagW, tagH);
        ctx.fill();

        ctx.fillStyle = textColor;
        ctx.fillText(tagText, x + 8, tagY + 15);

        ctx.restore();
      });
    }
  }, [showBoxes, showTrails, showTripwire, showZone, tripwireY, tripwireEntered, tripwireExited, zoneCount, showRecognitionNames, simpleMonitoringMode]);

  const activeDetectionsRef = useRef([]);
  const lastAiFailureRef = useRef(0);

  // ── Hardware & Model Config Handlers ──
  const handleModelChange = async (newModel) => {
    try {
      const res = await aiAPI.updateConfig({ model_name: newModel });
      if (res && res.success && res.config) {
        setAiConfig((prev) => ({ ...prev, model_name: res.config.model_name }));
        setTelemetry((prev) => ({ ...prev, modelName: res.config.model_name }));
      }
    } catch (err) {
      console.warn('Failed to update YOLO model:', err);
    }
  };

  const handleDeviceChange = async (newDevice) => {
    try {
      const res = await aiAPI.updateConfig({ device: newDevice });
      if (res && res.success && res.config) {
        setAiConfig((prev) => ({ ...prev, device: res.config.device }));
        setTelemetry((prev) => ({ ...prev, device: res.config.device }));
      }
    } catch (err) {
      console.warn('Failed to update accelerator device:', err);
    }
  };

  const handleFaceRecIntervalChange = async (newInterval) => {
    try {
      const res = await aiAPI.updateConfig({ face_rec_interval: newInterval });
      if (res && res.success && res.config) {
        setAiConfig((prev) => ({ ...prev, face_rec_interval_frames: res.config.face_rec_interval_frames }));
      }
    } catch (err) {
      console.warn('Failed to update face rec interval:', err);
    }
  };

  const handleMaxFacesChange = async (newMax) => {
    try {
      const res = await aiAPI.updateConfig({ max_faces_per_frame: newMax });
      if (res && res.success && res.config) {
        setAiConfig((prev) => ({ ...prev, max_faces_per_frame: res.config.max_faces_per_frame }));
      }
    } catch (err) {
      console.warn('Failed to update max faces per frame:', err);
    }
  };

  // ── Decoupled 60 FPS Canvas Overlay Render Loop (Independent of AI inference) ──
  useEffect(() => {
    if (connectionStatus !== 'connected' || !aiEnabled) {
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      return;
    }

    let animId = null;
    let isRunning = true;

    const renderLoop = () => {
      if (!isRunning) return;
      drawDetections(activeDetectionsRef.current);
      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);

    return () => {
      isRunning = false;
      if (animId) cancelAnimationFrame(animId);
    };
  }, [connectionStatus, aiEnabled, drawDetections]);

  // ── Real-Time Video Presentation FPS Tracker ──
  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video || connectionStatus !== 'connected' || isCctv) return;

    let callbackId = null;
    let frameCount = 0;
    let lastTime = performance.now();
    let isMounted = true;

    const onVideoFrame = (now) => {
      if (!isMounted) return;
      frameCount++;
      const elapsed = now - lastTime;
      if (elapsed >= 1000) {
        const currentFps = Math.round((frameCount * 1000) / elapsed);
        setTelemetry((prev) => ({ ...prev, renderingFps: currentFps }));
        frameCount = 0;
        lastTime = now;
      }
      if (video.requestVideoFrameCallback) {
        callbackId = video.requestVideoFrameCallback(onVideoFrame);
      }
    };

    if (video.requestVideoFrameCallback) {
      callbackId = video.requestVideoFrameCallback(onVideoFrame);
    }

    return () => {
      isMounted = false;
      if (callbackId && video.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(callbackId);
      }
    };
  }, [connectionStatus, isCctv]);

  // ── WebRTC Transport Latency Tracker (RTT & Jitter Buffer Delay) ──
  useEffect(() => {
    if (connectionStatus !== 'connected' || isCctv || isLocalWebcam) return;

    const intervalId = setInterval(async () => {
      const pc = peerConnectionRef.current;
      if (!pc || pc.connectionState !== 'connected') return;

      try {
        const stats = await pc.getStats();
        let rttMs = 0;
        let jitterDelayMs = 0;

        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.currentRoundTripTime != null) {
            rttMs = report.currentRoundTripTime * 1000;
          }
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            if (report.jitterBufferDelay != null && report.jitterBufferEmittedCount) {
              jitterDelayMs = (report.jitterBufferDelay / report.jitterBufferEmittedCount) * 1000;
            }
          }
        });

        const transportLat = Math.round((rttMs / 2) + jitterDelayMs);
        if (transportLat > 0) {
          setTelemetry((prev) => ({ ...prev, transportLatencyMs: transportLat }));
        }
      } catch (e) {
        // Stats query failure ignored
      }
    }, 1500);

    return () => clearInterval(intervalId);
  }, [connectionStatus, isCctv, isLocalWebcam]);

  // ResizeObserver to immediately redraw canvas overlays when container or window is resized
  useEffect(() => {
    const mediaEl = isCctv ? cctvImageRef.current : remoteVideoRef.current;
    if (!mediaEl) return;

    const ro = new ResizeObserver(() => {
      drawDetections(activeDetectionsRef.current);
    });
    ro.observe(mediaEl);
    return () => ro.disconnect();
  }, [drawDetections, isCctv]);

  const handleRetryAiService = async () => {
    setAiServiceStatus('checking');
    try {
      const cfg = await aiAPI.getConfig();
      setAiServiceStatus('online');
      if (cfg.default_conf) setConfThreshold(cfg.default_conf);
    } catch {
      setAiServiceStatus('offline');
      lastAiFailureRef.current = Date.now();
    }
  };

  // ──────────────────────────────────────────
  // Phase 6: Bounded Latest-Frame AI Inference Loop (Phone & CCTV)
  // ──────────────────────────────────────────
  useEffect(() => {
    if (connectionStatus !== 'connected' || !aiEnabled) {
      setPeopleCount(0);
      setActiveDetections([]);
      activeDetectionsRef.current = [];
      return;
    }

    let isMounted = true;
    let timerId = null;

    const offscreenCanvas = document.createElement('canvas');
    const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

    let aiCycleCount = 0;
    let lastAiCycleTime = performance.now();

    const handleDetectionResults = (data, now) => {
      const detections = data.detections || [];
      activeDetectionsRef.current = detections;
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

      // Face Recognition Telemetry & Audit Events
      if (data.recognized_count !== undefined) {
        setRecognizedCount(data.recognized_count);
      }
      if (data.unrecognized_count !== undefined) {
        setUnrecognizedCount(data.unrecognized_count);
      }
      if (data.recognized_students) {
        setRecognizedStudents(data.recognized_students);
      }
      if (data.gallery_count !== undefined) {
        setGalleryCount(data.gallery_count);
        if (data.gallery_count === 0 && !simpleMonitoringMode && now - lastAutoSyncTimeRef.current > 20000) {
          lastAutoSyncTimeRef.current = now;
          studentAPI.syncGallery()
            .then((res) => {
              if (res.syncedCount !== undefined && isMounted) {
                setGalleryCount(res.syncedCount);
              }
            })
            .catch(() => {});
        }
      }

      // Periodically log tracking event into MongoDB
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
    };

    const runInferenceCycle = async () => {
      if (!isMounted) return;

      const now = Date.now();
      // Graceful backoff if AI service failed
      if (aiServiceStatus === 'offline' && now - lastAiFailureRef.current < 2500) {
        if (isMounted) timerId = setTimeout(runInferenceCycle, 600);
        return;
      }

      // Bounded Latest-Frame Queue: Drop if busy
      if (isDetectingRef.current) {
        if (isMounted) timerId = setTimeout(runInferenceCycle, 16);
        return;
      }

      // ── Path A: CCTV Ingestion Stream ──
      if (isCctv) {
        const img = cctvImageRef.current;
        if (!img) {
          if (isMounted) timerId = setTimeout(runInferenceCycle, 50);
          return;
        }

        isDetectingRef.current = true;
        const cycleStart = performance.now();

        try {
          const data = await aiAPI.detectCctvFrame(
            selectedSessionId,
            confThreshold,
            tripwireY,
            enableTracking
          );
          if (!isMounted) return;
          setAiServiceStatus('online');

          if (data && data.success) {
            const cycleEnd = performance.now();
            const totalMs = Math.round(cycleEnd - cycleStart);
            aiCycleCount++;
            const aiElapsed = cycleEnd - lastAiCycleTime;
            let currentAiFps = telemetry.aiFps;
            if (aiElapsed >= 1000) {
              currentAiFps = Math.round((aiCycleCount * 1000) / aiElapsed);
              aiCycleCount = 0;
              lastAiCycleTime = cycleEnd;
            }

            const tel = data.telemetry || {};
            setTelemetry((prev) => ({
              ...prev,
              transportLatencyMs: data.frame_age_ms || prev.transportLatencyMs,
              detectionLatencyMs: tel.detection_time_ms || 0,
              recognitionLatencyMs: tel.recognition_time_ms || 0,
              totalProcessingMs: totalMs,
              aiFps: currentAiFps || Math.round(1000 / Math.max(1, totalMs)),
              device: tel.device || prev.device,
              modelName: tel.model_name || prev.modelName,
              facesAnalyzed: tel.faces_analyzed || 0,
            }));

            handleDetectionResults(data, now);
          }
        } catch (err) {
          lastAiFailureRef.current = Date.now();
          console.warn('CCTV inference cycle error:', err.message);
          if (isMounted) setAiServiceStatus('offline');
        } finally {
          isDetectingRef.current = false;
          if (isMounted) {
            timerId = setTimeout(runInferenceCycle, 16);
          }
        }
        return;
      }

      // ── Path B: Smartphone WebRTC Video Stream ──
      const video = remoteVideoRef.current;
      if (!video || video.readyState < 2) {
        if (isMounted) timerId = setTimeout(runInferenceCycle, 50);
        return;
      }

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) {
        if (isMounted) timerId = setTimeout(runInferenceCycle, 50);
        return;
      }

      isDetectingRef.current = true;
      const cycleStart = performance.now();

      try {
        const maxDim = 640;
        let targetW, targetH;
        if (vw >= vh) {
          targetW = maxDim;
          targetH = Math.max(32, Math.round((vh / vw) * maxDim));
        } else {
          targetH = maxDim;
          targetW = Math.max(32, Math.round((vw / vh) * maxDim));
        }
        if (offscreenCanvas.width !== targetW || offscreenCanvas.height !== targetH) {
          offscreenCanvas.width = targetW;
          offscreenCanvas.height = targetH;
        }
        offscreenCtx.drawImage(video, 0, 0, targetW, targetH);
        const base64Data = offscreenCanvas.toDataURL('image/jpeg', 0.65);

        const data = await aiAPI.detectFrame(
          base64Data,
          confThreshold,
          selectedSessionId || 'default',
          tripwireY,
          enableTracking
        );
        if (!isMounted) return;
        setAiServiceStatus('online');

        if (data && data.success) {
          const cycleEnd = performance.now();
          const totalMs = Math.round(cycleEnd - cycleStart);
          aiCycleCount++;
          const aiElapsed = cycleEnd - lastAiCycleTime;
          let currentAiFps = telemetry.aiFps;
          if (aiElapsed >= 1000) {
            currentAiFps = Math.round((aiCycleCount * 1000) / aiElapsed);
            aiCycleCount = 0;
            lastAiCycleTime = cycleEnd;
          }

          const tel = data.telemetry || {};
          setTelemetry((prev) => ({
            ...prev,
            detectionLatencyMs: tel.detection_time_ms || 0,
            recognitionLatencyMs: tel.recognition_time_ms || 0,
            totalProcessingMs: totalMs,
            aiFps: currentAiFps || Math.round(1000 / Math.max(1, totalMs)),
            device: tel.device || prev.device,
            modelName: tel.model_name || prev.modelName,
            facesAnalyzed: tel.faces_analyzed || 0,
          }));

          handleDetectionResults(data, now);
        }
      } catch (err) {
        lastAiFailureRef.current = Date.now();
        console.warn('ByteTrack inference error:', err.message);
        if (isMounted) setAiServiceStatus('offline');
      } finally {
        isDetectingRef.current = false;
        // Bounded latest-frame queue: immediately process next fresh frame without artificial delay
        if (isMounted) {
          timerId = setTimeout(runInferenceCycle, 16);
        }
      }
    };

    timerId = setTimeout(runInferenceCycle, 30);

    return () => {
      isMounted = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [connectionStatus, aiEnabled, enableTracking, confThreshold, tripwireY, selectedSessionId, isCctv, aiServiceStatus, simpleMonitoringMode]);

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

  // Calculate the reachable smartphone camera URL
  const host =
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && lanIp
      ? lanIp
      : window.location.hostname;
  const port = window.location.port ? `:${window.location.port}` : '';
  const mobileStreamUrl = selectedSessionId
    ? `${window.location.protocol}//${host}${port}/camera/${selectedSessionId}`
    : '';

  const handleCopyMobileUrl = () => {
    if (!mobileStreamUrl) return;
    navigator.clipboard.writeText(mobileStreamUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleOpenMobileView = () => {
    if (!selectedSessionId) return;
    window.open(`/camera/${selectedSessionId}`, '_blank');
  };

  const handleReconnect = () => {
    cleanupPeerConnection();
    setErrorMessage('');
    setConnectionStatus('connecting');
    const socket = getSocket();
    if (socket && selectedSessionId) {
      socket.emit('join-session', {
        sessionId: selectedSessionId,
        role: 'viewer',
      });
    }
  };

  const handleCameraSelectChange = (val) => {
    if (val === '__local_webcam__') {
      if (selectedSessionId) setSelectedSessionId('');
      startLocalWebcam();
    } else {
      if (isLocalWebcam) stopLocalWebcam();
      setSelectedSessionId(val);
    }
  };

  return (
    <div className="monitoring-page">
      {/* 1. Page Header */}
      <div className="monitoring-page-header">
        <div>
          <h1 className="monitoring-page-title">Live Classroom Monitor</h1>
          <p className="monitoring-page-subtitle">
            Live video, human detection, and student face recognition
          </p>
        </div>
      </div>

      {/* 2. Section 1: Compact Camera Selection & Real Connection Status Bar */}
      <div className="camera-control-bar glass-card">
        <div className="camera-control-left">
          <label htmlFor="camera-select" className="camera-select-label">
            <HiOutlineVideoCamera size={18} />
            <span>Camera Source:</span>
          </label>
          <div className="camera-select-container">
            <select
              id="camera-select"
              className="camera-dropdown-select"
              value={isLocalWebcam ? '__local_webcam__' : (selectedSessionId || '')}
              onChange={(e) => handleCameraSelectChange(e.target.value)}
            >
              <option value="__local_webcam__">💻 This Device Webcam (Local)</option>
              {cameras.filter((c) => c.type === 'phone').length > 0 && (
                <optgroup label="📱 Smartphone Cameras">
                  {cameras.filter((c) => c.type === 'phone').map((c) => (
                    <option key={c.sessionId} value={c.sessionId}>
                      📱 {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {cameras.filter((c) => c.type === 'cctv').length > 0 && (
                <optgroup label="📹 CCTV / IP Cameras">
                  {cameras.filter((c) => c.type === 'cctv').map((c) => (
                    <option key={c.sessionId} value={c.sessionId}>
                      📹 {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Real Connection Status Pill */}
          <div className={`connection-status-pill status-${connectionStatus}`}>
            <span className="status-dot" />
            <span className="status-label">
              {connectionStatus === 'connected'
                ? 'Connected'
                : connectionStatus === 'connecting'
                ? 'Connecting…'
                : connectionStatus === 'paused'
                ? 'Paused'
                : 'Offline'}
            </span>
          </div>
        </div>

        {/* Right side: Only context-appropriate connection action */}
        <div className="camera-control-right">
          {/* For Local Webcam */}
          {isLocalWebcam && (
            connectionStatus === 'connected' ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={stopLocalWebcam}
                title="Stop local device webcam"
              >
                <HiOutlineStop size={15} /> Stop Webcam
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={startLocalWebcam}
                title="Start local device webcam"
              >
                <HiOutlinePlay size={15} /> Start Webcam
              </button>
            )
          )}

          {/* For Phone Camera */}
          {!isLocalWebcam && !isCctv && (
            <div className="phone-actions-wrapper">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleOpenMobileView}
                disabled={!selectedSessionId}
                title="Open smartphone camera broadcaster page in new tab"
              >
                <HiOutlineExternalLink size={15} /> Open Phone Camera
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleCopyMobileUrl}
                disabled={!selectedSessionId}
                title="Copy camera stream link for smartphone"
              >
                <HiOutlineClipboardCopy size={15} /> {copied ? 'Link Copied!' : 'Copy Link'}
              </button>
              {connectionStatus !== 'connected' && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleReconnect}
                  disabled={!selectedSessionId}
                  title="Reconnect WebRTC stream"
                >
                  <HiOutlineRefresh size={15} /> Reconnect
                </button>
              )}
            </div>
          )}

          {/* For CCTV */}
          {!isLocalWebcam && isCctv && (
            <button
              type="button"
              className={`btn ${connectionStatus === 'connected' ? 'btn-danger' : 'btn-primary'} btn-sm`}
              onClick={handleToggleCctvStream}
              disabled={!selectedSessionId}
            >
              {connectionStatus === 'connected' ? (
                <>
                  <HiOutlineStop size={15} /> Stop CCTV Stream
                </>
              ) : (
                <>
                  <HiOutlinePlay size={15} /> Start CCTV Stream
                </>
              )}
            </button>
          )}

          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon-only"
            onClick={loadCameras}
            title="Refresh camera list"
          >
            <HiOutlineRefresh size={15} />
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="dashboard-error animate-fade-in" style={{ marginTop: '0.75rem' }}>
          <HiOutlineExclamationCircle size={18} /> {errorMessage}
        </div>
      )}

      {/* Main Grid: Section 2 (Large Video Feed) & Section 3 (Live Detection Results) */}
      <div className="monitoring-main-layout">
        {/* Left Column: Section 2 (Large Live Video Feed) */}
        <div className="video-feed-section glass-card">
          <div id="monitoring-player-container" className="monitoring-viewport-container">
            {isCctv ? (
              <img
                ref={cctvImageRef}
                className={`remote-video-feed ${connectionStatus === 'connected' ? 'active' : 'hidden'}`}
                src={cameraAPI.getCctvStreamUrl(selectedSessionId)}
                alt="CCTV RTSP Stream"
                onLoad={() => {
                  if (connectionStatus !== 'connected') setConnectionStatus('connected');
                }}
                onError={() => {
                  if (connectionStatus === 'connected') setConnectionStatus('disconnected');
                }}
              />
            ) : (
              <video
                ref={remoteVideoRef}
                className={`remote-video-feed ${connectionStatus === 'connected' ? 'active' : 'hidden'}`}
                autoPlay
                playsInline
                muted={isMuted}
                onLoadedMetadata={handleLoadedMetadata}
              />
            )}

            {/* Canvas overlay for bounding boxes & labels */}
            <canvas ref={canvasRef} className="detection-canvas-overlay" />

            {/* Viewport Placeholder when Stream is Inactive */}
            {connectionStatus !== 'connected' && (
              <div className="viewport-placeholder">
                <div className="placeholder-content">
                  <div className="placeholder-icon-ring">
                    <HiOutlineVideoCamera size={44} />
                  </div>

                  <h3 className="placeholder-title">
                    {connectionStatus === 'connecting'
                      ? (isLocalWebcam ? 'Starting Local Webcam…' : isCctv ? 'Connecting to CCTV Stream…' : 'Connecting to Camera…')
                      : connectionStatus === 'paused'
                      ? 'Camera Paused'
                      : `${isLocalWebcam ? 'Local Webcam' : (currentCamera?.name || 'Camera')} Offline`}
                  </h3>

                  <p className="placeholder-desc">
                    {isLocalWebcam ? (
                      'Click "Start Webcam" below to capture live video from this device.'
                    ) : isCctv ? (
                      `CCTV camera (${currentCamera?.sanitizedUrl || 'RTSP Stream'}) is offline. Click "Start CCTV Stream" to begin ingestion.`
                    ) : isBroadcasterOnline ? (
                      'The smartphone is online and connected. Tap "Start Camera" on the phone to broadcast video.'
                    ) : (
                      'Open the camera link on your smartphone or scan the QR code to begin streaming live classroom video.'
                    )}
                  </p>

                  <div className="placeholder-action-wrap">
                    {isLocalWebcam ? (
                      <button className="btn btn-primary" onClick={startLocalWebcam}>
                        <HiOutlinePlay size={16} /> Start Webcam
                      </button>
                    ) : isCctv ? (
                      <button className="btn btn-primary" onClick={handleToggleCctvStream}>
                        <HiOutlinePlay size={16} /> Start CCTV Stream
                      </button>
                    ) : (
                      <div className="placeholder-phone-box">
                        <div className="placeholder-phone-actions">
                          <button className="btn btn-primary" onClick={handleOpenMobileView}>
                            <HiOutlineExternalLink size={16} /> Open Phone Camera
                          </button>
                          <button className="btn btn-secondary" onClick={handleCopyMobileUrl}>
                            <HiOutlineClipboardCopy size={16} /> {copied ? 'Link Copied!' : 'Copy Camera Link'}
                          </button>
                        </div>
                        {mobileStreamUrl && (
                          <div className="placeholder-qr-preview">
                            <div className="qr-wrapper">
                              <QRCodeSVG
                                value={mobileStreamUrl}
                                size={96}
                                bgColor="#0f172a"
                                fgColor="#38bdf8"
                                level="M"
                              />
                            </div>
                            <span className="qr-caption">Scan with smartphone camera</span>
                            {typeof window !== 'undefined' && window.location && window.location.protocol !== 'https:' && (
                              <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px', textAlign: 'center', display: 'block', maxWidth: '240px' }}>
                                Note: Mobile cameras require HTTPS. For remote scanning, open via your HTTPS tunnel (e.g. ngrok).
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Viewport HUD Overlays (when connected) */}
            {connectionStatus === 'connected' && (
              <div className="viewport-hud">
                <div className="hud-badge live">
                  <span className="live-dot" /> {isLocalWebcam ? 'WEBCAM LIVE' : isCctv ? 'CCTV LIVE' : 'PHONE LIVE'}
                </div>
                {aiEnabled && (
                  <div className="hud-badge ai-badge">
                    <HiOutlineUsers size={14} />
                    <strong>{peopleCount}</strong> {peopleCount === 1 ? 'PERSON' : 'PEOPLE'} DETECTED
                  </div>
                )}
                {aiEnabled && (
                  <div className="hud-badge recognized-hud-badge">
                    <HiOutlineIdentification size={14} />
                    <strong>{recognizedCount}</strong> IDENTIFIED
                  </div>
                )}
                {aiEnabled && unrecognizedCount > 0 && (
                  <div className="hud-badge unrecognized-hud-badge">
                    <span>{unrecognizedCount} UNKNOWN</span>
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
                  {aiEnabled ? <HiOutlineEye size={18} /> : <HiOutlineEyeOff size={18} />}
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

          {/* Compact Stream Diagnostics Strip */}
          <div className="stream-diagnostics-strip">
            <span>Source: <strong>{isLocalWebcam ? 'Device Webcam' : isCctv ? 'CCTV (RTSP)' : 'Smartphone (WebRTC)'}</strong></span>
            <span>Gallery: <strong>{galleryCount !== null ? `${galleryCount} students enrolled` : 'Checking…'}</strong></span>
            <span>
              AI Engine: <strong className={aiServiceStatus === 'online' ? 'text-success' : 'text-danger'}>{aiServiceStatus.toUpperCase()}</strong>
              {aiServiceStatus === 'offline' && (
                <button
                  type="button"
                  className="btn-retry-ai"
                  onClick={handleRetryAiService}
                >
                  Retry AI
                </button>
              )}
            </span>
          </div>
        </div>

        {/* Right Column: Section 3 (Live Detection Results) */}
        <div className="detection-results-section">
          {/* Real-Time Performance & Telemetry HUD */}
          <div className="glass-card telemetry-hud-card">
            <div className="telemetry-header">
              <h3 className="section-card-title">
                <HiOutlineLightningBolt size={16} />
                <span>Performance & Latency HUD</span>
              </h3>
              <div className="telemetry-badges">
                <span className={`telemetry-chip chip-${telemetry.device}`}>
                  {telemetry.device === 'mps' ? 'Apple M2 (MPS)' : telemetry.device.toUpperCase()}
                </span>
                <span className="telemetry-chip chip-model">
                  {telemetry.modelName}
                </span>
              </div>
            </div>

            <div className="telemetry-grid">
              <div className="telemetry-item">
                <span className="telemetry-label">Transport Latency</span>
                <span className="telemetry-value text-cyan">
                  {telemetry.transportLatencyMs > 0 ? `${telemetry.transportLatencyMs} ms` : '< 15 ms'}
                </span>
                <span className="telemetry-subtext">{isCctv ? 'RTSP Stream Age' : 'WebRTC RTT+Jitter'}</span>
              </div>

              <div className="telemetry-item">
                <span className="telemetry-label">Rendering FPS</span>
                <span className="telemetry-value text-emerald">
                  {telemetry.renderingFps > 0 ? `${telemetry.renderingFps}` : '30'} FPS
                </span>
                <span className="telemetry-subtext">Independent 60Hz</span>
              </div>

              <div className="telemetry-item">
                <span className="telemetry-label">AI Throughput</span>
                <span className="telemetry-value text-info">
                  {telemetry.aiFps > 0 ? `${telemetry.aiFps}` : '24'} FPS
                </span>
                <span className="telemetry-subtext">Bounded Queue</span>
              </div>

              <div className="telemetry-item">
                <span className="telemetry-label">YOLO Detection</span>
                <span className="telemetry-value text-emerald">
                  {telemetry.detectionLatencyMs > 0 ? `${telemetry.detectionLatencyMs} ms` : '—'}
                </span>
                <span className="telemetry-subtext">Hardware Accel</span>
              </div>

              <div className="telemetry-item">
                <span className="telemetry-label">Face Recognition</span>
                <span className="telemetry-value text-purple">
                  {telemetry.recognitionLatencyMs > 0 ? `${telemetry.recognitionLatencyMs} ms` : '0 ms'}
                </span>
                <span className="telemetry-subtext">YuNet + SFace</span>
              </div>

              <div className="telemetry-item">
                <span className="telemetry-label">Total Processing</span>
                <span className="telemetry-value text-cyan">
                  {telemetry.totalProcessingMs > 0 ? `${telemetry.totalProcessingMs} ms` : '—'}
                </span>
                <span className="telemetry-subtext">End-to-End</span>
              </div>
            </div>
          </div>

          {/* Essential Live Metrics Summary */}
          <div className="glass-card live-metrics-summary-card">
            <h3 className="section-card-title">Live Detection Metrics</h3>
            <div className="essential-metrics-row">
              <div className="essential-metric-box">
                <span className="essential-metric-label">People Detected</span>
                <span className="essential-metric-value text-info">{peopleCount}</span>
              </div>
              <div className="essential-metric-box">
                <span className="essential-metric-label">Identified</span>
                <span className="essential-metric-value text-success">{recognizedCount}</span>
              </div>
              <div className="essential-metric-box">
                <span className="essential-metric-label">Unknown</span>
                <span className="essential-metric-value text-warning">{unrecognizedCount}</span>
              </div>
            </div>
          </div>

          {/* Identified Students Panel */}
          <div className="glass-card identified-students-card">
            <div className="identified-students-header">
              <h3 className="section-card-title">
                <HiOutlineBadgeCheck size={18} />
                <span>Identified Students ({recognizedStudents.length})</span>
              </h3>
              <span className={`live-tag ${connectionStatus === 'connected' ? 'active' : ''}`}>
                <span className="live-dot" /> LIVE
              </span>
            </div>

            {recognizedStudents.length === 0 ? (
              <div className="empty-students-state">
                <div className="empty-students-icon">
                  <HiOutlineUsers size={28} />
                </div>
                <p className="empty-students-title">No students currently identified in camera view.</p>
                <span className="empty-students-subtitle">
                  Enrolled students will appear here in real time when their faces are detected and recognized.
                </span>
              </div>
            ) : (
              <div className="identified-students-list">
                {recognizedStudents.map((st, idx) => (
                  <div key={st.student_id || idx} className="student-result-item">
                    <div className="student-avatar-circle">
                      {st.full_name ? st.full_name.charAt(0) : 'S'}
                    </div>
                    <div className="student-details">
                      <span className="student-name">{st.full_name}</span>
                      <div className="student-sub-row">
                        <span className="student-roll">{st.roll_number}</span>
                        {st.tracking_id && (
                          <span className="student-track-tag">Track #{st.tracking_id}</span>
                        )}
                      </div>
                    </div>
                    {st.similarity && (
                      <span className="student-match-badge">
                        {Math.round(st.similarity * 100)}% match
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Collapsible Advanced Tracking & Settings Section */}
          <div className="glass-card advanced-tracking-accordion">
            <button
              type="button"
              className="advanced-tracking-toggle-btn"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <div className="toggle-btn-left">
                <HiOutlineAdjustments size={16} />
                <span>Advanced Tracking & Settings</span>
              </div>
              {showAdvanced ? <HiOutlineChevronUp size={16} /> : <HiOutlineChevronDown size={16} />}
            </button>

            {showAdvanced && (
              <div className="advanced-tracking-body animate-fade-in">
                {/* Overlay Checkboxes */}
                <div className="advanced-field-group">
                  <span className="advanced-field-label">Overlay Controls:</span>
                  <div className="advanced-checkbox-grid">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={showBoxes}
                        onChange={(e) => setShowBoxes(e.target.checked)}
                      />
                      Bounding Boxes
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={showTrails}
                        onChange={(e) => setShowTrails(e.target.checked)}
                      />
                      Trajectory Trails
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={showTripwire}
                        onChange={(e) => setShowTripwire(e.target.checked)}
                      />
                      Virtual Tripwire
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={showRecognitionNames}
                        onChange={(e) => setShowRecognitionNames(e.target.checked)}
                      />
                      Name Badges
                    </label>
                  </div>
                </div>

                {/* Secondary Tracking Counts */}
                <div className="advanced-counts-grid">
                  <div className="adv-count-box">
                    <span>Unique IDs</span>
                    <strong>{uniqueIdsCount}</strong>
                  </div>
                  <div className="adv-count-box">
                    <span>Crossed In</span>
                    <strong>{tripwireEntered}</strong>
                  </div>
                  <div className="adv-count-box">
                    <span>Crossed Out</span>
                    <strong>{tripwireExited}</strong>
                  </div>
                </div>

                {/* Model & Hardware Acceleration Selector */}
                <div className="advanced-field-group">
                  <span className="advanced-field-label">AI Model & Acceleration:</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                    <div>
                      <span style={{ fontSize: '10px', color: '#94a3b8' }}>Detection Model:</span>
                      <select
                        className="advanced-select"
                        value={aiConfig.model_name}
                        onChange={(e) => handleModelChange(e.target.value)}
                      >
                        <option value="yolov8n.pt">YOLOv8n (Fast)</option>
                        <option value="yolo11n.pt">YOLO11n (High Recall)</option>
                      </select>
                    </div>
                    <div>
                      <span style={{ fontSize: '10px', color: '#94a3b8' }}>Hardware Device:</span>
                      <select
                        className="advanced-select"
                        value={aiConfig.device}
                        onChange={(e) => handleDeviceChange(e.target.value)}
                      >
                        <option value="mps">Apple MPS (GPU)</option>
                        <option value="coreml">Core ML (ANE)</option>
                        <option value="cpu">CPU Fallback</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Face Recognition Rate Limiting Controls */}
                <div className="advanced-field-group">
                  <span className="advanced-field-label">Face Recognition Optimization:</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                    <div className="slider-label-row">
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>Re-verify Interval:</span>
                      <span className="slider-value">{aiConfig.face_rec_interval_frames} frames</span>
                    </div>
                    <input
                      type="range"
                      min="15"
                      max="60"
                      step="5"
                      value={aiConfig.face_rec_interval_frames}
                      onChange={(e) => handleFaceRecIntervalChange(parseInt(e.target.value, 10))}
                      className="ai-slider"
                    />

                    <div className="slider-label-row">
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>Max Faces / Frame:</span>
                      <span className="slider-value">{aiConfig.max_faces_per_frame} faces</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="5"
                      step="1"
                      value={aiConfig.max_faces_per_frame}
                      onChange={(e) => handleMaxFacesChange(parseInt(e.target.value, 10))}
                      className="ai-slider"
                    />
                  </div>
                </div>

                {/* Tripwire Slider */}
                <div className="advanced-slider-group">
                  <div className="slider-label-row">
                    <span>Tripwire Line:</span>
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

                {/* Custom Session ID Option */}
                <div className="advanced-custom-session">
                  <label htmlFor="custom-session-input" className="custom-session-label">
                    Connect Custom Session ID:
                  </label>
                  <div className="custom-session-input-row">
                    <input
                      id="custom-session-input"
                      type="text"
                      className="form-input form-input-sm"
                      placeholder="e.g. room_101"
                      value={customSessionId}
                      onChange={(e) => setCustomSessionId(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={!customSessionId.trim()}
                      onClick={() => {
                        if (isLocalWebcam) stopLocalWebcam();
                        setSelectedSessionId(customSessionId.trim());
                        setCustomSessionId('');
                      }}
                    >
                      Connect
                    </button>
                  </div>
                </div>

                {/* Reset Tracking Session Button */}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm btn-block"
                  style={{ marginTop: '0.75rem' }}
                  onClick={handleResetTracking}
                  title="Reset tracking IDs, trajectories, and tripwire counts"
                >
                  <HiOutlineRefresh size={14} /> Reset Session Tracking
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
