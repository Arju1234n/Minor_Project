import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import './MobileCamera.css';

/**
 * Mobile Camera Page — Phase 2:
 * - Direct navigator.mediaDevices.getUserMedia integration
 * - Front (user) and Rear (environment) camera switching
 * - Device selection & capabilities discovery
 * - Touch-optimized live local video preview with iOS/Android compatibility
 * - Torch / Flashlight control (where hardware supported)
 * - Session binding & diagnostic badges
 */
export default function MobileCamera() {
  const { sessionId: paramSessionId } = useParams();
  const navigate = useNavigate();

  // Session state
  const [sessionId, setSessionId] = useState(
    paramSessionId || 'room_' + Math.random().toString(36).substring(2, 8)
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

  // Check secure context on mount (getUserMedia requires HTTPS or localhost)
  useEffect(() => {
    if (window.isSecureContext === false && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setIsSecureContext(false);
    }
  }, []);

  // Update session ID if URL parameter changes
  useEffect(() => {
    if (paramSessionId) {
      setSessionId(paramSessionId);
    }
  }, [paramSessionId]);

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

  // Enumerate devices once on mount
  useEffect(() => {
    enumerateVideoDevices();
  }, [enumerateVideoDevices]);

  // Clean up media tracks when component unmounts
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

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
   * Start local camera stream
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
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('MediaDevices API not supported in this browser. Please ensure you are on HTTPS or localhost.');
      }

      let newStream;
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
      } catch (constraintErr) {
        // Fallback to basic constraints if ideal constraints fail (e.g. older smartphone)
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
    } catch (err) {
      console.error('Camera access error:', err);
      let userFriendlyMsg = 'Could not access camera.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        userFriendlyMsg = 'Camera permission was denied. Please allow camera access in your browser site settings.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        userFriendlyMsg = 'No camera device detected on this smartphone or computer.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        userFriendlyMsg = 'Camera is already in use by another application or browser tab.';
      } else if (err.name === 'OverconstrainedError') {
        userFriendlyMsg = 'Requested camera resolution is not supported by your camera hardware.';
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
   * Stop local camera stream
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
  };

  /**
   * Toggle between front and rear cameras
   */
  const handleToggleFacingMode = async () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    setSelectedDeviceId(''); // clear exact device id to allow facingMode switch
    if (isStreaming) {
      await startCamera(nextMode, '');
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
              <strong>Insecure Context Detected:</strong> Camera access requires HTTPS when accessed remotely over the network. If connecting from a smartphone, ensure you are using an HTTPS reverse proxy (e.g., ngrok/Cloudflare tunnel) or testing via localhost.
            </div>
          </div>
        )}

        {/* Error Notification */}
        {errorMessage && (
          <div className="mobile-camera-alert error animate-slide-up">
            <HiOutlineExclamationCircle size={20} />
            <div>
              <strong>Camera Error:</strong> {errorMessage}
            </div>
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
              <p>Tap "Start Camera" below to grant browser permission and start the local video preview.</p>
              <div className="feature-tags">
                <span>✓ Front / Rear Switch</span>
                <span>✓ HD Resolution</span>
                <span>✓ WebRTC Ready</span>
              </div>
            </div>
          )}

          {/* Viewport Floating HUD Overlays (when streaming) */}
          {isStreaming && (
            <div className="mobile-camera-hud">
              <div className="hud-top">
                <span className="hud-badge live">
                  <span className="live-dot" /> LIVE PREVIEW
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
          {/* Hardware Device Picker (if multiple cameras available) */}
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
                    <span className="spinner-sm" /> Requesting Camera…
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

        {/* Connection & Phase Status Card */}
        <div className="mobile-camera-status-card">
          <div className="status-item">
            <span className="status-label">Local Camera:</span>
            <span className={`status-val ${isStreaming ? 'text-success' : 'text-muted'}`}>
              <span className={`pulse-dot ${isStreaming ? 'online' : 'offline'}`} />
              {isStreaming ? 'Active Preview' : 'Idle / Stopped'}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">WebRTC Peer:</span>
            <span className="status-val text-warning">
              <span className="pulse-dot idle" />
              Ready for Phase 3
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">Facing Mode:</span>
            <span className="status-val text-info">
              {facingMode === 'environment' ? 'Rear Camera (Back)' : 'Front Camera (Selfie)'}
            </span>
          </div>
        </div>

        {/* Instructions */}
        <div className="mobile-camera-guide">
          <h3>📱 Smartphone Tips:</h3>
          <ul>
            <li>Position your phone horizontally or vertically facing the classroom or room entry point.</li>
            <li>In Phase 3, opening this session on the admin dashboard will automatically link the live WebRTC stream.</li>
            <li>Keep the screen active and browser open while streaming.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
