import { act, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootScreen } from './BootScreen';

// The boot screen on its own. The timing tests fake setTimeout only, so nothing else slows down.
afterEach(() => {
  vi.useRealTimers();
});

const fakeClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const status = () => screen.getByRole('status');
const lines = () => Array.from(document.querySelectorAll('.boot-line')).map((line) => line.textContent);

describe('boot screen', () => {
  it('shows the wordmark, the three lines in order, the prompt and a focused Receive faxes button', () => {
    render(<BootScreen loading={false} onContinue={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Facsimortis' })).toBeInTheDocument();
    expect(lines()).toEqual(['Dialling…', 'Handshake…', 'Ready']);
    expect(screen.getByText('Press any key or select Receive faxes')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Receive faxes' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveFocus();
  });

  it('puts all three lines in the page at once: only CSS staggers them, so reduced motion shows them together', () => {
    fakeClock();
    render(<BootScreen loading={false} onContinue={() => {}} />);
    // Before any time passes, all three are there. No script adds or reveals them later.
    expect(lines()).toHaveLength(3);
    advance(2000);
    expect(lines()).toHaveLength(3);
  });

  it('continues by itself after 5 seconds, not before, and only once', () => {
    fakeClock();
    const onContinue = vi.fn();
    render(<BootScreen loading={false} onContinue={onContinue} />);
    advance(4999);
    expect(onContinue).not.toHaveBeenCalled();
    advance(1);
    expect(onContinue).toHaveBeenCalledTimes(1);
    advance(10_000);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('keeps the 5 second countdown when it is drawn again', () => {
    fakeClock();
    const onContinue = vi.fn();
    const view = render(<BootScreen loading onContinue={onContinue} />);
    advance(3000);
    view.rerender(<BootScreen loading={false} onContinue={onContinue} />);
    advance(1999);
    expect(onContinue).not.toHaveBeenCalled();
    advance(1);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('continues on any key, once, and stops Enter, Space and Tab from also acting on the inbox', () => {
    for (const key of ['a', 'Enter', ' ', 'Tab', 'Escape']) {
      const onContinue = vi.fn();
      const view = render(<BootScreen loading={false} onContinue={onContinue} />);
      const notPrevented = fireEvent.keyDown(document.activeElement ?? document.body, { key });
      expect(onContinue, key).toHaveBeenCalledTimes(1);
      expect(notPrevented, key).toBe(!['Enter', ' ', 'Tab'].includes(key));
      fireEvent.keyDown(document.body, { key: 'b' });
      expect(onContinue, key).toHaveBeenCalledTimes(1);
      view.unmount();
    }
  });

  it('does not continue on a modifier alone or on a browser shortcut', () => {
    const onContinue = vi.fn();
    render(<BootScreen loading={false} onContinue={onContinue} />);
    fireEvent.keyDown(document.body, { key: 'Shift' });
    fireEvent.keyDown(document.body, { key: 'r', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Tab', altKey: true });
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('continues on the button or on a click anywhere, once in total', () => {
    const onContinue = vi.fn();
    const view = render(<BootScreen loading={false} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole('button', { name: 'Receive faxes' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    fireEvent.click(document.body);
    expect(onContinue).toHaveBeenCalledTimes(1);
    view.unmount();

    const other = vi.fn();
    render(<BootScreen loading={false} onContinue={other} />);
    fireEvent.click(document.body);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('says "Receiving fax…" only after 150ms of loading, and clears it once the data is in', () => {
    fakeClock();
    const view = render(<BootScreen loading onContinue={() => {}} />);
    expect(status().textContent).toBe('');
    advance(149);
    expect(status().textContent).toBe('');
    advance(1);
    expect(status()).toHaveTextContent('Receiving fax…');
    view.rerender(<BootScreen loading={false} onContinue={() => {}} />);
    expect(status().textContent).toBe('');
  });

  it('never flashes "Receiving fax…" when the data is in within 150ms', () => {
    fakeClock();
    const view = render(<BootScreen loading onContinue={() => {}} />);
    advance(100);
    view.rerender(<BootScreen loading={false} onContinue={() => {}} />);
    advance(1000);
    expect(status().textContent).toBe('');
    view.unmount();

    render(<BootScreen loading={false} onContinue={() => {}} />);
    advance(1000);
    expect(status().textContent).toBe('');
  });

  it('is axe clean, with and without "Receiving fax…"', async () => {
    const { container } = render(<BootScreen loading onContinue={() => {}} />);
    expect((await axe.run(container)).violations).toEqual([]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(status()).toHaveTextContent('Receiving fax…');
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
