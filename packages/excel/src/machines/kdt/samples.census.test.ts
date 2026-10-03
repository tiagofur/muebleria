import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { parseKdtPanelBytes } from './parse';

/**
 * Corpus goldens (#1005 K2): every one of the 417 real production XMLs from
 * docs/machines/client-b/samples/ must parse within the documented grammar,
 * and the corpus-wide census must match what docs/machines/kdt-xml-format.md
 * registers (TypeNo 4 never observed, TypeNo 5 exactly once, Z1 ≈ T/2 on
 * horizontal holes, exactly one PANEL and at most one AlignmentFace per
 * file, no numeric field with more than two decimals).
 */

const SAMPLES_URL = new URL('../../../../../docs/machines/client-b/samples/', import.meta.url);
const SAMPLE_NAMES = readdirSync(SAMPLES_URL).filter((name) => name.endsWith('.xml')).sort();

describe('census de las 417 muestras reales (grammar + spec §15)', () => {
  it('el corpus está completo (417 archivos XML)', () => {
    expect(SAMPLE_NAMES).toHaveLength(417);
  });

  it('cada archivo parsea: un PANEL, ≥4 vértices, ≤1 AlignmentFace, censo TypeNo correcto', () => {
    const typeNoCensus = new Map<number, number>();
    const filesWithTypeNo5: string[] = [];
    for (const name of SAMPLE_NAMES) {
      const bytes = readFileSync(new URL(name, SAMPLES_URL));
      // Ningún campo numérico con más de 2 decimales en todo el corpus.
      expect(/\d+\.\d{3,}/.test(new TextDecoder().decode(bytes)), `decimales en ${name}`).toBe(
        false,
      );
      const doc = parseKdtPanelBytes(bytes);
      expect(doc.panel.lengthMm).toBeGreaterThan(0);
      expect(doc.panel.outline.length).toBeGreaterThanOrEqual(4);
      const alignments = doc.panel.outline.filter((vertex) => vertex.banding === 2).length;
      expect(alignments, `AlignmentFace en ${name}`).toBeLessThanOrEqual(1);
      for (const operation of doc.operations) {
        typeNoCensus.set(operation.typeNo, (typeNoCensus.get(operation.typeNo) ?? 0) + 1);
        if (operation.typeNo === 5) filesWithTypeNo5.push(name);
      }
    }
    // Censo del spec: 1,2,3,6,7 presentes; 4 jamás observado; 5 una sola vez.
    expect([...typeNoCensus.keys()].sort()).toEqual([1, 2, 3, 5, 6, 7]);
    expect(filesWithTypeNo5).toEqual(['EN72268A.xml']);
  });

  it('regla Z1 dentro del espesor en todos los Horizontal Holes del corpus (+ cuadrante↔canto)', () => {
    // El spec registra "Z1 ≈ PanelThickness/2", pero el corpus real contiene
    // contraejemplos (BA42011A: Z1=7.5 con T=15.5, desviación 0.25 del
    // centro). Lo invariantemente cierto — y lo que el transform exige — es
    // 0 < Z1 < T. La regla del centro se valida en K4 con el operador.
    let checked = 0;
    let centered = 0;
    for (const name of SAMPLE_NAMES) {
      const doc = parseKdtPanelBytes(readFileSync(new URL(name, SAMPLES_URL)));
      for (const operation of doc.operations) {
        if (operation.kind !== 'horizontal-hole') continue;
        checked += 1;
        const z1 = operation.fields.Z1 ?? Number.NaN;
        expect(
          z1 > 0 && z1 < doc.panel.thicknessMm,
          `Z1 en ${name} (Z1=${z1}, T=${doc.panel.thicknessMm})`,
        ).toBe(true);
        if (Math.abs(z1 - doc.panel.thicknessMm / 2) <= 0.011) centered += 1;
        // Coherencia de cuadrante con la coordenada fija del canto (§7).
        const { Quadrant, X1, Y1 } = operation.fields;
        if (Quadrant === 1) expect(X1).toBe(doc.panel.lengthMm);
        if (Quadrant === 2) expect(X1).toBe(0);
        if (Quadrant === 3) expect(Y1).toBe(doc.panel.widthMm);
        if (Quadrant === 4) expect(Y1).toBe(0);
      }
    }
    expect(checked).toBeGreaterThan(0);
    // La mayoría absoluta está centrada en espesor (hardware estándar);
    // las excepciones son datos, no licencia del writer.
    expect(centered / checked).toBeGreaterThan(0.9);
  });
});
