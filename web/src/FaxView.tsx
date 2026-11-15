import { useEffect, useRef, useState } from 'react';
import type { Field, FieldName } from '../../src/extract/schema.js';
import type { SampleFax } from '../../src/samples/schema.js';
import type { InboxItem } from './data';
import { FIELD_LABELS, NOT_FOUND_TEXT } from './field-labels';
import { READER_LABEL, type ReaderName } from './flags';
import { ghostRects } from './ghost';
import { reviewLabel } from './review';

interface FaxViewProps {
  item: InboxItem;
  fax: SampleFax;
  reader: ReaderName;
  onReaderChange: (reader: ReaderName) => void;
  onBack: () => void;
}

const READER_CHOICES: { name: ReaderName; label: string }[] = [
  { name: 'model', label: 'Model answers' },
  { name: 'rules', label: 'Rules reader' },
];

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function usePrefersReducedMotion(): boolean {
  const query = () => (typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION) : null);
  const [reduced, setReduced] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const list = query();
    if (!list) return;
    const update = () => setReduced(list.matches);
    update();
    list.addEventListener?.('change', update);
    return () => list.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

interface Selection {
  name: FieldName;
  /** Counts selections, so choosing a field again pulses its ghost again. */
  count: number;
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);
  return (
    <span className="confidence">
      <span>Confidence: {percent}%</span>
      <span className="confidence-bar" aria-hidden="true">
        <span className="confidence-fill" style={{ width: `${percent}%` }} />
      </span>
    </span>
  );
}

function FieldItem({ field, selected, onSelect }: { field: Field; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        className={selected ? 'field-item field-selected' : 'field-item'}
        aria-pressed={selected}
        data-field={field.name}
        onClick={onSelect}
      >
        <span className="field-name">{FIELD_LABELS[field.name]}</span>
        <span className={field.value === null ? 'field-value field-empty' : 'field-value'}>
          {field.value ?? NOT_FOUND_TEXT}
        </span>
        <ConfidenceBar confidence={field.confidence} />
        {field.flags.map((message) => (
          <span key={message} className="field-flag">
            <span aria-hidden="true">⚑</span> <span>{message}</span>
          </span>
        ))}
      </button>
    </li>
  );
}

function selectionLine(fields: Field[], selection: Selection | null): string {
  const field = selection ? fields.find((f) => f.name === selection.name) : undefined;
  if (!field) return '';
  const label = FIELD_LABELS[field.name];
  if (field.value === null) {
    return `Showing source for ${label}: ${NOT_FOUND_TEXT.toLowerCase()}, so there is nothing to highlight.`;
  }
  return `Showing source for ${label}: ${field.value}`;
}

/**
 * The fax screen. The image and the source ghosts share one SVG coordinate system
 * (viewBox = the fax size in pixels), so they scale together. Ghost rectangles are
 * drawn straight from OCR word boxes, found by word ID.
 */
export function FaxView({ item, fax, reader, onReaderChange, onBack }: FaxViewProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [selection, setSelection] = useState<Selection | null>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const result = fax.readers[reader];
  const fields = result.status === 'ok' ? result.fields : [];
  const status = reviewLabel(fax);
  const imageName = `Faxed referral form, fax ${item.entry.id}, with source highlights`;

  function ghostClass(selected: boolean): string {
    if (!selected) return 'ghost';
    return reducedMotion ? 'ghost ghost-selected ghost-static' : 'ghost ghost-selected ghost-pulse';
  }

  // The selected field is drawn last so it sits on top of the others.
  const ordered = [...fields.filter((f) => f.name !== selection?.name), ...fields.filter((f) => f.name === selection?.name)];

  return (
    <section aria-labelledby="fax-title" className="fax-view">
      <button type="button" className="button back-button" onClick={onBack}>
        Back to inbox
      </button>
      <div className="fax-title-row">
        <h2 id="fax-title" tabIndex={-1} ref={heading}>
          Fax {item.entry.id}
        </h2>
        {status && (
          <span className="review-status">
            <span aria-hidden="true">○</span> {status}
          </span>
        )}
      </div>
      <p className="reader-name">{READER_LABEL[reader]}</p>
      <div role="group" aria-label="Which reader to show" className="reader-toggle">
        {READER_CHOICES.map((choice) => (
          <button
            key={choice.name}
            type="button"
            className="button toggle-button"
            aria-pressed={reader === choice.name}
            onClick={() => onReaderChange(choice.name)}
          >
            {choice.label}
          </button>
        ))}
      </div>

      <div className="viewer">
        <div className="viewer-image">
          <svg
            className="fax-image"
            viewBox={`0 0 ${fax.width} ${fax.height}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ aspectRatio: `${fax.width} / ${fax.height}` }}
            role="img"
            aria-label={imageName}
          >
            <image href={item.imageUrl} x={0} y={0} width={fax.width} height={fax.height} />
            {ordered.map((field) => {
              const selected = selection?.name === field.name;
              const rects = ghostRects(field, fax.ocr.words);
              if (rects.length === 0) return null;
              return (
                <g
                  key={selected ? `${field.name}-${selection?.count}` : field.name}
                  className={ghostClass(selected)}
                  data-field={field.name}
                  data-selected={selected}
                >
                  {rects.map((rect) => (
                    <rect
                      key={rect.id}
                      data-word-id={rect.id}
                      x={rect.x}
                      y={rect.y}
                      width={rect.width}
                      height={rect.height}
                    />
                  ))}
                </g>
              );
            })}
          </svg>
          <p role="status" className="selection-line">
            {selectionLine(fields, selection)}
          </p>
        </div>

        <div className="viewer-side">
          {result.status === 'ok' ? (
            <ul className="field-list" aria-label="Fields read from this fax">
              {result.fields.map((field) => (
                <FieldItem
                  key={field.name}
                  field={field}
                  selected={selection?.name === field.name}
                  onSelect={() => setSelection((current) => ({ name: field.name, count: (current?.count ?? 0) + 1 }))}
                />
              ))}
            </ul>
          ) : (
            <div className="problem-box no-answer">
              <p>
                <span aria-hidden="true">–</span> {result.message}
              </p>
              {reader === 'model' && (
                <button type="button" className="button" onClick={() => onReaderChange('rules')}>
                  Show the rules reader
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
