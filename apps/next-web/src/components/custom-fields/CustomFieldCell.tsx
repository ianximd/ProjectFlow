'use client';

import { useState, useTransition } from 'react';
import type { CustomField } from '@projectflow/types';
import { setTaskCustomField } from '@/server/actions/tasks';
import { notifyActionError } from '@/lib/apiErrorToast';
import { TextCell } from './types/TextCell';
import { TextAreaCell } from './types/TextAreaCell';
import { NumberCell } from './types/NumberCell';
import { CurrencyCell } from './types/CurrencyCell';
import { CheckboxCell } from './types/CheckboxCell';
import { DateCell } from './types/DateCell';
import { UrlCell } from './types/UrlCell';
import { EmailCell } from './types/EmailCell';
import { PhoneCell } from './types/PhoneCell';
import { DropdownCell } from './types/DropdownCell';
import { LabelsCell } from './types/LabelsCell';
import { RatingCell } from './types/RatingCell';
import { PeopleCell } from './types/PeopleCell';
import { ProgressManualCell } from './types/ProgressManualCell';
import { ProgressAutoCell } from './types/ProgressAutoCell';

export interface CellProps<T = unknown> {
  field:     CustomField;
  value:     T;
  disabled?: boolean;
  /** Persist the new value. Pass `null` to clear the field. */
  onCommit:  (value: unknown) => void;
}

export function CustomFieldCell({
  taskId,
  field,
  value,
  disabled,
}: {
  taskId:    string;
  field:     CustomField;
  value:     unknown;
  disabled?: boolean;
}) {
  const [local, setLocal] = useState<unknown>(value);
  const [, start] = useTransition();

  const onCommit = (next: unknown) => {
    const prev = local;
    setLocal(next); // optimistic
    start(async () => {
      const r = await setTaskCustomField(taskId, field.id, next);
      if (!r.ok) {
        setLocal(prev); // rollback
        notifyActionError(r);
      }
    });
  };

  const p = { field, value: local, onCommit, disabled } as CellProps<any>;
  switch (field.type) {
    case 'text':            return <TextCell {...p} />;
    case 'text_area':       return <TextAreaCell {...p} />;
    case 'number':          return <NumberCell {...p} />;
    case 'currency':        return <CurrencyCell {...p} />;
    case 'checkbox':        return <CheckboxCell {...p} />;
    case 'date':            return <DateCell {...p} />;
    case 'url':             return <UrlCell {...p} />;
    case 'email':           return <EmailCell {...p} />;
    case 'phone':           return <PhoneCell {...p} />;
    case 'dropdown':        return <DropdownCell {...p} />;
    case 'labels':          return <LabelsCell {...p} />;
    case 'rating':          return <RatingCell {...p} />;
    case 'people':          return <PeopleCell {...p} />;
    case 'progress_manual': return <ProgressManualCell {...p} />;
    case 'progress_auto':   return <ProgressAutoCell {...p} />;
    default:                return null;
  }
}
