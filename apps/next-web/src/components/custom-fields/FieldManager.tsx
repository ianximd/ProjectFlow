'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Edit3, Trash2 } from 'lucide-react';

import type {
  CustomField, CustomFieldType, CustomFieldConfig, RollupFunction, FieldRef,
} from '@projectflow/types';

import { createCustomField, updateCustomField, deleteCustomField } from '@/server/actions/custom-fields';
import { loadSpaceLists, type SpaceListOption } from '@/server/actions/relationships';
import { notifyActionError } from '@/lib/apiErrorToast';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/dialog';

// All custom-field types (wave-1 + Phase 5b relationship/rollup).
const TYPES: CustomFieldType[] = [
  'text', 'text_area', 'number', 'currency', 'checkbox', 'date', 'url', 'email',
  'phone', 'dropdown', 'labels', 'rating', 'people', 'progress_manual', 'progress_auto',
  'relationship', 'rollup',
];

// Builtin source-field keys offered for a rollup's source (mirrors the API's
// readBuiltin keys in relationship.service.ts). Labels resolved via t().
const ROLLUP_BUILTIN_KEYS = ['storyPoints', 'priority', 'status', 'dueDate', 'startDate', 'position'] as const;
const ROLLUP_FUNCTIONS: RollupFunction[] = ['sum', 'avg', 'count', 'min', 'max', 'first', 'concat'];

// Human-readable labels are resolved via t() inside the component (see typeLabel helper).

interface FormState {
  name: string;
  type: CustomFieldType;
  required: boolean;
  // ── relationship config ──
  relationshipTargetType: 'any' | 'list';
  relationshipTargetListId: string;
  // ── rollup config ──
  rollupRelationshipFieldId: string;
  rollupSourceKind: 'builtin' | 'custom';
  rollupSourceKey: string;
  rollupFunction: RollupFunction;
}

const EMPTY_FORM: FormState = {
  name: '', type: 'text', required: false,
  relationshipTargetType: 'any', relationshipTargetListId: '',
  rollupRelationshipFieldId: '', rollupSourceKind: 'builtin', rollupSourceKey: 'storyPoints',
  rollupFunction: 'sum',
};

