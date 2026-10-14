import React, { useEffect, useState, useCallback } from 'react';
import { dashboardAPI, cameraAPI } from '../services/api';
import {
  HiOutlineClipboardList,
  HiOutlineRefresh,
  HiOutlineFilter,
  HiOutlineDownload,
  HiOutlineTrash,
  HiOutlineUserGroup,
  HiOutlineTrendingUp,
  HiOutlineChevronDown,
  HiOutlineChevronUp,
} from 'react-icons/hi';
import './History.css';

/**
 * Detection History Page — Phase 7:
 * - Aggregated session occupancy analytics (Peak, Average, Event totals)
 * - Multi-criteria event filtering (by Camera Session, Min People, Date Range)
 * - Expandable event inspection (bounding boxes, tracking IDs, confidence scores)
 * - CSV and JSON event data export
 * - Batch deletion and data retention controls
 */
export default function History() {
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState({ totalEvents: 0, maxPeople: 0, avgPeople: 0 });
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [error, setError] = useState('');
  const [expandedRow, setExpandedRow] = useState(null);

  // Filters state
  const [filterSession, setFilterSession] = useState('all');
  const [filterMinPeople, setFilterMinPeople] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Fetch cameras for filter dropdown
  useEffect(() => {
    cameraAPI.list().then((res) => {
      setCameras(res.sessions || []);
    }).catch(() => {});
  }, []);

  const fetchEvents = useCallback(async (page = 1) => {
    try {
      setError('');
      setLoading(true);

      const params = { page, limit: 25 };
      if (filterSession && filterSession !== 'all') params.sessionId = filterSession;
      if (filterMinPeople) params.minPeople = filterMinPeople;
      if (filterStartDate) params.startDate = filterStartDate;
      if (filterEndDate) params.endDate = filterEndDate;

      const res = await dashboardAPI.getEvents(params);
      setEvents(res.events || []);
      setSummary(res.summary || { totalEvents: 0, maxPeople: 0, avgPeople: 0 });
      setPagination(res.pagination || { page: 1, pages: 1, total: 0 });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filterSession, filterMinPeople, filterStartDate, filterEndDate]);

  useEffect(() => {
    fetchEvents(1);
  }, [fetchEvents]);

  /**
   * Export loaded events to CSV
   */
  const handleExportCSV = () => {
    if (events.length === 0) return;

    const headers = ['Timestamp', 'Session ID', 'People Count', 'Tracking IDs', 'Confidences'];
    const rows = events.map((evt) => {
      const trackingIds = (evt.detections || []).map((d) => d.trackingId || '').join(';');
      const confs = (evt.detections || []).map((d) => Math.round((d.confidence || 0) * 100) + '%').join(';');
      return [
        `"${new Date(evt.timestamp).toISOString()}"`,
        `"${evt.sessionId || ''}"`,
        evt.peopleCount || 0,
        `"${trackingIds}"`,
        `"${confs}"`,
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `detection_events_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Export loaded events to JSON
   */
  const handleExportJSON = () => {
    if (events.length === 0) return;
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `detection_events_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Delete events older than specified days
   */
  const handleDeleteBatch = async (days) => {
    if (!confirm(`Permanently delete all detection events older than ${days} days?`)) return;
    try {
      await dashboardAPI.deleteEvents({ olderThanDays: days });
      await fetchEvents(1);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleResetFilters = () => {
    setFilterSession('all');
    setFilterMinPeople('');
    setFilterStartDate('');
    setFilterEndDate('');
  };

  return (
    <div className="history-page">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Event History & Audit Logs</h1>
          <p className="page-subtitle">
            Search, filter, inspect, and export historic human detection records
          </p>
        </div>

        {/* Action Buttons */}
        <div className="history-actions">
          <button className="btn btn-secondary btn-sm" onClick={handleExportCSV} disabled={events.length === 0}>
            <HiOutlineDownload size={16} /> Export CSV
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleExportJSON} disabled={events.length === 0}>
            <HiOutlineDownload size={16} /> Export JSON
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => fetchEvents(pagination.page)}>
            <HiOutlineRefresh size={16} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="dashboard-error animate-fade-in">⚠ {error}</div>}

      {/* Aggregate KPI Summary Cards */}
      <div className="history-summary-grid animate-fade-in">
        <div className="glass-card summary-card">
          <span className="summary-title">Total Filtered Events</span>
          <span className="summary-val text-primary">{pagination.total || 0}</span>
        </div>
        <div className="glass-card summary-card">
          <span className="summary-title">Peak Occupancy in Query</span>
          <span className="summary-val text-warning">{summary.maxPeople || 0} People</span>
        </div>
        <div className="glass-card summary-card">
          <span className="summary-title">Average Occupancy</span>
          <span className="summary-val text-info">{summary.avgPeople || 0} People/Event</span>
        </div>
      </div>

      {/* Filter Toolbar Card */}
      <div className="glass-card filter-card animate-fade-in">
        <div className="filter-card__header">
          <h3 className="section-title" style={{ marginBottom: 0, fontSize: 'var(--font-sm)' }}>
            <HiOutlineFilter size={16} /> Filter Event Log
          </h3>
          <button className="btn btn-ghost btn-xs text-muted" onClick={handleResetFilters}>
            Reset Filters
          </button>
        </div>

        <div className="filters-grid">
          {/* Camera Session Filter */}
          <div className="filter-group">
            <label className="filter-label">Camera Session</label>
            <select
              className="form-input filter-select"
              value={filterSession}
              onChange={(e) => setFilterSession(e.target.value)}
            >
              <option value="all">All Cameras & Sessions</option>
              {cameras.map((cam) => (
                <option key={cam.sessionId} value={cam.sessionId}>
                  {cam.name} ({cam.sessionId.slice(0, 8)}…)
                </option>
              ))}
            </select>
          </div>

          {/* Min People Count */}
          <div className="filter-group">
            <label className="filter-label">Min Occupancy</label>
            <input
              type="number"
              min="0"
              placeholder="e.g. 2"
              className="form-input filter-input"
              value={filterMinPeople}
              onChange={(e) => setFilterMinPeople(e.target.value)}
            />
          </div>

          {/* Start Date */}
          <div className="filter-group">
            <label className="filter-label">Start Date</label>
            <input
              type="date"
              className="form-input filter-input"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
            />
          </div>

          {/* End Date */}
          <div className="filter-group">
            <label className="filter-label">End Date</label>
            <input
              type="date"
              className="form-input filter-input"
              value={filterEndDate}
              onChange={(e) => setFilterEndDate(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Events Table */}
      <div className="glass-card animate-fade-in">
        <div className="table-header-row">
          <h2 className="section-title" style={{ marginBottom: 0 }}>
            <HiOutlineClipboardList size={20} /> Event Log Records ({pagination.total})
          </h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-ghost btn-xs text-muted"
              onClick={() => handleDeleteBatch(30)}
              title="Delete events older than 30 days"
            >
              <HiOutlineTrash size={12} /> Prune &gt;30d
            </button>
          </div>
        </div>

        {loading ? (
          <div className="loading-screen" style={{ minHeight: 220 }}>
            <div className="spinner" />
          </div>
        ) : events.length === 0 ? (
          <div className="empty-state">
            <HiOutlineClipboardList size={40} />
            <p>No detection events match your criteria</p>
            <span className="text-muted">
              Start a camera stream in Live Monitoring to generate new detection events
            </span>
          </div>
        ) : (
          <>
            <div className="camera-table-wrapper">
              <table className="camera-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Camera Session</th>
                    <th>Occupancy</th>
                    <th>Tracking IDs</th>
                    <th>Detections</th>
                    <th>Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((evt, i) => {
                    const isExpanded = expandedRow === i;
                    const trackingIds = (evt.detections || [])
                      .map((d) => d.trackingId)
                      .filter(Boolean);

                    return (
                      <React.Fragment key={evt._id || i}>
                        <tr
                          className={`history-row ${isExpanded ? 'row-expanded' : ''}`}
                          onClick={() => setExpandedRow(isExpanded ? null : i)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td className="history-time">
                            {new Date(evt.timestamp).toLocaleString()}
                          </td>
                          <td>
                            <code>{evt.sessionId?.slice(0, 12) ?? '—'}…</code>
                          </td>
                          <td>
                            <span className={`badge ${evt.peopleCount > 0 ? 'badge-online' : 'badge-offline'}`}>
                              {evt.peopleCount} {evt.peopleCount === 1 ? 'Person' : 'People'}
                            </span>
                          </td>
                          <td>
                            {trackingIds.length > 0 ? (
                              <div className="id-tags-wrap">
                                {trackingIds.map((id) => (
                                  <span key={id} className="id-tag">
                                    #{id}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted text-xs">—</span>
                            )}
                          </td>
                          <td className="text-muted">
                            {evt.detections?.length ?? 0} boxes
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              title="Toggle Details"
                            >
                              {isExpanded ? <HiOutlineChevronUp size={14} /> : <HiOutlineChevronDown size={14} />}
                            </button>
                          </td>
                        </tr>

                        {/* Expanded Inspection Drawer */}
                        {isExpanded && (
                          <tr className="expanded-details-row">
                            <td colSpan="6">
                              <div className="expanded-content">
                                <h4>Detection Coordinates & Confidence Details:</h4>
                                {(!evt.detections || evt.detections.length === 0) ? (
                                  <p className="text-muted text-xs">No individual bounding boxes logged for this frame.</p>
                                ) : (
                                  <div className="boxes-grid">
                                    {evt.detections.map((det, dIdx) => (
                                      <div key={dIdx} className="detection-box-card">
                                        <div className="box-card-header">
                                          <strong>Person #{det.trackingId || dIdx + 1}</strong>
                                          <span className="badge badge-online">
                                            {Math.round((det.confidence || 0) * 100)}% Conf
                                          </span>
                                        </div>
                                        {det.bbox && (
                                          <div className="box-coords">
                                            <span>X: {det.bbox.x}px</span>
                                            <span>Y: {det.bbox.y}px</span>
                                            <span>W: {det.bbox.width}px</span>
                                            <span>H: {det.bbox.height}px</span>
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="history-pagination">
              <button
                className="btn btn-ghost btn-sm"
                disabled={pagination.page <= 1}
                onClick={() => fetchEvents(pagination.page - 1)}
              >
                Previous
              </button>
              <span className="history-pagination__info">
                Page {pagination.page} of {pagination.pages} ({pagination.total} events)
              </span>
              <button
                className="btn btn-ghost btn-sm"
                disabled={pagination.page >= pagination.pages}
                onClick={() => fetchEvents(pagination.page + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

