import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AUTOMATION_TEMPLATES,
  TEMPLATE_STRINGS,
  getTemplateCatalog,
} from '../automation.templates.js';
import {
  ruleShapeSchema,
  TRIGGER_TYPES,
  CONDITION_TYPES,
  OPERATORS,
  ACTION_TYPES,
} from '../automation.templates.schema.js';

// The web Automations namespace is the source of truth for the in-app gallery
// labels; the catalog-localization invariant asserts every key exists in both.
function loadAutomations(file: string): Record<string, string> {
  const raw = readFileSync(resolve(process.cwd(), '../next-web/messages', file), 'utf8');
  return (JSON.parse(raw) as any).Automations as Record<string, string>;
}
const enAuto = loadAutomations('en.json');
const idAuto = loadAutomations('id.json');

const TRIG = new Set<string>(TRIGGER_TYPES);
const COND = new Set<string>(CONDITION_TYPES);
const OPS  = new Set<string>(OPERATORS);
const ACT  = new Set<string>(ACTION_TYPES);

describe('automation template catalog', () => {
  it('ships 15–20 templates with unique keys (BUILD_PLAN §7.6)', () => {
    expect(AUTOMATION_TEMPLATES.length).toBeGreaterThanOrEqual(15);
    expect(AUTOMATION_TEMPLATES.length).toBeLessThanOrEqual(20);
    const keys = AUTOMATION_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every template validates against the shared rule schema (savable as a real rule)', () => {
    for (const tpl of AUTOMATION_TEMPLATES) {
      const parsed = ruleShapeSchema.safeParse({
        trigger: tpl.trigger, conditions: tpl.conditions, actions: tpl.actions,
      });
      expect(parsed.success, `template '${tpl.key}': ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
      // Round-trip: the schema must PRESERVE the trigger (not silently strip
      // option keys like FIELD_CHANGED's `field`), else "Use template" saves a
      // weaker rule than the card advertises.
      if (parsed.success) expect(parsed.data.trigger).toMatchObject(tpl.trigger as any);
    }
  });

  it('every template uses only real trigger/condition/operator/action tokens', () => {
    for (const tpl of AUTOMATION_TEMPLATES) {
      expect(TRIG.has((tpl.trigger as any).type), `trigger ${tpl.key}`).toBe(true);
      for (const a of tpl.actions) expect(ACT.has((a as any).type), `action ${tpl.key}`).toBe(true);
      // The catalog uses flat leaf arrays today; assert that invariant so a
      // future AND/OR-tree template forces this token check to be extended.
      expect(Array.isArray(tpl.conditions), `conditions flat-array ${tpl.key}`).toBe(true);
      for (const c of tpl.conditions as any[]) {
        // leaves only in the catalog (no AND/OR groups); guard either shape.
        if ((c as any).type) {
          expect(COND.has((c as any).type), `cond ${tpl.key}`).toBe(true);
          if ((c as any).operator) expect(OPS.has((c as any).operator), `op ${tpl.key}`).toBe(true);
        }
      }
    }
  });

  it('every template has at least one action', () => {
    for (const tpl of AUTOMATION_TEMPLATES) expect(tpl.actions.length).toBeGreaterThan(0);
  });

  it('the API-side TEMPLATE_STRINGS covers every template in en + id', () => {
    for (const tpl of AUTOMATION_TEMPLATES) {
      expect(TEMPLATE_STRINGS.en[tpl.key]?.title, `en str ${tpl.key}`).toBeTruthy();
      expect(TEMPLATE_STRINGS.id[tpl.key]?.title, `id str ${tpl.key}`).toBeTruthy();
    }
  });

  it('each i18nTitleKey/i18nDescKey exists in BOTH en.json and id.json (Automations namespace)', () => {
    for (const tpl of AUTOMATION_TEMPLATES) {
      expect(enAuto[tpl.i18nTitleKey], `en missing ${tpl.i18nTitleKey}`).toBeTruthy();
      expect(enAuto[tpl.i18nDescKey],  `en missing ${tpl.i18nDescKey}`).toBeTruthy();
      expect(idAuto[tpl.i18nTitleKey], `id missing ${tpl.i18nTitleKey}`).toBeTruthy();
      expect(idAuto[tpl.i18nDescKey],  `id missing ${tpl.i18nDescKey}`).toBeTruthy();
    }
  });

  it('getTemplateCatalog localizes titles for id', () => {
    const en = getTemplateCatalog('en');
    const id = getTemplateCatalog('id');
    expect(en[0].title).toBe(TEMPLATE_STRINGS.en[en[0].key].title);
    expect(id[0].title).toBe(TEMPLATE_STRINGS.id[id[0].key].title);
    expect(id[0].title).not.toBe(en[0].title); // genuinely translated
  });
});
