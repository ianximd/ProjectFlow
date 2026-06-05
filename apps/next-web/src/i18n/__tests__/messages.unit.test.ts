import { describe, it, expect } from 'vitest';
import en from '../../../messages/en.json';
import id from '../../../messages/id.json';

/** Flatten nested message object to dotted key paths. */
function keys(obj: Record<string, any>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('message catalogs', () => {
  it('en and id have identical key sets (no missing/extra translations)', () => {
    const enKeys = keys(en).sort();
    const idKeys = keys(id).sort();
    const missingInId = enKeys.filter((k) => !idKeys.includes(k));
    const extraInId = idKeys.filter((k) => !enKeys.includes(k));
    expect(missingInId, `keys missing from id.json: ${missingInId.join(', ')}`).toEqual([]);
    expect(extraInId, `keys present only in id.json: ${extraInId.join(', ')}`).toEqual([]);
  });

  it('has no empty string values in either catalog', () => {
    for (const [catalog, name] of [[en, 'en'], [id, 'id']] as const) {
      const empties = keys(catalog).filter((k) => {
        const val = k.split('.').reduce<any>((o, part) => o?.[part], catalog);
        return val === '';
      });
      expect(empties, `empty values in ${name}.json`).toEqual([]);
    }
  });
});
