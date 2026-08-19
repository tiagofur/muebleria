/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';


afterEach(() => {
  cleanup();
});


import type { Project, ProjectInternalMessage } from '@muebles/domain';
import { InternalCommsPanel } from './InternalCommsPanel';

describe('InternalCommsPanel', () => {
  const dummyProject: Project = {
    id: 'p-1',
    name: 'Cocina Integral Roble',
    customerId: 'cust-1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 2000,
    status: 'accepted',
    items: [],
    ownerUserId: 'u-sales',
    assignedEngineerId: 'u-eng',
    technicalStatus: 'in_review',
    surveyCompletedAt: '2026-08-10T10:00:00Z',
    installationScheduledDate: '2026-08-25',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };

  const dummyMessages: readonly ProjectInternalMessage[] = [
    {
      id: 'm-1',
      projectId: 'p-1',
      senderId: 'u-sales',
      senderName: 'Carlos Ventas',
      messageType: 'technical_query',
      content: '¿Las medidas del muro izquierdo incluyen zoclo?',
      isResolved: false,
      attachments: [],
      createdAt: '2026-08-11T12:00:00Z',
    },
    {
      id: 'm-2',
      projectId: 'p-1',
      senderId: 'u-eng',
      senderName: 'Ing. Martín',
      messageType: 'query_response',
      content: 'Confirmado, el zoclo va de 100mm rehundido.',
      isResolved: true,
      attachments: [],
      createdAt: '2026-08-11T14:00:00Z',
    },
  ];

  const assignableOwners = [
    { id: 'u-sales', label: 'Carlos Ventas' },
    { id: 'u-eng', label: 'Ing. Martín' },
  ];

  it('renders handoff card, status badge, roles and messages', () => {
    render(
      <InternalCommsPanel
        project={dummyProject}
        messages={dummyMessages}
        assignableOwners={assignableOwners}
        onSendMessage={vi.fn()}
        onUpdateTechnicalWorkflow={vi.fn()}
      />,
    );

    expect(screen.getByText(/Handoff Técnico/i)).toBeTruthy();
    expect(screen.getByText('En Revisión Técnica / Medidas')).toBeTruthy();
    expect(screen.getAllByText('Carlos Ventas').length).toBeGreaterThan(0);
    expect(screen.getByText('¿Las medidas del muro izquierdo incluyen zoclo?')).toBeTruthy();
    expect(screen.getByText('Confirmado, el zoclo va de 100mm rehundido.')).toBeTruthy();

  });

  it('calls onSendMessage when user enters text and clicks Enviar Mensaje', async () => {
    const onSend = vi.fn();
    render(
      <InternalCommsPanel
        project={dummyProject}
        messages={dummyMessages}
        assignableOwners={assignableOwners}
        onSendMessage={onSend}
        onUpdateTechnicalWorkflow={vi.fn()}
      />,
    );

    const textarea = screen.getByPlaceholderText(/Escribe un mensaje o consulta interna/i);
    fireEvent.change(textarea, { target: { value: 'Nuevo comentario de prueba' } });

    const sendBtn = screen.getByRole('button', { name: /Enviar Mensaje/i });
    fireEvent.click(sendBtn);

    expect(onSend).toHaveBeenCalledWith({
      messageType: 'comment',
      content: 'Nuevo comentario de prueba',
    });
  });

  it('calls onUpdateTechnicalWorkflow when changing assigned engineer', () => {
    const onUpdate = vi.fn();
    render(
      <InternalCommsPanel
        project={{ ...dummyProject, assignedEngineerId: undefined }}
        messages={[]}
        assignableOwners={assignableOwners}
        onSendMessage={vi.fn()}
        onUpdateTechnicalWorkflow={onUpdate}
      />,
    );

    const select = screen.getByLabelText(/Asignar responsable técnico/i);
    fireEvent.change(select, { target: { value: 'u-eng' } });

    expect(onUpdate).toHaveBeenCalledWith({
      assignedEngineerId: 'u-eng',
      technicalStatus: undefined,
    });
  });

  it('filters messages when clicking a filter pill', () => {
    render(
      <InternalCommsPanel
        project={dummyProject}
        messages={dummyMessages}
        assignableOwners={assignableOwners}
        onSendMessage={vi.fn()}
        onUpdateTechnicalWorkflow={vi.fn()}
      />,
    );

    const filterBtn = screen.getByRole('button', { name: /Cambios de Diseño/i });
    fireEvent.click(filterBtn);

    expect(
      screen.getByText(/No hay mensajes registrados en este filtro/i),
    ).toBeTruthy();
  });



describe('InternalCommsPanel — primary button vocabulary (F111)', () => {
  it('uses global .btn .btn--primary for primary technical transitions', () => {
    render(
      <InternalCommsPanel
        project={dummyProject}
        messages={dummyMessages}
        assignableOwners={assignableOwners}
        onSendMessage={vi.fn()}
        onUpdateTechnicalWorkflow={vi.fn()}
      />,
    );

    const primaries = screen
      .getAllByRole('button')
      .filter((b) => b.classList.contains('btn--primary'));
    expect(primaries.length).toBeGreaterThan(0);
    for (const btn of primaries) {
      expect(btn.classList.contains('btn')).toBe(true);
      expect(btn.classList.contains('internal-comms__action-btn')).toBe(false);
    }
  });
});

});
