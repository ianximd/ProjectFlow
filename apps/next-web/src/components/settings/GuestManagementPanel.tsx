'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { Guest, GuestInvite, HierarchyNodeType, ObjectPermissionLevel } from '@projectflow/types';
import { notifyActionError } from '@/lib/apiErrorToast';
import { inviteGuest, revokeGuest } from '@/server/actions/guests';
import styles from './GuestManagementPanel.module.css';

const LEVELS: ObjectPermissionLevel[] = ['VIEW', 'COMMENT', 'EDIT', 'FULL'];

export interface ObjectOption {
  type: HierarchyNodeType;
  id: string;
  label: string;
}

interface Props {
  workspaceId: string;
  initialGuests: Guest[];
  initialPending: GuestInvite[];
  objectOptions: ObjectOption[];
}

export function GuestManagementPanel({
  workspaceId,
  initialGuests,
  initialPending,
  objectOptions,
}: Props) {
  const t = useTranslations('Guests');

  const [guests, setGuests]           = useState<Guest[]>(initialGuests);
  const [pending]                     = useState<GuestInvite[]>(initialPending);
  const [email, setEmail]             = useState('');
  const [objectKey, setObjectKey]     = useState(
    objectOptions.length > 0 ? `${objectOptions[0]!.type}:${objectOptions[0]!.id}` : '',
  );
  const [level, setLevel]             = useState<ObjectPermissionLevel>('VIEW');
  const [inviting, startInvite]       = useTransition();
  const [revoking, startRevoke]       = useTransition();
  const [revokingId, setRevokingId]   = useState<string | null>(null);

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !objectKey) return;
    const [objectType, objectId] = objectKey.split(':') as [HierarchyNodeType, string];
    startInvite(async () => {
      const r = await inviteGuest({ workspaceId, email: email.trim(), objectType, objectId, level });
      if (!r.ok) {
        notifyActionError(r);
      } else {
        setEmail('');
      }
    });
  }

  function handleRevoke(userId: string) {
    setRevokingId(userId);
    startRevoke(async () => {
      const r = await revokeGuest(workspaceId, userId);
      if (!r.ok) {
        notifyActionError(r);
      } else {
        setGuests((prev) => prev.filter((g) => g.userId !== userId));
      }
      setRevokingId(null);
    });
  }

  return (
    <div className={styles.root}>
      <h3 className={styles.heading}>{t('title')}</h3>

      {/* Invite form */}
      <form onSubmit={handleInvite} className={styles.inviteRow}>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('emailPlaceholder')}
          className={styles.input}
          aria-label={t('email')}
          disabled={inviting}
        />
        <select
          value={objectKey}
          onChange={(e) => setObjectKey(e.target.value)}
          className={styles.select}
          aria-label={t('object')}
          disabled={inviting || objectOptions.length === 0}
        >
          {objectOptions.map((o) => (
            <option key={`${o.type}:${o.id}`} value={`${o.type}:${o.id}`}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as ObjectPermissionLevel)}
          className={styles.select}
          aria-label={t('level')}
          disabled={inviting}
        >
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {t(`levels.${l}`)}
            </option>
          ))}
        </select>
        <button type="submit" className={styles.inviteBtn} disabled={inviting || !email.trim() || !objectKey}>
          {t('invite')}
        </button>
      </form>

      <p className={styles.hint}>{t('spaceRuleHint')}</p>

      {/* Guest list */}
      {guests.length === 0 && pending.length === 0 ? (
        <p className={styles.empty}>{t('noGrants')}</p>
      ) : (
        <ul className={styles.list}>
          {guests.map((g) => {
            const roleKey = g.roleSlug === 'workspace-limited-member' ? 'limited' : 'guest';
            const grantsText = g.grants.length > 0
              ? g.grants.map((gr) => `${gr.objectType} · ${gr.level}`).join(', ')
              : t('noGrants');
            return (
              <li key={g.userId} className={styles.guestRow}>
                <span className={styles.guestEmail}>{g.email}</span>
                <span className={styles.guestRole}>{t(`roles.${roleKey}`)}</span>
                <span className={styles.guestGrants}>{grantsText}</span>
                <button
                  type="button"
                  className={styles.revokeBtn}
                  onClick={() => handleRevoke(g.userId)}
                  disabled={revoking && revokingId === g.userId}
                  aria-label={`${t('revoke')} ${g.email}`}
                >
                  {t('revoke')}
                </button>
              </li>
            );
          })}
          {pending.map((inv) => (
            <li key={inv.id} className={`${styles.guestRow} ${styles.pendingRow}`}>
              <span className={styles.guestEmail}>{inv.email}</span>
              <span className={styles.guestRole}>{t('statusPending')}</span>
              <span className={styles.guestGrants}>{`${inv.objectType} · ${inv.level}`}</span>
              <span />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
