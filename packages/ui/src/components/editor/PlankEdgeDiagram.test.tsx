// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PlankEdgeDiagram, type EdgeStates } from './PlankEdgeDiagram';

afterEach(cleanup);

const allOff: EdgeStates = { L1: false, L2: false, W1: false, W2: false };
const twoOn: EdgeStates = { L1: true, L2: false, W1: true, W2: false };

describe('PlankEdgeDiagram', () => {
  it('renders the four edge buttons with their codes', () => {
    render(<PlankEdgeDiagram edges={allOff} onToggle={vi.fn()} lengthMm={720} widthMm={480} />);
    expect(screen.getByTestId('edge-L1')).toBeTruthy();
    expect(screen.getByTestId('edge-L2')).toBeTruthy();
    expect(screen.getByTestId('edge-W1')).toBeTruthy();
    expect(screen.getByTestId('edge-W2')).toBeTruthy();
  });

  it('marks encintado edges with aria-pressed=true', () => {
    render(<PlankEdgeDiagram edges={twoOn} onToggle={vi.fn()} lengthMm={720} widthMm={480} />);
    expect(screen.getByTestId('edge-L1').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('edge-W1').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('edge-L2').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('edge-W2').getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onToggle with the correct EdgeSide when an edge is clicked', () => {
    const onToggle = vi.fn();
    render(<PlankEdgeDiagram edges={allOff} onToggle={onToggle} lengthMm={720} widthMm={480} />);
    fireEvent.click(screen.getByTestId('edge-L1'));
    fireEvent.click(screen.getByTestId('edge-W2'));
    expect(onToggle).toHaveBeenNthCalledWith(1, 'L1');
    expect(onToggle).toHaveBeenNthCalledWith(2, 'W2');
  });

  it('toggles via keyboard (Enter and Space)', () => {
    const onToggle = vi.fn();
    render(<PlankEdgeDiagram edges={allOff} onToggle={onToggle} lengthMm={720} widthMm={480} />);
    const edge = screen.getByTestId('edge-L2');
    edge.focus();
    fireEvent.keyDown(edge, { key: 'Enter' });
    fireEvent.keyDown(edge, { key: ' ' });
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onToggle).toHaveBeenCalledWith('L2');
  });

  it('makes edges non-focusable and non-interactive when disabled', () => {
    const onToggle = vi.fn();
    render(<PlankEdgeDiagram edges={allOff} onToggle={onToggle} lengthMm={720} widthMm={480} disabled />);
    const edge = screen.getByTestId('edge-L1');
    expect(edge.getAttribute('tabindex')).toBe('-1');
    fireEvent.click(edge);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('describes the plank dimensions in the group label', () => {
    render(<PlankEdgeDiagram edges={allOff} onToggle={vi.fn()} lengthMm={720} widthMm={480} />);
    const svg = document.querySelector('.plank-edge-diagram__svg');
    expect(svg?.getAttribute('aria-label') ?? '').toContain('720');
    expect(svg?.getAttribute('aria-label') ?? '').toContain('480');
  });
});
