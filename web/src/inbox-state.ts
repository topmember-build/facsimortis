/** How many sample faxes wait for the "Incoming fax" button instead of showing at the start. */
export const HELD_BACK_FAXES = 1;

/** Message shown once every sample fax is in the inbox. */
export const NO_MORE_FAXES_MESSAGE = 'No more sample faxes.';

/** All sample faxes except the last HELD_BACK_FAXES are in the inbox at the start. */
export function initialVisibleCount(total: number): number {
  return Math.max(0, total - HELD_BACK_FAXES);
}

/** Each press of "Incoming fax" reveals the next fax in index order, up to the total. */
export function revealNext(visible: number, total: number): number {
  return Math.min(total, visible + 1);
}
