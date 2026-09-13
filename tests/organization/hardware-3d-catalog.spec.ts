import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

/**
 * #667 M2: Hardware 3D assets administration from React browser E2E
 * against the real Go backend + PostgreSQL container:
 *
 * 1. Upload new .skp model → finalize → exact revision bound → persisted across reloads.
 * 2. Edit hardware: changing name only preserves exact visualAsset binding.
 * 3. Add revision N+1 (.glb) to existing asset → select exact new revision → persisted.
 * 4. Cancel form with unbind draft does not alter persisted binding.
 * 5. Choose existing asset → exact revision binding → survives reload independently.
 * 6. Retire asset from new selections: requires confirmation, explains non-destructive scope,
 *    disables selection for new bindings, while keeping existing bindings intact.
 * 7. Unbind hardware: removes binding only from target hardware, does not delete asset.
 * 8. Organization B (vendedor role, no mutate permissions) cannot create, edit, or upload models.
 * 9. Responsive viewports at 390px, 768px, and 1280px with no horizontal overflow.
 */

async function getApi() {
  const base = required('ORGANIZATION_API_BASE');
  const loginResponse = await new GraneteApiClient(base).login({
    email: required('ORGANIZATION_GATE_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  return {
    base,
    repository: new APIWorkspaceRepository(base, { getAccessToken: () => loginResponse.token }),
    client: new GraneteApiClient(base),
    token: loginResponse.token,
  };
}

async function loginToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible();
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
}

test.describe.serial('Hardware 3D Asset Administration (#667 M2) browser E2E', () => {
  test('end-to-end hardware 3D asset lifecycle across real PostgreSQL and browser viewports', async ({ page }) => {
    test.setTimeout(120_000);
    const { repository } = await getApi();
    page.on('response', (res) => {
      if (!res.ok()) {
        console.log(`[HTTP ${res.status()}] ${res.request().method()} ${res.url()}`);
      }
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log(`[BROWSER ERROR] ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => {
      console.log(`[PAGE UNCAUGHT ERROR] ${err.message}\n${err.stack}`);
    });

    await loginToA(page);

    // Test responsive viewports
    for (const [width, height] of [[390, 844], [768, 900], [1280, 800]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto('/hardware');
      await expect(page.getByRole('heading', { name: 'Herrajes', exact: true })).toBeVisible();

      const overflow = await page.evaluate(
        () =>
          (document.scrollingElement?.scrollWidth ?? 0) -
          (document.scrollingElement?.clientWidth ?? 0),
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }

    // Set desktop viewport for the interactive walkthrough
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/hardware');
    await expect(page.getByRole('heading', { name: 'Herrajes', exact: true })).toBeVisible();

    // -------------------------------------------------------------------------
    // Step 1: Upload new .skp model and bind to new hardware
    // -------------------------------------------------------------------------
    await page.getByRole('button', { name: /Nuevo herraje/i }).click();
    await expect(page.getByRole('heading', { name: 'Nuevo herraje' })).toBeVisible();

    await page.getByLabel('Código').fill('HW-3D-01');
    await page.getByLabel('Nombre').fill('Tirador Tubular 128mm');
    await page.getByLabel('Costo unitario').fill('15.50');

    // Open 3D model section
    await page.getByTestId('hardware-3d-section-toggle').click();
    await expect(page.getByTestId('hardware-unbound-card')).toBeVisible();
    await expect(page.getByText('Sin modelo de archivo asociado')).toBeVisible();

    // Open upload modal
    await page.getByTestId('hardware-open-upload-btn').click();
    await expect(page.getByTestId('hardware-asset-upload-modal')).toBeVisible();

    // Fill upload form with dummy .skp bytes
    const skpContent = Buffer.from('skp-dummy-test-binary-content-rev1-data-stream');
    await page.getByTestId('hardware-asset-file-input').setInputFiles({
      name: 'tirador-tubular-128.skp',
      mimeType: 'application/octet-stream',
      buffer: skpContent,
    });
    await page.getByTestId('hardware-asset-name-input').fill('Tirador Tubular 3D Model');

    // Submit upload
    await page.getByTestId('hardware-asset-upload-submit-btn').click();
    await expect(page.getByTestId('hardware-upload-success')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('hardware-asset-upload-modal')).not.toBeVisible();

    // Verify bound card in hardware form modal
    await expect(page.getByTestId('hardware-bound-card')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('hardware-bound-card')).toContainText('SKP');
    await expect(page.getByTestId('hardware-bound-card')).toContainText('Rev. 1');
    await expect(page.getByTestId('hardware-bound-card')).toContainText('Pendiente de validación');
    await expect(page.getByTestId('hardware-bound-card')).toContainText('Archivo almacenado');

    // Submit hardware form
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('heading', { name: 'Nuevo herraje' })).not.toBeVisible();

    // Verify detail in table row
    const row01 = page.locator('tr.catalog-table__row').filter({ hasText: 'HW-3D-01' });
    await expect(row01).toBeVisible();
    await row01.click();

    const detail3D = page.getByTestId('hardware-detail-3d');
    await expect(detail3D).toBeVisible();
    await expect(detail3D).toContainText('SKP');
    await expect(detail3D).toContainText('Pendiente de validación');

    // Reload page and confirm persistence
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Herrajes', exact: true })).toBeVisible();
    const rowReloaded = page.locator('tr.catalog-table__row').filter({ hasText: 'HW-3D-01' });
    await expect(rowReloaded).toBeVisible();
    const detailReloaded = page.getByTestId('hardware-detail-3d');
    if (!(await detailReloaded.isVisible())) {
      await rowReloaded.click();
    }

    await expect(detailReloaded).toBeVisible();
    await expect(detailReloaded).toContainText('SKP');
    await expect(detailReloaded).toContainText('Pendiente de validación');

    // Confirm server-side persistence via API repository
    const catalogA = await repository.getCatalog();
    const persisted01 = catalogA.hardware.find((h) => h.code === 'HW-3D-01');
    expect(persisted01).toBeDefined();
    expect(persisted01?.visualAsset).toBeDefined();
    expect(persisted01?.visualAsset?.representation).toBe('skp');
    expect(persisted01?.visualAsset?.validationState).toBe('pending');
    const assetId = persisted01!.visualAsset!.assetId;
    const rev1Id = persisted01!.visualAsset!.assetRevisionId;
    expect(assetId).toBeTruthy();
    expect(rev1Id).toBeTruthy();

    // -------------------------------------------------------------------------
    // Step 2: Edit hardware, change ONLY name -> binding must be preserved
    // -------------------------------------------------------------------------
    await page.getByRole('button', { name: 'Editar HW-3D-01' }).click();
    await expect(page.getByRole('heading', { name: 'Editar herraje' })).toBeVisible();

    // Bound card is visible with Rev. 1
    await expect(page.getByTestId('hardware-bound-card')).toBeVisible();
    await expect(page.getByTestId('hardware-bound-card')).toContainText('Rev. 1');

    // Change only the name
    await page.getByLabel('Nombre').fill('Tirador Tubular Renombrado');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar herraje' })).not.toBeVisible();

    // Reload page and verify binding is strictly identical
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Herrajes', exact: true })).toBeVisible();
    const catalogA2 = await repository.getCatalog();
    const renamed01 = catalogA2.hardware.find((h) => h.code === 'HW-3D-01');
    expect(renamed01?.name).toBe('Tirador Tubular Renombrado');
    expect(renamed01?.visualAsset?.assetId).toBe(assetId);
    expect(renamed01?.visualAsset?.assetRevisionId).toBe(rev1Id);
    expect(renamed01?.visualAsset?.representation).toBe('skp');

    // -------------------------------------------------------------------------
    // Step 3: Add revision N+1 (.glb) to the existing asset
    // -------------------------------------------------------------------------
    await page.getByRole('button', { name: 'Editar HW-3D-01' }).click();
    await expect(page.getByRole('heading', { name: 'Editar herraje' })).toBeVisible();

    // Click "Subir nueva versión..."
    await page.getByTestId('hardware-add-revision-btn').click();
    await expect(page.getByTestId('hardware-asset-upload-modal')).toBeVisible();

    // Upload .glb bytes for Rev. 2 (must start with glTF magic for backend content inspection)
    const glbContent = Buffer.from('glTF-dummy-binary-content-rev2-distinct-hash');
    await page.getByTestId('hardware-asset-file-input').setInputFiles({
      name: 'tirador-tubular-v2.glb',
      mimeType: 'model/gltf-binary',
      buffer: glbContent,
    });

    await page.getByTestId('hardware-asset-upload-submit-btn').click();
    await expect(page.getByTestId('hardware-upload-success')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('hardware-asset-upload-modal')).not.toBeVisible();

    // Bound card now displays GLB and Rev. 2
    await expect(page.getByTestId('hardware-bound-card')).toContainText('GLB', { timeout: 10_000 });
    await expect(page.getByTestId('hardware-bound-card')).toContainText('Rev. 2');

    // Save and verify persistence
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar herraje' })).not.toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Herrajes', exact: true })).toBeVisible();
    const catalogA3 = await repository.getCatalog();
    const updated01 = catalogA3.hardware.find((h) => h.code === 'HW-3D-01');
    expect(updated01?.visualAsset?.representation).toBe('glb');
    const rev2Id = updated01?.visualAsset?.assetRevisionId;
    expect(rev2Id).toBeTruthy();
    expect(rev2Id).not.toBe(rev1Id);

    // -------------------------------------------------------------------------
    // Step 4: Cancel form with unbind draft does not alter persisted binding
    // -------------------------------------------------------------------------
    await page.getByRole('button', { name: 'Editar HW-3D-01' }).click();
    await expect(page.getByRole('heading', { name: 'Editar herraje' })).toBeVisible();

    // Unbind in draft
    await page.getByTestId('hardware-unbind-asset-btn').click();
    await expect(page.getByTestId('hardware-unbound-card')).toBeVisible();

    // Cancel without saving
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar herraje' })).not.toBeVisible();

    // Re-open and verify binding is still Rev. 2
    await page.getByRole('button', { name: 'Editar HW-3D-01' }).click();
    await expect(page.getByTestId('hardware-bound-card')).toBeVisible();
    await expect(page.getByTestId('hardware-bound-card')).toContainText('GLB');
    await expect(page.getByTestId('hardware-bound-card')).toContainText('Rev. 2');
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar herraje' })).not.toBeVisible();

    // -------------------------------------------------------------------------
    // Step 5: Choose existing asset -> bind Rev. 1 to a second hardware item
    // -------------------------------------------------------------------------
    await page.getByRole('button', { name: /Nuevo herraje/i }).click();
    await page.getByLabel('Código').fill('HW-3D-02');
    await page.getByLabel('Nombre').fill('Tirador Secundario');
    await page.getByLabel('Costo unitario').fill('18.00');

    await page.getByTestId('hardware-3d-section-toggle').click();
    await page.getByTestId('hardware-open-selector-btn').click();
    await expect(page.getByTestId('hardware-asset-selector-modal')).toBeVisible();

    // The asset we uploaded appears in selector
    const assetItem = page.getByTestId(`hardware-asset-item-${assetId}`);
    await expect(assetItem).toBeVisible();
    await assetItem.click();

    // Available revisions: Rev. 1 (SKP) and Rev. 2 (GLB)
    await expect(page.getByTestId('hardware-asset-revision-1')).toContainText('SKP');
    await expect(page.getByTestId('hardware-asset-revision-2')).toContainText('GLB');

    // Select Rev. 1
    await page.getByTestId('hardware-asset-select-rev-1').click();
    await expect(page.getByTestId('hardware-asset-selector-modal')).not.toBeVisible();

    // Form now has Rev. 1 bound
    await expect(page.getByTestId('hardware-bound-card')).toBeVisible();
    await expect(page.getByTestId('hardware-bound-card')).toContainText('SKP');
    await expect(page.getByTestId('hardware-bound-card')).toContainText('Rev. 1');

    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('heading', { name: 'Nuevo herraje' })).not.toBeVisible();

    // Verify both items persist with independent revisions
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Herrajes', exact: true })).toBeVisible();
    const catalogA4 = await repository.getCatalog();
    const item01 = catalogA4.hardware.find((h) => h.code === 'HW-3D-01');
    const item02 = catalogA4.hardware.find((h) => h.code === 'HW-3D-02');
    expect(item01?.visualAsset?.assetRevisionId).toBe(rev2Id);
    expect(item02?.visualAsset?.assetRevisionId).toBe(rev1Id);

    // -------------------------------------------------------------------------
    // Step 6: Retire asset: confirm dialog, disable selection, keep existing
    // -------------------------------------------------------------------------
    await page.getByRole('button', { name: /Nuevo herraje/i }).click();
    await page.getByTestId('hardware-3d-section-toggle').click();
    await page.getByTestId('hardware-open-selector-btn').click();
    await expect(page.getByTestId('hardware-asset-selector-modal')).toBeVisible();

    await page.getByTestId(`hardware-asset-item-${assetId}`).click();

    // Click "Retirar recurso" -> confirmation appears
    await page.getByTestId('hardware-asset-retire-btn').click();
    await expect(page.getByText('¿Retirar recurso de nuevas selecciones?')).toBeVisible();

    // Click "Cancelar" -> stays active
    await page.getByTestId('hardware-asset-retire-cancel-btn').click();
    await expect(page.getByTestId('hardware-asset-select-rev-1')).toBeEnabled();

    // Click "Retirar recurso" again -> Confirm
    await page.getByTestId('hardware-asset-retire-btn').click();
    await page.getByTestId('hardware-asset-retire-confirm-btn').click();

    // Asset transitions to retired status
    await expect(page.getByText('Este recurso está retirado')).toBeVisible({ timeout: 10_000 });
    // Selection buttons become disabled
    await expect(page.getByTestId('hardware-asset-select-rev-1')).toBeDisabled();
    await expect(page.getByTestId('hardware-asset-select-rev-2')).toBeDisabled();

    // Close selector and cancel new hardware form
    await page.getByTestId('hardware-asset-selector-modal').getByRole('button', { name: 'Cerrar' }).first().click();
    await expect(page.getByTestId('hardware-asset-selector-modal')).not.toBeVisible();
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('heading', { name: 'Nuevo herraje' })).not.toBeVisible();

    // Existing bindings on HW-3D-01 and HW-3D-02 remain completely intact!
    const catalogA5 = await repository.getCatalog();
    expect(catalogA5.hardware.find((h) => h.code === 'HW-3D-01')?.visualAsset?.assetRevisionId).toBe(rev2Id);
    expect(catalogA5.hardware.find((h) => h.code === 'HW-3D-02')?.visualAsset?.assetRevisionId).toBe(rev1Id);

    // -------------------------------------------------------------------------
    // Step 7: Unbind hardware -> removes binding from this item only
    // -------------------------------------------------------------------------
    const row02 = page.locator('tr.catalog-table__row').filter({ hasText: 'HW-3D-02' });
    await row02.hover();
    await page.getByRole('button', { name: 'Editar HW-3D-02' }).click();
    await expect(page.getByRole('heading', { name: 'Editar herraje' })).toBeVisible();
    await page.getByTestId('hardware-unbind-asset-btn').click();
    await expect(page.getByTestId('hardware-unbound-card')).toBeVisible();
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar herraje' })).not.toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Herrajes', exact: true })).toBeVisible();
    const catalogA6 = await repository.getCatalog();
    const unbound02 = catalogA6.hardware.find((h) => h.code === 'HW-3D-02');
    const stillBound01 = catalogA6.hardware.find((h) => h.code === 'HW-3D-01');
    expect(unbound02?.visualAsset).toBeUndefined();
    expect(stillBound01?.visualAsset?.assetRevisionId).toBe(rev2Id);

    // -------------------------------------------------------------------------
    // Step 8: Organization B (vendedor role) mutation protection
    // -------------------------------------------------------------------------
    await page.getByLabel('Cambiar organización').selectOption({ label: 'Browser Gate B' });
    await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate B');

    await page.goto('/hardware');
    await expect(page.getByRole('heading', { name: 'Herrajes', exact: true })).toBeVisible();

    // "Nuevo herraje" button must NOT be present
    await expect(page.getByRole('button', { name: /Nuevo herraje/i })).not.toBeVisible();
    // Edit buttons must NOT be present
    await expect(page.getByRole('button', { name: /^Editar /i })).not.toBeVisible();
  });
});
