(async () => {
  const base = 'http://localhost:5000';
  const creds = { email: 'superadmin@lms.com', password: 'SuperAdmin@123' };
  const fetch = global.fetch || (await import('node-fetch')).default;

  try {
    const loginRes = await fetch(`${base}/api/super-admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });
    const loginJson = await loginRes.json();
    if (!loginRes.ok) {
      console.error('Login failed', loginJson);
      process.exit(1);
    }
    const token = loginJson.accessToken;
    console.log('Logged in, token length:', String(token || '').length);

    // Create college
    const collegePayload = { name: 'Test College', code: `TC${Date.now()}`, location: 'Test City' };
    const colRes = await fetch(`${base}/api/superadmin/colleges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(collegePayload),
    });
    const colJson = await colRes.json();
    if (!colRes.ok) {
      console.error('Create college failed', colJson);
      process.exit(1);
    }
    console.log('Created college:', colJson.id || colJson);

    const collegeId = colJson.id;

    // Create student payload — ensure enrollNumber >= 3 chars
    const studentPayload = {
      fullName: 'Test Student',
      email: `teststudent+${Date.now()}@example.com`,
      enrollNumber: 'ENR123',
      collegeId,
      department: 'Computer Science',
    };

    const studRes = await fetch(`${base}/api/super-admin/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(studentPayload),
    });

    const studJson = await studRes.json();
    console.log('Create student status:', studRes.status, studJson);
  } catch (err) {
    console.error('Test script error', err);
    process.exit(1);
  }
})();