const assert = require('assert');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5000/api';

async function runTests() {
  console.log('🧪 Starting Phase 5: Recognition Events & Live Audit Logging Test Suite...\n');

  // 1. Authenticate as Admin
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@smartclassroom.ai', password: 'admin123' }),
  });
  const loginData = await loginRes.json();
  assert.strictEqual(loginRes.status, 200, 'Admin login failed');
  const token = loginData.token;
  console.log('✅ 1. Admin authenticated successfully');

  // 2. Register and enroll a test student
  const testDir = path.resolve(__dirname, '../../../ai-service');
  const singleFacePath = path.join(testDir, 'face_crop_0.jpg');
  assert(fs.existsSync(singleFacePath), 'face_crop_0.jpg must exist in ai-service');

  const rollNumber = `EVT-TEST-${Date.now()}`;
  const formData = new FormData();
  formData.append('fullName', 'Priya Patel');
  formData.append('rollNumber', rollNumber);
  formData.append('department', 'Information Technology');
  formData.append('semester', 4);
  formData.append('className', 'IT-B');
  formData.append('facePhotos', new Blob([fs.readFileSync(singleFacePath)], { type: 'image/jpeg' }), 'priya.jpg');

  const createRes = await fetch(`${BASE_URL}/students`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const createData = await createRes.json();
  assert.strictEqual(createRes.status, 201, 'Student creation failed');
  const studentId = createData.student._id;
  console.log(`✅ 2. Created test student: Priya Patel (${rollNumber})`);

  // Enroll face
  const enrollRes = await fetch(`${BASE_URL}/students/${studentId}/enroll`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const enrollData = await enrollRes.json();
  assert.strictEqual(enrollRes.status, 200, 'Face enrollment failed: ' + JSON.stringify(enrollData));
  console.log('✅ 3. Successfully enrolled biometrics for Priya Patel');

  // 3. Record a Recognition Event via POST /api/students/recognition-events
  const sessionId = `audit_session_${Date.now()}`;
  const recEventPayload = {
    sessionId,
    studentId,
    trackingId: 104,
    confidence: 0.892,
    bbox: { x: 120, y: 80, width: 140, height: 260 },
    status: 'recognized',
  };

  const postEventRes = await fetch(`${BASE_URL}/students/recognition-events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(recEventPayload),
  });
  const postEventData = await postEventRes.json();
  assert.strictEqual(postEventRes.status, 201, 'Failed to record recognition event');
  assert(postEventData.success, 'Event response success was false');
  assert.strictEqual(postEventData.event.trackingId, 104);
  assert.strictEqual(postEventData.event.confidence, 0.892);
  assert.strictEqual(postEventData.event.studentId.fullName, 'Priya Patel');
  assert.strictEqual(postEventData.event.studentId.rollNumber, rollNumber);
  console.log('✅ 4. Recorded recognition event in MongoDB with populated student details');

  // 4. Query Recognition Events via GET /api/students/recognition-events
  const queryRes = await fetch(`${BASE_URL}/students/recognition-events?sessionId=${sessionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const queryData = await queryRes.json();
  assert.strictEqual(queryRes.status, 200);
  assert(queryData.success);
  assert.strictEqual(queryData.count, 1);
  assert.strictEqual(queryData.events[0].sessionId, sessionId);
  assert.strictEqual(queryData.events[0].studentId.rollNumber, rollNumber);
  console.log('✅ 5. Queried recognition audit events by sessionId with populated student reference');

  // 5. Query with status filter
  const filterRes = await fetch(`${BASE_URL}/students/recognition-events?status=recognized&limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const filterData = await filterRes.json();
  assert.strictEqual(filterRes.status, 200);
  assert(filterData.count >= 1);
  console.log(`✅ 6. Filtered events by status 'recognized' returned ${filterData.count} record(s)`);

  console.log('\n🎉 ALL PHASE 5 RECOGNITION AUDIT EVENT TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch((err) => {
  console.error('❌ Phase 5 test failed:', err);
  process.exit(1);
});
