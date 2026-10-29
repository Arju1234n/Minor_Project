const assert = require('assert');
const fs = require('fs');
const path = require('path');

const BACKEND_URL = 'http://localhost:5000/api';
const AI_URL = 'http://localhost:8000';

async function testWorkflow() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('🧪 Testing End-to-End Live Person Identification Workflow');
  console.log('════════════════════════════════════════════════════════════════\n');

  // Step 1: Admin Login
  console.log('[Step 1] Authenticating as Admin...');
  const loginRes = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@smartclassroom.ai', password: 'admin123' }),
  });
  const loginData = await loginRes.json();
  assert.strictEqual(loginRes.status, 200, 'Login failed');
  const token = loginData.token;
  console.log('✅ Admin authenticated successfully.\n');

  // Clean up any previous test students with duplicate test embeddings
  const existingListRes = await fetch(`${BACKEND_URL}/students?limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const existingData = await existingListRes.json();
  for (const st of (existingData.students || [])) {
    if (st.rollNumber.startsWith('LIVE-') || st.rollNumber.startsWith('EVT-TEST-') || st.rollNumber.startsWith('MULTI-') || st.rollNumber.startsWith('VALID-') || st.rollNumber.startsWith('NOFACE-')) {
      await fetch(`${BACKEND_URL}/students/${st._id}?permanent=true`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  }
  // Sync clean gallery
  await fetch(`${BACKEND_URL}/students/sync-gallery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  // Step 2: Register student with name, roll, class, face photo & autoEnroll
  console.log('[Step 2] Registering student with photo and autoEnroll=true...');
  const testDir = path.resolve(__dirname, '../../../ai-service');
  const singleFacePath = path.join(testDir, 'face_crop_0.jpg');
  assert(fs.existsSync(singleFacePath), 'face_crop_0.jpg missing');

  const testRoll = `LIVE-${Date.now()}`;
  const formData = new FormData();
  formData.append('fullName', 'Live Test Student');
  formData.append('rollNumber', testRoll);
  formData.append('department', 'Computer Science & Engineering');
  formData.append('semester', 6);
  formData.append('className', 'CSE-A');
  formData.append('autoEnroll', 'true');
  formData.append('facePhotos', new Blob([fs.readFileSync(singleFacePath)], { type: 'image/jpeg' }), 'portrait.jpg');

  const regRes = await fetch(`${BACKEND_URL}/students`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const regData = await regRes.json();
  assert.strictEqual(regRes.status, 201, `Registration failed: ${JSON.stringify(regData)}`);
  assert.strictEqual(regData.success, true);
  assert.strictEqual(regData.enrolled, true);
  assert.strictEqual(regData.gallerySynced, true);
  assert.strictEqual(regData.student.enrollmentStatus, 'enrolled');
  const studentId = regData.student._id;
  console.log(`✅ Student registered & enrolled: ${regData.student.fullName} (${regData.student.rollNumber})`);
  console.log(`   Enrollment status: ${regData.student.enrollmentStatus}`);
  console.log(`   Gallery synchronized: ${regData.gallerySynced}\n`);

  // Step 3: Verify embeddings in MongoDB
  console.log('[Step 3] Verifying ArcFace embeddings saved in MongoDB...');
  const enrollRes = await fetch(`${BACKEND_URL}/students/${studentId}/enrollment`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const enrollData = await enrollRes.json();
  assert.strictEqual(enrollRes.status, 200);
  assert.strictEqual(enrollData.enrolledFaceCount, 1);
  assert.strictEqual(enrollData.embeddings[0].modelName, 'SFace-ArcFace');
  console.log(`✅ Embedding confirmed: Model=${enrollData.embeddings[0].modelName}, Quality=${enrollData.embeddings[0].qualityScore}\n`);

  // Step 4: Verify AI Microservice Gallery has student loaded
  console.log('[Step 4] Checking AI microservice vector gallery status...');
  const galleryRes = await fetch(`${AI_URL}/api/ai/gallery-status`);
  const galleryData = await galleryRes.json();
  assert(galleryData.enrolled_students_count >= 1, 'Expected at least 1 student in vector gallery');
  console.log(`✅ AI Gallery Status: ${galleryData.enrolled_students_count} student(s) loaded, ${galleryData.total_embeddings_count} embedding(s).\n`);

  // Step 5: Test live frame recognition with enrolled student
  console.log('[Step 5] Testing Person Identification on classroom frame...');
  const samplePath = path.join(testDir, 'sample_classroom_test.jpg');
  const imgBytes = fs.readFileSync(samplePath);
  const base64Img = 'data:image/jpeg;base64,' + imgBytes.toString('base64');

  const detectRes = await fetch(`${AI_URL}/api/ai/detect-frame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: base64Img,
      session_id: 'live_test_session',
      conf_threshold: 0.35,
      enable_tracking: true,
    }),
  });
  const detectData = await detectRes.json();
  assert.strictEqual(detectRes.status, 200);
  assert.strictEqual(detectData.success, true);
  assert(detectData.people_count >= 2, `Expected multiple people in test frame, got ${detectData.people_count}`);
  console.log(`✅ Detected ${detectData.people_count} people in frame.`);

  detectData.detections.forEach((d, idx) => {
    console.log(`   Person #${idx + 1}: Track #${d.tracking_id} | Class=${d.class} | Status=${d.identity_status} | Label=${d.label}`);
    assert(d.label, 'Missing label');
    assert(d.identity_status, 'Missing identity_status');
    assert(typeof d.tracking_id === 'number', 'tracking_id must be a number distinct from name');
  });

  // Step 6: Test recognition on direct crop of enrolled student vs unknown person
  console.log('\n[Step 6] Testing direct recognition of enrolled student crop vs unknown crop...');
  const recStudentRes = await fetch(`${AI_URL}/api/ai/recognize-face`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_path: singleFacePath }),
  });
  const recStudentData = await recStudentRes.json();
  assert.strictEqual(recStudentData.status, 'recognized');
  assert.strictEqual(recStudentData.student_id, studentId.toString());
  assert.strictEqual(recStudentData.roll_number, testRoll);
  assert.strictEqual(recStudentData.full_name, 'Live Test Student');
  console.log(`✅ Enrolled student correctly identified: "${recStudentData.label}" (Confidence: ${recStudentData.score})`);

  // Unknown person: face_crop_1 (not enrolled)
  const unknownPath = path.join(testDir, 'face_crop_1.jpg');
  const recUnkRes = await fetch(`${AI_URL}/api/ai/recognize-face`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_path: unknownPath }),
  });
  const recUnkData = await recUnkRes.json();
  assert.strictEqual(recUnkData.status, 'unknown');
  assert.strictEqual(recUnkData.label, 'Unknown');
  assert.strictEqual(recUnkData.student_id, null);
  console.log(`✅ Unenrolled face correctly identified as: "${recUnkData.label}" (Score: ${recUnkData.score})`);

  // Step 7: Multi-person frame with enrolled student + unknown people
  console.log('\n[Step 7] Testing multi-person classroom frame with enrolled student + unknown people...');
  const { execFileSync } = require('child_process');
  const pythonCode = [
    'import cv2, base64',
    `base = cv2.imread("${samplePath}")`,
    `face = cv2.imread("${singleFacePath}")`,
    'target_w, target_h = 100, 100',
    'face_resized = cv2.resize(face, (target_w, target_h))',
    'base[400:400+target_h, 90:90+target_w] = face_resized',
    '_, enc = cv2.imencode(".jpg", base)',
    'print("data:image/jpeg;base64," + base64.b64encode(enc.tobytes()).decode("utf-8"))',
  ].join('\n');

  const compositeB64 = execFileSync(path.join(testDir, '.venv/bin/python'), ['-c', pythonCode]).toString().trim();

  const multiSessionId = `multi_person_eval_${Date.now()}`;
  const multiDetectRes = await fetch(`${AI_URL}/api/ai/detect-frame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: compositeB64,
      session_id: multiSessionId,
      conf_threshold: 0.35,
      enable_tracking: true,
    }),
  });
  const multiDetectData = await multiDetectRes.json();
  assert.strictEqual(multiDetectData.success, true);
  console.log(`✅ Multi-person frame processed: ${multiDetectData.people_count} people detected in frame.`);
  console.log(`   Recognized: ${multiDetectData.recognized_count}, Unrecognized: ${multiDetectData.unrecognized_count}`);
  console.log('   Recognized students payload:', JSON.stringify(multiDetectData.recognized_students));

  const foundStudent = multiDetectData.recognized_students.find((s) => s.student_id === studentId.toString() || s.roll_number === testRoll);
  assert(foundStudent, 'Enrolled student should be present in recognized_students');
  assert.strictEqual(foundStudent.roll_number, testRoll);
  assert.strictEqual(foundStudent.full_name, 'Live Test Student');
  console.log(`✅ Enrolled student successfully recognized in live multi-person scene: "${foundStudent.full_name}" (Roll: ${foundStudent.roll_number}, Track: #${foundStudent.tracking_id})`);

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL LIVE PERSON IDENTIFICATION WORKFLOW TESTS PASSED!');
  console.log('════════════════════════════════════════════════════════════════\n');
}

testWorkflow().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
