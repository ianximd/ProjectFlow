'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import styles from './AutomationRuleBuilder.module.css';
import type {
  AutomationRule,
  AutomationTriggerType,
  AutomationActionType,
  AutomationTriggerConfig,
  AutomationCondition,
  AutomationAction,
} from '@projectflow/types';

// ── helpers ──────────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<AutomationTriggerType, string> = {
  ISSUE_CREATED:        'Issue Created',
  ISSUE_UPDATED:        'Issue Updated',
  ISSUE_TRANSITIONED:   'Issue Transitioned',
  SPRINT_STARTED:       'Sprint Started',
  SPRINT_COMPLETED:     'Sprint Completed',
  DUE_DATE_APPROACHING: 'Due Date Approaching',
  SCHEDULED:            'Scheduled (cron)',
  MANUAL:               'Manual / API trigger',
  WEBHOOK:              'Incoming Webhook',
};

const ACTION_LABELS: Record<AutomationActionType, string> = {
  TRANSITION_ISSUE:   'Transition Issue',
  ASSIGN_ISSUE:       'Assign Issue',
  UNASSIGN_ISSUE:     'Unassign Issue',
  SET_PRIORITY:       'Set Priority',
  ADD_COMMENT:        'Add Comment',
  SEND_NOTIFICATION:  'Send Notification',
  TRIGGER_WEBHOOK:    'Trigger Webhook',
};

const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

// ── fetch helpers ─────────────────────────────────────────────────────────────

