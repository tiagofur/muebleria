import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { Customer, Project } from '@granete/domain';
import { Eye, EyeOff, Pencil, Plus, SearchX, Users } from 'lucide-react';
import {
	EmptyState,
	formatEmpty,
	Modal,
	PageHeader,
	PageToolbar,
	SearchInput,
	StatusChips,
	useDebouncedValue,
	useRoutableEntitySelection,
} from '../common';
import { ActiveBadge, CatalogTable, type CatalogColumn } from '../catalogs/CatalogTable';
import {
	filterCatalogItems,
	type CatalogStatusFilter,
	validateRequiredName,
} from '../catalogs/catalogHelpers';
import { WhatsAppButton } from '../crm/WhatsAppButton';
import { StatusBadge } from '../projects/components/StatusBadge';
import '../catalogs/catalogs.css';


export type CustomerDraft = {
	name: string;
	email: string;
	phone: string;
	address: string;
	notes: string;
	/** Portfolio owner (F034). Empty = shell default (me). */
	ownerUserId: string;
};

export type OwnerOption = {
	readonly id: string;
	readonly name: string;
	readonly role?: string;
};

const emptyDraft = (defaultOwnerId = ''): CustomerDraft => ({
	name: '',
	email: '',
	phone: '',
	address: '',
	notes: '',
	ownerUserId: defaultOwnerId,
});

function toDraft(item: Customer): CustomerDraft {
	return {
		name: item.name,
		email: item.email ?? '',
		phone: item.phone ?? '',
		address: item.address ?? '',
		notes: item.notes ?? '',
		ownerUserId: item.ownerUserId ?? '',
	};
}

export interface CustomersScreenProps {
	readonly customers: readonly Customer[];
	readonly onCreate: (draft: CustomerDraft) => void;
	readonly onUpdate: (id: string, draft: CustomerDraft) => void;
	readonly onDeactivate: (id: string) => void;
	readonly onReactivate: (id: string) => void;
	readonly openEntityId?: string | null;
	readonly onSelectionChange?: (id: string | null) => void;
	/** When true, show owner picker (admin / gerente). */
	readonly canAssignOwner?: boolean;
	readonly assignableOwners?: readonly OwnerOption[];
	readonly currentUserId?: string;
	/** Optional labels map for owner column (id → name). */
	readonly ownerLabels?: Readonly<Record<string, string>>;
	readonly projects?: readonly Project[];
	readonly onOpenProject?: (projectId: string) => void;
	readonly workshopName?: string;
	/**
	 * #1127 P1: gating de mutación con paridad a Cotizaciones — sin permiso,
	 * la pantalla es sólo lectura (contactar por WhatsApp sigue disponible).
	 */
	readonly canMutateCustomers?: boolean;
}

