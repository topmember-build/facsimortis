import { describe, expect, it } from 'vitest';
import { editLabel } from '../web/src/edit-hints.js';
import { FIELD_LABELS } from '../web/src/field-labels.js';
import {
  BUTTON,
  FIELD_CARD,
  acceptButton,
  describeTarget,
  editBox,
  editButton,
  faxIcon,
  fieldCard,
  nameMatcher,
} from '../tools/demo-capture/labels.js';
import { DEMO_NOW_UTC, HOLD, SCENES, TARGET_MARGIN, TYPED_PHONE, goalMs } from '../tools/demo-capture/plan.js';

// V1a. The labels the capture scenes use, checked against the site's own exported constants that the root
// project can import. The boot constants use browser types, and the labels that live only in the site's
// components (Accept anyway, Save, Verify record, the reader toggle and the rest) are checked in
// web/src/DemoCaptureLabels.test.tsx, by walking the app.

describe('demo capture labels against the site constants', () => {
  it('uses the site field names for the field cards and the edit box', () => {
    for (const [field, label] of Object.entries(FIELD_CARD)) {
      expect(label).toBe(FIELD_LABELS[field as keyof typeof FIELD_LABELS]);
    }
    expect(editBox('callbackPhone').name).toBe(editLabel(FIELD_LABELS.callbackPhone));
  });

  it('names the Accept and Edit buttons with the hidden field name, as screen readers hear them', () => {
    expect(acceptButton('npi').name).toBe('Accept anyway Provider number (NPI)');
    expect(editButton('callbackPhone').name).toBe('Edit Callback phone');
  });

  it('matches fax icons and field cards by the start of the name only', () => {
    const icon = nameMatcher(faxIcon('fax-0003'));
    expect(icon).toBeInstanceOf(RegExp);
    expect((icon as RegExp).test('fax-0003, received Oct 1, 09:14, 2 flagged, not yet reviewed')).toBe(true);
    expect((icon as RegExp).test('x fax-0003, received Oct 1')).toBe(false);
    expect((icon as RegExp).test('fax-00031, received Oct 1')).toBe(false);
    // The brackets in "(NPI)" are matched literally.
    const card = nameMatcher(fieldCard('npi')) as RegExp;
    expect(card.test('Provider number (NPI) 6720988041')).toBe(true);
    expect(card.test('Provider number NPI 6720988041')).toBe(false);
    expect(nameMatcher({ role: 'button', name: BUTTON.save })).toBe('Save');
  });

  it('describes targets in words for the error that stops a run', () => {
    expect(describeTarget({ role: 'button', name: 'Save' })).toBe('button "Save"');
    expect(describeTarget(faxIcon('fax-0003'))).toBe('button whose name starts with "fax-0003, received "');
  });
});

describe('demo capture plan', () => {
  it('holds the boot screen for 3 s', () => {
    expect(HOLD.bootScreen).toBe(3_000);
  });

  it('has the six scenes in order, each with a goal of its target plus about 15%', () => {
    expect(SCENES.map((scene) => scene.id)).toEqual(['scene-1', 'scene-2', 'scene-3', 'scene-4', 'scene-5', 'scene-6']);
    expect(TARGET_MARGIN).toBe(0.15);
    expect(SCENES.map(goalMs)).toEqual([13_800, 20_700, 43_700, 27_600, 18_400, 27_600]);
  });

  it('types a phone number in a usual format and fixes the clock in UTC', () => {
    expect(TYPED_PHONE).toBe('555-0151');
    expect(new Date(DEMO_NOW_UTC).toISOString()).toBe(DEMO_NOW_UTC);
  });
});
