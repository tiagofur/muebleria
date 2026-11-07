/**
 * Ajustes › Agarres (#1533, ADR-0009 Amendment 1 §14.3/§14.7): the workshop's
 * grip styles — one recipe per furniture type (inferior/superior/alto), one
 * default. The list renders each style's summary; the editor modal holds one
 * row per furniture type (jaladera / gola / rebase) and the SERVER-computed
 * preview sentences («Mueble de 720 → puerta de 680») — React never computes
 * a formula. Every write carries If-Match; a stale version is an honest
 * conflict banner, never a silent overwrite.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Plus,
  Pencil,
  Star,
  Trash2,
} from 'lucide-react';
import { GraneteApiError, type GraneteApiClient } from '@granete/storage';
import type {
  GripStyle,
  GripStyleRecipe,
} from '@granete/storage';
import { ConfirmDialog, EmptyState, Modal } from '../common';
import './settings.css';

export type GripFurnitureTypeId = 'inferior' | 'superior' | 'alto';

const FURNITURE_TYPE_LABELS: Readonly<Record<GripFurnitureTypeId, string>> = {
  inferior: 'Inferiores',
  superior: 'Alacenas',
  alto: 'Muebles altos',
};

const MODE_LABELS: Readonly<Record<string, string>> = {
  handle: 'Jaladera',
  gola: 'Gola',
  bottom_overhang: 'Rebase',
};

const FURNITURE_TYPES: readonly GripFurnitureTypeId[] = ['inferior', 'superior', 'alto'];

const DEFAULT_OVERHANG_MM = 20;

/** One furniture type's in-editor recipe (round-trips with GripStyleRecipe). */
interface GripEditorRow {
  mode: GripStyleRecipe['mode'];
  handleHardwareId: string | null;
  topProfileId: string;
  betweenProfileId: string;
  overhangMm: number;
}

interface GripEditorDraft {
  id: string | null; // null = creating
  version: number; // 0 when creating
  name: string;
  offered: boolean;
  isDefault: boolean;
  rows: Record<GripFurnitureTypeId, GripEditorRow>;
}

function emptyRow(mode: GripStyleRecipe['mode']): GripEditorRow {
  return {
    mode,
    handleHardwareId: null,
    topProfileId: '',
    betweenProfileId: '',
    overhangMm: DEFAULT_OVERHANG_MM,
  };
}

/** The generated type flattens byFurnitureType to Record<string, unknown>;
 * this reader reclaims the recipe shape (the server validates the rest). */
function recipeOf(style: GripStyle, ftype: string): GripStyleRecipe | undefined {
  const raw = (style.byFurnitureType as Record<string, unknown> | undefined)?.[ftype];
  if (!raw || typeof raw !== 'object') return undefined;
  const recipe = raw as GripStyleRecipe;
  return typeof recipe.mode === 'string' ? recipe : undefined;
}

function rowsOfStyle(style: GripStyle): Record<GripFurnitureTypeId, GripEditorRow> {
  const rows = {} as Record<GripFurnitureTypeId, GripEditorRow>;
  for (const ftype of FURNITURE_TYPES) {
    const recipe = recipeOf(style, ftype);
    rows[ftype] = {
      mode: recipe?.mode ?? 'handle',
      handleHardwareId: recipe?.handleHardwareId ?? null,
      topProfileId: recipe?.topProfileId ?? '',
      betweenProfileId: recipe?.betweenProfileId ?? '',
      overhangMm: recipe?.overhangMm ?? DEFAULT_OVERHANG_MM,
    };
  }
  return rows;
}

/** The workshop-facing summary of one recipe («gola L 8006 arriba, C 8007 entre cajones»). */
function recipeSummary(
  recipe: GripStyleRecipe | undefined,
  profileCodeById: (id: string) => string,
): string {
  if (!recipe) return '—';
  switch (recipe.mode) {
    case 'handle':
      return 'jaladera';
    case 'gola': {
      const top = recipe.topProfileId ? profileCodeById(recipe.topProfileId) : '?';
      const parts = [`gola ${top} arriba`];
      if (recipe.betweenProfileId) {
        parts.push(`${profileCodeById(recipe.betweenProfileId)} entre cajones`);
      }
      return parts.join(', ');
    }
    case 'bottom_overhang':
      return `rebase ${recipe.overhangMm ?? DEFAULT_OVERHANG_MM} mm`;
    default:
      return '—';
  }
}

