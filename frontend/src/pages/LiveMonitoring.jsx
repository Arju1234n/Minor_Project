import { HiOutlineEye, HiOutlineVideoCamera } from 'react-icons/hi';
import './LiveMonitoring.css';

export default function LiveMonitoring() {
  return (
    <div className="monitoring-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Live Monitoring</h1>
          <p className="page-subtitle">
            View live camera feeds with real-time human detection overlays
          </p>
        </div>
      </div>

      <div className="glass-card monitoring-placeholder animate-fade-in">
        <div className="empty-state">
          <div className="monitoring-placeholder__icon">
            <HiOutlineEye size={48} />
          </div>
          <h2>Live Monitoring</h2>
          <p>
            This page will display the live WebRTC video stream from connected
            cameras with YOLO detection bounding boxes and ByteTrack tracking IDs.
          </p>
          <div className="monitoring-features">
            <div className="monitoring-feature">
              <HiOutlineVideoCamera size={20} />
              <span>WebRTC live stream viewer</span>
            </div>
            <div className="monitoring-feature">
              <HiOutlineEye size={20} />
              <span>YOLO detection overlay with bounding boxes</span>
            </div>
            <div className="monitoring-feature">
              <HiOutlineEye size={20} />
              <span>ByteTrack multi-person tracking IDs</span>
            </div>
          </div>
          <span className="text-muted">
            Coming in Phase 3-6 — WebRTC streaming, AI detection, and tracking integration
          </span>
        </div>
      </div>
    </div>
  );
}
