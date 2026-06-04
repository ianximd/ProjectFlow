'use client';

import { useState, useTransition } from 'react';
import { Plus, Edit3, Trash2 } from 'lucide-react';

import type { CustomField, CustomFieldType } from '@projectflow/types';

import { createCustomField, updateCustomField, deleteCustomField } from '@/server/actions/custom-fields';
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

// All 15 wave-1 custom-field types (mirrors CK_CustomFields_Type in migration 0030).
const TYPES: CustomFieldType[] = [
  'text', 'text_area', 'number', 'currency', 'checkbox', 'date', 'url', 'email',
  'phone', 'dropdown', 'labels', 'rating', 'people', 'progress_manual', 'progress_auto',
];

// Human-readable labels for the type Select / row display.
const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text',
  text_area: 'Text area',
  number: 'Number',
  currency: 'Currency',
  checkbox: 'Checkbox',
  date: 'Date',
  url: 'URL',
  email: 'Email',
  phone: 'Phone',
  dropdown: 'Dropdown',
  labels: 'Labels',
  rating: 'Rating',
  people: 'People',
  progress_manual: 'Progress (manual)',
  progress_auto: 'Progress (auto)',
};

interface FormState {
  name: string;
  type: CustomFieldType;
  required: boolean;
}

const EMPTY_FORM: FormState = { name: '', type: 'text', required: false };

export function FieldManager({
  scopeType, scopeId, fields,
}: {
  scopeType: 'SPACE' | 'FOLDER' | 'LIST';
  scopeId: string;
  fields: CustomField[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomField | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isPending, start] = useTransition();

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(f: CustomField) {
    setEditing(f);
    setForm({ name: f.name, type: f.type, required: f.required });
    setOpen(true);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    // TODO(wave-1+): per-type config sub-form (dropdown/labels options, currency
    // code, rating max, date includeTime) — pass `config` to create/update here.
    start(async () => {
      const r = editing
        ? await updateCustomField(editing.id, { name, required: form.required })
        : await createCustomField({
            scopeType, scopeId, type: form.type, name, required: form.required, position: fields.length,
          });
      if (!r.ok) {
        notifyActionError(r);
      } else {
        setOpen(false);
        setEditing(null);
      }
    });
  }

  function remove(f: CustomField) {
    if (!window.confirm(`Delete field "${f.name}"?`)) return;
    start(async () => {
      const r = await deleteCustomField(f.id);
      if (!r.ok) notifyActionError(r);
    });
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
        <div className="text-xs text-muted-foreground">
          Custom fields cascade down to tasks in this {scopeType.toLowerCase()} and everything beneath it.
        </div>
        <Button size="sm" variant="primary" className="ml-auto" onClick={openCreate}>
          <Plus className="size-4" /> Add field
        </Button>
      </div>

      {fields.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground">No custom fields yet</div>
            <div className="text-xs text-muted-foreground max-w-sm">
              Add fields like priority, story points, or a customer dropdown — they appear on every task in scope.
            </div>
          </div>
          <Button size="sm" variant="primary" onClick={openCreate}>
            <Plus className="size-4" /> Add your first field
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
                    Required
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <Button
                    size="sm" variant="ghost" className="h-7 w-7 p-0"
                    onClick={() => openEdit(f)}
                    aria-label={`Edit ${f.name}`}
                  >
                    <Edit3 className="size-3.5" />
                  </Button>
                  <Button
                    size="sm" variant="ghost"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => remove(f)}
                    disabled={isPending}
                    aria-label={`Delete ${f.name}`}
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
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'New custom field'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save}>
            <DialogBody className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cf-name" className="text-xs font-medium text-muted-foreground">Name</label>
                <Input
                  id="cf-name" required autoFocus value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Priority, Story points, Customer"
                />
              </div>

              {/* Type is fixed after creation — only selectable on create. */}
              {!editing && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Type</label>
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

              <label className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox
                  checked={form.required}
                  onCheckedChange={(c) => setForm({ ...form, required: c === true })}
                />
                Required (blocks marking a task Done until set)
              </label>
            </DialogBody>
            <DialogFooter>
              <Button
                type="button" variant="outline"
                onClick={() => { setOpen(false); setEditing(null); }}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={isPending || !form.name.trim()}>
                {isPending ? 'Saving…' : editing ? 'Save changes' : 'Create field'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