export function gripStyleSummaryLines(
  style: GripStyle,
  profileCodeById: (id: string) => string,
): readonly string[] {
  return FURNITURE_TYPES.map((ftype) => {
    const label = FURNITURE_TYPE_LABELS[ftype];
    return `${label}: ${recipeSummary(recipeOf(style, ftype), profileCodeById)}`;
  });
}

export interface GripStylesSectionProps {
  readonly api: GraneteApiClient;
  readonly token: string | null;
}

/** #1533 (C4): the API names the failing family in its message — anchor the
 * alert to that field instead of a modal-level paragraph. */
function saveErrorAnchor(message: string): 'name' | 'inferior' | 'superior' | 'alto' | 'top' {
  const lowered = message.toLowerCase();
  if (lowered.includes('nombre')) return 'name';
  if (lowered.includes('inferior') || lowered.includes('muebles bajos')) return 'inferior';
  if (lowered.includes('superior') || lowered.includes('alacena')) return 'superior';
  if (lowered.includes('alto') || lowered.includes('muebles altos')) return 'alto';
  if (lowered.includes('arriba') || lowered.includes('perfil superior')) return 'top';
  return 'name';
}

export function GripStylesSection({ api, token }: GripStylesSectionProps): ReactNode {
  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [styles, setStyles] = useState<readonly GripStyle[]>([]);
  const [profiles, setProfiles] = useState<readonly { id: string; code: string; name: string; usage?: Record<string, { usable?: boolean; message?: string | null }> }[]>([]);

  const [editor, setEditor] = useState<GripEditorDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [previewByType, setPreviewByType] = useState<Readonly<Record<string, string>>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<GripStyle | null>(null);
  const [listFlash, setListFlash] = useState<string | null>(null);
  const [hardwareOptions, setHardwareOptions] = useState<readonly { id: string; name: string }[]>([]);

  const reload = useCallback(async (): Promise<boolean> => {
    if (!token) {
      setPhase('error');
      setLoadError('Necesitás una sesión activa para ver los estilos de agarre.');
      return false;
    }
    try {
      const [styleList, profileList] = await Promise.all([
        api.listGripStyles(token),
        api.listOpeningProfiles(token),
      ]);
      setStyles(styleList);
      setProfiles(profileList.map((p) => ({ id: p.id, code: p.code, name: p.name, usage: p.usage })));
      setPhase('ready');
      setLoadError(null);
      return true;
    } catch (err) {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'No se pudieron cargar los estilos de agarre.');
      return false;
    }
  }, [api, token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const profileCodeById = useCallback(
    (id: string) => profiles.find((p) => p.id === id)?.code ?? '?',
    [profiles],
  );

  /** All org profiles with the server's use-rule verdict at one position:
   * usable ones are selectable, the rest stay visible DISABLED with their
   * reason (the brief: «deshabilitados con su motivo, no ocultos»). */
  const profilesAt = useCallback(
    (position: 'top' | 'between') =>
      profiles.map((p) => {
        const usage = p.usage?.[position];
        return {
          id: p.id,
          code: p.code,
          name: p.name,
          usable: usage?.usable === true,
          reason: usage?.usable === true ? null : usage?.message ?? null,
        };
      }),
    [profiles],
  );

  const refreshPreview = useCallback(
    async (draft: GripEditorDraft, payload?: Record<string, GripStyleRecipe>) => {
      if (!token) return;
      setPreviewLoading(true);
      try {
        const byFurnitureType = payload ?? {};
        if (!payload) {
          for (const ftype of FURNITURE_TYPES) {
            const row = draft.rows[ftype];
            byFurnitureType[ftype] = {
              mode: row.mode,
              ...(row.mode === 'handle' && row.handleHardwareId ? { handleHardwareId: row.handleHardwareId } : {}),
              ...(row.mode === 'gola' && row.topProfileId ? { topProfileId: row.topProfileId } : {}),
              ...(row.mode === 'gola' && row.betweenProfileId ? { betweenProfileId: row.betweenProfileId } : {}),
              ...(row.mode === 'bottom_overhang' ? { overhangMm: row.overhangMm } : {}),
            };
          }
        }
        const response = await api.previewGripStyles(token, { heightMm: 720, byFurnitureType });
        const next: Record<string, string> = {};
        for (const preview of response.previews ?? []) {
          next[String(preview.furnitureType)] = String(preview.preview);
        }
        setPreviewByType(next);
      } catch (err) {
        // The preview degrades to a message; the editor stays usable.
        setPreviewByType({
          __error: err instanceof Error ? err.message : 'La vista previa no pudo resolverse.',
        });
      } finally {
        setPreviewLoading(false);
      }
    },
    [api, token],
  );

  // #1533: the preview re-resolves when a DISCRETE choice changes (mode or
  // profile selects) — never on each keystroke of the overhang input.
  const previewFingerprint = editor
    ? JSON.stringify(
        FURNITURE_TYPES.map((ftype) => {
          const row = editor.rows[ftype];
          return [row.mode, row.topProfileId, row.betweenProfileId];
        }),
      )
    : null;
  useEffect(() => {
    if (!editor || previewFingerprint === null) return;
    const byFurnitureType: Record<string, GripStyleRecipe> = {};
    const fingerprints = JSON.parse(previewFingerprint) as readonly [string, string, string][];
    FURNITURE_TYPES.forEach((ftype, index) => {
      const [mode, topProfileId, betweenProfileId] = fingerprints[index] ?? [];
      const row = editor.rows[ftype];
      byFurnitureType[ftype] = {
        mode: (mode ?? 'handle') as GripStyleRecipe['mode'],
        ...(mode === 'handle' && row.handleHardwareId ? { handleHardwareId: row.handleHardwareId } : {}),
        ...(mode === 'gola' && topProfileId ? { topProfileId } : {}),
        ...(mode === 'gola' && betweenProfileId ? { betweenProfileId } : {}),
        ...(mode === 'bottom_overhang' ? { overhangMm: row.overhangMm } : {}),
      };
    });
    const timer = window.setTimeout(() => {
      setPreviewLoading(true);
      api
        .previewGripStyles(token ?? '', { heightMm: 720, byFurnitureType })
        .then((response) => {
          const next: Record<string, string> = {};
          for (const preview of response.previews ?? []) {
            next[String(preview.furnitureType)] = String(preview.preview);
          }
          setPreviewByType(next);
        })
        .catch((err: unknown) => {
          setPreviewByType({ __error: err instanceof Error ? err.message : 'La vista previa no pudo resolverse.' });
        })
        .finally(() => setPreviewLoading(false));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [api, previewFingerprint, token, editor]);

  const openEditor = useCallback(
    (style: GripStyle | null) => {
      setSaveError(null);
      setConflict(false);
      setPreviewByType({});
      const draft: GripEditorDraft = style
        ? {
            id: style.id,
            version: style.version,
            name: style.name,
            offered: style.offered,
            isDefault: style.isDefault,
            rows: rowsOfStyle(style),
          }
        : {
            id: null,
            version: 0,
            name: '',
            offered: true,
            isDefault: styles.length === 0,
            rows: { inferior: emptyRow('handle'), superior: emptyRow('handle'), alto: emptyRow('handle') },
          };
      setEditor(draft);
      void refreshPreview(draft);
      if (token) {
        // The jaladera picker: the workshop's handle hardware (best effort —
        // an empty picker still lets the style save without a fixed SKU).
        api.listHardware(token).then((list) => {
          setHardwareOptions(list.filter((hw) => hw.active).map((hw) => ({ id: hw.id, name: hw.name })));
        }).catch(() => setHardwareOptions([]));
      }
    },
    [api, styles.length, refreshPreview, token],
  );

  const saveEditor = useCallback(async () => {
    if (!editor || !token) return;
    if (editor.name.trim().length === 0) {
      setSaveError('El nombre del estilo es obligatorio.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setConflict(false);
    const byFurnitureType: Record<string, GripStyleRecipe> = {};
    for (const ftype of FURNITURE_TYPES) {
      const row = editor.rows[ftype];
      byFurnitureType[ftype] = {
        mode: row.mode,
        ...(row.mode === 'handle' && row.handleHardwareId ? { handleHardwareId: row.handleHardwareId } : {}),
        ...(row.mode === 'gola' && row.topProfileId ? { topProfileId: row.topProfileId } : {}),
        ...(row.mode === 'gola' && row.betweenProfileId ? { betweenProfileId: row.betweenProfileId } : {}),
        ...(row.mode === 'bottom_overhang' ? { overhangMm: row.overhangMm } : {}),
      };
    }
    const write = {
      name: editor.name.trim(),
      offered: editor.offered,
      isDefault: editor.isDefault,
      byFurnitureType,
    };
    try {
      if (editor.id) {
        await api.updateGripStyle(token, editor.id, editor.version, write);
      } else {
        await api.createGripStyle(token, write);
      }
      setEditor(null);
      const ok = await reload();
      if (ok) setListFlash('Estilo guardado.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo guardar el estilo.';
      if (err instanceof GraneteApiError && err.status === 412) {
        setConflict(true);
      } else {
        setSaveError(message);
      }
    } finally {
      setSaving(false);
    }
  }, [api, editor, reload, token]);

  const markDefault = useCallback(
    async (style: GripStyle) => {
      if (!token) return;
      setSaving(true);
      try {
        await api.updateGripStyle(token, style.id, style.version, {
          name: style.name,
          offered: true,
          isDefault: true,
          byFurnitureType: style.byFurnitureType,
        });
        await reload();
        setListFlash(`«${style.name}» es el estilo predeterminado.`);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'No se pudo marcar el predeterminado.');
        setPhase('error');
      } finally {
        setSaving(false);
      }
    },
    [api, reload, token],
  );

  const toggleOffered = useCallback(
    async (style: GripStyle, offered: boolean) => {
      if (!token) return;
      setSaving(true);
      try {
        await api.updateGripStyle(token, style.id, style.version, {
          name: style.name,
          offered,
          isDefault: style.isDefault,
          byFurnitureType: style.byFurnitureType,
        });
        await reload();
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'No se pudo cambiar «Ofrecer».');
        setPhase('error');
      } finally {
        setSaving(false);
      }
    },
    [api, reload, token],
  );

  const deleteStyle = useCallback(async () => {
    if (!confirmDelete || !token) return;
    setSaving(true);
    try {
      await api.deleteGripStyle(token, confirmDelete.id, confirmDelete.version);
      setConfirmDelete(null);
      await reload();
      setListFlash('Estilo eliminado. Los proyectos que lo usaban conservan sus valores congelados.');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No se pudo eliminar el estilo.');
      setPhase('error');
    } finally {
      setSaving(false);
    }
  }, [api, confirmDelete, reload, token]);

  const flash = useMemo(
    () => (listFlash ? <p className="settings-lead settings-lead--inline" role="status">{listFlash}</p> : null),
    [listFlash],
  );

  if (phase === 'loading') {
    // C5: card skeletons — the layout never jumps when the cards arrive.
    return (
      <div data-testid="grip-styles-loading" aria-busy="true" aria-label="Cargando estilos de agarre">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <p className="settings-lead settings-lead--inline" aria-hidden>Una receta por tipo de mueble, con un estilo predeterminado.</p>
        </div>
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            aria-hidden
            data-testid="grip-styles-skeleton"
            style={{ border: '1px solid var(--border, #ddd)', borderRadius: 8, padding: '12px 16px', marginBottom: 12, opacity: 0.6 }}
          >
            <div style={{ height: 16, width: '30%', background: 'var(--border, #ddd)', borderRadius: 4, marginBottom: 10 }} />
            <div style={{ height: 12, width: '70%', background: 'var(--border, #ddd)', borderRadius: 4, marginBottom: 6 }} />
            <div style={{ height: 12, width: '55%', background: 'var(--border, #ddd)', borderRadius: 4 }} />
          </div>
        ))}
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <div data-testid="grip-styles-error">
        <p className="settings-lead settings-lead--inline" role="alert">{loadError}</p>
        <button type="button" className="btn" data-testid="grip-styles-retry" onClick={() => { setPhase('loading'); void reload(); }}>
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div data-testid="grip-styles-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <p className="settings-lead settings-lead--inline">
          Una receta por tipo de mueble, con un estilo predeterminado. Los muebles nuevos heredan el predeterminado; un
          cambio aquí nunca altera un proyecto existente hasta que lo actualices.
        </p>
        <button type="button" className="btn btn--primary" data-testid="grip-styles-create" onClick={() => openEditor(null)}>
          <Plus size={14} aria-hidden style={{ marginRight: 6 }} />
          Nuevo estilo
        </button>
      </div>
      {flash}

      {styles.length === 0 ? (
        <EmptyState
          title="Sin estilos de agarre"
          description="Creá el primer estilo para definir cómo se agarran los frentes de cada tipo de mueble."
          actionLabel="Crear el primer estilo"
          onAction={() => openEditor(null)}
        />
      ) : (
        <ul className="catalog-list" data-testid="grip-styles-list" style={{ listStyle: 'none', padding: 0 }}>
          {styles.map((style) => (
            <li
              key={style.id}
              className="catalog-card"
              data-testid={`grip-style-card-${style.id}`}
              style={{ border: '1px solid var(--border, #ddd)', borderRadius: 8, padding: '12px 16px', marginBottom: 12 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <strong>{style.name}</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {style.isDefault ? (
                    <span className="catalog-badge" data-testid={`grip-style-default-${style.id}`} style={{ fontWeight: 600 }}>
                      <Star size={12} aria-hidden style={{ marginRight: 4, verticalAlign: '-2px' }} />
                      Predeterminado
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--sm"
                      data-testid={`grip-style-make-default-${style.id}`}
                      disabled={saving}
                      onClick={() => void markDefault(style)}
                    >
                      Marcar predeterminado
                    </button>
                  )}
                  <label
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    title={style.isDefault ? 'El estilo predeterminado siempre está ofrecido' : undefined}
                  >
                    <input
                      type="checkbox"
                      role="switch"
                      checked={style.offered}
                      disabled={saving || style.isDefault}
                      aria-label={`Ofrecer en SketchUp: ${style.name}`}
                      aria-disabled={style.isDefault || undefined}
                      data-testid={`grip-style-offered-${style.id}`}
                      onChange={(event) => void toggleOffered(style, event.target.checked)}
                    />
                    Ofrecer en SketchUp
                  </label>
                </div>
                <p className="settings-lead settings-lead--inline" style={{ margin: '4px 0 0' }}>
                  Ocultar sólo quita el estilo de las elecciones nuevas.
                </p>
              </div>
              <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }} data-testid={`grip-style-summary-${style.id}`}>
                {gripStyleSummaryLines(style, profileCodeById).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid={`grip-style-edit-${style.id}`}
                  onClick={() => openEditor(style)}
                >
                  <Pencil size={12} aria-hidden style={{ marginRight: 4, verticalAlign: '-2px' }} />
                  Editar
                </button>
                {!style.isDefault ? (
                  <button
                    type="button"
                    className="btn btn--sm"
                    data-testid={`grip-style-delete-${style.id}`}
                    onClick={() => setConfirmDelete(style)}
                  >
                    <Trash2 size={12} aria-hidden style={{ marginRight: 4, verticalAlign: '-2px' }} />
                    Eliminar
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editor ? (
        <div data-testid="grip-style-editor">
        <Modal
          open
          onClose={() => setEditor(null)}
          title={editor.id ? 'Editar estilo de agarre' : 'Nuevo estilo de agarre'}
          size="lg"
        >
          <div
            className="catalog-form"
            style={{ padding: 0 }}
          >
            <h2 style={{ marginTop: 0 }}>{editor.id ? 'Editar estilo de agarre' : 'Nuevo estilo de agarre'}</h2>

            {conflict ? (
              <div role="alert" data-testid="grip-style-conflict" style={{ border: '1px solid var(--border, #ddd)', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>
                <p style={{ margin: '0 0 8px' }}>Alguien más cambió este estilo. Recargá y volvé a aplicar tus cambios.</p>
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid="grip-style-conflict-reload"
                  onClick={async () => {
                    // C2: the modal draft is CONSERVED for re-applying — only
                    // the If-Match version is refreshed from the reloaded list.
                    const ok = await reload();
                    if (ok && editor.id) {
                      const fresh = styles.find((s) => s.id === editor.id);
                      if (fresh) setEditor({ ...editor, version: fresh.version });
                    }
                    setConflict(false);
                  }}
                >
                  Recargar
                </button>
              </div>
            ) : null}
            {saveError && saveErrorAnchor(saveError) === 'name' ? (
              <p role="alert" data-testid="grip-style-save-error" aria-describedby="grip-style-name" style={{ color: 'var(--danger, #b00)', margin: '0 0 4px' }}>{saveError}</p>
            ) : null}

            <label style={{ display: 'block', marginBottom: 12 }}>
              Nombre
              <input
                type="text"
                value={editor.name}
                maxLength={120}
                disabled={saving}
                data-testid="grip-style-name"
                aria-invalid={saveError != null && saveErrorAnchor(saveError) === 'name' || undefined}
                style={{ display: 'block', width: '100%', marginTop: 4 }}
                onChange={(event) => setEditor({ ...editor, name: event.target.value })}
              />
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input
                type="checkbox"
                role="switch"
                checked={editor.offered}
                disabled={saving}
                data-testid="grip-style-editor-offered"
                onChange={(event) => setEditor({ ...editor, offered: event.target.checked })}
              />
              Ofrecer en SketchUp
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <input
                type="checkbox"
                role="switch"
                checked={editor.isDefault}
                disabled={saving}
                data-testid="grip-style-editor-default"
                onChange={(event) => setEditor({ ...editor, isDefault: event.target.checked })}
              />
              Predeterminado del taller
            </label>

            {FURNITURE_TYPES.map((ftype) => {
              const row = editor.rows[ftype];
              const setRow = (next: Partial<GripEditorRow>) =>
                setEditor({ ...editor, rows: { ...editor.rows, [ftype]: { ...row, ...next } } });
              const rowError = saveError != null && saveErrorAnchor(saveError) === ftype;

              return (
                <fieldset key={ftype} data-testid={`grip-style-row-${ftype}`} disabled={saving} style={{ border: '1px solid var(--border, #ddd)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                  <legend style={{ fontWeight: 600 }}>{FURNITURE_TYPE_LABELS[ftype]}</legend>
                  {rowError ? (
                    <p role="alert" data-testid={`grip-style-save-error-${ftype}`} style={{ color: 'var(--danger, #b00)', margin: '0 0 8px' }}>{saveError}</p>
                  ) : null}
                  <label style={{ display: 'block', marginBottom: 8 }}>
                    Modo
                    <select
                      value={row.mode}
                      data-testid={`grip-style-mode-${ftype}`}
                      style={{ display: 'block', width: '100%', marginTop: 4 }}
                      onChange={(event) => {
                        const mode = event.target.value as GripStyleRecipe['mode'];
                        setRow({ ...emptyRow(mode), mode });
                      }}
                    >
                      {Object.entries(MODE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  {row.mode === 'handle' ? (
                    <label style={{ display: 'block' }}>
                      Herraje (opcional)
                      <select
                        value={row.handleHardwareId ?? ''}
                        data-testid={`grip-style-handle-hardware-${ftype}`}
                        style={{ display: 'block', width: '100%', marginTop: 4 }}
                        onChange={(event) => setRow({ handleHardwareId: event.target.value || null })}
                      >
                        <option value="">Sin herraje fijo</option>
                        {hardwareOptions.map((hw) => (
                          <option key={hw.id} value={hw.id}>{hw.name}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {row.mode === 'gola' ? (
                    <>
                      <label style={{ display: 'block', marginBottom: 8 }}>
                        Perfil superior
                        <select
                          value={row.topProfileId}
                          data-testid={`grip-style-top-profile-${ftype}`}
                          style={{ display: 'block', width: '100%', marginTop: 4 }}
                          onChange={(event) => setRow({ topProfileId: event.target.value })}
                        >
                          <option value="">Elegí un perfil…</option>
                          {profilesAt('top').map((p) => (
                            <option
                              key={p.id}
                              value={p.usable ? p.id : ''}
                              disabled={!p.usable}
                              title={p.reason ?? undefined}
                            >
                              {p.usable ? `${p.code} — ${p.name}` : `${p.code} — no utilizable arriba (${p.reason ?? 'faltan datos de ficha'})`}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={{ display: 'block' }}>
                        Perfil entre frentes (opcional)
                        <select
                          value={row.betweenProfileId}
                          data-testid={`grip-style-between-profile-${ftype}`}
                          style={{ display: 'block', width: '100%', marginTop: 4 }}
                          onChange={(event) => setRow({ betweenProfileId: event.target.value })}
                        >
                          <option value="">Sin gola entre frentes</option>
                          {profilesAt('between').map((p) => (
                            <option
                              key={p.id}
                              value={p.usable ? p.id : ''}
                              disabled={!p.usable}
                              title={p.reason ?? undefined}
                            >
                              {p.usable ? `${p.code} — ${p.name}` : `${p.code} — no utilizable entre frentes (${p.reason ?? 'faltan datos de ficha'})`}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : null}
                  {row.mode === 'bottom_overhang' ? (
                    <label style={{ display: 'block' }}>
                      Milímetros (por defecto 20)
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={row.overhangMm}
                        data-testid={`grip-style-overhang-${ftype}`}
                        style={{ display: 'block', width: '100%', marginTop: 4 }}
                        onChange={(event) => setRow({ overhangMm: Number(event.target.value) })}
                      />
                    </label>
                  ) : null}
                  {previewByType[ftype] ? (
                    <p data-testid={`grip-style-preview-${ftype}`} style={{ margin: '8px 0 0' }}>
                      {previewByType[ftype]}
                    </p>
                  ) : null}
                </fieldset>
              );
            })}

            {previewByType.__error ? (
              <p role="alert" style={{ color: 'var(--danger, #b00)' }}>{previewByType.__error}</p>
            ) : null}
            <button
              type="button"
              className="btn btn--sm"
              data-testid="grip-style-preview-refresh"
              disabled={previewLoading}
              onClick={() => void refreshPreview(editor)}
            >
              {previewLoading ? 'Resolviendo vista previa…' : 'Actualizar vista previa'}
            </button>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn" data-testid="grip-style-editor-cancel" onClick={() => setEditor(null)} disabled={saving}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--primary"
                data-testid="grip-style-editor-save"
                disabled={saving}
                onClick={() => void saveEditor()}
              >
                {saving ? 'Guardando…' : 'Guardar estilos'}
              </button>
            </div>
          </div>
        </Modal>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={confirmDelete ? `Eliminar «${confirmDelete.name}»?` : ''}
        message="Los proyectos que usan este estilo conservan sus valores congelados; sólo deja de ofrecerse para elecciones nuevas."
        confirmLabel="Eliminar"
        onConfirm={() => void deleteStyle()}
      />
    </div>
  );
}
