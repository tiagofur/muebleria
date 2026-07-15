// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CustomersScreen } from './CustomersScreen';
import type { Customer } from '@muebles/domain';

const mockCustomers: Customer[] = [
	{
		id: 'c1',
		name: 'Tiago Furniture',
		email: 'tiago@example.com',
		phone: '123456789',
		address: 'Calle Falsa 123',
		notes: 'Buen cliente',
		active: true,
	},
	{
		id: 'c2',
		name: 'Juan Perez',
		email: 'juan@example.com',
		phone: '987654321',
		address: '',
		notes: '',
		active: false,
	},
];

describe('CustomersScreen', () => {
	afterEach(cleanup);

	it('renders list of active customers by default', () => {
		render(
			<CustomersScreen
				customers={mockCustomers}
				onCreate={vi.fn()}
				onUpdate={vi.fn()}
				onDeactivate={vi.fn()}
				onReactivate={vi.fn()}
			/>
		);

		expect(screen.getByText('Tiago Furniture')).toBeTruthy();
		expect(screen.getByText('tiago@example.com')).toBeTruthy();
		// Por defecto filtra solo activos, por lo que Juan Perez no debería mostrarse
		expect(screen.queryByText('Juan Perez')).toBeNull();
	});

	it('renders empty state when there are no customers', () => {
		render(
			<CustomersScreen
				customers={[]}
				onCreate={vi.fn()}
				onUpdate={vi.fn()}
				onDeactivate={vi.fn()}
				onReactivate={vi.fn()}
			/>
		);

		expect(screen.getByText('No hay clientes registrados')).toBeTruthy();
	});

	it('opens modal and submits new customer draft', () => {
		const onCreate = vi.fn();
		render(
			<CustomersScreen
				customers={[]}
				onCreate={onCreate}
				onUpdate={vi.fn()}
				onDeactivate={vi.fn()}
				onReactivate={vi.fn()}
			/>
		);

		// Clic en Agregar cliente en el EmptyState
		const newButton = screen.getAllByRole('button', { name: 'Agregar cliente' })[0] as HTMLElement;
		fireEvent.click(newButton);

		// Llenar formulario
		const nameInput = screen.getByLabelText(/nombre completo/i);
		const emailInput = screen.getByLabelText(/email/i);

		fireEvent.change(nameInput, { target: { value: 'Nuevo Cliente S.A.' } });
		fireEvent.change(emailInput, { target: { value: 'nuevo@example.com' } });

		// Click en Guardar
		const saveButton = screen.getByRole('button', { name: /guardar/i }) as HTMLElement;
		fireEvent.click(saveButton);

		expect(onCreate).toHaveBeenCalledWith({
			name: 'Nuevo Cliente S.A.',
			email: 'nuevo@example.com',
			phone: '',
			address: '',
			notes: '',
		});
	});
});
