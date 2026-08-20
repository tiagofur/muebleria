/**
 * Pure project/quotation draft validation helpers.
 */

import {
  validateNonNegativeNumber,
  validateRequiredName,
} from '../../catalogs/catalogHelpers';
import {
  PROJECT_STATUSES,
  type ProjectDraft,
} from './projectDraftTransforms';

export function validateProjectDraft(draft: ProjectDraft): string | null {
  const nameErr = validateRequiredName(draft.name);
  if (nameErr) return 'El nombre de la cotización es obligatorio.';

  const customerId = draft.customerId.trim();
  const newCustomerName = (draft.customerName ?? '').trim();
  if (!customerId && !newCustomerName) {
    return 'Seleccioná un cliente.';
  }

  const currency = draft.currency.trim();
  if (!currency) {
    return 'La moneda es obligatoria.';
  }

  const margin = Number(draft.marginFactor);
  if (!Number.isFinite(margin) || margin <= 0) {
    return 'El factor de margen debe ser un número mayor a 0.';
  }

  const labor = Number(draft.laborFixedCost);
  const laborErr = validateNonNegativeNumber(labor, 'Mano de obra fija');
  if (laborErr) return laborErr;

  if (!PROJECT_STATUSES.includes(draft.status)) {
    return 'Estado de cotización inválido.';
  }

  return null;
}

export function validateItemQuantity(quantity: number): string | null {
  if (!Number.isFinite(quantity)) {
    return 'La cantidad debe ser un número.';
  }
  if (!Number.isInteger(quantity)) {
    return 'La cantidad debe ser un entero.';
  }
  if (quantity < 1) {
    return 'La cantidad debe ser ≥ 1.';
  }
  return null;
}
