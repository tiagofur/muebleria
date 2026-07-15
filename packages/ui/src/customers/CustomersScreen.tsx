import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { Customer } from '@muebles/domain';
import { Eye, EyeOff, Pencil, Plus, Users } from 'lucide-react';
import {
	EmptyState,
	Modal,
	SearchInput,
	StatusChips,
	useDebouncedValue,
} from '../common';
import { ActiveBadge, CatalogTable, type CatalogColumn } from '../catalogs/CatalogTable';
import {
	filterCatalogItems,
	type CatalogStatusFilter,
	validateRequiredName,
} from '../catalogs/catalogHelpers';
import '../catalogs/catalogs.css';

export type CustomerDraft = {
	name: string;
	email: string;
	phone: string;
	address: string;
	notes: string;
};

const emptyDraft = (): CustomerDraft => ({
	name: '',
	email: '',
	phone: '',
	address: '',
	notes: '',
});

function toDraft(item: Customer): CustomerDraft {
	return {
		name: item.name,
		email: item.email ?? '',
		phone: item.phone ?? '',
		address: item.address ?? '',
		notes: item.notes ?? '',
	};
}

export interface CustomersScreenProps {
	readonly customers: readonly Customer[];
	readonly onCreate: (draft: CustomerDraft) => void;
	readonly onUpdate: (id: string, draft: CustomerDraft) => void;
	readonly onDeactivate: (id: string) => void;
	readonly onReactivate: (id: string) => void;
}

export function CustomersScreen({
	customers,
	onCreate,
	onUpdate,
	onDeactivate,
	onReactivate,
}: CustomersScreenProps): ReactNode {
	const formId = useId();
	const [search, setSearch] = useState('');
	const debouncedSearch = useDebouncedValue(search);
	const [status, setStatus] = useState<CatalogStatusFilter>('active');
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [modalOpen, setModalOpen] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draft, setDraft] = useState<CustomerDraft>(emptyDraft());
	const [error, setError] = useState<string | null>(null);

	const rows = useMemo(
		() =>
			filterCatalogItems(customers, {
				status,
				query: debouncedSearch,
			}),
		[customers, status, debouncedSearch],
	);

	const closeModal = () => {
		setModalOpen(false);
		setEditingId(null);
		setDraft(emptyDraft());
		setError(null);
	};

	const startCreate = () => {
		setEditingId(null);
		setDraft(emptyDraft());
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
		setExpandedId((prev) => (prev === item.id ? null : item.id));
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

	const columns: CatalogColumn<Customer>[] = [
		{ key: 'name', header: 'Nombre', render: (r) => r.name },
		{ key: 'email', header: 'Email', render: (r) => r.email || '-' },
		{ key: 'phone', header: 'Teléfono', render: (r) => r.phone || '-' },
		{
			key: 'status',
			header: 'Estado',
			render: (r) => <ActiveBadge active={r.active} />,
		},
	];

	const isTrulyEmpty = customers.length === 0;
	const isFilterEmpty = !isTrulyEmpty && rows.length === 0;

	return (
		<section className="catalog-page" aria-label="Catálogo de clientes">
			<div className="catalog-page__header">
				<h2 className="catalog-page__title">Registro de Clientes</h2>
				<div className="catalog-page__toolbar">
					<button type="button" className="btn btn--primary" onClick={startCreate}>
						<Plus size={16} strokeWidth={1.5} aria-hidden />
						Nuevo cliente
					</button>
				</div>
			</div>

			{!isTrulyEmpty ? (
				<div className="catalog-page__filters">
					<SearchInput
						value={search}
						onChange={setSearch}
						placeholder="Buscar clientes…"
						aria-label="Buscar clientes"
					/>
					<StatusChips value={status} onChange={setStatus} />
				</div>
			) : null}

			<div className="catalog-layout">
				{isTrulyEmpty ? (
					<EmptyState
						icon={Users}
						title="No hay clientes registrados"
						description="Registrá al primer cliente del sistema para asignarle cotizaciones."
						actionLabel="Agregar cliente"
						onAction={startCreate}
					/>
				) : isFilterEmpty ? (
					<p className="catalog-empty-filter">
						No hay clientes que coincidan con la búsqueda o el filtro.
					</p>
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
									<span className="catalog-row-detail__value">{row.phone || 'No especificado'}</span>
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
								<div className="catalog-row-detail__field">
									<span className="catalog-row-detail__label">Estado</span>
									<span className="catalog-row-detail__value">
										<ActiveBadge active={row.active} />
									</span>
								</div>
								<div className="catalog-row-detail__actions">
									<button
										type="button"
										className="btn btn--small"
										onClick={() => startEdit(row)}
									>
										<Pencil size={14} strokeWidth={1.5} aria-hidden />
										Editar
									</button>
									{row.active ? (
										<button
											type="button"
											className="btn btn--small btn--danger"
											onClick={() => onDeactivate(row.id)}
										>
											<EyeOff size={14} strokeWidth={1.5} aria-hidden />
											Desactivar
										</button>
									) : (
										<button
											type="button"
											className="btn btn--small"
											onClick={() => onReactivate(row.id)}
										>
											<Eye size={14} strokeWidth={1.5} aria-hidden />
											Reactivar
										</button>
									)}
								</div>
							</>
						)}
						getRowActions={(row) => (
							<>
								<button
									type="button"
									className="btn btn--small btn--ghost"
									aria-label={`Editar ${row.name}`}
									onClick={() => startEdit(row)}
								>
									<Pencil size={14} strokeWidth={1.5} aria-hidden />
									Editar
								</button>
								{row.active ? (
									<button
										type="button"
										className="btn btn--small btn--ghost btn--danger"
										aria-label={`Desactivar ${row.name}`}
										onClick={() => onDeactivate(row.id)}
									>
										<EyeOff size={14} strokeWidth={1.5} aria-hidden />
										Desactivar
									</button>
								) : (
									<button
										type="button"
										className="btn btn--small btn--ghost"
										aria-label={`Reactivar ${row.name}`}
										onClick={() => onReactivate(row.id)}
									>
										<Eye size={14} strokeWidth={1.5} aria-hidden />
										Reactivar
									</button>
								)}
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
					{error ? <p className="catalog-form__error">{error}</p> : null}

					<div className="catalog-form__field">
						<label htmlFor="cust-name">Nombre completo</label>
						<input
							id="cust-name"
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
