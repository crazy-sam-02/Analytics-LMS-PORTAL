(async () => {
  const baseUrl = process.env.BASE_URL || 'http://localhost:5002';
  const results = [];
  const log = (name, ok, status, body) => {
    results.push({ name, ok, status, body });
    console.log(`${ok ? '✓' : '✗'} ${name} -> ${status}`);
    if (!ok && body) console.log('  Body:', JSON.stringify(body).slice(0, 500));
  };

  try {
    // SuperAdmin login
    const loginRes = await fetch(`${baseUrl}/api/super-admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'superadmin@lms.com', password: 'SuperAdmin@123' }),
    });
    const loginJson = await loginRes.json().catch(() => null);
    log('POST /api/super-admin/auth/login', loginRes.ok, loginRes.status, loginJson);

    const token = loginJson?.accessToken;
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

    // Endpoints to test (authenticated)
    const endpoints = [
      { name: 'GET /api/super-admin/colleges', path: '/api/super-admin/colleges' },
      { name: 'GET /api/super-admin/metrics', path: '/api/super-admin/metrics' },
      { name: 'GET /api/super-admin/metrics/summary', path: '/api/super-admin/metrics/summary' },
      { name: 'GET /api/super-admin/metrics/health', path: '/api/super-admin/metrics/health' },
    ];

    for (const ep of endpoints) {
      try {
        const r = await fetch(baseUrl + ep.path, { headers: { ...authHeaders } });
        const j = await r.json().catch(() => null);
        log(ep.name, r.ok, r.status, j);
      } catch (err) {
        console.error('Error calling', ep.path, err.message);
        log(ep.name, false, 'ERR', { message: err.message });
      }
    }

    // A public or unauthenticated endpoint if exists
    try {
      const r = await fetch(baseUrl + '/');
      const text = await r.text().catch(() => null);
      log('GET / (root)', r.ok, r.status, text && text.slice(0, 300));
    } catch (err) {
      log('GET / (root)', false, 'ERR', { message: err.message });
    }

  } catch (err) {
    console.error('Smoke test failed', err);
  }

  console.log('\nSummary:');
  results.forEach((r) => console.log(`${r.ok ? 'OK ' : 'FAIL'} ${r.name} => ${r.status}`));

  const failed = results.filter((r) => !r.ok);
  process.exit(failed.length === 0 ? 0 : 2);
})();