export function CustomersScreen({
	customers,
	onCreate,
	onUpdate,
	onDeactivate,
	onReactivate,
	openEntityId = null,
	onSelectionChange,
	canAssignOwner = false,
	assignableOwners = [],
	currentUserId = '',
	ownerLabels = {},
	projects = [],
	onOpenProject,
	workshopName,
	canMutateCustomers = true,
}: CustomersScreenProps): ReactNode {
	const formId = useId();
	const [search, setSearch] = useState('');
	const debouncedSearch = useDebouncedValue(search);
	const [status, setStatus] = useState<CatalogStatusFilter>('active');
	const customerIds = useMemo(() => customers.map((c) => c.id), [customers]);
	const { selectedId: expandedId, toggleSelectedId } =
		useRoutableEntitySelection({
			openEntityId,
			onSelectionChange,
			knownIds: customerIds,
		});
	const [modalOpen, setModalOpen] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draft, setDraft] = useState<CustomerDraft>(() =>
		emptyDraft(currentUserId),
	);
	const [error, setError] = useState<string | null>(null);
	/** #1127 P2: desactivar pide confirmación inline (§4.2), nunca 1 click. */
	const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);

	const normalizeForSearch = (value: string): string =>
		value
			.trim()
			.toLocaleLowerCase('es-UY')
			.normalize('NFD')
			.replace(/\p{Diacritic}/gu, '');

	const rows = useMemo(
		() =>
			filterCatalogItems(customers, {
				status,
				query: debouncedSearch,
				// #1127 P0: Customer no tiene `code` — el matcher por defecto era
				// no-op. Buscar por nombre, email y teléfono normalizados.
				matchItem: (customer, q) => {
					// #1127 re-critique: el teléfono matchea también sin espacios.
					const qDigits = q.replace(/\D/g, '');
					if (qDigits.length >= 6 && normalizeForSearch(customer.phone ?? '').replace(/\D/g, '').includes(qDigits)) {
						return true;
					}
					return [normalizeForSearch(customer.name), normalizeForSearch(customer.email ?? ''), normalizeForSearch(customer.phone ?? '')]
						.some((hay) => hay.includes(q));
				},
			}),
		[customers, status, debouncedSearch],
	);

	const confirmDeactivate = (id: string | null) => {
		setConfirmDeactivateId(id);
	};

	const closeModal = () => {
		setModalOpen(false);
		setEditingId(null);
		setDraft(emptyDraft(currentUserId));
		setError(null);
	};

	const startCreate = () => {
		setEditingId(null);
		setDraft(emptyDraft(currentUserId));
		setError(null);
		setModalOpen(true);
	};

	const startEdit = (item: Customer) => {
		setEditingId(item.id);
		setDraft(toDraft(item));
		setError(null);
		setModalOpen(true);
	};

	const toggleExpand = (item: Customer) => {
		toggleSelectedId(item.id);
	};

	const validate = (): string | null => {
		return validateRequiredName(draft.name);
	};

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		const err = validate();
		if (err) {
			setError(err);
			return;
		}
		setError(null);
		if (editingId) {
			onUpdate(editingId, draft);
		} else {
			onCreate(draft);
		}
		closeModal();
	};

	const columns: CatalogColumn<Customer>[] = useMemo(() => {
		const cols: CatalogColumn<Customer>[] = [
			{ key: 'name', header: 'Nombre', render: (r) => r.name },
			{
				key: 'email',
				header: 'Email',
				render: (r) => formatEmpty(r.email),
			},
			{
				key: 'phone',
				header: 'Teléfono / WhatsApp',
				render: (r) => (
					// #1127 P1: contactar no togglea la fila — el click queda
					// aislado en el botón (el texto del teléfono sigue toggleando).
					<div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
						<span>{formatEmpty(r.phone)}</span>
						{r.phone ? (
							<WhatsAppButton
								phone={r.phone}
								customerName={r.name}
								workshopName={workshopName}
								compact
							/>
						) : null}
					</div>
				),
			},
		];
		if (canAssignOwner) {
			cols.push({
				key: 'owner',
				header: 'Responsable',
				render: (r) =>
					formatEmpty(
						(r.ownerUserId && ownerLabels[r.ownerUserId]) ||
							r.ownerUserId,
					),
			});
		}
		cols.push({
			key: 'status',
			header: 'Estado',
			render: (r) => <ActiveBadge active={r.active} />,
		});
		return cols;
	}, [canAssignOwner, ownerLabels, workshopName]);


	const isTrulyEmpty = customers.length === 0;
	const isFilterEmpty = !isTrulyEmpty && rows.length === 0;

	return (
		<section className="catalog-page" aria-label="Clientes">
			<PageHeader
				title="Clientes"
				subtitle="Personas y talleres a los que cotizás"
				icon={<Users size={16} strokeWidth={1.5} />}
				primaryAction={
					canMutateCustomers ? (
						<button type="button" className="btn btn--primary" onClick={startCreate}>
							<Plus size={16} strokeWidth={1.5} aria-hidden />
							Nuevo cliente
						</button>
					) : undefined
				}
			/>

			{!isTrulyEmpty ? (
				<PageToolbar
					ariaLabel="Buscar y filtrar clientes"
					search={
						<SearchInput
							value={search}
							onChange={setSearch}
							placeholder="Buscar clientes…"
							aria-label="Buscar clientes"
						/>
					}
					filters={<StatusChips value={status} onChange={setStatus} />}
				/>
			) : null}

			{/* #1127: contador de resultados con paridad a Cotizaciones. */}
			{!isTrulyEmpty ? (
				<div className="project-list-meta" aria-live="polite" data-testid="customers-results-summary">
					{`Mostrando ${rows.length} de ${customers.length} ${customers.length === 1 ? 'cliente' : 'clientes'}`}
				</div>
			) : null}

			<div className="catalog-layout">
				{isTrulyEmpty ? (
					<EmptyState
						icon={Users}
						title="No hay clientes"
						description="Agregá el primer cliente para asignarle cotizaciones."
						actionLabel={canMutateCustomers ? 'Nuevo cliente' : undefined}
						onAction={canMutateCustomers ? startCreate : undefined}
					/>
				) : isFilterEmpty ? (
					<EmptyState
						variant="no-results"
						icon={SearchX}
						title="Sin resultados"
						description="No hay clientes que coincidan con la búsqueda o el filtro."
						actionLabel="Limpiar filtros"
						onAction={() => {
							setSearch('');
							setStatus('active');
						}}
					/>
				) : (
					<CatalogTable
						columns={columns}
						rows={rows}
						expandedId={expandedId}
						isInactive={(r) => !r.active}
						onRowClick={toggleExpand}
						renderExpandedDetail={(row) => (
							<>
								<div className="catalog-row-detail__field">
									<span className="catalog-row-detail__label">Nombre completo</span>
									<span className="catalog-row-detail__value">{row.name}</span>
								</div>
								<div className="catalog-row-detail__field">
									<span className="catalog-row-detail__label">Email</span>
									<span className="catalog-row-detail__value">{row.email || 'No especificado'}</span>
								</div>
								<div className="catalog-row-detail__field">
									<span className="catalog-row-detail__label">Teléfono</span>
									<span className="catalog-row-detail__value">
										<div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
											<span>{row.phone || 'No especificado'}</span>
											{row.phone ? (
												<WhatsAppButton
													phone={row.phone}
													customerName={row.name}
													workshopName={workshopName}
													compact
												/>
											) : null}
										</div>
									</span>
								</div>
								<div className="catalog-row-detail__field">
									<span className="catalog-row-detail__label">Dirección</span>
									<span className="catalog-row-detail__value">{row.address || 'No especificada'}</span>
								</div>
								{row.notes ? (
									<div className="catalog-row-detail__field">
										<span className="catalog-row-detail__label">Notas del cliente</span>
										<span className="catalog-row-detail__value">{row.notes}</span>
									</div>
								) : null}
								{row.ownerUserId ? (
									<div className="catalog-row-detail__field">
										<span className="catalog-row-detail__label">Responsable</span>
										<span className="catalog-row-detail__value">
											{ownerLabels[row.ownerUserId] || row.ownerUserId}
										</span>
									</div>
								) : null}
								<div className="catalog-row-detail__field">
									<span className="catalog-row-detail__label">Estado</span>
									<span className="catalog-row-detail__value">
										<ActiveBadge active={row.active} />
									</span>
								</div>
								{(() => {
									const customerProjects = projects.filter((p) => p.customerId === row.id);
									if (customerProjects.length === 0) return null;
									return (
										<div className="catalog-row-detail__field" style={{ gridColumn: '1 / -1', marginTop: '0.5rem' }}>
											<span className="catalog-row-detail__label">
												Proyectos asociados ({customerProjects.length})
											</span>
											<div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginTop: '0.375rem' }}>
												{customerProjects.map((p) => (
													<div
														key={p.id}
														style={{
															display: 'flex',
															alignItems: 'center',
															justifyContent: 'space-between',
															padding: '0.4rem 0.75rem',
															background: 'var(--surface-app)',
															borderRadius: 'var(--radius-sm, 4px)',
															border: '1px solid var(--border-default)',
														}}
													>
														<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
															<span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</span>
															<StatusBadge status={p.status} />
															<span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
																· {p.items.length} mueble{p.items.length === 1 ? '' : 's'}
															</span>
														</div>
														{onOpenProject ? (
															<button
																type="button"
																className="btn btn--small btn--ghost"
																onClick={(e) => {
																	e.stopPropagation();
																	onOpenProject(p.id);
																}}
															>
																Ver cotización
															</button>
														) : null}
													</div>
												))}
											</div>
										</div>
									);
								})()}

								<div className="catalog-row-detail__actions">
									{canMutateCustomers ? (
										<button
											type="button"
											className="btn btn--small"
											onClick={() => startEdit(row)}
										>
											<Pencil size={14} strokeWidth={1.5} aria-hidden />
											Editar
										</button>
									) : null}
									{canMutateCustomers && row.active ? (
										confirmDeactivateId === row.id ? (
											<>
												<span className="project-list-meta" role="alert">
													¿Desactivar a {row.name}?
												</span>
												<button
													type="button"
													className="btn btn--small btn--danger"
													autoFocus
													onClick={() => {
														onDeactivate(row.id);
														confirmDeactivate(null);
													}}
													data-testid={`customer-confirm-deactivate-${row.id}`}
												>
													Sí, desactivar
												</button>
												<button
													type="button"
													className="btn btn--small btn--ghost"
													onClick={() => confirmDeactivate(null)}
												>
													Cancelar
												</button>
											</>
										) : (
											<button
												type="button"
												className="btn btn--small btn--danger"
												onClick={() => confirmDeactivate(row.id)}
											>
												<EyeOff size={14} strokeWidth={1.5} aria-hidden />
												Desactivar
											</button>
										)
									) : canMutateCustomers && !row.active ? (
										<button
											type="button"
											className="btn btn--small"
											onClick={() => onReactivate(row.id)}
										>
											<Eye size={14} strokeWidth={1.5} aria-hidden />
											Reactivar
										</button>
									) : null}
								</div>
							</>
						)}
						getRowActions={(row) => (
							<>
								{canMutateCustomers ? (
									<button
										type="button"
										className="btn btn--small btn--ghost"
										aria-label={`Editar ${row.name}`}
										onClick={() => startEdit(row)}
									>
										<Pencil size={14} strokeWidth={1.5} aria-hidden />
										Editar
									</button>
								) : null}
								{canMutateCustomers && row.active ? (
									confirmDeactivateId === row.id ? (
										<>
											<span className="project-list-meta" role="alert">
												¿Desactivar?
											</span>
											<button
												type="button"
												className="btn btn--small btn--danger"
												autoFocus
												aria-label={`Confirmar desactivar ${row.name}`}
												onClick={() => {
													onDeactivate(row.id);
													confirmDeactivate(null);
												}}
											>
												Sí
											</button>
											<button
												type="button"
												className="btn btn--small btn--ghost"
												aria-label="Cancelar desactivar"
												onClick={() => confirmDeactivate(null)}
											>
												No
											</button>
										</>
									) : (
										<button
											type="button"
											className="btn btn--small btn--ghost btn--danger"
											aria-label={`Desactivar ${row.name}`}
											onClick={() => confirmDeactivate(row.id)}
										>
											<EyeOff size={14} strokeWidth={1.5} aria-hidden />
											Desactivar
										</button>
									)
								) : canMutateCustomers && !row.active ? (
									<button
										type="button"
										className="btn btn--small btn--ghost"
										aria-label={`Reactivar ${row.name}`}
										onClick={() => onReactivate(row.id)}
									>
										<Eye size={14} strokeWidth={1.5} aria-hidden />
										Reactivar
									</button>
								) : null}
							</>
						)}
					/>
				)}
			</div>

			<Modal
				open={modalOpen}
				onClose={closeModal}
				title={editingId ? 'Editar cliente' : 'Nuevo cliente'}
				size="sm"
				footer={
					<>
						<button type="button" className="btn" onClick={closeModal}>
							Cancelar
						</button>
						<button type="submit" className="btn btn--primary" form={formId}>
							Guardar
						</button>
					</>
				}
			>
				<form id={formId} className="catalog-form" onSubmit={handleSubmit}>
					{error ? (
						<p id={`${formId}-error`} className="catalog-form__error" role="alert">
							{error}
						</p>
					) : null}

					<div className="catalog-form__field">
						<label htmlFor="cust-name">Nombre completo</label>
						<input
							id="cust-name"
							aria-describedby={error ? `${formId}-error` : undefined}
							value={draft.name}
							onChange={(e) => setDraft({ ...draft, name: e.target.value })}
							required
						/>
					</div>
					<div className="catalog-form__field">
						<label htmlFor="cust-email">Email</label>
						<input
							id="cust-email"
							type="email"
							value={draft.email}
							onChange={(e) => setDraft({ ...draft, email: e.target.value })}
						/>
					</div>
					<div className="catalog-form__field">
						<label htmlFor="cust-phone">Teléfono</label>
						<input
							id="cust-phone"
							value={draft.phone}
							onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
						/>
					</div>
					<div className="catalog-form__field">
						<label htmlFor="cust-address">Dirección</label>
						<input
							id="cust-address"
							value={draft.address}
							onChange={(e) => setDraft({ ...draft, address: e.target.value })}
						/>
					</div>
					{canAssignOwner && assignableOwners.length > 0 ? (
						<div className="catalog-form__field">
							<label htmlFor="cust-owner">Responsable</label>
							<select
								id="cust-owner"
								value={draft.ownerUserId}
								onChange={(e) =>
									setDraft({ ...draft, ownerUserId: e.target.value })
								}
								data-testid="customer-owner-select"
							>
								{assignableOwners.map((u) => (
									<option key={u.id} value={u.id}>
										{u.name}
										{u.role ? ` (${u.role})` : ''}
									</option>
								))}
							</select>
						</div>
					) : null}
					<div className="catalog-form__field">
						<label htmlFor="cust-notes">Notas</label>
						<textarea
							id="cust-notes"
							value={draft.notes}
							onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
						/>
					</div>
				</form>
			</Modal>
		</section>
	);
}
