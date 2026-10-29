import React, { useState, useEffect, useCallback, useRef } from 'react';
import { studentAPI, dashboardAPI } from '../services/api';
import {
  HiOutlineUserGroup,
  HiOutlineUserAdd,
  HiOutlineSearch,
  HiOutlineFilter,
  HiOutlineRefresh,
  HiOutlinePhotograph,
  HiOutlineTrash,
  HiOutlinePencilAlt,
  HiOutlineCheckCircle,
  HiOutlineXCircle,
  HiOutlineX,
  HiOutlineUpload,
  HiOutlineClipboardList,
  HiOutlineChip,
  HiOutlineCamera,
  HiOutlineExclamation,
  HiOutlineAcademicCap,
  HiOutlineBadgeCheck,
} from 'react-icons/hi';
import './Students.css';

export default function Students() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [gallerySyncing, setGallerySyncing] = useState(false);
  const [galleryStatus, setGalleryStatus] = useState(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, pages: 1 });
  const [summary, setSummary] = useState({
    totalStudents: 0,
    activeStudents: 0,
    enrolledStudents: 0,
    pendingEnrollment: 0,
  });

  // Filters state
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('all');
  const [filterSemester, setFilterSemester] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterEnrollment, setFilterEnrollment] = useState('all');
  const [availableFilters, setAvailableFilters] = useState({ departments: [], semesters: [] });

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' | 'edit'
  const [editingStudentId, setEditingStudentId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Candidate Test Records Modal state
  const [testCandidates, setTestCandidates] = useState([]);
  const [showTestModal, setShowTestModal] = useState(false);
  const [selectedTestIds, setSelectedTestIds] = useState([]);
  const [cleaningUpTests, setCleaningUpTests] = useState(false);

  // Recognition History modal state
  const [historyStudent, setHistoryStudent] = useState(null);
  const [historyEvents, setHistoryEvents] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyPagination, setHistoryPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [historyFilterStatus, setHistoryFilterStatus] = useState('all');
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');

  // Form state (strictly Semester as academic grouping, NO class/section)
  const [formData, setFormData] = useState({
    fullName: '',
    rollNumber: '',
    registrationNumber: '',
    department: 'Computer Science & Engineering',
    semester: 6,
  });

  // Face photos upload state
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previewUrls, setPreviewUrls] = useState([]);
  const fileInputRef = useRef(null);

  // Live camera capture state
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoStreamRef = useRef(null);
  const liveVideoRef = useRef(null);

  const startCamera = async () => {
    try {
      setCameraError('');
      setIsCameraOpen(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      videoStreamRef.current = stream;
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        liveVideoRef.current.play().catch(() => {});
      }
    } catch (err) {
      console.error('Camera access error:', err);
      setCameraError('Unable to access camera: ' + (err.message || 'Permission denied'));
      setIsCameraOpen(false);
    }
  };

  const stopCamera = useCallback(() => {
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((track) => track.stop());
      videoStreamRef.current = null;
    }
    if (liveVideoRef.current) {
      liveVideoRef.current.srcObject = null;
    }
    setIsCameraOpen(false);
    setCameraError('');
  }, []);

  const handleCaptureLivePhoto = () => {
    if (!liveVideoRef.current || !videoStreamRef.current) return;
    if (selectedFiles.length >= 5) {
      setError('You can upload or capture a maximum of 5 face photographs per student.');
      return;
    }

    const video = liveVideoRef.current;
    if (!video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');

    // Draw mirrored to match front-facing selfie view
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `live-photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const updatedFiles = [...selectedFiles, file].slice(0, 5);
      setSelectedFiles(updatedFiles);

      const url = URL.createObjectURL(blob);
      setPreviewUrls([...previewUrls, url].slice(0, 5));
    }, 'image/jpeg', 0.95);
  };

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Fetch candidate test records (for safe, explicit inspection)
  const fetchTestCandidates = useCallback(async () => {
    try {
      const res = await studentAPI.getCandidateTestRecords();
      if (res && res.success) {
        setTestCandidates(res.candidates || []);
      }
    } catch (_) {}
  }, []);

  // Fetch students list
  const fetchStudents = useCallback(async (page = 1) => {
    try {
      setLoading(true);
      setError('');
      const params = { page, limit: 25 };
      if (search.trim()) params.search = search.trim();
      if (filterDept !== 'all') params.department = filterDept;
      if (filterSemester !== 'all') params.semester = filterSemester;
      if (filterStatus !== 'all') params.status = filterStatus;
      if (filterEnrollment !== 'all') params.enrollmentStatus = filterEnrollment;

      const res = await studentAPI.list(params);
      setStudents(res.students || []);
      setPagination(res.pagination || { page: 1, limit: 25, total: 0, pages: 1 });
      setSummary(res.summary || { totalStudents: 0, activeStudents: 0, enrolledStudents: 0, pendingEnrollment: 0 });
      if (res.availableFilters) {
        setAvailableFilters({
          departments: res.availableFilters.departments || [],
          semesters: res.availableFilters.semesters || [1, 2, 3, 4, 5, 6, 7, 8],
        });
      }

      // Fetch live AI microservice gallery sync status
      dashboardAPI.getGalleryStatus()
        .then((gRes) => {
          if (gRes && gRes.galleryStatus) {
            setGalleryStatus(gRes.galleryStatus);
          }
        })
        .catch(() => {});

      // Refresh test candidates
      fetchTestCandidates();
    } catch (err) {
      setError(err.message || 'Failed to load students');
    } finally {
      setLoading(false);
    }
  }, [search, filterDept, filterSemester, filterStatus, filterEnrollment, fetchTestCandidates]);

  useEffect(() => {
    fetchStudents(1);
  }, [fetchStudents]);

  // Handle image files selection
  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    if (selectedFiles.length + files.length > 5) {
      setError('You can upload a maximum of 5 face photographs per student.');
      return;
    }

    const updatedFiles = [...selectedFiles, ...files].slice(0, 5);
    setSelectedFiles(updatedFiles);

    const urls = updatedFiles.map((file) => URL.createObjectURL(file));
    setPreviewUrls(urls);
  };

  const handleRemovePhoto = (index) => {
    const updatedFiles = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(updatedFiles);

    URL.revokeObjectURL(previewUrls[index]);
    setPreviewUrls(previewUrls.filter((_, i) => i !== index));
  };

  const handleOpenCreateModal = () => {
    setModalMode('create');
    setEditingStudentId(null);
    setFormData({
      fullName: '',
      rollNumber: '',
      registrationNumber: '',
      department: availableFilters.departments[0] || 'Computer Science & Engineering',
      semester: 6,
    });
    setSelectedFiles([]);
    setPreviewUrls([]);
    setError('');
    setShowModal(true);
  };

  const handleOpenEditModal = (student) => {
    setModalMode('edit');
    setEditingStudentId(student._id);
    setFormData({
      fullName: student.fullName || '',
      rollNumber: student.rollNumber || '',
      registrationNumber: student.registrationNumber || '',
      department: student.department || '',
      semester: student.semester || 1,
    });
    setSelectedFiles([]);
    setPreviewUrls([]);
    setError('');
    setShowModal(true);
  };

  const handleCloseModal = () => {
    stopCamera();
    setShowModal(false);
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    setPreviewUrls([]);
    setSelectedFiles([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const payload = new FormData();
      payload.append('fullName', formData.fullName.trim());
      payload.append('rollNumber', formData.rollNumber.trim());
      if (formData.registrationNumber) {
        payload.append('registrationNumber', formData.registrationNumber.trim());
      }
      payload.append('department', formData.department.trim());
      payload.append('semester', formData.semester);

      selectedFiles.forEach((file) => {
        payload.append('facePhotos', file);
      });

      if (modalMode === 'create') {
        if (selectedFiles.length > 0) {
          payload.append('autoEnroll', 'true');
        }
        const res = await studentAPI.create(payload);
        if (res.enrolled && res.gallerySynced) {
          setSuccessMsg(`Student "${formData.fullName}" registered, ${res.enrolledCount || selectedFiles.length} face embedding(s) enrolled and synchronized with AI gallery.`);
        } else if (res.enrolled) {
          setSuccessMsg(`Student "${formData.fullName}" registered and face biometrics enrolled.`);
        } else {
          setSuccessMsg(`Student "${formData.fullName}" registered successfully.`);
        }
      } else {
        await studentAPI.update(editingStudentId, payload);
        setSuccessMsg(`Student record for "${formData.fullName}" updated.`);
      }

      handleCloseModal();
      fetchStudents(pagination.page);
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err) {
      setError(err.message || 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualSync = async () => {
    try {
      setGallerySyncing(true);
      setError('');
      const res = await studentAPI.syncGallery();
      setSuccessMsg(res.message || 'AI Face Gallery synchronized successfully.');
      fetchStudents(pagination.page);
      dashboardAPI.getGalleryStatus()
        .then((gRes) => {
          if (gRes && gRes.galleryStatus) setGalleryStatus(gRes.galleryStatus);
        })
        .catch(() => {});
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err) {
      setError(err.message || 'AI Gallery synchronization failed');
    } finally {
      setGallerySyncing(false);
    }
  };

  const [enrollingId, setEnrollingId] = useState(null);

  const handleEnroll = async (student) => {
    try {
      setEnrollingId(student._id);
      setError('');
      const res = await studentAPI.enroll(student._id);
      setSuccessMsg(res.message || `Face enrollment & gallery sync completed for "${student.fullName}"`);
      fetchStudents(pagination.page);
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err) {
      setError(err.message || 'Face enrollment failed');
    } finally {
      setEnrollingId(null);
    }
  };

  const handleWipeEnrollment = async (student) => {
    if (!confirm(`Wipe biometric face embeddings for "${student.fullName}"?`)) return;
    try {
      setError('');
      await studentAPI.deleteEnrollment(student._id);
      setSuccessMsg(`Biometric face data removed for "${student.fullName}".`);
      fetchStudents(pagination.page);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleStatus = async (id) => {
    try {
      await studentAPI.toggleStatus(id);
      fetchStudents(pagination.page);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (student) => {
    if (
      !confirm(
        `Are you sure you want to delete student "${student.fullName}" (${student.rollNumber})? This will deactivate the student and remove biometric embeddings.`
      )
    ) {
      return;
    }

    try {
      await studentAPI.delete(student._id, true);
      setSuccessMsg(`Student "${student.fullName}" deleted successfully.`);
      fetchStudents(pagination.page);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setError(err.message);
    }
  };

  // Safe Cleanup of Identified Candidate Test Records
  const handleOpenTestModal = () => {
    setSelectedTestIds(testCandidates.map((c) => c._id));
    setShowTestModal(true);
  };

  const handleToggleTestSelect = (id) => {
    setSelectedTestIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleExecuteTestCleanup = async () => {
    if (selectedTestIds.length === 0) return;
    if (!confirm(`Confirm deletion of ${selectedTestIds.length} explicitly selected test record(s)? This will clean up test entries without affecting real student records.`)) return;

    try {
      setCleaningUpTests(true);
      setError('');
      const res = await studentAPI.cleanupTestRecords(selectedTestIds);
      setSuccessMsg(res.message || `Successfully cleaned up ${selectedTestIds.length} test records.`);
      setShowTestModal(false);
      setSelectedTestIds([]);
      fetchStudents(1);
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err) {
      setError(err.message || 'Cleanup of test records failed');
    } finally {
      setCleaningUpTests(false);
    }
  };

  // Recognition History Modal
  const fetchStudentHistory = useCallback(async (studentId, page = 1) => {
    try {
      setHistoryLoading(true);
      setHistoryError('');
      const params = { studentId, page, limit: 15 };
      if (historyFilterStatus !== 'all') params.status = historyFilterStatus;
      if (historyStartDate) params.startDate = historyStartDate;
      if (historyEndDate) params.endDate = historyEndDate;

      const res = await studentAPI.getRecognitionEvents(params);
      setHistoryEvents(res.events || []);
      setHistoryPagination(res.pagination || { page: 1, pages: 1, total: 0 });
    } catch (err) {
      setHistoryError(err.message || 'Failed to load recognition history');
    } finally {
      setHistoryLoading(false);
    }
  }, [historyFilterStatus, historyStartDate, historyEndDate]);

  const handleOpenHistory = (student) => {
    setHistoryStudent(student);
    setHistoryFilterStatus('all');
    setHistoryStartDate('');
    setHistoryEndDate('');
    fetchStudentHistory(student._id, 1);
  };

  const handleCloseHistory = () => {
    setHistoryStudent(null);
    setHistoryEvents([]);
  };

  return (
    <div className="students-page">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Student Directory &amp; Face Registry</h1>
          <p className="page-subtitle">
            Manage student registrations by academic semester and oversee YuNet + ArcFace biometric enrollments
          </p>
        </div>

        <div className="students-actions">
          {testCandidates.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{
                borderColor: 'rgba(245, 158, 11, 0.4)',
                color: '#fbbf24',
                background: 'rgba(245, 158, 11, 0.08)',
              }}
              onClick={handleOpenTestModal}
              title="Inspect and review automated test records"
            >
              <HiOutlineClipboardList size={16} /> Review Test Records ({testCandidates.length})
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleManualSync}
            disabled={gallerySyncing}
            title="Push active student embeddings to AI service vector index"
          >
            <HiOutlineRefresh size={16} className={gallerySyncing ? 'animate-spin' : ''} />
            {gallerySyncing ? 'Syncing...' : 'Sync AI Gallery'}
          </button>

          <button type="button" className="btn btn-primary btn-sm" onClick={handleOpenCreateModal}>
            <HiOutlineUserAdd size={16} /> Register Student
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => fetchStudents(pagination.page)}
            title="Refresh directory"
          >
            <HiOutlineRefresh size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="dashboard-error animate-fade-in" style={{ whiteSpace: 'pre-wrap' }}>
          ⚠ {error}
        </div>
      )}
      {successMsg && (
        <div className="status-banner status-banner--success animate-fade-in">
          <HiOutlineCheckCircle size={18} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* AI Microservice Gallery Sync Status Banner */}
      {galleryStatus && (
        <div
          className="gallery-sync-banner animate-fade-in"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            padding: '12px 18px',
            borderRadius: 'var(--radius-md, 8px)',
            background: galleryStatus.aiServiceOnline ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
            border: `1px solid ${galleryStatus.aiServiceOnline ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
            fontSize: 'var(--font-sm, 13px)',
            color: 'var(--text-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: !galleryStatus.aiServiceOnline
                  ? '#ef4444'
                  : galleryStatus.isSynchronized
                  ? '#10b981'
                  : '#f59e0b',
                boxShadow: !galleryStatus.aiServiceOnline
                  ? '0 0 10px #ef4444'
                  : galleryStatus.isSynchronized
                  ? '0 0 10px #10b981'
                  : '0 0 10px #f59e0b',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <strong>AI Microservice Gallery:</strong>
              <span
                className={`badge ${
                  !galleryStatus.aiServiceOnline
                    ? 'badge-offline'
                    : galleryStatus.isSynchronized
                    ? 'badge-online'
                    : 'badge-warning'
                }`}
                style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}
              >
                {!galleryStatus.aiServiceOnline
                  ? 'Offline'
                  : galleryStatus.isSynchronized
                  ? 'Synchronized'
                  : 'Sync Required'}
              </span>
            </div>

            {galleryStatus.aiServiceOnline ? (
              <div className="gallery-metrics-row">
                <span className="gallery-chip">
                  Identities Loaded: <strong>{galleryStatus.syncedStudents ?? 0}</strong>
                </span>
                <span className="gallery-chip">
                  Active Embeddings: <strong>{galleryStatus.syncedEmbeddings ?? 0}</strong>
                </span>
                <span className="gallery-chip">
                  Cosine Threshold: <strong>{galleryStatus.similarityThreshold || 0.363}</strong>
                </span>
              </div>
            ) : (
              <span className="text-danger" style={{ fontWeight: 500 }}>
                {galleryStatus.lastSyncError || 'AI Service Unreachable — vector index synchronization pending'}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {galleryStatus.lastSyncedAt ? (
              <span style={{ fontSize: 11, color: '#34d399' }} title="Confirmed AI service gallery sync timestamp">
                Last Synced: {new Date(galleryStatus.lastSyncedAt).toLocaleTimeString()}
              </span>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Last Synced: Never / Pending
              </span>
            )}
            {galleryStatus.checkedAt && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Checked: {new Date(galleryStatus.checkedAt).toLocaleTimeString()}
              </span>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-xs text-primary"
              onClick={handleManualSync}
              disabled={gallerySyncing}
            >
              {gallerySyncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="students-summary-grid animate-fade-in">
        <div className="glass-card summary-card">
          <span className="summary-title">Total Registered</span>
          <span className="summary-val text-primary">{summary.totalStudents || 0}</span>
        </div>
        <div className="glass-card summary-card">
          <span className="summary-title">Active Students</span>
          <span className="summary-val text-online">{summary.activeStudents || 0}</span>
        </div>
        <div className="glass-card summary-card">
          <span className="summary-title">Face Enrolled</span>
          <span className="summary-val text-info">{summary.enrolledStudents || 0}</span>
        </div>
        <div className="glass-card summary-card">
          <span className="summary-title">Pending Face Data</span>
          <span className="summary-val text-warning">{summary.pendingEnrollment || 0}</span>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="glass-card filter-card animate-fade-in">
        <div className="filter-card__header">
          <h3 className="section-title" style={{ marginBottom: 0, fontSize: 'var(--font-sm)' }}>
            <HiOutlineFilter size={16} /> Search &amp; Filter Students
          </h3>
          {(search || filterDept !== 'all' || filterSemester !== 'all' || filterStatus !== 'all' || filterEnrollment !== 'all') && (
            <button
              type="button"
              className="btn btn-ghost btn-xs text-muted"
              onClick={() => {
                setSearch('');
                setFilterDept('all');
                setFilterSemester('all');
                setFilterStatus('all');
                setFilterEnrollment('all');
              }}
            >
              Reset Filters
            </button>
          )}
        </div>

        <div className="students-filter-grid">
          {/* Search */}
          <div className="filter-group" style={{ gridColumn: 'span 2' }}>
            <label className="filter-label">Search by Name, Roll No, or Reg No</label>
            <div className="search-input-wrap">
              <HiOutlineSearch size={16} className="search-icon" />
              <input
                type="text"
                className="form-input filter-search-input"
                placeholder="e.g. Arjun Kumar or CS2026-01..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Department */}
          <div className="filter-group">
            <label className="filter-label">Department</label>
            <select
              className="form-input filter-select"
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
            >
              <option value="all">All Departments</option>
              {availableFilters.departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* Semester */}
          <div className="filter-group">
            <label className="filter-label">Academic Semester</label>
            <select
              className="form-input filter-select"
              value={filterSemester}
              onChange={(e) => setFilterSemester(e.target.value)}
            >
              <option value="all">All Semesters</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <option key={s} value={s}>
                  Semester {s}
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div className="filter-group">
            <label className="filter-label">Account Status</label>
            <select
              className="form-input filter-select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          {/* Face Enrollment Status */}
          <div className="filter-group">
            <label className="filter-label">Biometric Status</label>
            <select
              className="form-input filter-select"
              value={filterEnrollment}
              onChange={(e) => setFilterEnrollment(e.target.value)}
            >
              <option value="all">All Enrollment</option>
              <option value="enrolled">Face Enrolled</option>
              <option value="pending">Pending AI</option>
              <option value="failed">Failed Enrollment</option>
            </select>
          </div>
        </div>
      </div>

      {/* Students Directory Table */}
      <div className="glass-card animate-fade-in">
        <div className="table-header-row">
          <h2 className="section-title" style={{ marginBottom: 0 }}>
            <HiOutlineUserGroup size={20} /> Student Roster ({pagination.total})
          </h2>
        </div>

        {loading ? (
          <div className="loading-screen" style={{ minHeight: 220 }}>
            <div className="spinner" />
          </div>
        ) : students.length === 0 ? (
          <div className="empty-state">
            <HiOutlineUserGroup size={44} />
            <p>No student records match your query</p>
            <span className="text-muted">
              Click &quot;Register Student&quot; above to add students and upload biometric face photos
            </span>
          </div>
        ) : (
          <>
            <div className="camera-table-wrapper">
              <table className="camera-table">
                <thead>
                  <tr>
                    <th>Roll Number</th>
                    <th>Student Name</th>
                    <th>Department &amp; Semester</th>
                    <th>Face Enrollment</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((st) => (
                    <tr key={st._id}>
                      {/* Roll Number */}
                      <td>
                        <span className="roll-badge">{st.rollNumber}</span>
                        {st.registrationNumber && (
                          <div className="reg-number-sub">{st.registrationNumber}</div>
                        )}
                      </td>

                      {/* Student Details */}
                      <td>
                        <div className="student-profile-cell">
                          <div className="student-avatar-thumb">
                            {st.photos && st.photos.length > 0 ? (
                              <HiOutlinePhotograph size={20} className="text-primary" />
                            ) : (
                              <span>{st.fullName ? st.fullName.charAt(0).toUpperCase() : 'S'}</span>
                            )}
                          </div>
                          <div>
                            <strong className="student-name">{st.fullName}</strong>
                            <div className="text-muted text-xs">
                              Registered {new Date(st.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Department & Semester */}
                      <td>
                        <div className="dept-cell">
                          <span>{st.department}</span>
                          <span className="semester-tag">
                            <HiOutlineAcademicCap size={12} /> Semester {st.semester || 1}
                          </span>
                        </div>
                      </td>

                      {/* Face Enrollment Status */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'flex-start' }}>
                          <span
                            className={`badge ${
                              st.enrolledFaceCount > 0 && st.enrollmentStatus === 'enrolled'
                                ? 'badge-online'
                                : st.photos?.length > 0
                                ? 'badge-warning'
                                : 'badge-offline'
                            }`}
                          >
                            {st.enrolledFaceCount > 0 && st.enrollmentStatus === 'enrolled'
                              ? `✓ Enrolled (${st.enrolledFaceCount} ${st.enrolledFaceCount === 1 ? 'embedding' : 'embeddings'})`
                              : st.photos?.length > 0
                              ? `⚡ Pending AI (${st.photos.length} ${st.photos.length === 1 ? 'photo' : 'photos'})`
                              : 'No Face Data'}
                          </span>

                          {st.photos?.length > 0 && st.enrollmentStatus !== 'enrolled' && (
                            <button
                              type="button"
                              className="btn btn-primary btn-xs"
                              style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px' }}
                              disabled={enrollingId === st._id}
                              onClick={() => handleEnroll(st)}
                              title="Process photos with OpenCV YuNet & SFace ArcFace"
                            >
                              {enrollingId === st._id ? 'Enrolling...' : '⚡ Enroll AI'}
                            </button>
                          )}

                          {st.enrolledFaceCount > 0 && st.enrollmentStatus === 'enrolled' && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs text-muted"
                              style={{ fontSize: '10px', padding: '1px 4px' }}
                              onClick={() => handleWipeEnrollment(st)}
                              title="Wipe biometric face embeddings from MongoDB"
                            >
                              Clear Biometrics
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Active / Inactive Status */}
                      <td>
                        <button
                          type="button"
                          className={`status-toggle-btn ${st.status === 'active' ? 'status-active' : 'status-inactive'}`}
                          onClick={() => handleToggleStatus(st._id)}
                          title="Click to toggle status"
                        >
                          {st.status === 'active' ? (
                            <><HiOutlineCheckCircle size={14} /> Active</>
                          ) : (
                            <><HiOutlineXCircle size={14} /> Inactive</>
                          )}
                        </button>
                      </td>

                      {/* Action Buttons */}
                      <td>
                        <div className="action-buttons-wrap">
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            onClick={() => handleOpenHistory(st)}
                            title="View Recognition Audit History"
                          >
                            <HiOutlineClipboardList size={16} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            onClick={() => handleOpenEditModal(st)}
                            title="Edit Student Profile"
                          >
                            <HiOutlinePencilAlt size={16} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs text-danger"
                            onClick={() => handleDelete(st)}
                            title="Delete Student Record"
                          >
                            <HiOutlineTrash size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="history-pagination">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={pagination.page <= 1}
                onClick={() => fetchStudents(pagination.page - 1)}
              >
                Previous
              </button>
              <span className="history-pagination__info">
                Page {pagination.page} of {pagination.pages} ({pagination.total} students)
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={pagination.page >= pagination.pages}
                onClick={() => fetchStudents(pagination.page + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Registration / Edit Modal ────────────────────── */}
      {showModal && (
        <div className="modal-backdrop animate-fade-in" onClick={handleCloseModal}>
          <div className="modal-card animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                {modalMode === 'create' ? (
                  <><HiOutlineUserAdd size={22} /> Register New Student</>
                ) : (
                  <><HiOutlinePencilAlt size={22} /> Edit Student Profile</>
                )}
              </h2>
              <button type="button" className="btn-close" onClick={handleCloseModal}>
                <HiOutlineX size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="student-modal-form">
              <div className="form-row-2">
                {/* Full Name */}
                <div className="form-group">
                  <label className="form-label" htmlFor="fullName">
                    Full Name <span className="text-danger">*</span>
                  </label>
                  <input
                    id="fullName"
                    type="text"
                    required
                    className="form-input"
                    placeholder="e.g. Arjun Kumar"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  />
                </div>

                {/* Roll Number */}
                <div className="form-group">
                  <label className="form-label" htmlFor="rollNumber">
                    Roll Number <span className="text-danger">*</span>
                  </label>
                  <input
                    id="rollNumber"
                    type="text"
                    required
                    className="form-input font-mono"
                    placeholder="e.g. CS2026-01"
                    value={formData.rollNumber}
                    onChange={(e) => setFormData({ ...formData, rollNumber: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row-2">
                {/* Registration Number (Optional) */}
                <div className="form-group">
                  <label className="form-label" htmlFor="registrationNumber">
                    Registration Number (Optional)
                  </label>
                  <input
                    id="registrationNumber"
                    type="text"
                    className="form-input font-mono"
                    placeholder="e.g. REG-2026-9812"
                    value={formData.registrationNumber}
                    onChange={(e) => setFormData({ ...formData, registrationNumber: e.target.value })}
                  />
                </div>

                {/* Department */}
                <div className="form-group">
                  <label className="form-label" htmlFor="department">
                    Department <span className="text-danger">*</span>
                  </label>
                  <input
                    id="department"
                    type="text"
                    required
                    className="form-input"
                    placeholder="e.g. Computer Science & Engineering"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  />
                </div>
              </div>

              {/* Semester (Academic Grouping) */}
              <div className="form-group">
                <label className="form-label" htmlFor="semester">
                  Academic Semester <span className="text-danger">*</span>
                </label>
                <select
                  id="semester"
                  required
                  className="form-input"
                  value={formData.semester}
                  onChange={(e) => setFormData({ ...formData, semester: parseInt(e.target.value, 10) || 1 })}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                    <option key={s} value={s}>
                      Semester {s}
                    </option>
                  ))}
                </select>
              </div>

              {/* Face Photographs Upload & Live Capture */}
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>
                    Consented Face Photographs for AI Biometric Enrollment (1 to 5 photos)
                  </label>
                  {!isCameraOpen ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={startCamera}
                      title="Capture face using webcam"
                    >
                      <HiOutlineCamera size={14} /> Open Webcam
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs text-danger"
                      onClick={stopCamera}
                    >
                      Close Webcam
                    </button>
                  )}
                </div>

                {/* Live Webcam Box */}
                {isCameraOpen && (
                  <div className="live-camera-capture-box animate-fade-in">
                    {cameraError ? (
                      <div className="dashboard-error">{cameraError}</div>
                    ) : (
                      <>
                        <div className="live-camera-video-wrap">
                          <video ref={liveVideoRef} className="live-camera-preview-video" autoPlay playsInline muted />
                          <div className="face-framing-guide">
                            <span>ALIGN FACE HERE</span>
                          </div>
                        </div>
                        <div className="live-camera-actions">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={handleCaptureLivePhoto}
                            disabled={selectedFiles.length >= 5}
                          >
                            <HiOutlineCamera size={16} /> Snap Photo ({selectedFiles.length}/5)
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={stopCamera}>
                            Done
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* File Dropzone */}
                {!isCameraOpen && (
                  <div className="photo-dropzone" onClick={() => fileInputRef.current?.click()}>
                    <HiOutlineUpload size={28} className="text-primary" />
                    <p>Click to choose student face photos</p>
                    <span className="text-muted text-xs">
                      Supports JPEG, PNG, WebP (up to 5MB each). Maximum 5 clear portraits.
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: 'none' }}
                      onChange={handleFileChange}
                    />
                  </div>
                )}

                {/* Previews Grid */}
                {previewUrls.length > 0 && (
                  <div className="preview-photos-grid">
                    {previewUrls.map((url, idx) => (
                      <div key={idx} className="preview-photo-wrap animate-scale-in">
                        <img src={url} alt={`Preview ${idx + 1}`} className="preview-photo-img" />
                        <button
                          type="button"
                          className="btn-remove-photo"
                          onClick={() => handleRemovePhoto(idx)}
                          title="Remove this photo"
                        >
                          ×
                        </button>
                        <span className="photo-index-tag">#{idx + 1}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Modal Actions */}
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={handleCloseModal} disabled={submitting}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting
                    ? 'Processing...'
                    : modalMode === 'create'
                    ? selectedFiles.length > 0
                      ? 'Register & Enroll Biometrics'
                      : 'Register Student'
                    : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Test Records Review & Explicit Cleanup Modal ───── */}
      {showTestModal && (
        <div className="modal-backdrop animate-fade-in" onClick={() => setShowTestModal(false)}>
          <div className="modal-card animate-scale-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
            <div className="modal-header">
              <h2 className="modal-title" style={{ color: '#fbbf24' }}>
                <HiOutlineClipboardList size={22} /> Review Candidate Test Records ({testCandidates.length})
              </h2>
              <button type="button" className="btn-close" onClick={() => setShowTestModal(false)}>
                <HiOutlineX size={20} />
              </button>
            </div>

            <div className="test-warning-box">
              <HiOutlineExclamation size={24} style={{ flexShrink: 0 }} />
              <div>
                <strong>Automated Test Record Inspection:</strong>
                <p style={{ margin: '4px 0 0 0' }}>
                  These records were generated by automated test suites (matching prefixes like <code>TEST-</code> or <code>LIVE-</code>).
                  Real students and enrolled biometric face data are <strong>never</strong> deleted.
                  Review the candidate list below and confirm explicit cleanup.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '14px 0 6px 0' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Selected for cleanup: <strong>{selectedTestIds.length}</strong> of {testCandidates.length}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => {
                  if (selectedTestIds.length === testCandidates.length) setSelectedTestIds([]);
                  else setSelectedTestIds(testCandidates.map((c) => c._id));
                }}
              >
                {selectedTestIds.length === testCandidates.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            <div className="test-records-table-wrap">
              <table className="test-records-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>Select</th>
                    <th>Roll Number</th>
                    <th>Student Name</th>
                    <th>Department</th>
                    <th>Created At</th>
                  </tr>
                </thead>
                <tbody>
                  {testCandidates.map((item) => (
                    <tr key={item._id} onClick={() => handleToggleTestSelect(item._id)} style={{ cursor: 'pointer' }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedTestIds.includes(item._id)}
                          onChange={() => handleToggleTestSelect(item._id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td>
                        <code style={{ color: '#38bdf8' }}>{item.rollNumber}</code>
                      </td>
                      <td><strong>{item.fullName}</strong></td>
                      <td>{item.department}</td>
                      <td>{new Date(item.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowTestModal(false)}
                disabled={cleaningUpTests}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={selectedTestIds.length === 0 || cleaningUpTests}
                onClick={handleExecuteTestCleanup}
              >
                {cleaningUpTests ? 'Cleaning Up...' : `Delete Selected Test Records (${selectedTestIds.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Recognition Audit History Modal ────────────────── */}
      {historyStudent && (
        <div className="modal-backdrop animate-fade-in" onClick={handleCloseHistory}>
          <div className="modal-card animate-scale-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 740 }}>
            <div className="modal-header">
              <h2 className="modal-title">
                <HiOutlineClipboardList size={22} /> Recognition Audit: {historyStudent.fullName}
              </h2>
              <button type="button" className="btn-close" onClick={handleCloseHistory}>
                <HiOutlineX size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
              <span className="roll-badge">{historyStudent.rollNumber}</span>
              <span className="semester-tag">Semester {historyStudent.semester || 1}</span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{historyStudent.department}</span>
            </div>

            {/* Filter Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
              <div>
                <label className="filter-label">Match Status</label>
                <select
                  className="form-input filter-select"
                  value={historyFilterStatus}
                  onChange={(e) => setHistoryFilterStatus(e.target.value)}
                >
                  <option value="all">All Events</option>
                  <option value="recognized">Recognized</option>
                  <option value="unknown">Unknown</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </div>
              <div>
                <label className="filter-label">Start Date</label>
                <input
                  type="date"
                  className="form-input"
                  value={historyStartDate}
                  onChange={(e) => setHistoryStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="filter-label">End Date</label>
                <input
                  type="date"
                  className="form-input"
                  value={historyEndDate}
                  onChange={(e) => setHistoryEndDate(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm btn-block"
                  onClick={() => fetchStudentHistory(historyStudent._id, 1)}
                >
                  Filter Events
                </button>
              </div>
            </div>

            {/* History Table */}
            {historyLoading ? (
              <div className="loading-screen" style={{ minHeight: 180 }}>
                <div className="spinner" />
              </div>
            ) : historyEvents.length === 0 ? (
              <div className="empty-state" style={{ minHeight: 160 }}>
                <HiOutlineClipboardList size={36} />
                <p>No recognition events recorded for this student</p>
                <span className="text-muted text-xs">
                  Detections from Live Monitor and CCTV will appear here with audit timestamps
                </span>
              </div>
            ) : (
              <div className="camera-table-wrapper" style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table className="camera-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Session / Camera</th>
                      <th>Track ID</th>
                      <th>Similarity Score</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyEvents.map((evt) => (
                      <tr key={evt._id}>
                        <td>{new Date(evt.timestamp).toLocaleString()}</td>
                        <td>
                          <code style={{ color: '#38bdf8' }}>{evt.sessionId?.slice(0, 12)}…</code>
                        </td>
                        <td>Track #{evt.trackingId || 1}</td>
                        <td>
                          <strong style={{ color: evt.status === 'recognized' ? '#10b981' : '#f59e0b' }}>
                            {Math.round((evt.confidence || 0) * 100)}%
                          </strong>
                        </td>
                        <td>
                          <span className={`badge ${evt.status === 'recognized' ? 'badge-online' : 'badge-warning'}`}>
                            {evt.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* History Pagination */}
            {historyPagination.pages > 1 && (
              <div className="history-pagination" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  disabled={historyPagination.page <= 1}
                  onClick={() => fetchStudentHistory(historyStudent._id, historyPagination.page - 1)}
                >
                  Previous
                </button>
                <span className="history-pagination__info">
                  Page {historyPagination.page} of {historyPagination.pages}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  disabled={historyPagination.page >= historyPagination.pages}
                  onClick={() => fetchStudentHistory(historyStudent._id, historyPagination.page + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
