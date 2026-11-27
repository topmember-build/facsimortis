/**
 * Every on-screen label the demo scenes look for, exactly as the site shows it (found in web/src).
 * test/demo-capture-labels.test.ts checks them against the site's own constants and source, and
 * web/src/DemoCaptureLabels.test.tsx walks every scene's labels through the app, so a renamed label
 * fails a test instead of a recording.
 *
 * A target is a role and an accessible name. Most names are matched exactly. A fax icon and a field card
 * carry more in their name (the received time and status, or the value and confidence), so those are
 * matched by the start of the name.
 */

export type Role = 'button' | 'heading' | 'textbox' | 'group';

export interface Target {
  role: Role;
  name: string;
  /** "exact" (the default): the whole accessible name. "prefix": the name starts with `name`. */
  match?: 'exact' | 'prefix';
}

export const BUTTON = {
  receiveFaxes: 'Receive faxes',
  incomingFax: 'Incoming fax',
  backToInbox: 'Back to inbox',
  modelAnswers: 'Model answers',
  rulesReader: 'Rules reader',
  save: 'Save',
  verifyRecord: 'Verify record',
  downloadJson: 'Download JSON',
} as const;

/** The group around the Model answers / Rules reader toggle. */
export const READER_GROUP = 'Which reader to show';

/** The heading of the verified panel. */
export const LAID_TO_REST = 'Laid to rest';

/** The field cards the scenes use, by the site's field name. */
export const FIELD_CARD = {
  npi: 'Provider number (NPI)',
  callbackPhone: 'Callback phone',
  referringProvider: 'Referring provider',
} as const;

export type CardField = keyof typeof FIELD_CARD;

/** The visible "Accept anyway" plus the field name, which is there for screen readers only. */
export const ACCEPT_ANYWAY = 'Accept anyway';
/** The visible "Edit" plus the field name, which is there for screen readers only. */
export const EDIT = 'Edit';

export const button = (name: string): Target => ({ role: 'button', name });
export const acceptButton = (field: CardField): Target => button(`${ACCEPT_ANYWAY} ${FIELD_CARD[field]}`);
export const editButton = (field: CardField): Target => button(`${EDIT} ${FIELD_CARD[field]}`);
export const editBox = (field: CardField): Target => ({ role: 'textbox', name: `New value for ${FIELD_CARD[field]}` });
/** A field card: its name starts with the field name, then the value, the note and the confidence. */
export const fieldCard = (field: CardField): Target => ({ role: 'button', name: FIELD_CARD[field], match: 'prefix' });
/** A fax icon in the inbox, for example "fax-0003, received Oct 1, 09:14, 2 flagged, not yet reviewed". */
export const faxIcon = (faxId: string): Target => ({ role: 'button', name: `${faxId}, received `, match: 'prefix' });
/** The heading of an open fax, "Fax fax-0003" (the word "Fax" is for screen readers). */
export const faxHeading = (faxId: string): Target => ({ role: 'heading', name: `Fax ${faxId}` });
export const laidToRestHeading: Target = { role: 'heading', name: LAID_TO_REST };
export const readerGroup: Target = { role: 'group', name: READER_GROUP };

/** The part of a fax icon's name that says how many fields are flagged, for example ", 2 flagged, ". */
export const flaggedInName = (count: number): string => `, ${count} flagged, `;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What a role query should match: the exact string, or a pattern anchored at the start of the name. */
export function nameMatcher(target: Target): string | RegExp {
  return target.match === 'prefix' ? new RegExp(`^${escapeRegExp(target.name)}`) : target.name;
}

/** The target in words, for error messages: `button "Receive faxes"`. */
export function describeTarget(target: Target): string {
  return target.match === 'prefix'
    ? `${target.role} whose name starts with "${target.name}"`
    : `${target.role} "${target.name}"`;
}
