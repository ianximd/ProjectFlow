'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { notifyActionError } from '@/lib/apiErrorToast';
import {
  buildFieldOptions,
  fieldRefToken,
  tokenToFieldRef,
  type FieldOption,
} from './field-options';
import {
  createSavedView,
  previewViewTasks,
  updateSavedView,
} from '@/server/actions/views';
import type {
  CustomField,
  FieldRef,
  FilterGroup,
  FilterOperator,
  FilterRule,
  SavedView,
  SortKey,
  ViewConfig,
  ViewScopeType,
} from '@projectflow/types';

interface Props {
  activeView: SavedView;
  scopeType: ViewScopeType;
  scopeId: string;
  /** Workspace id for EVERYTHING-scoped preview/save-as-new (they fail closed
   *  without it). Undefined for node-scoped views. */
  workspaceId?: string;
  customFields: CustomField[];
  meMode: boolean;
}

// The operator set offered in the builder. The API validates/rejects field+op
// combinations it doesn't allow; failures surface via the preview error toast.
// `labelKey` maps to a `Views.filters.*` catalog entry — labels can't be resolved
// here (module scope), so they're translated at the RuleEditor render site.
type OperatorLabelKey =
  | 'opIs' | 'opIsNot' | 'opGt' | 'opGte' | 'opLt' | 'opLte'
  | 'opIn' | 'opNotIn' | 'opContains' | 'opIsEmpty' | 'opIsNotEmpty';
const OPERATORS: { value: FilterOperator; labelKey: OperatorLabelKey }[] = [
  { value: '=', labelKey: 'opIs' },
  { value: '!=', labelKey: 'opIsNot' },
  { value: '>', labelKey: 'opGt' },
  { value: '>=', labelKey: 'opGte' },
  { value: '<', labelKey: 'opLt' },
  { value: '<=', labelKey: 'opLte' },
  { value: 'in', labelKey: 'opIn' },
  { value: 'not_in', labelKey: 'opNotIn' },
  { value: 'contains', labelKey: 'opContains' },
  { value: 'is_empty', labelKey: 'opIsEmpty' },
  { value: 'is_not_empty', labelKey: 'opIsNotEmpty' },
];

const VALUELESS_OPS = new Set<FilterOperator>(['is_empty', 'is_not_empty']);

function isGroup(node: FilterRule | FilterGroup): node is FilterGroup {
  return (node as FilterGroup).conjunction !== undefined;
}

