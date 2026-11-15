import { useEffect, useRef } from 'react';
import type { InboxItem } from './data';
import { READER_LABEL, type ReaderName } from './flags';
import type { SampleFax } from '../../src/samples/schema.js';

interface FaxViewProps {
  item: InboxItem;
  fax: SampleFax;
  reader: ReaderName;
  onBack: () => void;
}

/** Minimal fax screen: the full page image, which fax it is, and a way back. */
export function FaxView({ item, fax, reader, onBack }: FaxViewProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section aria-labelledby="fax-title" className="fax-view">
      <button type="button" className="button" onClick={onBack}>
        Back to inbox
      </button>
      <h2 id="fax-title" tabIndex={-1} ref={heading}>
        Fax {item.entry.id}
      </h2>
      <p className="reader-name">{READER_LABEL[reader]}</p>
      <img
        className="fax-image"
        src={item.imageUrl}
        alt={`Faxed referral form, fax ${item.entry.id}`}
        width={fax.width}
        height={fax.height}
      />
    </section>
  );
}
