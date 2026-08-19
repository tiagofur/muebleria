/**
 * F108 — Contraste AA medido, no estimado.
 *
 * Verifica por par foreground/superficie que los roles de texto legible y los
 * pares de badge semánticos (texto -700 sobre tinte -50) sostengan WCAG AA
 * (4.5:1 para texto normal; los badges usan --text-xs 12px semibold, por lo
 * que NO califican como large text). Valores en docs/design.md §4.8.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

type HslColor = readonly [number, number, number];

function readToken(name: string): HslColor {
  const tokens = readFileSync(join(here, 'tokens.css'), 'utf8');
  const match = tokens.match(
    new RegExp(`--${name}: hsl\\((\\d+) (\\d+)% (\\d+)%\\)`),
  );
  if (!match) throw new Error(`Missing literal hsl() token: --${name}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function relativeLuminance([hue, saturation, lightness]: HslColor): number {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const huePrime = hue / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const [r, g, b] =
    huePrime < 1 ? [chroma, x, 0]
      : huePrime < 2 ? [x, chroma, 0]
        : huePrime < 3 ? [0, chroma, x]
          : huePrime < 4 ? [0, x, chroma]
            : huePrime < 5 ? [x, 0, chroma]
              : [chroma, 0, x];
  const offset = l - chroma / 2;
  const channel = (value: number): number => {
    const srgb = value + offset;
    return srgb <= 0.04045
      ? srgb / 12.92
      : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(foreground: HslColor, background: HslColor): number {
  const [first, second] = [relativeLuminance(foreground), relativeLuminance(background)]
    .sort((a, b) => b - a);
  return (first! + 0.05) / (second! + 0.05);
}

describe('Text and semantic AA contrast pairs (F108)', () => {
  it.each(
    [
      'text-primary',
      'text-secondary',
      'text-muted',
    ].flatMap((fg) =>
      [
        ['white', [0, 0, 100] as HslColor],
        ['surface-app', readToken('surface-app')],
        ['surface-card', readToken('surface-card')],
        ['surface-hover', readToken('surface-hover')],
        ['surface-input', readToken('surface-input')],
        ['surface-selected', readToken('surface-selected')],
      ].map(([label, bg]) => [fg, label as string, bg as HslColor] as const),
    ),
  )('%s on %s is >=4.5:1', (fg, label, bg) => {
    const ratio = contrastRatio(readToken(fg), bg);
    expect(ratio, `${fg} on ${label}`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(
    [
      ['warning-700', 'warning-50'],
      ['success-700', 'success-50'],
      ['danger-700', 'danger-50'],
      ['info-700', 'info-50'],
      ['brand-700', 'brand-50'],
    ] as const,
  )('%s on %s (status badge pair) is >=4.5:1', (fg, bg) => {
    const ratio = contrastRatio(readToken(fg), readToken(bg));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('warning-700 is also readable on plain surfaces (white/app)', () => {
    expect(contrastRatio(readToken('warning-700'), [0, 0, 100])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(readToken('warning-700'), readToken('surface-app'))).toBeGreaterThanOrEqual(4.5);
  });

  it('login placeholder alpha keeps AA over the darkest possible card', () => {
    const css = readFileSync(join(here, '../auth/login.css'), 'utf8');
    const match = css.match(
      /\.login-field__input::placeholder\s*\{[\s\S]*?--text-inverse\) (\d+)%/,
    );
    expect(match).not.toBeNull();
    const alpha = Number(match![1]) / 100;
    expect(alpha).toBeGreaterThanOrEqual(0.6);
  });
});
