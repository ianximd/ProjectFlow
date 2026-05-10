'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BurndownChart }           from '@/components/charts/BurndownChart';
import { VelocityChart }           from '@/components/charts/VelocityChart';
import { SprintSummaryWidget }     from '@/components/charts/SprintSummaryWidget';
import { WorkloadChart }           from '@/components/charts/WorkloadChart';
import { CreatedVsResolvedChart }  from '@/components/charts/CreatedVsResolvedChart';
import { useStore }                from '@/store/useStore';
import styles from './dashboard.module.css';
import type {
  BurndownReport,
  VelocityEntry,
  SprintSummaryReport,
  WorkloadEntry,
  CreatedVsResolvedEntry,
} from '@projectflow/types';

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000000';

async function apiFetch(path: string, token: string | null) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    credentials: 'include',
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Request failed');
  return json;
}

interface Project { id: string; name: string; key: string; }
interface Sprint  { id: string; name: string; }

export default function DashboardPage() {
  const router      = useRouter();
  const accessToken = useStore(s => s.accessToken);

  const [projectId, setProjectId] = useState('');
  const [sprintId,  setSprintId]  = useState('');

  // ── Projects ──────────────────────────────────────────────────
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects', WORKSPACE_ID, accessToken],
    queryFn:  async () => {
      const json = await apiFetch(`/api/v1/projects?workspaceId=${WORKSPACE_ID}`, accessToken);
      if (json.error) { router.push('/login'); return []; }
      const list: Project[] = json.data ?? [];
      if (list.length > 0 && !projectId) setProjectId(list[0].id);
      return list;
    },
  });

  // ── Sprints for selected project ───────────────────────────────
  const { data: sprints = [] } = useQuery<Sprint[]>({
    queryKey: ['sprints', projectId],
    enabled:  !!projectId,
    queryFn:  async () => {
      const json = await apiFetch(`/api/v1/sprints?projectId=${projectId}`, accessToken);
      const list: Sprint[] = json.data ?? [];
      if (list.length > 0 && !sprintId) setSprintId(list[0].id);
      return list;
    },
  });

  // ── Report queries ─────────────────────────────────────────────
  const { data: burndown, isLoading: loadingBd } = useQuery<BurndownReport | null>({
    queryKey: ['report-burndown', sprintId],
    enabled:  !!sprintId,
    queryFn:  async () => {
      const json = await apiFetch(`/api/v1/reports/burndown?sprintId=${sprintId}`, accessToken);
      return json.data ?? null;
    },
  });

  const { data: velocity = [], isLoading: loadingVel } = useQuery<VelocityEntry[]>({
    queryKey: ['report-velocity', projectId],
    enabled:  !!projectId,
    queryFn:  async () => {
      const json = await apiFetch(`/api/v1/reports/velocity?projectId=${projectId}&numSprints=6`, accessToken);
      return json.data ?? [];
    },
  });

  const { data: sprintSummary, isLoading: loadingSs } = useQuery<SprintSummaryReport | null>({
    queryKey: ['report-sprint-summary', sprintId],
    enabled:  !!sprintId,
    queryFn:  async () => {
      const json = await apiFetch(`/api/v1/reports/sprint-summary?sprintId=${sprintId}`, accessToken);
      return json.data ?? null;
    },
  });

  const { data: workload = [], isLoading: loadingWl } = useQuery<WorkloadEntry[]>({
    queryKey: ['report-workload', projectId],
    enabled:  !!projectId,
    queryFn:  async () => {
      const json = await apiFetch(`/api/v1/reports/workload?projectId=${projectId}`, accessToken);
      return json.data ?? [];
    },
  });

  const { data: cvr = [], isLoading: loadingCvr } = useQuery<CreatedVsResolvedEntry[]>({
    queryKey: ['report-cvr', projectId],
    enabled:  !!projectId,
    queryFn:  async () => {
      const json = await apiFetch(`/api/v1/reports/created-vs-resolved?projectId=${projectId}&weeks=8`, accessToken);
      return json.data ?? [];
    },
  });

  const selectedSprint = sprints.find(s => s.id === sprintId);

  return (
    <>
      <div className={styles.page}>
        {/* ── Header ── */}
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.headerIcon}>📊</span>
            <h1 className={styles.title}>Dashboard</h1>
          </div>

          <div className={styles.controls}>
            <select
              className={styles.select}
              value={projectId}
              onChange={e => { setProjectId(e.target.value); setSprintId(''); }}
            >
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.key})</option>
              ))}
            </select>

            <select
              className={styles.select}
              value={sprintId}
              onChange={e => setSprintId(e.target.value)}
              disabled={sprints.length === 0}
            >
              {sprints.length === 0 && <option>No sprints</option>}
              {sprints.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Gadget grid ── */}
        <div className={styles.content}>
          <div className={styles.grid}>

            {/* Burndown Chart */}
            <div className={styles.gadget}>
              <div className={styles.gadgetHeader}>
                <h3 className={styles.gadgetTitle}>
                  <span className={styles.gadgetIcon}>📉</span>
                  Burndown Chart
                </h3>
                {selectedSprint && (
                  <span className={styles.sprintBadge}>{selectedSprint.name}</span>
                )}
              </div>
              <div className={styles.gadgetBody}>
                {!sprintId ? (
                  <div className={styles.noSprint}>Select a sprint to view burndown</div>
                ) : loadingBd ? (
                  <div className={styles.placeholder}>Loading…</div>
                ) : burndown ? (
                  <BurndownChart data={burndown} />
                ) : (
                  <div className={styles.placeholder}>No data</div>
                )}
              </div>
            </div>

            {/* Sprint Summary */}
            <div className={styles.gadget}>
              <div className={styles.gadgetHeader}>
                <h3 className={styles.gadgetTitle}>
                  <span className={styles.gadgetIcon}>🗂</span>
                  Sprint Report
                </h3>
                {selectedSprint && (
                  <span className={styles.sprintBadge}>{selectedSprint.name}</span>
                )}
              </div>
              <div className={styles.gadgetBody}>
                {!sprintId ? (
                  <div className={styles.noSprint}>Select a sprint to view report</div>
                ) : loadingSs ? (
                  <div className={styles.placeholder}>Loading…</div>
                ) : sprintSummary ? (
                  <SprintSummaryWidget data={sprintSummary} />
                ) : (
                  <div className={styles.placeholder}>No data</div>
                )}
              </div>
            </div>

            {/* Velocity Chart — wide */}
            <div className={`${styles.gadget} ${styles.gadgetWide}`}>
              <div className={styles.gadgetHeader}>
                <h3 className={styles.gadgetTitle}>
                  <span className={styles.gadgetIcon}>⚡</span>
                  Velocity Chart
                </h3>
              </div>
              <div className={styles.gadgetBody}>
                {loadingVel ? (
                  <div className={styles.placeholder}>Loading…</div>
                ) : velocity.length === 0 ? (
                  <div className={styles.placeholder}>No completed sprints yet</div>
                ) : (
                  <VelocityChart data={velocity} />
                )}
              </div>
            </div>

            {/* Workload */}
            <div className={styles.gadget}>
              <div className={styles.gadgetHeader}>
                <h3 className={styles.gadgetTitle}>
                  <span className={styles.gadgetIcon}>👥</span>
                  Team Workload
                </h3>
              </div>
              <div className={styles.gadgetBody}>
                {loadingWl ? (
                  <div className={styles.placeholder}>Loading…</div>
                ) : workload.length === 0 ? (
                  <div className={styles.placeholder}>No assigned issues</div>
                ) : (
                  <WorkloadChart data={workload} />
                )}
              </div>
            </div>

            {/* Created vs Resolved */}
            <div className={styles.gadget}>
              <div className={styles.gadgetHeader}>
                <h3 className={styles.gadgetTitle}>
                  <span className={styles.gadgetIcon}>📈</span>
                  Created vs. Resolved
                </h3>
              </div>
              <div className={styles.gadgetBody}>
                {loadingCvr ? (
                  <div className={styles.placeholder}>Loading…</div>
                ) : cvr.length === 0 ? (
                  <div className={styles.placeholder}>No data for this period</div>
                ) : (
                  <CreatedVsResolvedChart data={cvr} />
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
