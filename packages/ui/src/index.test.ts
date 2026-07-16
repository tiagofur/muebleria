import { describe, expect, it } from 'vitest';
import {
  APP_NAV_SECTIONS,
  AppShell,
  EdgesCatalog,
  HardwareCatalog,
  MaterialsCatalog,
  ModulesScreen,
  OptionGroupsScreen,
  PACKAGE_NAME,
  PricePreviewGate,
  ProjectsScreen,
  canShowPricePreview,
  canShowProjectPricePreview,
  filterActiveForPicker,
  membersForKind,
  optionGroupsForBoardParts,
  optionGroupsForHardware,
  optionsForGroup,
  validateModuleCode,
  validateUniqueCode,
} from './index';

describe('@muebles/ui package surface', () => {
  it('exports package identity', () => {
    expect(PACKAGE_NAME).toBe('@muebles/ui');
  });

  it('exports catalog screens and helpers (F006)', () => {
    expect(typeof MaterialsCatalog).toBe('function');
    expect(typeof EdgesCatalog).toBe('function');
    expect(typeof HardwareCatalog).toBe('function');
    expect(typeof validateUniqueCode).toBe('function');
    expect(typeof filterActiveForPicker).toBe('function');
  });

  it('exports option group screens and helpers (F007)', () => {
    expect(typeof OptionGroupsScreen).toBe('function');
    expect(typeof PricePreviewGate).toBe('function');
    expect(typeof canShowPricePreview).toBe('function');
    expect(typeof membersForKind).toBe('function');
  });

  it('exports module editor screens and helpers (F008)', () => {
    expect(typeof ModulesScreen).toBe('function');
    expect(typeof validateModuleCode).toBe('function');
    expect(typeof optionGroupsForBoardParts).toBe('function');
    expect(typeof optionGroupsForHardware).toBe('function');
  });

  it('exports project/quotation screens and helpers (F009)', () => {
    expect(typeof ProjectsScreen).toBe('function');
    expect(typeof canShowProjectPricePreview).toBe('function');
    expect(typeof optionsForGroup).toBe('function');
  });

  it('exports export issue list (F010)', async () => {
    const { ExportIssueList } = await import('./index');
    expect(typeof ExportIssueList).toBe('function');
  });

  it('exports AppShell layout (F017)', () => {
    expect(typeof AppShell).toBe('function');
    expect(APP_NAV_SECTIONS).toHaveLength(3);
    expect(APP_NAV_SECTIONS[0]?.id).toBe('trabajo');
    expect(APP_NAV_SECTIONS[1]?.id).toBe('ingenieria');
    expect(APP_NAV_SECTIONS[2]?.id).toBe('config');
  });

  it('exports RegisterScreen and UsersScreen (F026)', async () => {
    const { RegisterScreen, UsersScreen, LoginScreen } = await import('./index');
    expect(typeof LoginScreen).toBe('function');
    expect(typeof RegisterScreen).toBe('function');
    expect(typeof UsersScreen).toBe('function');
  });

  it('exports Modal component (F018)', async () => {
    const { Modal } = await import('./index');
    expect(typeof Modal).toBe('function');
  });

  it('exports ToastProvider and useToast (F019)', async () => {
    const { ToastProvider, useToast, TOAST_DURATION_MS, TOAST_MAX } =
      await import('./index');
    expect(typeof ToastProvider).toBe('function');
    expect(typeof useToast).toBe('function');
    expect(TOAST_DURATION_MS).toBe(4000);
    expect(TOAST_MAX).toBe(3);
  });

  it('exports loading primitives (issue #30)', async () => {
    const {
      Spinner,
      PageLoading,
      InlineLoading,
      ListSkeleton,
      submitBusyLabel,
    } = await import('./index');
    expect(typeof Spinner).toBe('function');
    expect(typeof PageLoading).toBe('function');
    expect(typeof InlineLoading).toBe('function');
    expect(typeof ListSkeleton).toBe('function');
    expect(submitBusyLabel(true, 'Guardar')).toBe('Guardando…');
  });

  it('exports catalog list primitives (F020)', async () => {
    const {
      SearchInput,
      StatusChips,
      EmptyState,
      useDebouncedValue,
      SEARCH_DEBOUNCE_MS,
      matchesCodeOrName,
    } = await import('./index');
    expect(typeof SearchInput).toBe('function');
    expect(typeof StatusChips).toBe('function');
    expect(typeof EmptyState).toBe('function');
    expect(typeof useDebouncedValue).toBe('function');
    expect(SEARCH_DEBOUNCE_MS).toBe(150);
    expect(typeof matchesCodeOrName).toBe('function');
  });

  it('exports module card helpers (F021)', async () => {
    const { filterModulesByQuery, formatModuleMoney } = await import('./index');
    expect(typeof filterModulesByQuery).toBe('function');
    expect(typeof formatModuleMoney).toBe('function');
  });

  it('exports project card helpers (F022)', async () => {
    const {
      filterProjectsByQuery,
      formatProjectMoney,
      projectStatusBadgeClass,
    } = await import('./index');
    expect(typeof filterProjectsByQuery).toBe('function');
    expect(typeof formatProjectMoney).toBe('function');
    expect(typeof projectStatusBadgeClass).toBe('function');
  });

  it('exports Dashboard and helpers (F023)', async () => {
    const {
      Dashboard,
      countActiveProjects,
      selectRecentProjects,
      sumMonthlyQuotedTotal,
    } = await import('./index');
    expect(typeof Dashboard).toBe('function');
    expect(typeof countActiveProjects).toBe('function');
    expect(typeof selectRecentProjects).toBe('function');
    expect(typeof sumMonthlyQuotedTotal).toBe('function');
  });
});