async function apiReq<T>(path: string, opts: RequestInit, token: string): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${token}`,
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || res.statusText);
  }
  return res.json();
}

// ── sub-components ────────────────────────────────────────────────────────────

interface TriggerEditorProps {
  trigger: AutomationTriggerConfig;
  onChange: (t: AutomationTriggerConfig) => void;
}
function TriggerEditor({ trigger, onChange }: TriggerEditorProps) {
  return (
    <div className={styles.section}>
      <label className={styles.label}>Trigger</label>
      <select
        className={styles.select}
        value={trigger.type}
        onChange={e => onChange({ ...trigger, type: e.target.value as AutomationTriggerType })}
      >
        {(Object.keys(TRIGGER_LABELS) as AutomationTriggerType[]).map(t => (
          <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
        ))}
      </select>

      {trigger.type === 'ISSUE_TRANSITIONED' && (
        <input
          className={styles.input}
          placeholder="Only when transitioning to status (optional)"
          value={trigger.toStatus ?? ''}
          onChange={e => onChange({ ...trigger, toStatus: e.target.value || undefined })}
        />
      )}
      {trigger.type === 'DUE_DATE_APPROACHING' && (
        <input
          className={styles.input}
          type="number"
          placeholder="Hours before due date"
          value={trigger.hoursBeforeDue ?? ''}
          onChange={e => onChange({ ...trigger, hoursBeforeDue: Number(e.target.value) || undefined })}
        />
      )}
      {trigger.type === 'SCHEDULED' && (
        <input
          className={styles.input}
          placeholder="Cron expression, e.g. 0 9 * * 1"
          value={trigger.cron ?? ''}
          onChange={e => onChange({ ...trigger, cron: e.target.value || undefined })}
        />
      )}
    </div>
  );
}

interface ConditionListProps {
  conditions: AutomationCondition[];
  onChange:   (c: AutomationCondition[]) => void;
}
function ConditionList({ conditions, onChange }: ConditionListProps) {
  const add = () =>
    onChange([...conditions, { type: 'FIELD_EQUALS', field: 'priority', value: 'HIGH' }]);
  const remove = (i: number) => onChange(conditions.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<AutomationCondition>) =>
    onChange(conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <label className={styles.label}>Conditions <span className={styles.hint}>(all must match)</span></label>
        <button className={styles.addBtn} onClick={add}>+ Add</button>
      </div>
      {conditions.length === 0 && <p className={styles.empty}>No conditions — rule fires for all events.</p>}
      {conditions.map((cond, i) => (
        <div key={i} className={styles.conditionRow}>
          <select
            className={styles.selectSm}
            value={cond.type}
            onChange={e => update(i, { type: e.target.value as any })}
          >
            <option value="FIELD_EQUALS">Field equals</option>
            <option value="FIELD_NOT_EQUALS">Field not equals</option>
            <option value="IN_SPRINT">In sprint</option>
            <option value="NOT_IN_SPRINT">Not in sprint</option>
          </select>
          {(cond.type === 'FIELD_EQUALS' || cond.type === 'FIELD_NOT_EQUALS') && (
            <>
              <input
                className={styles.inputSm}
                placeholder="field"
                value={cond.field ?? ''}
                onChange={e => update(i, { field: e.target.value })}
              />
              <input
                className={styles.inputSm}
                placeholder="value"
                value={cond.value ?? ''}
                onChange={e => update(i, { value: e.target.value })}
              />
            </>
          )}
          <button className={styles.removeBtn} onClick={() => remove(i)}>✕</button>
        </div>
      ))}
    </div>
  );
}

interface ActionListProps {
  actions:  AutomationAction[];
  onChange: (a: AutomationAction[]) => void;
}
function ActionList({ actions, onChange }: ActionListProps) {
  const add = () => onChange([...actions, { type: 'SEND_NOTIFICATION', message: '' }]);
  const remove = (i: number) => onChange(actions.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<AutomationAction>) =>
    onChange(actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <label className={styles.label}>Actions</label>
        <button className={styles.addBtn} onClick={add}>+ Add</button>
      </div>
      {actions.length === 0 && <p className={styles.empty}>Add at least one action.</p>}
      {actions.map((action, i) => (
        <div key={i} className={styles.actionCard}>
          <div className={styles.actionHeader}>
            <select
              className={styles.selectSm}
              value={action.type}
              onChange={e => update(i, { type: e.target.value as AutomationActionType })}
            >
              {(Object.keys(ACTION_LABELS) as AutomationActionType[]).map(t => (
                <option key={t} value={t}>{ACTION_LABELS[t]}</option>
              ))}
            </select>
            <button className={styles.removeBtn} onClick={() => remove(i)}>✕</button>
          </div>

          {action.type === 'TRANSITION_ISSUE' && (
            <input
              className={styles.inputSm}
              placeholder="Target status name"
              value={action.toStatus ?? ''}
              onChange={e => update(i, { toStatus: e.target.value })}
            />
          )}
          {action.type === 'ASSIGN_ISSUE' && (
            <input
              className={styles.inputSm}
              placeholder="User ID or REPORTER"
              value={action.assigneeId ?? ''}
              onChange={e => update(i, { assigneeId: e.target.value })}
            />
          )}
          {action.type === 'SET_PRIORITY' && (
            <select
              className={styles.selectSm}
              value={action.priority ?? 'MEDIUM'}
              onChange={e => update(i, { priority: e.target.value })}
            >
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {(action.type === 'ADD_COMMENT' || action.type === 'SEND_NOTIFICATION') && (
            <textarea
              className={styles.textarea}
              placeholder="Message"
              value={action.message ?? ''}
              onChange={e => update(i, { message: e.target.value })}
            />
          )}
          {action.type === 'TRIGGER_WEBHOOK' && (
            <input
              className={styles.inputSm}
              placeholder="https://hooks.example.com/..."
              value={action.webhookUrl ?? ''}
              onChange={e => update(i, { webhookUrl: e.target.value })}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
}

const defaultTrigger: AutomationTriggerConfig = { type: 'ISSUE_CREATED' };

export default function AutomationRuleBuilder({ projectId }: Props) {
  const token = useStore(s => s.accessToken) ?? '';
  const qc    = useQueryClient();

  // ── list ──
  const { data, isLoading } = useQuery({
    queryKey: ['automations', projectId],
    queryFn:  () =>
      apiReq<{ rules: AutomationRule[] }>(`/api/v1/automations?projectId=${projectId}`, {}, token)
        .then(r => r.rules),
    enabled: Boolean(projectId && token),
  });

  // ── form state ──
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [name,       setName]       = useState('');
  const [trigger,    setTrigger]    = useState<AutomationTriggerConfig>(defaultTrigger);
  const [conditions, setConditions] = useState<AutomationCondition[]>([]);
  const [actions,    setActions]    = useState<AutomationAction[]>([]);

  function openNew() {
    setEditing(null);
    setName('');
    setTrigger(defaultTrigger);
    setConditions([]);
    setActions([]);
    setCreating(true);
  }

  function openEdit(rule: AutomationRule) {
    setEditing(rule);
    setName(rule.name);
    setTrigger(rule.trigger);
    setConditions(rule.conditions);
    setActions(rule.actions);
    setCreating(true);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automations', projectId] });

  // ── mutations ──
  const createMutation = useMutation({
    mutationFn: () =>
      apiReq('/api/v1/automations', {
        method: 'POST',
        body:   JSON.stringify({ projectId, name, trigger, conditions, actions }),
      }, token),
    onSuccess: () => { invalidate(); closeForm(); },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      apiReq(`/api/v1/automations/${editing!.id}`, {
        method: 'PATCH',
        body:   JSON.stringify({ name, trigger, conditions, actions }),
      }, token),
    onSuccess: () => { invalidate(); closeForm(); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiReq(`/api/v1/automations/${id}/toggle`, {
        method: 'POST',
        body:   JSON.stringify({ isEnabled: enabled }),
      }, token),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiReq(`/api/v1/automations/${id}`, { method: 'DELETE' }, token),
    onSuccess: invalidate,
  });

  const isBusy = createMutation.isPending || updateMutation.isPending;

  function handleSave() {
    if (!name.trim() || actions.length === 0) return;
    if (editing) updateMutation.mutate();
    else         createMutation.mutate();
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.root}>
      {/* rule list */}
      <div className={styles.listPanel}>
        <div className={styles.listHeader}>
          <h2 className={styles.title}>Automation Rules</h2>
          <button className={styles.primaryBtn} onClick={openNew}>+ New Rule</button>
        </div>

        {isLoading && <p className={styles.empty}>Loading…</p>}

        {!isLoading && (!data || data.length === 0) && (
          <div className={styles.emptyState}>
            <p>No rules yet.</p>
            <p className={styles.hint}>Automate repetitive tasks — transition issues, assign owners, send notifications.</p>
          </div>
        )}

        {data?.map(rule => (
          <div key={rule.id} className={styles.ruleCard}>
            <div className={styles.ruleInfo}>
              <span className={styles.ruleName}>{rule.name}</span>
              <span className={styles.ruleMeta}>
                {TRIGGER_LABELS[rule.trigger.type]} · {rule.actions.length} action{rule.actions.length !== 1 ? 's' : ''} · {rule.executionCount} runs
              </span>
            </div>
            <div className={styles.ruleActions}>
              <button
                className={rule.isEnabled ? styles.toggleOn : styles.toggleOff}
                onClick={() => toggleMutation.mutate({ id: rule.id, enabled: !rule.isEnabled })}
                title={rule.isEnabled ? 'Disable' : 'Enable'}
              >
                {rule.isEnabled ? 'ON' : 'OFF'}
              </button>
              <button className={styles.editBtn} onClick={() => openEdit(rule)}>Edit</button>
              <button
                className={styles.deleteBtn}
                onClick={() => deleteMutation.mutate(rule.id)}
                disabled={deleteMutation.isPending}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* slide-over form */}
      {creating && (
        <div className={styles.overlay} onClick={closeForm}>
          <aside className={styles.drawer} onClick={e => e.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <h3 className={styles.drawerTitle}>{editing ? 'Edit Rule' : 'New Automation Rule'}</h3>
              <button className={styles.closeBtn} onClick={closeForm}>✕</button>
            </div>

            <div className={styles.drawerBody}>
              <div className={styles.section}>
                <label className={styles.label}>Rule Name</label>
                <input
                  className={styles.input}
                  placeholder="e.g. Auto-assign high priority issues"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>

              <TriggerEditor   trigger={trigger}       onChange={setTrigger} />
              <ConditionList   conditions={conditions} onChange={setConditions} />
              <ActionList      actions={actions}       onChange={setActions} />
            </div>

            <div className={styles.drawerFooter}>
              <button className={styles.cancelBtn} onClick={closeForm}>Cancel</button>
              <button
                className={styles.primaryBtn}
                onClick={handleSave}
                disabled={isBusy || !name.trim() || actions.length === 0}
              >
                {isBusy ? 'Saving…' : editing ? 'Update Rule' : 'Create Rule'}
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
