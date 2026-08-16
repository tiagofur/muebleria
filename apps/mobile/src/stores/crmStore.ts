import { create } from 'zustand';
import { apiClient } from '../services/apiClient';

export type PhotoStage = 'survey' | 'in_workshop' | 'installed' | 'delivery_receipt';

export const PHOTO_STAGE_LABELS_ES: Record<PhotoStage, string> = {
  survey: 'Relevamiento en Obra',
  in_workshop: 'Ensamble en Taller',
  installed: 'Instalación Terminada',
  delivery_receipt: 'Acta de Entrega Firmada',
};

export interface ProjectPhoto {
  id: string;
  projectId: string;
  stage: PhotoStage;
  url: string;
  thumbnailUrl?: string;
  caption?: string;
  createdAt: string;
}

export interface InternalMessage {
  id: string;
  projectId: string;
  senderName: string;
  senderRole: string;
  messageType: 'comment' | 'technical_query' | 'query_response' | 'gate_approval';
  content: string;
  createdAt: string;
}

export interface WarrantyTicket {
  id: string;
  code: string;
  projectId: string;
  projectName: string;
  customerName: string;
  title: string;
  description: string;
  priority: 'low' | 'normal' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved';
  photoUrls?: string[];
  createdAt: string;
}

export interface CrmState {
  photos: Record<string, ProjectPhoto[]>; // Key: projectId
  messages: Record<string, InternalMessage[]>; // Key: projectId
  warranties: WarrantyTicket[];
  isLoading: boolean;

  // Actions
  addPhoto: (
    projectId: string,
    stage: PhotoStage,
    url: string,
    caption?: string
  ) => Promise<ProjectPhoto>;
  deletePhoto: (projectId: string, photoId: string) => Promise<void>;
  getPhotosByProject: (projectId: string, stage?: PhotoStage) => ProjectPhoto[];

  sendMessage: (
    projectId: string,
    content: string,
    senderName: string,
    senderRole: string,
    messageType?: InternalMessage['messageType']
  ) => Promise<InternalMessage>;
  getMessagesByProject: (projectId: string) => InternalMessage[];

  createWarrantyTicket: (
    ticket: Omit<WarrantyTicket, 'id' | 'code' | 'createdAt' | 'status'>
  ) => Promise<WarrantyTicket>;
  getWarranties: () => WarrantyTicket[];
}

export const useCrmStore = create<CrmState>((set, get) => ({
  photos: {},
  messages: {},
  warranties: [
    {
      id: 'war-1',
      code: 'GAR-001',
      projectId: 'proj-1',
      projectName: 'Cocina Residencia Pérez',
      customerName: 'Roberto Pérez',
      title: 'Ajuste de bisagra en alacena superior',
      description: 'La puerta derecha roza levemente con el marco superior.',
      priority: 'normal',
      status: 'open',
      createdAt: new Date().toISOString(),
    },
  ],
  isLoading: false,

  addPhoto: async (projectId, stage, url, caption) => {
    const newPhoto: ProjectPhoto = {
      id: `photo-${Date.now()}`,
      projectId,
      stage,
      url,
      caption,
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      photos: {
        ...state.photos,
        [projectId]: [newPhoto, ...(state.photos[projectId] || [])],
      },
    }));

    return newPhoto;
  },

  deletePhoto: async (projectId, photoId) => {
    set((state) => ({
      photos: {
        ...state.photos,
        [projectId]: (state.photos[projectId] || []).filter((p) => p.id !== photoId),
      },
    }));
  },

  getPhotosByProject: (projectId, stage) => {
    const list = get().photos[projectId] || [];
    if (!stage) return list;
    return list.filter((p) => p.stage === stage);
  },

  sendMessage: async (
    projectId,
    content,
    senderName,
    senderRole,
    messageType = 'comment'
  ) => {
    const newMsg: InternalMessage = {
      id: `msg-${Date.now()}`,
      projectId,
      senderName,
      senderRole,
      messageType,
      content,
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      messages: {
        ...state.messages,
        [projectId]: [...(state.messages[projectId] || []), newMsg],
      },
    }));

    return newMsg;
  },

  getMessagesByProject: (projectId) => {
    return get().messages[projectId] || [];
  },

  createWarrantyTicket: async (ticketInput) => {
    const newTicket: WarrantyTicket = {
      ...ticketInput,
      id: `war-${Date.now()}`,
      code: `GAR-${Math.floor(100 + Math.random() * 900)}`,
      status: 'open',
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      warranties: [newTicket, ...state.warranties],
    }));

    return newTicket;
  },

  getWarranties: () => {
    return get().warranties;
  },
}));
