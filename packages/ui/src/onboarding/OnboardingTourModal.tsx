import React, { useState, type ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Factory,
  Layers,
  Sparkles,
  X,
} from 'lucide-react';
import './onboardingTourModal.css';

export type OnboardingTourModalProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onLoadDemoProject?: () => void;
};

const TOUR_STORAGE_KEY = 'muebles_has_seen_onboarding_v1';

export function getHasSeenOnboardingTour(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    return window.localStorage.getItem(TOUR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setHasSeenOnboardingTour(seen: boolean): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (seen) {
      window.localStorage.setItem(TOUR_STORAGE_KEY, 'true');
    } else {
      window.localStorage.removeItem(TOUR_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

type StepData = {
  readonly badge: string;
  readonly title: string;
  readonly description: string;
  readonly icon: ReactNode;
  readonly highlights: readonly string[];
};

const STEPS: readonly StepData[] = [
  {
    badge: 'Paso 1 de 3 · Experiencia 3D Instantánea',
    title: '¡Bienvenido a Muebles! — Tu Taller en 3D',
    description:
      'Explora el proyecto de demostración "Cocina López": una cocina en L completa (4 bajomesadas, 4 alacenas, isla central y despensa) con ambientación 3D de pisos y muros lista para mostrar a tus clientes.',
    icon: <Sparkles className="onboarding-tour__header-icon" size={20} strokeWidth={1.5} />,
    highlights: [
      'Visualización 3D interactiva en tiempo real',
      'Ambientación de muros y piso cerámico',
      'Despiece y cotización automática',
    ],
  },
  {
    badge: 'Paso 2 de 3 · Catálogo de Ingeniería',
    title: 'Catálogo de Muebles LatAm',
    description:
      'Dispones de 17+ módulos prediseñados y paramétricos ideales para carpinterías de Latinoamérica: bajomesadas 1/2 puertas, cajoneras 3/4 cajones, bajo fregadero, esquineros L, alacenas sobrecampana, torres de horno e islas.',
    icon: <Layers className="onboarding-tour__header-icon" size={20} strokeWidth={1.5} />,
    highlights: [
      'Muebles ajustables a cualquier medida',
      'Configuración de materiales y herrajes',
      'Estructuras y componentes reutilizables',
    ],
  },
  {
    badge: 'Paso 3 de 3 · Preparación para Taller',
    title: 'Exportación a Producción en 1 Clic',
    description:
      'Genera directamente el plan de corte oficial Plantilla_Optimizer.xlsx, el mapa de corte visual PDF para sierras manuales, etiquetas térmicas ZPL para impresoras Zebra y datos estructurados de mecanizado CNC.',
    icon: <Factory className="onboarding-tour__header-icon" size={20} strokeWidth={1.5} />,
    highlights: [
      'Exportador oficial Optimizer Excel',
      'PDF de cortes visuales y etiquetas Zebra',
      'Datos de perforaciones estructurados (JSON/CSV)',
    ],
  },
];

export function OnboardingTourModal({
  isOpen,
  onClose,
  onLoadDemoProject,
}: OnboardingTourModalProps): ReactNode {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  if (!isOpen) return null;

  const currentStep = STEPS[currentStepIndex]!;
  const isLastStep = currentStepIndex === STEPS.length - 1;

  const handleFinish = () => {
    if (dontShowAgain) {
      setHasSeenOnboardingTour(true);
    }
    if (onLoadDemoProject) {
      onLoadDemoProject();
    }
    onClose();
  };

  const handleSkip = () => {
    if (dontShowAgain) {
      setHasSeenOnboardingTour(true);
    }
    onClose();
  };

  return (
    <div className="onboarding-tour-overlay" data-testid="onboarding-tour-modal">
      <div className="onboarding-tour-card" role="dialog" aria-modal="true">
        <header className="onboarding-tour__header">
          <h3 className="onboarding-tour__header-title">
            {currentStep.icon}
            <span>Tour de Bienvenida — Muebles App</span>
          </h3>
          <button
            type="button"
            className="onboarding-tour__close-btn"
            onClick={handleSkip}
            aria-label="Cerrar tour"
            data-testid="onboarding-tour-close"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </header>

        <div className="onboarding-tour__body">
          <div className="onboarding-tour__step-indicator" aria-label="Progreso del tour">
            {STEPS.map((_, idx) => (
              <div
                key={idx}
                className={`onboarding-tour__dot ${
                  idx === currentStepIndex ? 'onboarding-tour__dot--active' : ''
                }`}
              />
            ))}
          </div>

          <div className="onboarding-tour__step-content">
            <span className="onboarding-tour__step-badge">{currentStep.badge}</span>
            <h4 className="onboarding-tour__title">{currentStep.title}</h4>
            <p className="onboarding-tour__description">{currentStep.description}</p>
            <ul className="onboarding-tour__highlights">
              {currentStep.highlights.map((item, idx) => (
                <li key={idx} className="onboarding-tour__highlight-item">
                  <CheckCircle2
                    className="onboarding-tour__highlight-check"
                    size={16}
                    strokeWidth={1.5}
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <footer className="onboarding-tour__footer">
          <label className="onboarding-tour__dont-show">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => {
                const checked = e.target.checked;
                setDontShowAgain(checked);
                setHasSeenOnboardingTour(checked);
              }}
              data-testid="onboarding-tour-dont-show-again"
            />
            <span>No volver a mostrar en el inicio</span>
          </label>

          <div className="onboarding-tour__actions">
            {currentStepIndex > 0 ? (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setCurrentStepIndex((prev) => prev - 1)}
                data-testid="onboarding-tour-prev"
              >
                <ChevronLeft size={16} strokeWidth={1.5} />
                Anterior
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={handleSkip}
                data-testid="onboarding-tour-skip"
              >
                Omitir
              </button>
            )}

            {!isLastStep ? (
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setCurrentStepIndex((prev) => prev + 1)}
                data-testid="onboarding-tour-next"
              >
                Siguiente
                <ChevronRight size={16} strokeWidth={1.5} />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleFinish}
                data-testid="onboarding-tour-finish"
              >
                Explorar Cocina López 3D
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
