'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { createForm, updateForm } from '@/server/actions/forms';
import { notifyActionError } from '@/lib/apiErrorToast';
import styles from './FormBuilder.module.css';
import type {
  Form, FormConfig, FormField, FormFieldType, FormBranchingRule, FormFieldMapping,
} from '@projectflow/types';

const FIELD_TYPES: FormFieldType[] = ['short_text', 'long_text', 'number', 'email', 'select', 'multiselect', 'checkbox', 'date'];

interface ListOption { id: string; name: string }
interface TemplateOption { id: string; name: string }

interface Props {
  workspaceId: string;
  scopeType: 'SPACE' | 'FOLDER' | 'LIST';
  scopeId: string;
  lists: ListOption[];
  templates: TemplateOption[];
  initial?: Form;
}

function uniqueKey(existing: FormField[], base: string): string {
  let k = base; let i = 1;
  while (existing.some((f) => f.key === k)) k = `${base}_${i++}`;
  return k;
}

export function FormBuilder({ workspaceId, scopeType, scopeId, lists, templates, initial }: Props) {
  const t = useTranslations('Forms');
  const [name, setName] = useState(initial?.name ?? '');
  const [fields, setFields] = useState<FormField[]>(initial?.config.fields ?? []);
  const [branching, setBranching] = useState<FormBranchingRule[]>(initial?.config.branching ?? []);
  const [targetListId, setTargetListId] = useState(initial?.targetListId ?? lists[0]?.id ?? '');
  const [mapping, setMapping] = useState<FormFieldMapping>(initial?.fieldMapping ?? {});
  const [templateId, setTemplateId] = useState<string | null>(initial?.templateId ?? null);
  const [isPublic, setIsPublic] = useState(initial?.isPublic ?? false);
  const [publicSlug, setPublicSlug] = useState(initial?.publicSlug ?? '');
  const [authRequired, setAuthRequired] = useState(initial?.authRequired ?? false);
  const [pending, start] = useTransition();

  const addField = (type: FormFieldType) =>
    setFields((prev) => [...prev, {
      key: uniqueKey(prev, type), label: t('newFieldLabel'), type, required: false,
      ...(type === 'select' || type === 'multiselect' ? { options: ['Option 1'] } : {}),
    }]);

  const patchField = (idx: number, patch: Partial<FormField>) =>
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  const removeField = (idx: number) => {
    const key = fields[idx].key;
    setFields((prev) => prev.filter((_, i) => i !== idx));
    setBranching((prev) => prev.filter((r) => r.fieldKey !== key && r.when.fieldKey !== key));
    setMapping((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };
  const move = (idx: number, dir: -1 | 1) => setFields((prev) => {
    const next = [...prev]; const j = idx + dir;
    if (j < 0 || j >= next.length) return prev;
    [next[idx], next[j]] = [next[j], next[idx]]; return next;
  });

  const addRule = () => {
    if (fields.length < 2) return;
    setBranching((prev) => [...prev, {
      fieldKey: fields[fields.length - 1].key, action: 'show',
      when: { fieldKey: fields[0].key, op: 'equals', value: '' },
    }]);
  };
  const patchRule = (idx: number, patch: Partial<FormBranchingRule>) =>
    setBranching((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const removeRule = (idx: number) => setBranching((prev) => prev.filter((_, i) => i !== idx));

  const setMap = (key: string, kind: 'task' | 'custom_field', target: string) =>
    setMapping((prev) => ({ ...prev, [key]: { kind, target } }));

  const onSave = () => start(async () => {
    const config: FormConfig = { fields, branching };
    const input = {
      workspaceId, scopeType, scopeId, name, config, targetListId, fieldMapping: mapping,
      templateId, isPublic, publicSlug: isPublic ? publicSlug : null, authRequired,
    };
    const r = initial
      ? await updateForm(initial.id, input)
      : await createForm(input);
    if (!r.ok) return notifyActionError(r);
  });

  // Earlier-than-idx field keys can be a branching CONDITION for a later field.
  const earlierKeys = (key: string) => {
    const idx = fields.findIndex((f) => f.key === key);
    return fields.slice(0, idx < 0 ? fields.length : idx).map((f) => f.key);
  };

  return (
    <div className={styles.root}>
      <input className={styles.nameInput} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('formName')} />

      <section className={styles.section}>
        <h3>{t('fields')}</h3>
        <div className={styles.palette}>
          {FIELD_TYPES.map((ft) => (
            <button key={ft} className={styles.paletteBtn} onClick={() => addField(ft)}>{t(`type.${ft}`)}</button>
          ))}
        </div>
        <ul className={styles.fieldList}>
          {fields.map((f, idx) => (
            <li key={f.key} className={styles.fieldRow} data-field-key={f.key}>
              <input className={styles.fieldLabel} value={f.label} onChange={(e) => patchField(idx, { label: e.target.value })} />
              <span className={styles.fieldType}>{t(`type.${f.type}`)}</span>
              {(f.type === 'select' || f.type === 'multiselect') && (
                <input
                  className={styles.optionsInput}
                  value={(f.options ?? []).join(', ')}
                  onChange={(e) => patchField(idx, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  placeholder={t('optionsCsv')}
                />
              )}
              <label className={styles.requiredToggle}>
                <input type="checkbox" checked={f.required} onChange={(e) => patchField(idx, { required: e.target.checked })} />
                {t('required')}
              </label>
              <span className={styles.fieldActions}>
                <button onClick={() => move(idx, -1)} aria-label={t('moveUp')}>↑</button>
                <button onClick={() => move(idx, 1)} aria-label={t('moveDown')}>↓</button>
                <button onClick={() => removeField(idx)} aria-label={t('removeField')}>✕</button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h3>{t('branching')}</h3>
        <button className={styles.addBtn} onClick={addRule} disabled={fields.length < 2}>{t('addRule')}</button>
        <ul className={styles.ruleList}>
          {branching.map((r, idx) => (
            <li key={idx} className={styles.ruleRow}>
              <select value={r.action} onChange={(e) => patchRule(idx, { action: e.target.value as 'show' | 'hide' })}>
                <option value="show">{t('actionShow')}</option>
                <option value="hide">{t('actionHide')}</option>
              </select>
              <select value={r.fieldKey} onChange={(e) => patchRule(idx, { fieldKey: e.target.value })}>
                {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <span>{t('when')}</span>
              <select value={r.when.fieldKey} onChange={(e) => patchRule(idx, { when: { ...r.when, fieldKey: e.target.value } })}>
                {earlierKeys(r.fieldKey).map((k) => {
                  const fld = fields.find((f) => f.key === k)!;
                  return <option key={k} value={k}>{fld.label}</option>;
                })}
              </select>
              <select value={r.when.op} onChange={(e) => patchRule(idx, { when: { ...r.when, op: e.target.value as FormBranchingRule['when']['op'] } })}>
                <option value="equals">=</option>
                <option value="not_equals">≠</option>
                <option value="includes">⊇</option>
                <option value="is_empty">{t('opEmpty')}</option>
                <option value="is_not_empty">{t('opNotEmpty')}</option>
              </select>
              {(r.when.op === 'equals' || r.when.op === 'not_equals' || r.when.op === 'includes') && (
                <input value={r.when.value ?? ''} onChange={(e) => patchRule(idx, { when: { ...r.when, value: e.target.value } })} placeholder={t('value')} />
              )}
              <button onClick={() => removeRule(idx)} aria-label={t('removeRule')}>✕</button>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h3>{t('mapping')}</h3>
        <label className={styles.targetRow}>
          {t('targetList')}
          <select value={targetListId} onChange={(e) => setTargetListId(e.target.value)}>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <ul className={styles.mapList}>
          {fields.map((f) => {
            const m = mapping[f.key];
            return (
              <li key={f.key} className={styles.mapRow}>
                <span className={styles.mapLabel}>{f.label}</span>
                <select
                  value={m ? `${m.kind}:${m.target}` : ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) { setMapping((p) => { const n = { ...p }; delete n[f.key]; return n; }); return; }
                    const [kind, target] = v.split(':') as ['task' | 'custom_field', string];
                    setMap(f.key, kind, target);
                  }}
                >
                  <option value="">{t('mapNone')}</option>
                  <option value="task:title">{t('mapTitle')}</option>
                  <option value="task:description">{t('mapDescription')}</option>
                  <option value="task:priority">{t('mapPriority')}</option>
                </select>
              </li>
            );
          })}
        </ul>
        <label className={styles.targetRow}>
          {t('applyTemplate')}
          <select value={templateId ?? ''} onChange={(e) => setTemplateId(e.target.value || null)}>
            <option value="">{t('noTemplate')}</option>
            {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
          </select>
        </label>
      </section>

      <section className={styles.section}>
        <h3>{t('publishing')}</h3>
        <label><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> {t('makePublic')}</label>
        {isPublic && (
          <input className={styles.slugInput} value={publicSlug} onChange={(e) => setPublicSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder={t('slug')} />
        )}
        <label><input type="checkbox" checked={authRequired} onChange={(e) => setAuthRequired(e.target.checked)} /> {t('authRequired')}</label>
      </section>

      <button className={styles.saveBtn} onClick={onSave} disabled={pending || !name || fields.length === 0 || !targetListId}>
        {pending ? t('saving') : t('save')}
      </button>
    </div>
  );
}
