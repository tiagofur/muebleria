import { describe, expect, it } from 'vitest';
import { previewPartForComponent } from './previewComponentPart';

const dims = { PW: 600, PH: 720, PD: 560, T: 18 };

describe('previewPartForComponent', () => {
  it('applies placement heuristic rotation when rotateX/Y/Z are null (auto)', () => {
    const part = previewPartForComponent(
      {
        placement: 'lateral_izquierdo',
        lengthMm: 720,
        widthMm: 560,
        thicknessMm: 18,
        rotateX: null,
        rotateY: null,
        rotateZ: null,
      },
      dims,
    );
    // lateral_izquierdo heurística: [90,180,90] (validated mapping, see rotationMapping.test.ts)
    expect(part.rotateX).toBe(90);
    expect(part.rotateY).toBe(180);
    expect(part.rotateZ).toBe(90);
    // Default x position for a single left lateral is 0.
    expect(part.x).toBe(0);
  });

  it('respects explicit rotateX: 0 over the placement default (0 is valid, not unset)', () => {
    const part = previewPartForComponent(
      {
        placement: 'trasera',
        lengthMm: 720,
        widthMm: 600,
        thicknessMm: 18,
        rotateX: 0,
        rotateY: null,
        rotateZ: null,
      },
      dims,
    );
    // trasera default is rotateX:90; explicit 0 must win.
    expect(part.rotateX).toBe(0);
    expect(part.rotateY).toBe(0);
    expect(part.rotateZ).toBe(0);
  });

  it('evaluates xFormula against container dims (spatial H = thickness)', () => {
    const part = previewPartForComponent(
      {
        placement: 'custom',
        lengthMm: 720,
        widthMm: 560,
        thicknessMm: 18,
        xFormula: 'T',
      },
      dims,
    );
    expect(part.x).toBe(18); // T = 18
  });

  it('evaluates lengthFormula using parent dims (PH = parent height)', () => {
    const part = previewPartForComponent(
      {
        placement: 'lateral_izquierdo',
        lengthMm: 0,
        widthMm: 0,
        thicknessMm: 18,
        lengthFormula: 'PH',
        widthFormula: 'PD',
        rotateX: null,
        rotateY: null,
        rotateZ: null,
      },
      dims,
    );
    expect(part.lengthMm).toBe(720); // PH
    expect(part.widthMm).toBe(560); // PD
  });

  it('falls back to placement pose on axes without an explicit formula', () => {
    // trasera pose: x=T(18), y=0, z=T(18)
    const part = previewPartForComponent(
      {
        placement: 'trasera',
        lengthMm: 720,
        widthMm: 600,
        thicknessMm: 18,
        rotateX: null,
      },
      dims,
    );
    expect(part.x).toBe(18);
    expect(part.y).toBe(0);
    expect(part.z).toBe(18);
  });

  it('does not throw on a partial/invalid formula — falls back instead (preview tolerance)', () => {
    // Typing "P" into a formula field used to crash the editor via the error
    // boundary: the char passes the allowed-chars regex but matches no variable,
    // so `new Function('return (P)')` throws ReferenceError. Preview must be
    // tolerant because the user is typing the formula live.
    const part = previewPartForComponent(
      {
        placement: 'custom',
        lengthMm: 720,   // base value
        widthMm: 560,    // base value
        thicknessMm: 18,
        lengthFormula: 'P',            // invalid partial
        xFormula: 'PW -',              // invalid partial (trailing operator)
      },
      dims,
    );
    // Invalid formulas fall back to base dims / placement pose, never throw.
    expect(part.lengthMm).toBe(720);
    expect(part.x).toBe(0); // custom placement pose x
  });

  it('uses the evaluated value when a formula becomes valid mid-typing', () => {
    const part = previewPartForComponent(
      {
        placement: 'custom',
        lengthMm: 0,
        widthMm: 0,
        thicknessMm: 18,
        lengthFormula: 'PH - 31',   // valid → 720 - 31 = 689
        xFormula: 'T',              // valid → 18
      },
      dims,
    );
    expect(part.lengthMm).toBe(689);
    expect(part.x).toBe(18);
  });
});
