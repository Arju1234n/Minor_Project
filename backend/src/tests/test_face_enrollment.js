const assert = require('assert');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5000/api';

async function runTests() {
  console.log('🧪 Starting Phase 2: Face Enrollment & Embedding Storage Test Suite...\n');

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

  // Prepare test images in temp directory
  const testDir = path.resolve(__dirname, '../../../ai-service');
  const multiFacePath = path.join(testDir, 'sample_classroom_test.jpg');
  const singleFacePath = path.join(testDir, 'face_crop_0.jpg');

  assert(fs.existsSync(multiFacePath), 'sample_classroom_test.jpg must exist in ai-service');
  assert(fs.existsSync(singleFacePath), 'face_crop_0.jpg must exist in ai-service');

  const noFacePath = path.join(testDir, 'test_no_face_wall.jpg');
  if (!fs.existsSync(noFacePath)) {
    require('child_process').execSync(
      `"${path.join(testDir, '.venv/bin/python')}" -c "import cv2, numpy as np; img = np.zeros((300, 300, 3), dtype=np.uint8) + 128; cv2.imwrite('${noFacePath}', img)"`
    );
  }
  assert(fs.existsSync(noFacePath), 'test_no_face_wall.jpg must exist in ai-service');

  // 2. Test Single Face Requirement: Reject photo with NO FACE
  console.log('📝 Testing rejection of image with NO face...');
  const formDataNoFace = new FormData();
  formDataNoFace.append('fullName', 'No Face Student');
  formDataNoFace.append('rollNumber', `NOFACE-${Date.now()}`);
  formDataNoFace.append('department', 'Computer Science');
  formDataNoFace.append('semester', 6);
  formDataNoFace.append('className', 'CSE-A');
  formDataNoFace.append('facePhotos', new Blob([fs.readFileSync(noFacePath)], { type: 'image/jpeg' }), 'no_face.jpg');

  const regNoFaceRes = await fetch(`${BASE_URL}/students`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formDataNoFace,
  });
  const regNoFaceData = await regNoFaceRes.json();
  assert.strictEqual(regNoFaceRes.status, 201, 'Student creation failed');
  const noFaceStudentId = regNoFaceData.student._id;

  const enrollNoFaceRes = await fetch(`${BASE_URL}/students/${noFaceStudentId}/enroll`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const enrollNoFaceData = await enrollNoFaceRes.json();
  assert.strictEqual(enrollNoFaceRes.status, 400, 'Expected 400 rejection for no face');
  assert(enrollNoFaceData.errors[0].includes('No face detected') || enrollNoFaceData.errors[0].includes('could not be read'),
    'Expected no-face error message, got: ' + JSON.stringify(enrollNoFaceData.errors));
  console.log('✅ 2. Correctly rejected image with no detected face:', enrollNoFaceData.errors[0]);

  // 3. Test Multi-Face Rejection: Reject photo with MULTIPLE faces
  console.log('📝 Testing rejection of image with MULTIPLE faces...');
  const formDataMulti = new FormData();
  formDataMulti.append('fullName', 'Multi Face Student');
  formDataMulti.append('rollNumber', `MULTI-${Date.now()}`);
  formDataMulti.append('department', 'Computer Science');
  formDataMulti.append('semester', 6);
  formDataMulti.append('className', 'CSE-A');
  formDataMulti.append('facePhotos', new Blob([fs.readFileSync(multiFacePath)], { type: 'image/jpeg' }), 'classroom_multi.jpg');

  const regMultiRes = await fetch(`${BASE_URL}/students`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formDataMulti,
  });
  const regMultiData = await regMultiRes.json();
  const multiStudentId = regMultiData.student._id;

  const enrollMultiRes = await fetch(`${BASE_URL}/students/${multiStudentId}/enroll`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const enrollMultiData = await enrollMultiRes.json();
  assert.strictEqual(enrollMultiRes.status, 400, 'Expected 400 rejection for multiple faces');
  assert(enrollMultiData.errors[0].includes('Multiple faces'),
    'Expected multiple faces error message, got: ' + JSON.stringify(enrollMultiData.errors));
  console.log('✅ 3. Correctly rejected portrait containing multiple faces:', enrollMultiData.errors[0]);

  // 4. Test Valid Face Enrollment: Single Person Portrait
  console.log('📝 Testing successful enrollment of valid single-face portrait...');
  const formDataValid = new FormData();
  formDataValid.append('fullName', 'Devendra Yadav');
  formDataValid.append('rollNumber', `VALID-${Date.now()}`);
  formDataValid.append('department', 'Computer Science');
  formDataValid.append('semester', 6);
  formDataValid.append('className', 'CSE-A');
  formDataValid.append('facePhotos', new Blob([fs.readFileSync(singleFacePath)], { type: 'image/jpeg' }), 'single_portrait.jpg');

  const regValidRes = await fetch(`${BASE_URL}/students`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formDataValid,
  });
  const regValidData = await regValidRes.json();
  assert.strictEqual(regValidRes.status, 201);
  const validStudentId = regValidData.student._id;

  const enrollValidRes = await fetch(`${BASE_URL}/students/${validStudentId}/enroll`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const enrollValidData = await enrollValidRes.json();
  assert.strictEqual(enrollValidRes.status, 200, 'Face enrollment failed: ' + JSON.stringify(enrollValidData));
  assert.strictEqual(enrollValidData.enrolledCount, 1);
  assert.strictEqual(enrollValidData.student.enrollmentStatus, 'enrolled');
  console.log('✅ 4. Successfully enrolled 128-d ArcFace embedding for student:', enrollValidData.student.fullName);

  // 5. Verify Embeddings Stored in Database
  const getEnrollRes = await fetch(`${BASE_URL}/students/${validStudentId}/enrollment`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const getEnrollData = await getEnrollRes.json();
  assert.strictEqual(getEnrollRes.status, 200);
  assert.strictEqual(getEnrollData.enrolledFaceCount, 1);
  assert.strictEqual(getEnrollData.embeddings[0].modelName, 'SFace-ArcFace');
  console.log('✅ 5. Verified FaceEmbedding record in MongoDB with quality score:', getEnrollData.embeddings[0].qualityScore);

  // 6. Test Biometrics Wipe / Reset
  const wipeRes = await fetch(`${BASE_URL}/students/${validStudentId}/enrollment`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  const wipeData = await wipeRes.json();
  assert.strictEqual(wipeRes.status, 200);
  assert.strictEqual(wipeData.student.enrollmentStatus, 'pending');
  assert.strictEqual(wipeData.student.enrolledFaceCount, 0);
  console.log('✅ 6. Successfully wiped biometric embeddings for student:', wipeData.message);

  // Cleanup temp file
  try { fs.unlinkSync(noFacePath); } catch (_) {}

  console.log('\n🎉 ALL PHASE 2 FACE ENROLLMENT TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch((err) => {
  console.error('❌ Phase 2 test failed:', err);
  process.exit(1);
});
