// Seed an active sprint + tasks into "Smoke Project" via the API so the
// data-routes (dashboard/backlog/roadmap/board) have real content.
// Run: node e2e/_smoke/seed.mjs
import { request } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';
const EMAIL = 'smoke1@projectflow.test';
const PW = 'SmokePass123!';
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();

const api = await request.newContext();
const login = await api.post(`${API}/auth/login`, { data: { email: EMAIL, password: PW } });
const token = (await login.json()).data.token;
const H = { Authorization: `Bearer ${token}` };

const wsRes = await api.get(`${API}/workspaces`, { headers: H });
const wsAll = (await wsRes.json()).data;
const ws = wsAll.find((w) => w.Name === 'Smoke WS') ?? wsAll[0];
const wsId = ws.Id;
console.log('WS:', wsId, ws.Name);

const projRes = await api.get(`${API}/projects?workspaceId=${wsId}`, { headers: H });
const projJson = await projRes.json();
const projects = Array.isArray(projJson) ? projJson : (projJson.data ?? projJson.projects ?? []);
console.log('PROJECTS RAW:', JSON.stringify(projects).slice(0, 300));
const proj = projects.find((p) => (p.Name || p.name) === 'Smoke Project') ?? projects[0];
const projId = proj.Id || proj.id;
console.log('PROJECT:', projId, proj.Name || proj.name);

const sprintRes = await api.post(`${API}/sprints`, { headers: H, data: { projectId: projId, name: 'Sprint 1', goal: 'Smoke sprint', startDate: iso(0), endDate: iso(14) } });
const sprint = (await sprintRes.json()).data;
const sprintId = sprint.Id || sprint.id;
console.log('SPRINT:', sprintRes.status(), sprintId);
const startRes = await api.post(`${API}/sprints/${sprintId}/start`, { headers: H, data: {} });
console.log('SPRINT START:', startRes.status());

const tasks = [
  { title: 'Design login screen', type: 'STORY', priority: 'HIGH', sprintId, dueDate: iso(7), storyPoints: 5 },
  { title: 'Fix board drag bug', type: 'BUG', priority: 'HIGHEST', sprintId, dueDate: iso(3), storyPoints: 3 },
  { title: 'Write API docs', type: 'TASK', priority: 'MEDIUM', sprintId, storyPoints: 2 },
  { title: 'Add dark mode', type: 'FEATURE', priority: 'LOW', dueDate: iso(20), storyPoints: 8 },
  { title: 'Refactor auth module', type: 'IMPROVEMENT', priority: 'MEDIUM', storyPoints: 5 },
  { title: 'Set up CI pipeline', type: 'TASK', priority: 'HIGH', sprintId, dueDate: iso(10), storyPoints: 3 },
];
for (const t of tasks) {
  const r = await api.post(`${API}/tasks`, { headers: H, data: { projectId: projId, workspaceId: wsId, ...t } });
  console.log(`TASK ${r.status()}: ${t.title}`);
}
console.log('DONE. wsId=' + wsId + ' projId=' + projId + ' sprintId=' + sprintId);
await api.dispose();
