import { describe, it, expect, beforeEach } from 'vitest';
import { useCrmStore } from './crmStore';

describe('crmStore Mobile (Fase 2)', () => {
  beforeEach(() => {
    useCrmStore.setState({
      photos: {},
      messages: {},
      warranties: [],
      isLoading: false,
    });
  });

  it('agrega fotos categorizadas por etapa al proyecto', async () => {
    const store = useCrmStore.getState();

    await store.addPhoto(
      'proj-1',
      'survey',
      'https://example.com/photo1.jpg',
      'Cota Muro A: 3200mm'
    );
    await store.addPhoto(
      'proj-1',
      'installed',
      'https://example.com/photo2.jpg',
      'Cocina montada'
    );

    const allPhotos = useCrmStore.getState().getPhotosByProject('proj-1');
    expect(allPhotos.length).toBe(2);

    const surveyPhotos = useCrmStore.getState().getPhotosByProject('proj-1', 'survey');
    expect(surveyPhotos.length).toBe(1);
    expect(surveyPhotos[0].caption).toBe('Cota Muro A: 3200mm');
    expect(surveyPhotos[0].stage).toBe('survey');

    const installedPhotos = useCrmStore.getState().getPhotosByProject('proj-1', 'installed');
    expect(installedPhotos.length).toBe(1);
  });

  it('elimina una foto del proyecto', async () => {
    const store = useCrmStore.getState();
    const photo = await store.addPhoto('proj-1', 'survey', 'https://example.com/del.jpg');

    expect(useCrmStore.getState().getPhotosByProject('proj-1').length).toBe(1);

    await useCrmStore.getState().deletePhoto('proj-1', photo.id);
    expect(useCrmStore.getState().getPhotosByProject('proj-1').length).toBe(0);
  });

  it('envía mensajes de chat técnico y consultas', async () => {
    const store = useCrmStore.getState();

    await store.sendMessage(
      'proj-1',
      '¿El zócalo va de 100mm o 150mm?',
      'Martín Carpintero',
      'produccion',
      'technical_query'
    );

    const msgs = useCrmStore.getState().getMessagesByProject('proj-1');
    expect(msgs.length).toBe(1);
    expect(msgs[0].messageType).toBe('technical_query');
    expect(msgs[0].content).toBe('¿El zócalo va de 100mm o 150mm?');
  });

  it('crea tickets de garantía con código autogenerado', async () => {
    const store = useCrmStore.getState();

    const ticket = await store.createWarrantyTicket({
      projectId: 'proj-1',
      projectName: 'Cocina Pérez',
      customerName: 'Roberto Pérez',
      title: 'Ajuste de corredera',
      description: 'Cajón inferior no cierra suavemente',
      priority: 'urgent',
    });

    expect(ticket.code).toMatch(/^GAR-\d+/);
    expect(ticket.status).toBe('open');
    expect(ticket.priority).toBe('urgent');

    const list = useCrmStore.getState().getWarranties();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(ticket.id);
  });
});
