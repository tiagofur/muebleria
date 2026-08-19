/**
 * Accessible tab primitives for peer workspaces and ordered workflows.
 */

import type { ReactNode } from 'react';

import { useRovingTabList } from './rovingTabList';

export type TabDefinition<TTabId extends string> = {
  readonly id: TTabId;
  readonly label: string;
  readonly count?: number;
  readonly disabled?: boolean;
  /** Tooltip nativo (p. ej. razón por la que la tab está deshabilitada). */
  readonly title?: string;
  /** Icono Lucide opcional antes del label (pasar con aria-hidden). */
  readonly icon?: ReactNode;
  /** Marca "!" de atención (p. ej. falta de estructura base en editors). */
  readonly alert?: boolean;
};

type TabsProps<TTabId extends string> = {
  readonly tabs: readonly TabDefinition<TTabId>[];
  readonly activeTab: TTabId;
  readonly onTabChange: (tab: TTabId) => void;
  readonly ariaLabel: string;
  readonly idPrefix: string;
  readonly testIdPrefix?: string;
};

function Tabs<TTabId extends string>({
  tabs,
  activeTab,
  onTabChange,
  ariaLabel,
  idPrefix,
  testIdPrefix,
  variant,
}: TabsProps<TTabId> & { readonly variant: 'workspace' | 'workflow' }): ReactNode {
  const tabIds = tabs.filter((tab) => !tab.disabled).map((tab) => tab.id);
  const rovingTabs = useRovingTabList({
    tabIds,
    selectedId: activeTab,
    onSelect: onTabChange,
  });

  return (
    <nav
      className={`tabs tabs--${variant}`}
      role="tablist"
      aria-label={ariaLabel}
      {...rovingTabs.tabListProps}
      data-testid={testIdPrefix ? `${testIdPrefix}-tablist` : undefined}
    >
      <div className="tabs__scroller">
        {tabs.map((tab) => {
          const selected = activeTab === tab.id;
          const enabledIndex = tabIds.indexOf(tab.id);
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              {...(enabledIndex >= 0 ? rovingTabs.tabPropsAt(enabledIndex) : { tabIndex: -1 })}
              id={`${idPrefix}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${idPrefix}-panel-${tab.id}`}
              disabled={tab.disabled}
              title={tab.title}
              className={`tabs__tab ${selected ? 'tabs__tab--active' : ''}`}
              onClick={() => onTabChange(tab.id)}
              data-testid={testIdPrefix ? `${testIdPrefix}-tab-${tab.id}` : undefined}
            >
              {tab.icon}
              {tab.label}
              {tab.count !== undefined ? (
                <span className="tabs__count" aria-label={`${tab.count} elementos`}>
                  {tab.count}
                </span>
              ) : null}
              {tab.alert ? (
                <span className="tabs__alert" title={tab.title ?? 'Atención'}>
                  !
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function WorkspaceTabs<TTabId extends string>(props: TabsProps<TTabId>): ReactNode {
  return <Tabs {...props} variant="workspace" />;
}

export function WorkflowTabs<TTabId extends string>(props: TabsProps<TTabId>): ReactNode {
  return <Tabs {...props} variant="workflow" />;
}
