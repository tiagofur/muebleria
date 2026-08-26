/**
 * MaterialOptionSelectorDialog — selector visual de acabados por rol para
 * Proyectar (doc canónico docs/architecture/catalog-option-selector.md).
 * Misma ventana que el plugin de SketchUp: Miller Columns (categorías del
 * taller, hasta 3 niveles) + grid de swatches + ficha técnica + scope de
 * aplicación. Reemplaza el anti-patrón ComboBox para grupos kind 'board';
 * el apply y el scope viven en el studio (panel presentacional + estado de
 * navegación local).
 */

import { useEffect, useMemo, useState } from 'react';
import type { MaterialBoard, MaterialCategory, OptionGroup } from '@muebles/domain';
import {
  categoryPath,
  filterMaterialBoardsByCategory,
  materialManufacturer,
  MATERIAL_MANUFACTURER_UNSET,
} from '@muebles/domain';
import './materialOptionSelector.css';

export type MaterialSelectorScope = 'furniture' | 'project';

export interface MaterialOptionSelectorDialogProps {
  readonly open: boolean;
  readonly group: OptionGroup | null;
  /** Curated materials for the role (optionsForGroup — same rule as SketchUp). */
  readonly materials: readonly MaterialBoard[];
  readonly materialCategories: readonly MaterialCategory[];
  /** Effective selection id (item override or inherited project default). */
  readonly currentValue?: string;
  /** True when currentValue comes from an item override (inherit available). */
  readonly currentIsOverride: boolean;
  readonly canEdit: boolean;
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
  readonly onApply: (optionId: string, scope: MaterialSelectorScope) => void;
  readonly onInherit: () => void;
  readonly onClose: () => void;
}

const SEARCH_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.5" y2="16.5" />
  </svg>
);

const GRAIN_ICON = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="4" y1="20" x2="20" y2="4" />
    <line x1="4" y1="14" x2="14" y2="4" />
    <line x1="10" y1="20" x2="20" y2="10" />
  </svg>
);

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function swatchStyle(
  material: MaterialBoard,
  resolveMediaUrl?: (url: string | undefined) => string | undefined,
): { backgroundImage?: string; backgroundColor?: string } {
  const texture = resolveMediaUrl
    ? resolveMediaUrl(material.previewTextureUrl ?? material.imageUrl)
    : (material.previewTextureUrl ?? material.imageUrl);
  if (texture) {
    return {
      backgroundImage: `url('${texture}')`,
      backgroundColor: material.previewColor,
    };
  }
  return { backgroundColor: material.previewColor };
}

