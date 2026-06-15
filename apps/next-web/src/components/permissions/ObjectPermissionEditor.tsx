'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { loadObjectPermissions, setObjectPermission, removeObjectPermission } from '@/server/actions/object-permissions';
import { groupGrantsBySubject, type SubjectGrantRow } from '@/lib/permissions';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { HierarchyNodeType, ObjectPermissionGrant, ObjectPermissionLevel } from '@projectflow/types';
import styles from './ObjectPermissionEditor.module.css';

const LEVELS: ObjectPermissionLevel[] = ['VIEW', 'COMMENT', 'EDIT', 'FULL'];

export function ObjectPermissionEditor({ objectType, objectId }: { objectType: HierarchyNodeType; objectId: string }) {
  const t = useTranslations('Permissions');
  const [rows, setRows] = useState<SubjectGrantRow[]>([]);
  const [pending, start] = useTransition();
  const [addId, setAddId] = useState('');
  const [addLevel, setAddLevel] = useState<ObjectPermissionLevel>('VIEW');

  const refetch = async () => {
    const grants: ObjectPermissionGrant[] = await loadObjectPermissions(objectType, objectId);
    setRows(groupGrantsBySubject(objectType, objectId, grants));
  };
  useEffect(() => { void refetch(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [objectType, objectId]);

  const onChangeLevel = (row: SubjectGrantRow, level: ObjectPermissionLevel) => start(async () => {
    const r = await setObjectPermission(objectType, objectId, { subjectType: row.subjectType, subjectId: row.subjectId, level });
    if (!r.ok) return notifyActionError(r);
    await refetch();
  });
  const onRemove = (row: SubjectGrantRow) => start(async () => {
    const r = await removeObjectPermission(objectType, objectId, { subjectType: row.subjectType, subjectId: row.subjectId });
    if (!r.ok) return notifyActionError(r);
    await refetch();
  });
  const onAdd = () => start(async () => {
    const id = addId.trim();
    if (!id) return;
    const r = await setObjectPermission(objectType, objectId, { subjectType: 'USER', subjectId: id, level: addLevel });
    if (!r.ok) return notifyActionError(r);
    setAddId('');
    await refetch();
  });

  return (
    <div className={styles.root}>
      <h3 className={styles.title}>{t('objectAccessTitle')}</h3>
      {rows.length === 0 && <p className={styles.empty}>{t('noGrants')}</p>}
      <ul className={styles.list}>
        {rows.map((row) => (
          <li key={`${row.subjectType}:${row.subjectId}`} className={styles.row}>
            <span className={styles.subject}>
              {row.subjectName ?? row.subjectId}
              <small className={styles.kind}>{row.subjectType === 'ROLE' ? t('role') : t('user')}</small>
            </span>
            <select className={styles.levelSelect} value={row.effectiveLevel} disabled={pending}
              onChange={(e) => onChangeLevel(row, e.target.value as ObjectPermissionLevel)}>
              {LEVELS.map((l) => <option key={l} value={l}>{t(`level.${l}`)}</option>)}
            </select>
            {row.directGrantId === null && row.inheritedFromName && (
              <span className={styles.inherited}>{t('inheritedFrom', { name: row.inheritedFromName })}</span>
            )}
            {row.directGrantId !== null && (
              <button className={styles.remove} disabled={pending} onClick={() => onRemove(row)}>{t('remove')}</button>
            )}
          </li>
        ))}
      </ul>
      <div className={styles.addBox}>
        <input className={styles.addInput} value={addId} placeholder={t('addUserPlaceholder')}
          onChange={(e) => setAddId(e.target.value)} aria-label={t('addUserPlaceholder')} />
        <select className={styles.levelSelect} value={addLevel} disabled={pending}
          onChange={(e) => setAddLevel(e.target.value as ObjectPermissionLevel)}>
          {LEVELS.map((l) => <option key={l} value={l}>{t(`level.${l}`)}</option>)}
        </select>
        <button className={styles.addBtn} disabled={pending || !addId.trim()} onClick={onAdd}>{t('addGrant')}</button>
      </div>
    </div>
  );
}
