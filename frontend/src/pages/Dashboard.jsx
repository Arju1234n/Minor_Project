import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { dashboardAPI, cameraAPI } from '../services/api';
import { getSocket } from '../services/webrtc';
import {
  HiOutlineVideoCamera,
  HiOutlineStatusOnline,
  HiOutlineUserGroup,
  HiOutlineLightningBolt,
  HiOutlineRefresh,
  HiOutlineEye,
  HiOutlineExternalLink,
  HiOutlineBadgeCheck,
  HiOutlineTrendingUp,
} from 'react-icons/hi';
import './Dashboard.css';

/**
 * Admin Dashboard — Phase 7:
 * - Real-time statistics streaming via Socket.IO (no page refresh required)
 * - Live camera state & quick streaming links
 * - Today's peak & average occupancy KPI metrics
 * - Real-time animated event activity ticker
 * - Hourly occupancy trend visualizer
 */
export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [liveEventsFeed, setLiveEventsFeed] = useState([]);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  // Fetch initial aggregated dashboard data
  const fetchData = useCallback(async () => {
    try {
      setError('');
      const [statsRes, camRes] = await Promise.all([
        dashboardAPI.getStats(),
        cameraAPI.list(),
      ]);
      setStats(statsRes.stats);
      setCameras(camRes.sessions || []);
      if (statsRes.stats?.recentEvents) {
        setLiveEventsFeed(statsRes.stats.recentEvents.slice(0, 15));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ──────────────────────────────────────────
  // Phase 7: Real-Time Socket.IO Streaming Updates
  // ──────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();

    const handleConnect = () => setRealtimeConnected(true);
    const handleDisconnect = () => setRealtimeConnected(false);

    if (socket.connected) setRealtimeConnected(true);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    // Live detection update from any active camera session
    const handleStatsUpdate = (data) => {
      // Prepend to live activity feed
      setLiveEventsFeed((prev) => [
        {
          sessionId: data.sessionId,
          peopleCount: data.peopleCount,
          timestamp: data.timestamp || new Date().toISOString(),
        },
        ...prev.slice(0, 24),
      ]);

      // Update counters in real time
      setStats((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          eventsToday: (prev.eventsToday || 0) + 1,
          peakOccupancyToday: Math.max(prev.peakOccupancyToday || 0, data.peopleCount || 0),
        };
      });
    };

    // Live camera status changes
    const handleBroadcasterConnected = ({ sessionId }) => {
      setCameras((prev) =>
        prev.map((c) => (c.sessionId === sessionId ? { ...c, status: 'online' } : c))
      );
    };

    const handleBroadcasterDisconnected = ({ sessionId }) => {
      setCameras((prev) =>
        prev.map((c) => (c.sessionId === sessionId ? { ...c, status: 'offline' } : c))
      );
    };

    const handleStreamStatus = ({ sessionId, isStreaming }) => {
      setCameras((prev) =>
        prev.map((c) =>
          c.sessionId === sessionId
            ? { ...c, status: isStreaming ? 'streaming' : 'online' }
            : c
        )
      );
    };

    socket.on('dashboard-stats-update', handleStatsUpdate);
    socket.on('broadcaster-connected', handleBroadcasterConnected);
    socket.on('broadcaster-disconnected', handleBroadcasterDisconnected);
    socket.on('broadcaster-stream-status', handleStreamStatus);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('dashboard-stats-update', handleStatsUpdate);
      socket.off('broadcaster-connected', handleBroadcasterConnected);
      socket.off('broadcaster-disconnected', handleBroadcasterDisconnected);
      socket.off('broadcaster-stream-status', handleStreamStatus);
    };
  }, []);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    );
  }

  const statCards = [
    {
      icon: HiOutlineVideoCamera,
      label: 'Active Cameras',
      value: `${stats?.onlineCameras ?? 0} / ${stats?.totalCameras ?? 0}`,
      subtext: `${stats?.onlineCameras ?? 0} online now`,
      color: 'var(--accent-primary)',
    },
    {
      icon: HiOutlineUserGroup,
      label: 'Peak Occupancy Today',
      value: `${stats?.peakOccupancyToday ?? 0} People`,
      subtext: `Avg: ${stats?.avgOccupancyToday ?? 0} people/event`,
      color: 'var(--accent-emerald)',
    },
    {
      icon: HiOutlineBadgeCheck,
      label: 'Unique IDs Tracked',
      value: `${stats?.uniqueIdsToday ?? 0}`,
      subtext: 'ByteTrack persistent IDs',
      color: 'var(--accent-secondary)',
    },
    {
      icon: HiOutlineLightningBolt,
      label: 'Detection Events Today',
      value: `${stats?.eventsToday ?? 0}`,
      subtext: 'Real-time AI processed',
      color: 'var(--accent-warning)',
    },
  ];

  return (
    <div className="dashboard-page">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Executive AI Dashboard</h1>
          <p className="page-subtitle">
            Real-time human detection, spatial tracking, and classroom occupancy analytics
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span className={`badge ${realtimeConnected ? 'badge-online' : 'badge-offline'}`}>
            <span className={`pulse-dot ${realtimeConnected ? 'online' : 'offline'}`} />
            {realtimeConnected ? 'SOCKET.IO LIVE' : 'DISCONNECTED'}
          </span>
          <button className="btn btn-ghost" onClick={fetchData}>
            <HiOutlineRefresh size={16} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="dashboard-error animate-fade-in">⚠ {error}</div>}

      {/* KPI Stats Grid */}
      <div className="stat-grid stagger">
        {statCards.map((card, i) => (
          <div key={i} className="glass-card stat-card animate-fade-in">
            <div className="stat-card__header">
              <div
                className="stat-card__icon"
                style={{ background: `${card.color}20`, color: card.color }}
              >
                <card.icon size={22} />
              </div>
            </div>
            <div className="stat-value">{card.value}</div>
            <div className="stat-label">{card.label}</div>
            {card.subtext && <div className="stat-subtext">{card.subtext}</div>}
          </div>
        ))}
      </div>

      {/* Hourly Occupancy Trend Visualizer */}
      {stats?.hourlyTrend && stats.hourlyTrend.length > 0 && (
        <div className="glass-card animate-fade-in trend-card">
          <div className="trend-card__header">
            <h2 className="section-title">
              <HiOutlineTrendingUp size={20} /> Today's Hourly Occupancy Trend
            </h2>
            <span className="text-muted text-xs">Peak people count per hour</span>
          </div>
          <div className="hourly-bars-container">
            {stats.hourlyTrend.map((h, i) => {
              const maxVal = Math.max(...stats.hourlyTrend.map((t) => t.peak || 1), 5);
              const heightPct = Math.max(15, Math.round(((h.peak || 0) / maxVal) * 100));
              return (
                <div key={i} className="hourly-bar-col">
                  <div className="bar-wrapper">
                    <span className="bar-val">{h.peak}</span>
                    <div
                      className="bar-fill"
                      style={{ height: `${heightPct}%` }}
                      title={`${h.hour}: ${h.peak} peak people, ${h.events} events`}
                    />
                  </div>
                  <span className="bar-label">{h.hour}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Camera Grid + Real-Time Live Activity Feed */}
      <div className="dashboard-grid">
        {/* Connected Camera Sessions */}
        <div className="glass-card animate-fade-in">
          <div className="section-header-row">
            <h2 className="section-title">
              <HiOutlineVideoCamera size={20} /> Registered Camera Units
            </h2>
            <Link to="/cameras" className="text-xs text-indigo">
              Manage All →
            </Link>
          </div>

          {cameras.length === 0 ? (
            <div className="empty-state">
              <HiOutlineVideoCamera size={40} />
              <p>No camera sessions registered yet</p>
              <Link to="/cameras" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}>
                Add New Camera
              </Link>
            </div>
          ) : (
            <div className="camera-list">
              {cameras.map((cam) => (
                <div key={cam.sessionId} className="camera-item">
                  <div className="camera-item__info">
                    <span className={`pulse-dot ${cam.status}`} />
                    <div>
                      <span className="camera-item__name">{cam.name}</span>
                      <code className="camera-item__id">
                        {cam.sessionId.slice(0, 10)}…
                      </code>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <span className={`badge badge-${cam.status}`}>
                      {cam.status}
                    </span>
                    <Link
                      to={`/monitoring?session=${cam.sessionId}`}
                      className="btn btn-ghost btn-sm"
                      title="Watch Live Stream"
                    >
                      <HiOutlineEye size={16} />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Real-time Live Detection Activity Feed */}
        <div className="glass-card animate-fade-in">
          <div className="section-header-row">
            <h2 className="section-title">
              <HiOutlineLightningBolt size={20} /> Real-Time Detection Feed
            </h2>
            <Link to="/history" className="text-xs text-indigo">
              View History →
            </Link>
          </div>

          {liveEventsFeed.length === 0 ? (
            <div className="empty-state">
              <HiOutlineUserGroup size={40} />
              <p>No detection events recorded yet</p>
              <span className="text-muted">
                Start a camera feed to see live detections appear in real time
              </span>
            </div>
          ) : (
            <div className="event-list">
              {liveEventsFeed.map((evt, i) => (
                <div key={i} className="event-item animate-fade-in">
                  <div className="event-item__badge">
                    {evt.peopleCount}
                  </div>
                  <div className="event-item__info">
                    <span className="event-item__label">
                      <strong>{evt.peopleCount} {evt.peopleCount === 1 ? 'person' : 'people'}</strong> detected
                    </span>
                    <div className="event-item__meta">
                      <code>{evt.sessionId?.slice(0, 10)}…</code>
                      <span>•</span>
                      <span className="event-item__time">
                        {new Date(evt.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
