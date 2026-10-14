const assert = require('assert');

const BASE_URL = 'http://localhost:5000/api';

async function runTests() {
  console.log('🧪 Starting Phase 1: Student Registration & Database Models Test Suite...\n');

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

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // 2. Test Validation: Missing required fields
  const missingRes = await fetch(`${BASE_URL}/students`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ fullName: 'Incomplete Student' }),
  });
  const missingData = await missingRes.json();
  assert.strictEqual(missingRes.status, 400, 'Expected 400 for missing fields');
  assert.strictEqual(missingData.success, false);
  console.log('✅ 2. Missing fields rejected with 400:', missingData.message);

  // 3. Register Student A
  const testRollA = `TEST-ROLL-${Date.now()}`;
  const studentARes = await fetch(`${BASE_URL}/students`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      fullName: 'Aarav Sharma',
      rollNumber: testRollA,
      registrationNumber: `REG-${testRollA}`,
      department: 'Computer Science & Engineering',
      semester: 6,
      className: 'CSE-A',
    }),
  });
  const studentAData = await studentARes.json();
  assert.strictEqual(studentARes.status, 201, 'Student A registration failed');
  assert.strictEqual(studentAData.student.rollNumber, testRollA.toUpperCase());
  const studentAId = studentAData.student._id;
  console.log('✅ 3. Student registered successfully:', studentAData.student.fullName, `(${studentAData.student.rollNumber})`);

  // 4. Test Duplicate Roll Number Prevention
  const dupRes = await fetch(`${BASE_URL}/students`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      fullName: 'Another Student',
      rollNumber: testRollA.toLowerCase(), // case-insensitive check
      department: 'Information Technology',
      semester: 4,
      className: 'IT-B',
    }),
  });
  const dupData = await dupRes.json();
  assert.strictEqual(dupRes.status, 400, 'Expected 400 for duplicate roll');
  assert.strictEqual(dupData.success, false);
  console.log('✅ 4. Duplicate roll number prevented:', dupData.message);

  // 5. Test Query and Filter
  const listRes = await fetch(`${BASE_URL}/students?search=Aarav`, {
    headers: authHeaders,
  });
  const listData = await listRes.json();
  assert.strictEqual(listRes.status, 200, 'Student list failed');
  assert(listData.students.length > 0, 'Expected at least 1 student in search');
  console.log(`✅ 5. Search & filter returned ${listData.students.length} record(s), total in DB: ${listData.pagination.total}`);

  // 6. Test Update
  const updateRes = await fetch(`${BASE_URL}/students/${studentAId}`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      className: 'CSE-B',
      semester: 7,
    }),
  });
  const updateData = await updateRes.json();
  assert.strictEqual(updateRes.status, 200, 'Update failed');
  assert.strictEqual(updateData.student.className, 'CSE-B');
  assert.strictEqual(updateData.student.semester, 7);
  console.log('✅ 6. Student updated successfully to Class:', updateData.student.className, 'Sem:', updateData.student.semester);

  // 7. Test Status Toggle (active -> inactive -> active)
  const toggleRes = await fetch(`${BASE_URL}/students/${studentAId}/status`, {
    method: 'PATCH',
    headers: authHeaders,
  });
  const toggleData = await toggleRes.json();
  assert.strictEqual(toggleRes.status, 200);
  assert.strictEqual(toggleData.status, 'inactive');
  console.log('✅ 7. Student status toggled to:', toggleData.status);

  // 8. Test Soft-Delete / Deactivation
  const deleteRes = await fetch(`${BASE_URL}/students/${studentAId}`, {
    method: 'DELETE',
    headers: authHeaders,
  });
  const deleteData = await deleteRes.json();
  assert.strictEqual(deleteRes.status, 200);
  console.log('✅ 8. Student deactivated successfully:', deleteData.message);

  console.log('\n🎉 ALL PHASE 1 TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
