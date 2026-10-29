/**
 * Test Suite: CCTV Backend Controller, Security & SSRF Protection
 */

const { validateCameraUrl, maskUrlCredentials } = require('../utils/urlValidator');

const API_BASE = 'http://localhost:5000/api';

async function runTests() {
  console.log('============================================================');
  console.log('🧪 Starting CCTV Backend & Security Test Suite...');
  console.log('============================================================');

  // ──────────────────────────────────────────
  // 1. SSRF and URL Validator Unit Tests
  // ──────────────────────────────────────────
  console.log('\n[Step 1] Testing SSRF Prevention and Stream URL Validator...');

  // 1a. Unsupported protocol
  const ftpRes = validateCameraUrl('ftp://camera.local/live');
  assert(!ftpRes.isValid, 'Should reject FTP protocol');
  console.log('✅ 1a. Rejected unsupported scheme: ftp://');

  // 1b. Cloud metadata IP (AWS/GCP/Azure)
  const ssrfRes = validateCameraUrl('http://169.254.169.254/latest/meta-data');
  assert(!ssrfRes.isValid, 'Should block 169.254.169.254 metadata address');
  console.log('✅ 1b. Blocked AWS/GCP metadata service (169.254.169.254)');

  // 1c. Internal database port
  const dbPortRes = validateCameraUrl('rtsp://192.168.1.50:27017/feed');
  assert(!dbPortRes.isValid, 'Should block MongoDB port 27017');
  console.log('✅ 1c. Blocked dangerous internal database port (27017)');

  // 1d. Valid RTSP URL with embedded credentials
  const validRtsp = validateCameraUrl('rtsp://admin:secretPass123@192.168.1.105:554/ch0/main');
  assert(validRtsp.isValid, 'Should accept valid RTSP URL');
  assert(validRtsp.parsed.username === 'admin', 'Should extract username');
  assert(validRtsp.parsed.password === 'secretPass123', 'Should extract password');
  assert(!validRtsp.parsed.sanitizedUrl.includes('secretPass123'), 'Sanitized URL must mask password');
  assert(validRtsp.parsed.sanitizedUrl.includes(':******@'), 'Sanitized URL must show masked asterisks');
  console.log(`✅ 1d. Sanitized credentials properly: ${validRtsp.parsed.sanitizedUrl}`);

  // ──────────────────────────────────────────
  // 2. Authenticate as Admin
  // ──────────────────────────────────────────
  console.log('\n[Step 2] Authenticating as Admin...');
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@smartclassroom.ai', password: 'admin123' }),
  });
  const loginData = await loginRes.json();
  assert(loginData.success && loginData.token, 'Login failed');
  const token = loginData.token;
  console.log('✅ Admin authenticated successfully.');

  // ──────────────────────────────────────────
  // 3. Create CCTV Camera Session
  // ──────────────────────────────────────────
  console.log('\n[Step 3] Creating CCTV Camera Session with credentials...');
  const createRes = await fetch(`${API_BASE}/cameras`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: 'Classroom Back Wall CCTV',
      type: 'cctv',
      rtspUrl: 'rtsp://security_user:p@ssword999@192.168.1.200:554/h264',
      fps: 15,
    }),
  });

  const createData = await createRes.json();
  assert(createRes.status === 201, `Create camera failed: ${JSON.stringify(createData)}`);
  const session = createData.session;
  console.log(`✅ Camera session created: ID=${session.sessionId} | Type=${session.type}`);

  // 3a. Verify credentials were NOT leaked in response
  const rawString = JSON.stringify(createData);
  assert(!rawString.includes('p@ssword999'), 'Raw password must NEVER be exposed in JSON response');
  assert(session.sanitizedUrl.includes(':******@'), 'Sanitized URL must contain asterisks in response');
  console.log(`✅ Verified credential confidentiality: ${session.sanitizedUrl}`);

  // ──────────────────────────────────────────
  // 4. Test Stream Probing Endpoint
  // ──────────────────────────────────────────
  console.log('\n[Step 4] Testing stream probe endpoint on offline stream...');
  const probeRes = await fetch(`${API_BASE}/cameras/test-stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      rtspUrl: 'rtsp://admin:pass@192.0.2.25:554/stream1',
    }),
  });

  const probeData = await probeRes.json();
  console.log('  • Probe response status:', probeRes.status, JSON.stringify(probeData));
  assert(probeData.success === true, 'Test stream request should complete');
  assert(probeData.reachable === false, 'Probe against 192.0.2.25 should report unreachable');
  console.log(`✅ Stream probe diagnosed correctly: reachable=${probeData.reachable} (${probeData.error || probeData.message})`);

  // ──────────────────────────────────────────
  // 5. Query Camera Session by ID
  // ──────────────────────────────────────────
  console.log('\n[Step 5] Querying CCTV session via GET /api/cameras/:sessionId...');
  const getRes = await fetch(`${API_BASE}/cameras/${session.sessionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const getData = await getRes.json();
  assert(getData.success === true, 'Get session failed');
  assert(getData.session.type === 'cctv', 'Type must be cctv');
  assert(!JSON.stringify(getData).includes('p@ssword999'), 'Queried session must not expose password');
  console.log('✅ Queried session successfully verified with zero credential leakage.');

  // ──────────────────────────────────────────
  // 6. Delete Camera Session and Clean Up
  // ──────────────────────────────────────────
  console.log('\n[Step 6] Deleting CCTV camera session...');
  const delRes = await fetch(`${API_BASE}/cameras/${session.sessionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  const delData = await delRes.json();
  assert(delRes.status === 200, 'Delete session failed');
  console.log('✅ CCTV camera session deleted successfully.');

  console.log('\n============================================================');
  console.log('🎉 ALL CCTV BACKEND & SECURITY TESTS PASSED!');
  console.log('============================================================\n');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