export function MaterialOptionSelectorDialog({
  open,
  group,
  materials,
  materialCategories,
  currentValue,
  currentIsOverride,
  canEdit,
  resolveMediaUrl,
  onApply,
  onInherit,
  onClose,
}: MaterialOptionSelectorDialogProps) {
  const [search, setSearch] = useState('');
  const [selectedL1, setSelectedL1] = useState<string | null>(null);
  const [selectedL2, setSelectedL2] = useState<string | null>(null);
  const [selectedL3, setSelectedL3] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [scope, setScope] = useState<MaterialSelectorScope>('furniture');

  // Reset navigation each time the dialog opens for a role, auto-locating the
  // current material's category branch (same behavior as the SketchUp picker).
  useEffect(() => {
    if (!open || !group) return;
    setSearch('');
    setSelectedL1(null);
    setSelectedL2(null);
    setSelectedL3(null);
    setCandidateId(currentValue ?? null);
    setScope('furniture');
    const current = materials.find((m) => m.id === currentValue);
    const path = categoryPath(current?.categoryId, materialCategories);
    if (path[0]) setSelectedL1(path[0].id);
    if (path[1]) setSelectedL2(path[1].id);
    if (path[2]) setSelectedL3(path[2].id);
  }, [open, group, currentValue, materials, materialCategories]);

  const hasCategories = materialCategories.length > 0;

  const rootCategories = useMemo(
    () =>
      materialCategories
        .filter((c) => !c.parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [materialCategories],
  );

  const l2Categories = useMemo(
    () =>
      selectedL1
        ? materialCategories
            .filter((c) => c.parentId === selectedL1)
            .sort((a, b) => a.sortOrder - b.sortOrder)
        : [],
    [materialCategories, selectedL1],
  );

  const l3Categories = useMemo(
    () =>
      selectedL2
        ? materialCategories
            .filter((c) => c.parentId === selectedL2)
            .sort((a, b) => a.sortOrder - b.sortOrder)
        : [],
    [materialCategories, selectedL2],
  );

  const selectedCategoryId = selectedL3 ?? selectedL2 ?? selectedL1 ?? null;

  const candidates = useMemo(() => {
    const byCategory = hasCategories
      ? filterMaterialBoardsByCategory(
          materials,
          selectedCategoryId,
          materialCategories,
        )
      : materials;
    const q = normalize(search);
    if (!q) return byCategory;
    return byCategory.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.code.toLowerCase().includes(q) ||
        (m.manufacturer ?? '').toLowerCase().includes(q),
    );
  }, [materials, hasCategories, selectedCategoryId, materialCategories, search]);

  const selected = useMemo(
    () => materials.find((m) => m.id === candidateId) ?? null,
    [materials, candidateId],
  );

  const apply = (): void => {
    if (!candidateId || !canEdit) return;
    onApply(candidateId, scope);
  };

  // Esc closes; Enter applies (never from within the search input).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (
        e.key === 'Enter' &&
        (e.target as HTMLElement | null)?.tagName !== 'INPUT' &&
        candidateId
      ) {
        e.preventDefault();
        apply();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, candidateId, scope, canEdit, onApply, onClose]);

  if (!open || !group) return null;

  const crumbs = [
    { label: 'Catálogo Completo', l1: null as string | null, l2: null as string | null, l3: null as string | null },
  ];
  const pathNodes = selectedCategoryId
    ? categoryPath(selectedCategoryId, materialCategories)
    : [];
  if (pathNodes[0]) {
    crumbs.push({ label: pathNodes[0].name, l1: pathNodes[0].id, l2: null, l3: null });
  }
  if (pathNodes[1]) {
    crumbs.push({ label: pathNodes[1].name, l1: pathNodes[0]!.id, l2: pathNodes[1].id, l3: null });
  }
  if (pathNodes[2]) {
    crumbs.push({ label: pathNodes[2].name, l1: pathNodes[0]!.id, l2: pathNodes[1]!.id, l3: pathNodes[2].id });
  }

  const countInBranch = (categoryId: string | null): number =>
    filterMaterialBoardsByCategory(
      materials,
      categoryId,
      materialCategories,
    ).length;

  const manufacturerLabel = (m: MaterialBoard): string => {
    const manufacturer = materialManufacturer(m);
    return manufacturer === MATERIAL_MANUFACTURER_UNSET
      ? 'Sin fabricante'
      : manufacturer;
  };

  return (
    <div className="mat-selector__backdrop">
      <div
        className="mat-selector"
        role="dialog"
        aria-modal="true"
        aria-label={`Catálogo de Acabados — ${group.name}`}
        data-testid="mat-selector-dialog"
      >
        <header className="mat-selector__header">
          <div className="mat-selector__title-group">
            <h2 className="mat-selector__title">Catálogo de Acabados</h2>
            <span className="mat-selector__role-badge">{group.name}</span>
          </div>
          <div className="mat-selector__search">
            <span className="mat-selector__search-icon" aria-hidden="true">
              {SEARCH_ICON}
            </span>
            <input
              type="text"
              className="mat-selector__search-input"
              placeholder="Buscar por nombre, código o fabricante..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              aria-label="Buscar materiales"
              data-testid="mat-selector-search"
            />
          </div>
          <button
            type="button"
            className="mat-selector__close"
            onClick={onClose}
            aria-label="Cerrar selector"
          >
            ✕
          </button>
        </header>

        {hasCategories && (
          <nav className="mat-selector__breadcrumbs" aria-label="Navegación de categorías">
            {crumbs.map((c, idx) => {
              const isLast = idx === crumbs.length - 1;
              return (
                <span key={`${c.label}-${idx}`} className="mat-selector__crumbs-group">
                  {idx > 0 && (
                    <span className="mat-selector__crumb-sep" aria-hidden="true">›</span>
                  )}
                  <button
                    type="button"
                    className={`mat-selector__crumb${isLast ? ' mat-selector__crumb--active' : ''}`}
                    onClick={() => {
                      setSelectedL1(c.l1);
                      setSelectedL2(c.l2);
                      setSelectedL3(c.l3);
                    }}
                    aria-current={isLast ? 'true' : 'false'}
                  >
                    {c.label}
                  </button>
                </span>
              );
            })}
          </nav>
        )}

        <div className={`mat-selector__body${hasCategories ? '' : ' mat-selector__body--no-categories'}`}>
          {hasCategories && (
            <div className="mat-selector__miller">
              <div className="mat-selector__column">
                <div className="mat-selector__column-header">Categorías</div>
                <ul className="mat-selector__column-list" data-testid="mat-selector-col-1">
                  <li>
                    <button
                      type="button"
                      className={`mat-selector__column-item${selectedL1 === null ? ' mat-selector__column-item--active' : ''}`}
                      aria-pressed={selectedL1 === null}
                      onClick={() => {
                        setSelectedL1(null);
                        setSelectedL2(null);
                        setSelectedL3(null);
                      }}
                    >
                      <span>Todas</span>
                      <span className="mat-selector__column-count">{materials.length}</span>
                    </button>
                  </li>
                  {rootCategories.map((cat) => (
                    <li key={cat.id}>
                      <button
                        type="button"
                        className={`mat-selector__column-item${selectedL1 === cat.id ? ' mat-selector__column-item--active' : ''}`}
                        aria-pressed={selectedL1 === cat.id}
                        onClick={() => {
                          setSelectedL1(cat.id);
                          setSelectedL2(null);
                          setSelectedL3(null);
                        }}
                      >
                        <span>{cat.name}</span>
                        <span className="mat-selector__column-count">
                          {countInBranch(cat.id)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              {l2Categories.length > 0 && (
                <div className="mat-selector__column">
                  <div className="mat-selector__column-header">Subcategorías</div>
                  <ul className="mat-selector__column-list" data-testid="mat-selector-col-2">
                    <li>
                      <button
                        type="button"
                        className={`mat-selector__column-item${selectedL2 === null ? ' mat-selector__column-item--active' : ''}`}
                        aria-pressed={selectedL2 === null}
                        onClick={() => {
                          setSelectedL2(null);
                          setSelectedL3(null);
                        }}
                      >
                        <span>Todas</span>
                        <span className="mat-selector__column-count">
                          {countInBranch(selectedL1)}
                        </span>
                      </button>
                    </li>
                    {l2Categories.map((cat) => (
                      <li key={cat.id}>
                        <button
                          type="button"
                          className={`mat-selector__column-item${selectedL2 === cat.id ? ' mat-selector__column-item--active' : ''}`}
                          aria-pressed={selectedL2 === cat.id}
                          onClick={() => {
                            setSelectedL2(cat.id);
                            setSelectedL3(null);
                          }}
                        >
                          <span>{cat.name}</span>
                          <span className="mat-selector__column-count">
                            {countInBranch(cat.id)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {l3Categories.length > 0 && (
                <div className="mat-selector__column">
                  <div className="mat-selector__column-header">Subgrupos</div>
                  <ul className="mat-selector__column-list" data-testid="mat-selector-col-3">
                    <li>
                      <button
                        type="button"
                        className={`mat-selector__column-item${selectedL3 === null ? ' mat-selector__column-item--active' : ''}`}
                        aria-pressed={selectedL3 === null}
                        onClick={() => setSelectedL3(null)}
                      >
                        <span>Todas</span>
                        <span className="mat-selector__column-count">
                          {countInBranch(selectedL2)}
                        </span>
                      </button>
                    </li>
                    {l3Categories.map((cat) => (
                      <li key={cat.id}>
                        <button
                          type="button"
                          className={`mat-selector__column-item${selectedL3 === cat.id ? ' mat-selector__column-item--active' : ''}`}
                          aria-pressed={selectedL3 === cat.id}
                          onClick={() => setSelectedL3(cat.id)}
                        >
                          <span>{cat.name}</span>
                          <span className="mat-selector__column-count">
                            {countInBranch(cat.id)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="mat-selector__grid-pane">
            <div className="mat-selector__grid-header">
              <span data-testid="mat-selector-count">
                {candidates.length} materiale{candidates.length === 1 ? '' : 's'}{' '}
                disponible{candidates.length === 1 ? '' : 's'}
              </span>
              {selectedCategoryId && (
                <span className="mat-selector__grid-category">
                  {categoryPath(selectedCategoryId, materialCategories)
                    .map((c) => c.name)
                    .join(' › ')}
                </span>
              )}
            </div>
            <div className="mat-selector__grid" role="listbox" aria-label="Materiales elegibles">
              {materials.length === 0 ? (
                <div className="mat-selector__empty">
                  <p className="mat-selector__empty-title">
                    Este rol no tiene materiales asignados
                  </p>
                  <p className="mat-selector__empty-hint">
                    Configurá el grupo de opciones del mueble en tu catálogo y
                    volvé a abrir el selector.
                  </p>
                </div>
              ) : candidates.length === 0 ? (
                <div className="mat-selector__empty">
                  <p className="mat-selector__empty-title">No se encontraron acabados</p>
                  <p className="mat-selector__empty-hint">
                    Probá ajustando el término de búsqueda o cambiando de categoría.
                  </p>
                </div>
              ) : (
                candidates.map((mat) => {
                  const isSelected = mat.id === candidateId;
                  return (
                    <button
                      type="button"
                      key={mat.id}
                      className={`mat-selector__card${isSelected ? ' mat-selector__card--selected' : ''}`}
                      role="option"
                      aria-selected={isSelected}
                      data-testid={`mat-selector-card-${mat.id}`}
                      onClick={() => setCandidateId(mat.id)}
                      onDoubleClick={() => {
                        setCandidateId(mat.id);
                        if (canEdit) onApply(mat.id, scope);
                      }}
                    >
                      <span
                        className="mat-selector__card-preview"
                        style={swatchStyle(mat, resolveMediaUrl)}
                      >
                        {mat.grainDefault && (
                          <span className="mat-selector__grain">
                            {GRAIN_ICON} Veta
                          </span>
                        )}
                      </span>
                      <span className="mat-selector__card-info">
                        <span className="mat-selector__card-name" title={mat.name}>
                          {mat.name}
                        </span>
                        <span className="mat-selector__card-meta">
                          <span className="mat-selector__card-code">{mat.code}</span>
                          <span>
                            {mat.thicknessMm ? `${mat.thicknessMm} mm` : '—'}
                          </span>
                        </span>
                        {mat.manufacturer && (
                          <span className="mat-selector__card-manufacturer">
                            {mat.manufacturer}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <aside className="mat-selector__detail">
            <div
              className="mat-selector__detail-preview"
              style={selected ? swatchStyle(selected, resolveMediaUrl) : undefined}
              aria-hidden="true"
            />
            <div className="mat-selector__detail-body">
              <h3 className="mat-selector__detail-name">
                {selected ? selected.name : 'Seleccioná un material'}
              </h3>
              <dl className="mat-selector__specs">
                <div className="mat-selector__spec">
                  <dt>Código</dt>
                  <dd>{selected?.code || '—'}</dd>
                </div>
                <div className="mat-selector__spec">
                  <dt>Espesor</dt>
                  <dd>{selected?.thicknessMm ? `${selected.thicknessMm} mm` : '—'}</dd>
                </div>
                <div className="mat-selector__spec">
                  <dt>Fabricante</dt>
                  <dd>{selected ? manufacturerLabel(selected) : '—'}</dd>
                </div>
                <div className="mat-selector__spec">
                  <dt>Veta</dt>
                  <dd>{selected ? (selected.grainDefault ? 'Sí (con veta)' : 'No / Lisa') : '—'}</dd>
                </div>
                <div className="mat-selector__spec mat-selector__spec--full">
                  <dt>Categoría</dt>
                  <dd>
                    {selected?.categoryId
                      ? categoryPath(selected.categoryId, materialCategories)
                          .map((c) => c.name)
                          .join(' › ')
                      : 'Sin categoría'}
                  </dd>
                </div>
              </dl>

              <fieldset className="mat-selector__scope">
                <legend className="mat-selector__scope-title">
                  Alcance de la selección
                </legend>
                <label className="mat-selector__scope-option">
                  <input
                    type="radio"
                    name="mat-selector-scope"
                    value="furniture"
                    checked={scope === 'furniture'}
                    onChange={() => setScope('furniture')}
                    data-testid="mat-selector-scope-furniture"
                  />
                  <span>Aplicar a este mueble</span>
                </label>
                <label className="mat-selector__scope-option">
                  <input
                    type="radio"
                    name="mat-selector-scope"
                    value="project"
                    checked={scope === 'project'}
                    onChange={() => setScope('project')}
                    data-testid="mat-selector-scope-project"
                  />
                  <span>Valor por defecto de la obra</span>
                </label>
              </fieldset>
            </div>

            <div className="mat-selector__actions">
              {currentIsOverride && (
                <button
                  type="button"
                  className="mat-selector__inherit"
                  onClick={() => {
                    if (canEdit) onInherit();
                  }}
                  data-testid="mat-selector-inherit"
                >
                  Heredar default de la obra
                </button>
              )}
              <button
                type="button"
                className="mat-selector__apply"
                disabled={!candidateId || !canEdit}
                onClick={apply}
                data-testid="mat-selector-apply"
              >
                Aplicar Acabado
              </button>
              <button
                type="button"
                className="mat-selector__cancel"
                onClick={onClose}
                data-testid="mat-selector-cancel"
              >
                Cancelar (Esc)
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
