/**
 * Web export pipeline for client-facing A/B Commercial Scenario Comparison PDF (#137).
 */

import {
  calcProjectBreakdown,
  compareRoleScenario,
  projectWithRoleChoice,
  type Catalog,
  type Project,
} from '@muebles/domain';
import { commercialScenarioPdfExport } from '@muebles/excel';

export function scenarioPdfFileName(projectName: string): string {
  const trimmed = projectName.trim();
  const safe =
    trimmed
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'proyecto';
  return `comparativa-ab-${safe}.pdf`;
}

export type ExportScenarioPdfResult =
  | { readonly ok: true; readonly fileName: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string };

export async function buildCommercialScenarioPdfExport(
  project: Project,
  catalog: Catalog,
  role: string,
  choiceB: string,
  customerName?: string,
): Promise<ExportScenarioPdfResult> {
  const comp = compareRoleScenario(project, catalog, role, choiceB);
  if (!comp.ok) {
    return { ok: false, message: comp.message };
  }

  const group = (catalog.optionGroups ?? []).find((g) => g.code === role);
  const roleName = group ? `${group.name} (${group.code})` : role;

  const optionAId = project.projectLevelChoices?.[role] || project.items[0]?.optionChoices?.[role] || '';
  const optionAName = optionAId || 'Opción A (Actual)';

  let optionBName = choiceB;
  const matB = catalog.materials?.find((m) => m.id === choiceB);
  const hwB = catalog.hardware?.find((h) => h.id === choiceB);
  const edgeB = catalog.edges?.find((e) => e.id === choiceB);
  if (matB) optionBName = `${matB.name} (${matB.code})`;
  else if (hwB) optionBName = `${hwB.name || hwB.code}`;
  else if (edgeB) optionBName = `${edgeB.name} (${edgeB.code})`;

  try {
    const bytes = await commercialScenarioPdfExport({
      projectName: project.name,
      customerName,
      currency: project.currency,
      roleName,
      optionA: {
        name: optionAName,
        salePrice: comp.saleA,
        breakdown: comp.breakdownA,
      },
      optionB: {
        name: optionBName,
        salePrice: comp.saleB,
        breakdown: comp.breakdownB,
      },
    });

    return {
      ok: true,
      fileName: scenarioPdfFileName(project.name),
      bytes,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Error al generar el PDF comparativo',
    };
  }
}