export function FieldManager({
  scopeType, scopeId, fields,
}: {
  scopeType: 'SPACE' | 'FOLDER' | 'LIST';
  scopeId: string;
  fields: CustomField[];
}) {
  const t = useTranslations('CustomFields');
  const tCommon = useTranslations('Common');

  // Human-readable labels for the type Select / row display.
  const TYPE_LABELS: Record<CustomFieldType, string> = {
    text: t('typeText'),
    text_area: t('typeTextArea'),
    number: t('typeNumber'),
    currency: t('typeCurrency'),
    checkbox: t('typeCheckbox'),
    date: t('typeDate'),
    url: t('typeUrl'),
    email: t('typeEmail'),
    phone: t('typePhone'),
    dropdown: t('typeDropdown'),
    labels: t('typeLabels'),
    rating: t('typeRating'),
    people: t('typePeople'),
    progress_manual: t('typeProgressManual'),
    progress_auto: t('typeProgressAuto'),
    relationship: t('typeRelationship'),
    rollup: t('typeRollup'),
    location: t('typeLocation'),
  };

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomField | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isPending, start] = useTransition();

  // Relationship fields already defined on THIS scope — the candidate set for a
  // rollup's "relationship field" picker.
  const relationshipFields = fields.filter((f) => f.type === 'relationship');

  // Lists in the Space, lazily loaded for the relationship "target list" picker.
  // Only fetched once the dialog is open on a relationship field (cheap to skip
  // otherwise). SPACE scope is the only place the manager is mounted today.
  const [lists, setLists] = useState<SpaceListOption[]>([]);
  useEffect(() => {
    if (!open || scopeType !== 'SPACE') return;
    if (form.type !== 'relationship') return;
    let cancelled = false;
    loadSpaceLists(scopeId)
      .then((rows) => { if (!cancelled) setLists(rows); })
      .catch(() => { if (!cancelled) setLists([]); });
    return () => { cancelled = true; };
  }, [open, scopeType, scopeId, form.type]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(f: CustomField) {
    setEditing(f);
    const cfg = f.config ?? {};
    const src = cfg.rollupSourceField;
    setForm({
      name: f.name, type: f.type, required: f.required,
      relationshipTargetType:   cfg.relationshipTargetType ?? 'any',
      relationshipTargetListId: cfg.relationshipTargetListId ?? '',
      rollupRelationshipFieldId: cfg.rollupRelationshipFieldId ?? '',
      rollupSourceKind: src?.kind ?? 'builtin',
      rollupSourceKey:  src?.key ?? 'storyPoints',
      rollupFunction:   cfg.rollupFunction ?? 'sum',
    });
    setOpen(true);
  }

  // Build the per-type config payload from the form. Returns undefined for the
  // wave-1 types (no config sub-form yet) so the create/update call omits it.
  function buildConfig(): CustomFieldConfig | undefined {
    if (form.type === 'relationship') {
      const cfg: CustomFieldConfig = { relationshipTargetType: form.relationshipTargetType };
      if (form.relationshipTargetType === 'list' && form.relationshipTargetListId) {
        cfg.relationshipTargetListId = form.relationshipTargetListId;
      }
      return cfg;
    }
    if (form.type === 'rollup') {
      const source: FieldRef = { kind: form.rollupSourceKind, key: form.rollupSourceKey };
      return {
        rollupRelationshipFieldId: form.rollupRelationshipFieldId,
        rollupSourceField: source,
        rollupFunction: form.rollupFunction,
      };
    }
    return undefined;
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    const config = buildConfig();
    start(async () => {
      const r = editing
        ? await updateCustomField(editing.id, { name, required: form.required, ...(config !== undefined ? { config } : {}) })
        : await createCustomField({
            scopeType, scopeId, type: form.type, name, required: form.required, position: fields.length,
            ...(config !== undefined ? { config } : {}),
          });
      if (!r.ok) {
        notifyActionError(r);
      } else {
        setOpen(false);
        setEditing(null);
      }
    });
  }

  // Block submit when the chosen type's required config isn't filled in. The
  // API also 422s on bad config, but disabling here gives immediate feedback.
  const configIncomplete =
    (form.type === 'relationship'
      && form.relationshipTargetType === 'list'
      && !form.relationshipTargetListId)
    || (form.type === 'rollup'
      && (!form.rollupRelationshipFieldId || !form.rollupSourceKey));

  function remove(f: CustomField) {
    if (!window.confirm(t('deleteFieldAriaLabel', { name: f.name }))) return;
    start(async () => {
      const r = await deleteCustomField(f.id);
      if (!r.ok) notifyActionError(r);
    });
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
        <div className="text-xs text-muted-foreground">
          {t('cascadeDesc', { scope: scopeType.toLowerCase() })}
        </div>
        <Button size="sm" variant="primary" className="ml-auto" onClick={openCreate}>
          <Plus className="size-4" /> {t('addField')}
        </Button>
      </div>

      {fields.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground">{t('noFieldsYet')}</div>
            <div className="text-xs text-muted-foreground max-w-sm">
              {t('noFieldsDesc')}
            </div>
          </div>
          <Button size="sm" variant="primary" onClick={openCreate}>
            <Plus className="size-4" /> {t('addFirstField')}
          </Button>
        </div>
      ) : (
        <Card className="p-0 overflow-hidden">
          <ul role="list" className="divide-y divide-border/60">
            {fields.map((f) => (
              <li
                key={f.id}
                data-testid="custom-field-row"
                className="group flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors"
              >
                <span className="text-sm font-medium text-foreground truncate">{f.name}</span>
                <span className="text-xs text-muted-foreground">{TYPE_LABELS[f.type] ?? f.type}</span>
                {f.required && (
                  <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive">
                    {t('requiredBadge')}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <Button
                    size="sm" variant="ghost" className="h-7 w-7 p-0"
                    onClick={() => openEdit(f)}
                    aria-label={t('editFieldAriaLabel', { name: f.name })}
                  >
                    <Edit3 className="size-3.5" />
                  </Button>
                  <Button
                    size="sm" variant="ghost"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => remove(f)}
                    disabled={isPending}
                    aria-label={t('deleteFieldAriaLabel', { name: f.name })}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } else setOpen(true); }}>
        <DialogContent key={editing?.id ?? 'create'}>
          <DialogHeader>
            <DialogTitle>{editing ? t('dialogEditTitle', { name: editing.name }) : t('dialogCreateTitle')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save}>
            <DialogBody className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cf-name" className="text-xs font-medium text-muted-foreground">{t('nameLabel')}</label>
                <Input
                  id="cf-name" required autoFocus value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t('namePlaceholder')}
                />
              </div>

              {/* Type is fixed after creation — only selectable on create. */}
              {!editing && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">{t('typeLabel')}</label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as CustomFieldType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* ── relationship config sub-form ── */}
              {form.type === 'relationship' && (
                <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">{t('relTargetLabel')}</span>
                    <div className="flex flex-col gap-1.5">
                      <label className="flex items-center gap-2 text-sm text-foreground">
                        <input
                          type="radio" name="rel-target" value="any"
                          checked={form.relationshipTargetType === 'any'}
                          onChange={() => setForm({ ...form, relationshipTargetType: 'any' })}
                        />
                        {t('relTargetAny')}
                      </label>
                      <label className="flex items-center gap-2 text-sm text-foreground">
                        <input
                          type="radio" name="rel-target" value="list"
                          checked={form.relationshipTargetType === 'list'}
                          onChange={() => setForm({ ...form, relationshipTargetType: 'list' })}
                        />
                        {t('relTargetList')}
                      </label>
                    </div>
                  </div>
                  {form.relationshipTargetType === 'list' && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">{t('relListLabel')}</label>
                      <Select
                        value={form.relationshipTargetListId || undefined}
                        onValueChange={(v) => setForm({ ...form, relationshipTargetListId: v })}
                      >
                        <SelectTrigger><SelectValue placeholder={t('relListPlaceholder')} /></SelectTrigger>
                        <SelectContent>
                          {lists.length === 0 ? (
                            <SelectItem value="__none" disabled>{t('relListEmpty')}</SelectItem>
                          ) : (
                            lists.map((l) => (
                              <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}

              {/* ── rollup config sub-form ── */}
              {form.type === 'rollup' && (
                <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">{t('rollupRelFieldLabel')}</label>
                    <Select
                      value={form.rollupRelationshipFieldId || undefined}
                      onValueChange={(v) => setForm({ ...form, rollupRelationshipFieldId: v })}
                    >
                      <SelectTrigger><SelectValue placeholder={t('rollupRelFieldPlaceholder')} /></SelectTrigger>
                      <SelectContent>
                        {relationshipFields.length === 0 ? (
                          <SelectItem value="__none" disabled>{t('rollupNoRelFields')}</SelectItem>
                        ) : (
                          relationshipFields.map((f) => (
                            <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">{t('rollupSourceLabel')}</label>
                    <Select
                      value={`${form.rollupSourceKind}:${form.rollupSourceKey}`}
                      onValueChange={(v) => {
                        const [kind, ...rest] = v.split(':');
                        setForm({ ...form, rollupSourceKind: kind as 'builtin' | 'custom', rollupSourceKey: rest.join(':') });
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder={t('rollupSourcePlaceholder')} /></SelectTrigger>
                      <SelectContent>
                        {ROLLUP_BUILTIN_KEYS.map((k) => (
                          <SelectItem key={`builtin:${k}`} value={`builtin:${k}`}>
                            {t(`builtinField_${k}` as `builtinField_${typeof k}`)}
                          </SelectItem>
                        ))}
                        {fields
                          .filter((f) => f.type !== 'relationship' && f.type !== 'rollup')
                          .map((f) => (
                            <SelectItem key={`custom:${f.id}`} value={`custom:${f.id}`}>{f.name}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">{t('rollupFunctionLabel')}</label>
                    <Select
                      value={form.rollupFunction}
                      onValueChange={(v) => setForm({ ...form, rollupFunction: v as RollupFunction })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLLUP_FUNCTIONS.map((fn) => (
                          <SelectItem key={fn} value={fn}>{t(`fn_${fn}` as `fn_${RollupFunction}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox
                  checked={form.required}
                  onCheckedChange={(c) => setForm({ ...form, required: c === true })}
                />
                {t('requiredCheckbox')}
              </label>
            </DialogBody>
            <DialogFooter>
              <Button
                type="button" variant="outline"
                onClick={() => { setOpen(false); setEditing(null); }}
                disabled={isPending}
              >
                {tCommon('cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={isPending || !form.name.trim() || configIncomplete}>
                {isPending ? t('saving') : editing ? t('saveChanges') : t('createField')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
