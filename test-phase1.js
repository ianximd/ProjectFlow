const http = require('http');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload ? Buffer.byteLength(payload) : 0,
        ...(options.headers || {}),
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const base = { hostname: 'localhost', port: 3001 };

  // 1. Login
  const login = await request({ ...base, path: '/api/v1/auth/login', method: 'POST' },
    { email: 'test@projectflow.app', password: 'testpassword123' });
  const token = login.body.data?.token;
  console.log(`Login: ${login.status} ${token ? '✓ Got JWT' : '✗ No token'}`);
  if (!token) process.exit(1);

  const auth = { Authorization: `Bearer ${token}` };

  // 2. Create Workspace
  const ws = await request({ ...base, path: '/api/v1/workspaces', method: 'POST', headers: auth },
    { name: 'Test Corp', slug: `test-corp-${Date.now()}` });
  console.log(`Create Workspace: ${ws.status} ${ws.body.data?.Name || JSON.stringify(ws.body.error)}`);
  const workspaceId = ws.body.data?.Id;

  // 3. Create Project
  const proj = await request({ ...base, path: '/api/v1/projects', method: 'POST', headers: auth },
    { workspaceId, name: 'Alpha App', key: `ALPHA${Date.now().toString().slice(-4)}`, type: 'SCRUM' });
  console.log(`Create Project: ${proj.status} ${proj.body.data?.Name || JSON.stringify(proj.body.error)}`);
  const projectId = proj.body.data?.Id;

  // 4. List workspaces
  const wsList = await request({ ...base, path: '/api/v1/workspaces', method: 'GET', headers: auth });
  console.log(`List Workspaces: ${wsList.status} count=${wsList.body.data?.length}`);

  // 5. List projects
  const projList = await request({ ...base, path: `/api/v1/projects?workspaceId=${workspaceId}`, method: 'GET', headers: auth });
  console.log(`List Projects: ${projList.status} count=${projList.body.data?.length}`);

  // 6. Create Sprint
  const sprint = await request({ ...base, path: '/api/v1/sprints', method: 'POST', headers: auth },
    { projectId, name: 'Sprint 1', goal: 'Ship MVP', startDate: new Date().toISOString(), endDate: new Date(Date.now() + 7*86400000).toISOString() });
  console.log(`Create Sprint: ${sprint.status} ${sprint.body.data?.Name || JSON.stringify(sprint.body.error)}`);
  const sprintId = sprint.body.data?.Id;

  // 7. Start Sprint
  const started = await request({ ...base, path: `/api/v1/sprints/${sprintId}/start`, method: 'POST', headers: auth });
  console.log(`Start Sprint: ${started.status} Status=${started.body.data?.Status || JSON.stringify(started.body.error)}`);

  // 8. Complete Sprint
  const completed = await request({ ...base, path: `/api/v1/sprints/${sprintId}/complete`, method: 'POST', headers: auth });
  console.log(`Complete Sprint: ${completed.status} Status=${completed.body.data?.Status || JSON.stringify(completed.body.error)}`);

  console.log('\n✅ Phase 1 backend E2E test complete!');
}

main().catch(console.error);
