import React, { useState, useEffect, useCallback, useRef } from 'react';
import { studentAPI } from '../services/api';
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
  HiOutlineIdentification,
} from 'react-icons/hi';
import './Students.css';

export default function Students() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
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
  const [filterClass, setFilterClass] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [availableFilters, setAvailableFilters] = useState({ departments: [], classes: [] });

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' | 'edit'
  const [editingStudentId, setEditingStudentId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    fullName: '',
    rollNumber: '',
    registrationNumber: '',
    department: 'Computer Science & Engineering',
    semester: 6,
    className: 'CSE-A',
  });

  // Face photos upload state
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previewUrls, setPreviewUrls] = useState([]);
  const fileInputRef = useRef(null);

  // Fetch students list
  const fetchStudents = useCallback(async (page = 1) => {
    try {
      setLoading(true);
      setError('');
      const params = { page, limit: 25 };
      if (search.trim()) params.search = search.trim();
      if (filterDept !== 'all') params.department = filterDept;
      if (filterClass !== 'all') params.className = filterClass;
      if (filterStatus !== 'all') params.status = filterStatus;

      const res = await studentAPI.list(params);
      setStudents(res.students || []);
      setPagination(res.pagination || { page: 1, limit: 25, total: 0, pages: 1 });
      setSummary(res.summary || { totalStudents: 0, activeStudents: 0, enrolledStudents: 0, pendingEnrollment: 0 });
      if (res.availableFilters) {
        setAvailableFilters(res.availableFilters);
      }
    } catch (err) {
      setError(err.message || 'Failed to load students');
    } finally {
      setLoading(false);
    }
  }, [search, filterDept, filterClass, filterStatus]);

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

    // Create object URLs for preview
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
      className: availableFilters.classes[0] || 'CSE-A',
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
      className: student.className || '',
    });
    setSelectedFiles([]);
    setPreviewUrls([]);
    setError('');
    setShowModal(true);
  };

  const handleCloseModal = () => {
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
      payload.append('className', formData.className.trim());

      selectedFiles.forEach((file) => {
        payload.append('facePhotos', file);
      });

      if (modalMode === 'create') {
        await studentAPI.create(payload);
        setSuccessMsg(`Student "${formData.fullName}" registered successfully.`);
      } else {
        await studentAPI.update(editingStudentId, payload);
        setSuccessMsg(`Student record for "${formData.fullName}" updated.`);
      }

      handleCloseModal();
      fetchStudents(pagination.page);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setError(err.message || 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (id, currentStatus) => {
    try {
      await studentAPI.toggleStatus(id);
      fetchStudents(pagination.page);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (student) => {
    if (!confirm(`Are you sure you want to deactivate student "${student.fullName}"?`)) return;
    try {
      await studentAPI.delete(student._id, false);
      fetchStudents(pagination.page);
      setSuccessMsg(`Student "${student.fullName}" deactivated.`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="students-page">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Student Directory &amp; Face Registry</h1>
          <p className="page-subtitle">
            Manage enrolled students, enrollment face photos, and classroom rosters
          </p>
        </div>

        <div className="students-actions">
          <button className="btn btn-primary" onClick={handleOpenCreateModal}>
            <HiOutlineUserAdd size={18} /> Add Student
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => fetchStudents(pagination.page)}>
            <HiOutlineRefresh size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && <div className="dashboard-error animate-fade-in">⚠ {error}</div>}
      {successMsg && (
        <div className="status-banner status-banner--success animate-fade-in">
          <HiOutlineCheckCircle size={18} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* KPI Cards */}
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
          {(search || filterDept !== 'all' || filterClass !== 'all' || filterStatus !== 'all') && (
            <button
              className="btn btn-ghost btn-xs text-muted"
              onClick={() => {
                setSearch('');
                setFilterDept('all');
                setFilterClass('all');
                setFilterStatus('all');
              }}
            >
              Reset Filters
            </button>
          )}
        </div>

        <div className="students-filter-grid">
          {/* Search */}
          <div className="filter-group" style={{ gridColumn: 'span 2' }}>
            <label className="filter-label">Search by Name or Roll No</label>
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

          {/* Class */}
          <div className="filter-group">
            <label className="filter-label">Class / Section</label>
            <select
              className="form-input filter-select"
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
            >
              <option value="all">All Classes</option>
              {availableFilters.classes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div className="filter-group">
            <label className="filter-label">Status</label>
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
        </div>
      </div>

      {/* Students Table */}
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
              Click &quot;Add Student&quot; above to register new students and upload enrollment face photos
            </span>
          </div>
        ) : (
          <>
            <div className="camera-table-wrapper">
              <table className="camera-table">
                <thead>
                  <tr>
                    <th>Roll Number</th>
                    <th>Student Details</th>
                    <th>Department &amp; Class</th>
                    <th>Face Enrollment</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((st) => (
                    <tr key={st._id}>
                      <td>
                        <span className="roll-badge">{st.rollNumber}</span>
                        {st.registrationNumber && (
                          <div className="reg-number-sub">{st.registrationNumber}</div>
                        )}
                      </td>
                      <td>
                        <div className="student-profile-cell">
                          <div className="student-avatar-thumb">
                            {st.photos && st.photos.length > 0 ? (
                              <HiOutlinePhotograph size={20} className="text-primary" />
                            ) : (
                              <span>{st.fullName.charAt(0).toUpperCase()}</span>
                            )}
                          </div>
                          <div>
                            <strong className="student-name">{st.fullName}</strong>
                            <div className="text-muted text-xs">
                              Added {new Date(st.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="dept-cell">
                          <span>{st.department}</span>
                          <span className="class-tag">
                            {st.className} (Sem {st.semester})
                          </span>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            st.enrollmentStatus === 'enrolled'
                              ? 'badge-online'
                              : st.enrolledFaceCount > 0
                              ? 'badge-warning'
                              : 'badge-offline'
                          }`}
                        >
                          {st.enrollmentStatus === 'enrolled'
                            ? `✓ Enrolled (${st.enrolledFaceCount})`
                            : st.enrolledFaceCount > 0
                            ? `Pending AI (${st.enrolledFaceCount})`
                            : 'No Photos'}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`status-toggle-btn ${st.status === 'active' ? 'status-active' : 'status-inactive'}`}
                          onClick={() => handleToggleStatus(st._id, st.status)}
                          title="Click to toggle status"
                        >
                          {st.status === 'active' ? (
                            <><HiOutlineCheckCircle size={14} /> Active</>
                          ) : (
                            <><HiOutlineXCircle size={14} /> Inactive</>
                          )}
                        </button>
                      </td>
                      <td>
                        <div className="action-buttons-wrap">
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            onClick={() => handleOpenEditModal(st)}
                            title="Edit Student"
                          >
                            <HiOutlinePencilAlt size={16} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs text-danger"
                            onClick={() => handleDelete(st)}
                            title="Deactivate Student"
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

            {/* Pagination */}
            <div className="history-pagination">
              <button
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

      {/* Registration / Edit Modal */}
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
              <button className="btn-close" onClick={handleCloseModal}>
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
                {/* Registration Number */}
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

              <div className="form-row-2">
                {/* Semester */}
                <div className="form-group">
                  <label className="form-label" htmlFor="semester">
                    Semester <span className="text-danger">*</span>
                  </label>
                  <input
                    id="semester"
                    type="number"
                    min="1"
                    max="12"
                    required
                    className="form-input"
                    value={formData.semester}
                    onChange={(e) => setFormData({ ...formData, semester: parseInt(e.target.value) || 1 })}
                  />
                </div>

                {/* Class / Section */}
                <div className="form-group">
                  <label className="form-label" htmlFor="className">
                    Class / Section <span className="text-danger">*</span>
                  </label>
                  <input
                    id="className"
                    type="text"
                    required
                    className="form-input"
                    placeholder="e.g. CSE-A"
                    value={formData.className}
                    onChange={(e) => setFormData({ ...formData, className: e.target.value })}
                  />
                </div>
              </div>

              {/* Face Photographs Upload Box */}
              <div className="form-group">
                <label className="form-label">
                  Consented Face Photographs for AI Enrollment (1 to 5 Photos)
                </label>
                <div
                  className="photo-dropzone"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <HiOutlineUpload size={28} className="text-primary" />
                  <p>Click to select 1–5 front-facing face images</p>
                  <span className="form-hint">
                    Clear lighting, single person, JPEG/PNG/WebP format (Max 5MB each)
                  </span>
                  <input
                    type="file"
                    ref={fileInputRef}
                    multiple
                    accept="image/jpeg,image/png,image/webp"
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                  />
                </div>

                {/* Image Previews */}
                {previewUrls.length > 0 && (
                  <div className="preview-photos-grid">
                    {previewUrls.map((url, idx) => (
                      <div key={idx} className="preview-photo-wrap">
                        <img src={url} alt={`Face ${idx + 1}`} className="preview-photo-img" />
                        <button
                          type="button"
                          className="btn-remove-photo"
                          onClick={() => handleRemovePhoto(idx)}
                          title="Remove photo"
                        >
                          <HiOutlineX size={12} />
                        </button>
                        <span className="photo-index-tag">Photo #{idx + 1}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleCloseModal}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting}
                >
                  {submitting ? (
                    <span className="spinner-sm" />
                  ) : modalMode === 'create' ? (
                    <><HiOutlineUserAdd size={16} /> Register Student</>
                  ) : (
                    <><HiOutlineCheckCircle size={16} /> Save Changes</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
