import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { NPI_FLAG } from '../../src/validators/messages.js';
import { cardFields, exportCardHtml, parseExport } from '../../tools/demo-capture/export-card.js';
import {
  BUTTON,
  acceptButton,
  editBox,
  editButton,
  faxHeading,
  faxIcon,
  fieldCard,
  flaggedInName,
  laidToRestHeading,
  nameMatcher,
  readerGroup,
  type Target,
} from '../../tools/demo-capture/labels.js';
import { DEMO_NOW_UTC, HOLD, TYPED_PHONE } from '../../tools/demo-capture/plan.js';
import { App } from '../../web/src/App';
import { BOOT_AUTO_CONTINUE_MS, BOOT_BUTTON_LABEL, type SessionStore } from '../../web/src/boot';
import { exportFileName, VerifiedRecordSchema } from '../../web/src/record';
import { MemoryStore } from '../../web/src/storage';
import { stubSite } from '../../web/src/test-site';

// V1a. This file sits outside web/ on purpose: nothing under web/ may refer to tools/ (test/mcp-records-deps.test.ts).
// The web test project runs it with the site's jsdom setup.
//
// Every label the demo capture scenes look for, walked through the app in scene order with the same
// targets the capture script uses (tools/demo-capture/labels.ts). A renamed label fails here, in CI, before
// any recording. Layout (ghosts, the source string) needs a real browser and is checked by demo:check (V1c).

class MapSession implements SessionStore {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const find = (target: Target) => screen.findByRole(target.role, { name: nameMatcher(target) });
const get = (target: Target) => screen.getByRole(target.role, { name: nameMatcher(target) });
const getAll = (target: Target) => screen.queryAllByRole(target.role, { name: nameMatcher(target) });

describe('the demo capture boot timing', () => {
  it('uses the boot button label and holds the boot screen well before it moves on by itself', () => {
    expect(BUTTON.receiveFaxes).toBe(BOOT_BUTTON_LABEL);
    expect(BOOT_AUTO_CONTINUE_MS - HOLD.bootScreen).toBeGreaterThanOrEqual(1_500);
  });
});

describe('the demo capture labels in the app, scene by scene', () => {
  it('finds every label and reaches each scene end state that does not need layout', async () => {
    stubSite();
    const user = userEvent.setup();
    const saved: { name: string; text: string }[] = [];
    render(
      <App
        boot
        session={new MapSession()}
        storage={new MemoryStore()}
        now={() => new Date(DEMO_NOW_UTC)}
        download={(name, text) => saved.push({ name, text })}
      />,
    );

    // Scene 1, Boot: Receive faxes opens the inbox with two faxes.
    await user.click(await find({ role: 'button', name: BUTTON.receiveFaxes }));
    await find(faxIcon('fax-0002'));
    expect(getAll(faxIcon('fax-0001'))).toHaveLength(1);
    expect(getAll(faxIcon('fax-0003'))).toHaveLength(0);

    // Scene 2, Inbox: Incoming fax brings fax-0003 with 2 flagged.
    await user.click(get({ role: 'button', name: BUTTON.incomingFax }));
    const fax3 = await find(faxIcon('fax-0003'));
    expect(fax3.getAttribute('aria-label')).toContain(flaggedInName(2));

    // Scene 3, Source ghost: open fax-0003, select Provider number, then Callback phone and back.
    await user.click(fax3);
    await find(faxHeading('fax-0003'));
    await user.click(get(fieldCard('npi')));
    expect(get(fieldCard('npi'))).toHaveAttribute('aria-pressed', 'true');
    await user.click(get(fieldCard('callbackPhone')));
    expect(get(fieldCard('callbackPhone'))).toHaveAttribute('aria-pressed', 'true');
    await user.click(get(fieldCard('npi')));
    expect(get(fieldCard('npi'))).toHaveAttribute('aria-pressed', 'true');

    // Scene 4, Resolve and verify: Accept anyway on the NPI, Edit the phone, type 555-0151, Save, Verify record.
    await user.click(get(acceptButton('npi')));
    await user.click(get(editButton('callbackPhone')));
    const box = get(editBox('callbackPhone'));
    expect(box).toHaveValue('555~0151');
    // The capture script selects all with the keyboard in Chrome; here the box is cleared the same way the
    // site's own tests do it, because the point is the labels.
    await user.clear(box);
    await user.type(box, TYPED_PHONE);
    await user.click(get({ role: 'button', name: BUTTON.save }));
    const verify = get({ role: 'button', name: BUTTON.verifyRecord });
    expect(verify).toBeEnabled();
    await user.click(verify);
    await find(laidToRestHeading);

    // Scene 5, Export: Download JSON saves the record; the export card reads it.
    await user.click(get({ role: 'button', name: BUTTON.downloadJson }));
    expect(saved).toHaveLength(1);
    const file = saved[0]!;
    const record = VerifiedRecordSchema.parse(JSON.parse(file.text));
    expect(file.name).toBe(exportFileName(record));
    expect(record.verifiedAtUtc).toBe(DEMO_NOW_UTC);
    const excerpt = parseExport(file.text, file.name);
    expect(cardFields(excerpt)).toEqual([
      {
        label: 'Provider number (NPI)',
        lines: [
          { caption: 'As read from the page', key: 'originalValue', value: '"6720988041"', flag: false },
          { caption: 'Accepted although the check failed', key: 'acceptedDespiteFlag', value: 'true', flag: true },
          { caption: 'The check that failed', key: 'failedChecks', value: JSON.stringify(NPI_FLAG), flag: true },
        ],
      },
      {
        label: 'Callback phone',
        lines: [
          { caption: 'As read from the page', key: 'originalValue', value: '"555~0151"', flag: false },
          { caption: 'Edited by the reviewer', key: 'finalValue', value: JSON.stringify(TYPED_PHONE), flag: false },
        ],
      },
    ]);
    const html = exportCardHtml(excerpt, { fileName: file.name, siteUrl: 'http://localhost:4173/facsimortis/' });
    expect(html).toContain(record.notice);
    expect(html).toContain(record.verifier);

    // Scene 6, Two readers: Back to inbox, fax-0002 on the model reader (no flags), then the rules reader
    // (three flags), then the referring provider card.
    await user.click(get({ role: 'button', name: BUTTON.backToInbox }));
    await user.click(await find(faxIcon('fax-0002')));
    await find(faxHeading('fax-0002'));
    const group = within(get(readerGroup));
    expect(group.getByRole('button', { name: BUTTON.modelAnswers })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('No fields are flagged.')).toBeInTheDocument();
    await user.click(group.getByRole('button', { name: BUTTON.rulesReader }));
    expect(group.getByRole('button', { name: BUTTON.rulesReader })).toHaveAttribute('aria-pressed', 'true');
    const flagged = document.querySelector('[data-section="needs-your-eyes"]')!;
    expect(flagged.querySelectorAll('button[data-field]')).toHaveLength(3);
    await user.click(get(fieldCard('referringProvider')));
    expect(get(fieldCard('referringProvider'))).toHaveAttribute('aria-pressed', 'true');
  });
});
