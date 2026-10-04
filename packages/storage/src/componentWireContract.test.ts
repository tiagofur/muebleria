import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Component } from '@granete/domain';
import { componentFromApi, componentToApi } from './apiMappers';

// R3 parity (#1063): contracts/componentWire.contract.json is the server READ
// wire for a fully-populated Component — proven stable against Go's
// marshal/unmarshal round-trip by
// backend-go/internal/api/component_wire_contract_test.go. This file pins the
// TS mappers to that same fixture in both directions: read (componentFromApi)
// and write (componentToApi, explicit nulls instead of omitempty, no
// timestamps). Perforations and canOpen never travel on this wire — drilling
// stays server-side and canOpen is derived from placement in the editor.
describe('Component wire contract (R3 parity, #1063)', () => {
  const fixture = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../contracts/componentWire.contract.json', import.meta.url)),
      'utf8',
    ),
  ) as Record<string, unknown>;

  it('maps the captured server read wire into the expected domain component', () => {
    const comp = componentFromApi(fixture);
    const expected: Component = {
      id: 'wire-comp-001',
      code: 'COM-WIRE-001',
      name: 'Lateral de prueba',
      placement: 'lateral_izquierdo',
      geometry: {
        kind: 'rectangular_board',
        lengthMm: 720,
        widthMm: 560,
        thicknessMm: 18,
        lengthFormula: 'PH',
        widthFormula: 'PD',
      },
      defaultEdges: [
        { side: 'L1', enabled: true },
        { side: 'W1', enabled: false },
      ],
      optionRoles: ['INTERIOR', 'LATERAL'],
      construction: {
        constructiveRole: 'lateral',
        connectionFaces: ['left', 'right'],
        joinerySystemId: 'screw-only',
      },
      notes: 'Lateral estándar del wire contract',
      active: true,
      xFormula: '0',
      yFormula: '0',
      zFormula: '0',
      rotateX: 90,
    };
    expect(comp).toEqual(expected);
  });

  it('emits the write wire the Go handler decodes for the same component', () => {
    const write = componentToApi(componentFromApi(fixture));
    expect(write).toEqual({
      id: 'wire-comp-001',
      code: 'COM-WIRE-001',
      name: 'Lateral de prueba',
      placement: 'lateral_izquierdo',
      geometry_kind: 'rectangular_board',
      length_mm: 720,
      width_mm: 560,
      thickness_mm: 18,
      length_formula: 'PH',
      width_formula: 'PD',
      x_formula: '0',
      y_formula: '0',
      z_formula: '0',
      rotate_x: 90,
      rotate_y: null,
      rotate_z: null,
      default_edges: [
        { side: 'L1', enabled: true },
        { side: 'W1', enabled: false },
      ],
      option_roles: ['INTERIOR', 'LATERAL'],
      construction: {
        constructive_role: 'lateral',
        connection_faces: ['left', 'right'],
        joinery_system_id: 'screw-only',
      },
      notes: 'Lateral estándar del wire contract',
      active: true,
    });
  });
});
