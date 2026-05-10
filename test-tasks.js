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
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
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
  console.log('Login:', login.status);
  const token = login.body.data?.token;
  if (!token) { console.error('No token!', login.body); process.exit(1); }

  const auth = { Authorization: `Bearer ${token}` };

  // Fetch Workspace
  const wsList = await request({ ...base, path: '/api/v1/workspaces', method: 'GET', headers: auth });
  const workspaceId = wsList.body?.data?.[0]?.Id;
  if (!workspaceId) { console.error('No workspace found! Run test-phase1.js first.'); process.exit(1); }

  // Fetch Project
  const projList = await request({ ...base, path: `/api/v1/projects?workspaceId=${workspaceId}`, method: 'GET', headers: auth });
  const projectId = projList.body?.data?.[0]?.Id;
  if (!projectId) { console.error('No project found! Run test-phase1.js first.'); process.exit(1); }

  // 2. Create a task in "In Progress" column
  const create = await request({ ...base, path: '/api/v1/tasks', method: 'POST',
    headers: auth }, {
    title: 'Test task from full-stack',
    status: 'In Progress',
    projectId: projectId,
    workspaceId: workspaceId,
  });
  console.log('Create:', create.status, JSON.stringify(create.body?.data?.Title || create.body?.error));
  const taskId = create.body?.data?.Id;

  if (!taskId) { console.error('Create failed!'); process.exit(1); }

  // 3. List tasks
  const list = await request({ ...base, path: `/api/v1/tasks?projectId=${projectId}`,
    method: 'GET', headers: auth });
  console.log('List count:', list.body?.data?.length, '| Status:', list.status);

  // 4. Delete the task
  const del = await request({ ...base, path: `/api/v1/tasks/${taskId}`, method: 'DELETE',
    headers: auth });
  console.log('Delete:', del.status, del.body?.data?.DeletedAt ? '✓ SoftDeleted' : JSON.stringify(del.body));
}

main().catch(console.error);
