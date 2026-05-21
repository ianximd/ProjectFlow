// Seed extras for remaining mutations: a 2nd (started) sprint for the
// dashboard sprint-switch, and a 2nd registered user for the member invite.
// Run: node e2e/_smoke/seed2.mjs
import { request } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';
const iso = (d) => new Date(Date.now() + d * 86400000).toISOString();
const PROJ = 'B27C1E9E-DAC1-41F1-8F82-109031C87007';

const api = await request.newContext();
const login = await api.post(`${API}/auth/login`, { data: { email: 'smoke1@projectflow.test', password: 'SmokePass123!' } });
const token = (await login.json()).data.token;
const H = { Authorization: `Bearer ${token}` };

const s = await api.post(`${API}/sprints`, { headers: H, data: { projectId: PROJ, name: 'Sprint 2', goal: 'second sprint', startDate: iso(15), endDate: iso(29) } });
const sj = await s.json();
const sid = sj.data?.Id || sj.data?.id;
console.log('Sprint 2:', s.status(), sid);
const st = await api.post(`${API}/sprints/${sid}/start`, { headers: H, data: {} });
console.log('Sprint 2 start:', st.status());

const reg = await api.post(`${API}/auth/register`, { data: { email: 'smoke2@projectflow.test', name: 'Smoke Two', password: 'SmokePass123!' } });
console.log('Register smoke2:', reg.status());
await api.dispose();
