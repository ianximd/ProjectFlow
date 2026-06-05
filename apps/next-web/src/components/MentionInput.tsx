'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { mentionToken } from '@/lib/mentions';

export interface MentionMember { userId: string; name: string }

export function MentionInput({
  value, onChange, members, placeholder, onSubmit,
}: {
  value: string;
  onChange: (next: string) => void;
  members: MentionMember[];
  placeholder?: string;
  onSubmit?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);

  // Close the suggestion dropdown when the parent clears the field (e.g. after
  // a successful submit) — otherwise a mid-mention dropdown lingers over the
  // now-empty textarea until the next keystroke.
  useEffect(() => { if (!value) setQuery(null); }, [value]);

  function recompute(next: string) {
    const m = /(^|\s)@([\p{L}0-9_]*)$/u.exec(next);
    setQuery(m ? m[2] : null);
  }
  function handleChange(next: string) { onChange(next); recompute(next); }

  function pick(member: MentionMember) {
    const replaced = value.replace(/(^|\s)@([\p{L}0-9_]*)$/u, (_, pre) => `${pre}${mentionToken(member.name, member.userId)} `);
    onChange(replaced);
    setQuery(null);
    ref.current?.focus();
  }

  const suggestions = query !== null
    ? members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6)
    : [];

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) { e.preventDefault(); onSubmit(); }
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-y rounded-md border bg-background p-2 text-sm"
      />
      {suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-64 rounded-md border bg-popover p-1 shadow-md" role="listbox">
          {suggestions.map((m) => (
            <li key={m.userId} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex w-full items-center rounded px-2 py-1 text-left text-sm hover:bg-accent"
                onClick={() => pick(m)}
              >
                @{m.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