export function FilterBuilder({ activeView, scopeType, scopeId, workspaceId, customFields, meMode }: Props) {
  const router = useRouter();
  const t = useTranslations('Views.filters');
  const [pending, startTransition] = useTransition();
  // EVERYTHING views have no hierarchy node — send a null node scope + workspaceId.
  const nodeScopeId = scopeType === 'EVERYTHING' ? null : scopeId;
  const wsId = scopeType === 'EVERYTHING' ? workspaceId : undefined;

  const options = buildFieldOptions(customFields);
  const firstField: FieldRef = options[0]?.ref ?? { kind: 'builtin', key: 'title' };

  // Local working copy of the active view's config (the editable AST).
  const [config, setConfig] = useState<ViewConfig>(() => cloneConfig(activeView.config));
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Stable React keys for the top-level filter rules list and the sort keys list.
  // These are UI-only ids — never serialised into the ViewConfig AST.
  const [ruleKeys, setRuleKeys] = useState<string[]>(() =>
    activeView.config.filter.rules.map(() => crypto.randomUUID()),
  );
  const [sortKeys, setSortKeys] = useState<string[]>(() =>
    activeView.config.sort.map(() => crypto.randomUUID()),
  );

  // Re-seed local state when the active view changes (tab switch).
  const seededId = useRef(activeView.id);
  useEffect(() => {
    if (seededId.current !== activeView.id) {
      seededId.current = activeView.id;
      setConfig(cloneConfig(activeView.config));
      setRuleKeys(activeView.config.filter.rules.map(() => crypto.randomUUID()));
      setSortKeys(activeView.config.sort.map(() => crypto.randomUUID()));
      setPreviewCount(null);
    }
  }, [activeView.id, activeView.config]);

  // Debounced live preview whenever the config changes.
  const runPreview = useCallback(
    (cfg: ViewConfig) => {
      setPreviewing(true);
      startTransition(async () => {
        const res = await previewViewTasks(scopeType, nodeScopeId, cfg, 1, meMode, wsId);
        setPreviewing(false);
        if (!res.ok) { notifyActionError(res); setPreviewCount(null); return; }
        setPreviewCount(res.data.total);
      });
    },
    [scopeType, nodeScopeId, wsId, meMode],
  );

  useEffect(() => {
    const h = setTimeout(() => runPreview(config), 350);
    return () => clearTimeout(h);
  }, [config, runPreview]);

  // ── Filter rule mutations (top-level group) ──────────────────────────────
  const setFilter = (filter: FilterGroup) => setConfig((c) => ({ ...c, filter }));

  const addRule = () => {
    setFilter({
      ...config.filter,
      rules: [...config.filter.rules, { field: firstField, op: '=', value: '' }],
    });
    setRuleKeys((ks) => [...ks, crypto.randomUUID()]);
  };

  const addNestedGroup = () => {
    setFilter({
      ...config.filter,
      rules: [
        ...config.filter.rules,
        { conjunction: 'OR', rules: [{ field: firstField, op: '=', value: '' }] },
      ],
    });
    setRuleKeys((ks) => [...ks, crypto.randomUUID()]);
  };

  const removeTopLevelRule = (i: number) => {
    setFilter({ ...config.filter, rules: config.filter.rules.filter((_, j) => j !== i) });
    setRuleKeys((ks) => ks.filter((_, j) => j !== i));
  };

  return (
    <div
      data-testid="filter-builder"
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/10 p-3 text-xs"
    >
      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold uppercase tracking-wide text-muted-foreground">{t('sectionFilters')}</span>
          <ConjunctionToggle
            value={config.filter.conjunction}
            onChange={(conjunction) => setFilter({ ...config.filter, conjunction })}
          />
        </div>

        {config.filter.rules.length === 0 ? (
          <div className="text-muted-foreground">{t('noFilters')}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {config.filter.rules.map((node, i) =>
              isGroup(node) ? (
                <NestedGroupEditor
                  key={ruleKeys[i]}
                  group={node}
                  options={options}
                  firstField={firstField}
                  onChange={(g) => {
                    const rules = [...config.filter.rules];
                    rules[i] = g;
                    setFilter({ ...config.filter, rules });
                  }}
                  onRemove={() => removeTopLevelRule(i)}
                />
              ) : (
                <RuleEditor
                  key={ruleKeys[i]}
                  rule={node}
                  options={options}
                  onChange={(r) => {
                    const rules = [...config.filter.rules];
                    rules[i] = r;
                    setFilter({ ...config.filter, rules });
                  }}
                  onRemove={() => removeTopLevelRule(i)}
                />
              ),
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="dashed" onClick={addRule} data-testid="add-filter-rule">
            <Plus className="size-3.5" /> {t('addFilter')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={addNestedGroup} data-testid="add-filter-group">
            <Plus className="size-3.5" /> {t('addGroup')}
          </Button>
        </div>
      </section>

      {/* ── Group by ────────────────────────────────────────────────────── */}
      <section className="flex items-center gap-2">
        <span className="w-16 shrink-0 font-semibold uppercase tracking-wide text-muted-foreground">{t('sectionGroup')}</span>
        <FieldSelect
          value={config.groupBy ?? null}
          options={options}
          allowNone
          noneLabel={t('noGrouping')}
          onChange={(ref) => setConfig((c) => ({ ...c, groupBy: ref ?? undefined }))}
        />
      </section>

      {/* ── Sort (multi-key) ────────────────────────────────────────────── */}
      <SortEditor
        sort={config.sort}
        sortKeys={sortKeys}
        options={options}
        firstField={firstField}
        onChange={(sort) => setConfig((c) => ({ ...c, sort }))}
        onAddSortKey={() => setSortKeys((ks) => [...ks, crypto.randomUUID()])}
        onRemoveSortKey={(i) => setSortKeys((ks) => ks.filter((_, j) => j !== i))}
      />

      {/* ── Columns ─────────────────────────────────────────────────────── */}
      <ColumnsEditor
        columns={config.columns ?? []}
        options={options}
        onChange={(columns) => setConfig((c) => ({ ...c, columns }))}
      />

      {/* ── Preview + save ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <span data-testid="filter-preview-count" className="text-muted-foreground">
          {previewing || pending
            ? t('previewing')
            : previewCount == null
              ? '—'
              : t('matching', { count: previewCount })}
        </span>
        <SaveControls
          activeView={activeView}
          scopeType={scopeType}
          scopeId={scopeId}
          workspaceId={workspaceId}
          config={config}
          onSaved={() => router.refresh()}
        />
      </div>
    </div>
  );
}

// ── Conjunction toggle (AND / OR) ────────────────────────────────────────────
function ConjunctionToggle({
  value,
  onChange,
}: {
  value: 'AND' | 'OR';
  onChange: (v: 'AND' | 'OR') => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-input">
      {(['AND', 'OR'] as const).map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          data-active={value === c ? 'true' : undefined}
          className={cn(
            'px-2 py-0.5 text-[11px] font-medium',
            value === c ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-accent',
          )}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

// ── A single filter rule (field / op / value) ────────────────────────────────
function RuleEditor({
  rule,
  options,
  onChange,
  onRemove,
}: {
  rule: FilterRule;
  options: FieldOption[];
  onChange: (r: FilterRule) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('Views.filters');
  const valueless = VALUELESS_OPS.has(rule.op);
  return (
    <div className="flex items-center gap-2" data-testid="filter-rule">
      <div className="min-w-[140px]">
        <FieldSelect
          value={rule.field}
          options={options}
          onChange={(ref) => ref && onChange({ ...rule, field: ref })}
        />
      </div>
      <Select value={rule.op} onValueChange={(v) => onChange({ ...rule, op: v as FilterOperator })}>
        <SelectTrigger size="sm" className="w-[120px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPERATORS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {t(o.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!valueless && (
        <Input
          variant="sm"
          className="w-[160px]"
          value={stringifyValue(rule.value)}
          placeholder={t('valuePlaceholder')}
          onChange={(e) => onChange({ ...rule, value: e.target.value })}
        />
      )}
      <Button type="button" size="sm" variant="ghost" mode="icon" onClick={onRemove} aria-label={t('removeFilter')}>
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

// ── A nested AND/OR group (one level) ────────────────────────────────────────
function NestedGroupEditor({
  group,
  options,
  firstField,
  onChange,
  onRemove,
}: {
  group: FilterGroup;
  options: FieldOption[];
  firstField: FieldRef;
  onChange: (g: FilterGroup) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('Views.filters');
  // Only flat rules inside a nested group (one level of grouping).
  const rules = group.rules.filter((r): r is FilterRule => !isGroup(r));

  // Stable keys for nested rule rows, seeded once. Every length change flows
  // through the add/remove handlers below, which update keys and rules together
  // by position — so keys stay aligned without mutating during render (a React
  // rule violation). The parent remounts this editor with a fresh key whenever
  // the underlying group identity changes, which reseeds these keys.
  const [keys, setKeys] = useState<string[]>(() => rules.map(() => crypto.randomUUID()));

  const removeRuleAt = (i: number) => {
    setKeys((ks) => ks.filter((_, j) => j !== i));
    onChange({ ...group, rules: rules.filter((_, j) => j !== i) });
  };
  const addRule = () => {
    setKeys((ks) => [...ks, crypto.randomUUID()]);
    onChange({ ...group, rules: [...rules, { field: firstField, op: '=', value: '' }] });
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-border bg-background/60 p-2" data-testid="filter-group">
      <div className="flex items-center justify-between gap-2">
        <ConjunctionToggle value={group.conjunction} onChange={(conjunction) => onChange({ ...group, conjunction })} />
        <Button type="button" size="sm" variant="ghost" mode="icon" onClick={onRemove} aria-label={t('removeGroup')}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {rules.map((r, i) => (
        <RuleEditor
          key={keys[i] ?? i}
          rule={r}
          options={options}
          onChange={(nr) => {
            const next = [...rules];
            next[i] = nr;
            onChange({ ...group, rules: next });
          }}
          onRemove={() => removeRuleAt(i)}
        />
      ))}
      <Button
        type="button"
        size="sm"
        variant="dashed"
        onClick={addRule}
      >
        <Plus className="size-3.5" /> {t('addFilter')}
      </Button>
    </div>
  );
}

// ── Multi-key sort editor ────────────────────────────────────────────────────
function SortEditor({
  sort,
  sortKeys,
  options,
  firstField,
  onChange,
  onAddSortKey,
  onRemoveSortKey,
}: {
  sort: SortKey[];
  sortKeys: string[];
  options: FieldOption[];
  firstField: FieldRef;
  onChange: (s: SortKey[]) => void;
  onAddSortKey: () => void;
  onRemoveSortKey: (i: number) => void;
}) {
  const t = useTranslations('Views.filters');
  return (
    <section className="flex flex-col gap-2">
      <span className="font-semibold uppercase tracking-wide text-muted-foreground">{t('sectionSort')}</span>
      {sort.map((k, i) => (
        <div key={sortKeys[i]} className="flex items-center gap-2" data-testid="sort-key">
          <div className="min-w-[140px]">
            <FieldSelect
              value={k.field}
              options={options}
              onChange={(ref) => {
                if (!ref) return;
                const next = [...sort];
                next[i] = { ...k, field: ref };
                onChange(next);
              }}
            />
          </div>
          <Select
            value={k.dir}
            onValueChange={(v) => {
              const next = [...sort];
              next[i] = { ...k, dir: v as 'ASC' | 'DESC' };
              onChange(next);
            }}
          >
            <SelectTrigger size="sm" className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ASC">{t('ascending')}</SelectItem>
              <SelectItem value="DESC">{t('descending')}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            mode="icon"
            onClick={() => { onChange(sort.filter((_, j) => j !== i)); onRemoveSortKey(i); }}
            aria-label={t('removeSortKey')}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="dashed"
        className="w-fit"
        onClick={() => { onChange([...sort, { field: firstField, dir: 'ASC' }]); onAddSortKey(); }}
      >
        <Plus className="size-3.5" /> {t('addSort')}
      </Button>
    </section>
  );
}

// ── Columns picker (checkbox list of all field options) ──────────────────────
function ColumnsEditor({
  columns,
  options,
  onChange,
}: {
  columns: FieldRef[];
  options: FieldOption[];
  onChange: (c: FieldRef[]) => void;
}) {
  const t = useTranslations('Views.filters');
  const selected = new Set(columns.map(fieldRefToken));
  const toggle = (ref: FieldRef) => {
    const tok = fieldRefToken(ref);
    if (selected.has(tok)) onChange(columns.filter((c) => fieldRefToken(c) !== tok));
    else onChange([...columns, ref]);
  };
  return (
    <section className="flex flex-col gap-2">
      <span className="font-semibold uppercase tracking-wide text-muted-foreground">{t('sectionColumns')}</span>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {options.map((o) => {
          const tok = fieldRefToken(o.ref);
          return (
            <label key={tok} className="flex items-center gap-1.5">
              <Checkbox size="sm" checked={selected.has(tok)} onCheckedChange={() => toggle(o.ref)} />
              <span>{o.label}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

// ── Save / Save-as-new ───────────────────────────────────────────────────────
function SaveControls({
  activeView,
  scopeType,
  scopeId,
  workspaceId,
  config,
  onSaved,
}: {
  activeView: SavedView;
  scopeType: ViewScopeType;
  scopeId: string;
  workspaceId?: string;
  config: ViewConfig;
  onSaved: () => void;
}) {
  const t = useTranslations('Views.filters');
  const [pending, startTransition] = useTransition();
  const [asNewName, setAsNewName] = useState('');
  const [showAsNew, setShowAsNew] = useState(false);

  const save = () =>
    startTransition(async () => {
      const res = await updateSavedView(activeView.id, { config });
      if (!res.ok) { notifyActionError(res); return; }
      onSaved();
    });

  const saveAsNew = () =>
    startTransition(async () => {
      const res = await createSavedView({
        scopeType,
        scopeId: scopeType === 'EVERYTHING' ? null : scopeId,
        type: activeView.type,
        name: asNewName.trim() || `${activeView.name} copy`,
        isShared: activeView.isShared,
        isDefault: false,
        config,
        workspaceId: scopeType === 'EVERYTHING' ? workspaceId : undefined,
      });
      if (!res.ok) { notifyActionError(res); return; }
      setShowAsNew(false);
      setAsNewName('');
      onSaved();
    });

  return (
    <div className="flex items-center gap-2">
      {showAsNew && (
        <Input
          variant="sm"
          className="w-[160px]"
          autoFocus
          value={asNewName}
          placeholder={t('newViewNamePlaceholder')}
          onChange={(e) => setAsNewName(e.target.value)}
        />
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => (showAsNew ? saveAsNew() : setShowAsNew(true))}
        data-testid="save-view-as-new"
      >
        {t('saveAsNew')}
      </Button>
      <Button type="button" size="sm" variant="primary" disabled={pending} onClick={save} data-testid="save-view">
        {t('save')}
      </Button>
    </div>
  );
}

// ── Field <Select> (built-ins + custom fields, optional "none") ──────────────
function FieldSelect({
  value,
  options,
  onChange,
  allowNone,
  noneLabel,
}: {
  value: FieldRef | null;
  options: FieldOption[];
  onChange: (ref: FieldRef | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const t = useTranslations('Views.filters');
  const resolvedNoneLabel = noneLabel ?? t('none');
  const NONE = '__none__';
  return (
    <Select
      value={value ? fieldRefToken(value) : NONE}
      onValueChange={(v) => onChange(v === NONE ? null : tokenToFieldRef(v))}
    >
      <SelectTrigger size="sm" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>{resolvedNoneLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={fieldRefToken(o.ref)} value={fieldRefToken(o.ref)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────
function cloneConfig(c: ViewConfig): ViewConfig {
  return JSON.parse(JSON.stringify(c)) as ViewConfig;
}

function stringifyValue(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}
