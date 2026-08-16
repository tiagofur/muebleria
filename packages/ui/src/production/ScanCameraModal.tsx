/**
 * Camera scan modal for the shop floor (F089 / #240).
 * Detection: native BarcodeDetector (QR + Code128) when the device has it
 * (Android/Chrome); jsQR (pure JS, QR) everywhere else — notably iOS Safari,
 * which will never ship BarcodeDetector. The modal stays open for continuous
 * scanning; each new reading fires onDetect, repeats are debounced.
 */

import jsQR from 'jsqr';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Camera, ScanLine } from 'lucide-react';
import { Modal } from '../common';
import { playScanFeedback } from './scanFeedback';

/** Minimal structural types — BarcodeDetector is not in TS DOM lib. */
type DetectedBarcode = { readonly rawValue: string };
type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<readonly DetectedBarcode[]>;
};
type BarcodeDetectorCtor = new (options?: {
  readonly formats?: readonly string[];
}) => BarcodeDetectorLike;

export function getBarcodeDetectorCtor(): BarcodeDetectorCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    BarcodeDetector?: BarcodeDetectorCtor;
  };
  return w.BarcodeDetector;
}

type FrameDetector = (canvas: HTMLCanvasElement) => Promise<string | null>;

/** Native detector (QR + Code128) or pure-JS jsQR (QR) — never null. */
function buildFrameDetector(): FrameDetector {
  const ctor = getBarcodeDetectorCtor();
  if (ctor) {
    try {
      const detector = new ctor({ formats: ['qr_code', 'code_128'] });
      return async (canvas) => {
        const codes = await detector.detect(canvas);
        return codes[0]?.rawValue ?? null;
      };
    } catch {
      /* fall through to jsQR */
    }
  }
  return (canvas) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve(null);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const found = jsQR(image.data, image.width, image.height);
    return Promise.resolve(found?.data ?? null);
  };
}

export type ScanCameraModalProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onDetect: (code: string) => void;
  /** Ignore the same code repeated within this window (ms). Default 1500. */
  readonly repeatDebounceMs?: number;
};

export function ScanCameraModal({
  open,
  onClose,
  onDetect,
  repeatDebounceMs = 1500,
}: ScanCameraModalProps): ReactNode {
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [lastRead, setLastRead] = useState<string | null>(null);
  const [cameraId, setCameraId] = useState<string>('');
  const [cameras, setCameras] = useState<
    readonly { readonly id: string; readonly label: string }[]
  >([]);
  const [manualCode, setManualCode] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastDetectRef = useRef<{ code: string; at: number } | null>(null);

  const emit = useCallback(
    (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      const now = Date.now();
      const last = lastDetectRef.current;
      if (last && last.code === trimmed && now - last.at < repeatDebounceMs) {
        return;
      }
      lastDetectRef.current = { code: trimmed, at: now };
      setLastRead(trimmed);
      onDetect(trimmed);
    },
    [onDetect, repeatDebounceMs],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const stopStream = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (!cancelled) setStreaming(false);
    };

    const listCameras = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setCameras(
          devices
            .filter((d) => d.kind === 'videoinput')
            .map((d, i) => ({
              id: d.deviceId,
              label: d.label || `Cámara ${i + 1}`,
            })),
        );
      } catch {
        /* camera list is optional */
      }
    };

    const start = async () => {
      setError(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        // Most common cause: page not served over HTTPS (secure context).
        setError('nocamera');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: cameraId
            ? { deviceId: { exact: cameraId } }
            : { facingMode: { ideal: 'environment' } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await Promise.resolve(video.play()).catch(() => undefined);
        }
        setStreaming(true);
        void listCameras();
        const detectFrame = buildFrameDetector();
        const canvas = document.createElement('canvas');
        interval = setInterval(async () => {
          if (!videoRef.current || videoRef.current.videoWidth === 0) return;
          const v = videoRef.current;
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          canvas.getContext('2d')?.drawImage(v, 0, 0);
          try {
            const raw = await detectFrame(canvas);
            if (raw) {
              const before = lastDetectRef.current?.code ?? null;
              emit(raw);
              if (before !== raw.trim()) {
                playScanFeedback('hit');
              }
            }
          } catch {
            /* transient decode errors are fine */
          }
        }, 250);
      } catch {
        setError('permission');
      }
    };

    void start();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, cameraId, emit]);

  useEffect(() => {
    if (!open) {
      setLastRead(null);
      setManualCode('');
      lastDetectRef.current = null;
    }
  }, [open]);

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    playScanFeedback('hit');
    emit(manualCode);
    setManualCode('');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Escanear con cámara"
      size="md"
      dataTestId="prod-piso-camera-modal"
      footer={
        <button
          type="button"
          className="btn"
          onClick={onClose}
          data-testid="prod-piso-camera-close"
        >
          Cerrar
        </button>
      }
    >
      <div className="prod-scan-camera">
        {error === 'nocamera' ? (
          <p
            className="prod-hub__placeholder-body"
            data-testid="prod-piso-camera-unsupported"
          >
            Este navegador no da acceso a la cámara desde esta conexión (se
            necesita HTTPS). Podés usar un lector USB o ingresar el código a
            mano.
          </p>
        ) : error === 'permission' ? (
          <p className="catalog-form__error" role="alert">
            No se pudo acceder a la cámara. Revisá los permisos del navegador o
            ingresá el código a mano.
          </p>
        ) : null}

        {!error ? (
          <>
            <div className="prod-scan-camera__video-wrap">
              <video
                ref={videoRef}
                className="prod-scan-camera__video"
                muted
                playsInline
                autoPlay
                data-testid="prod-piso-camera-video"
              />
              {!streaming ? (
                <p className="prod-scan-camera__hint">Iniciando cámara…</p>
              ) : null}
              <p className="prod-scan-camera__hint prod-scan-camera__hint--corner">
                <ScanLine size={14} strokeWidth={1.5} aria-hidden /> Apuntá el
                QR de la etiqueta — la lectura es automática
              </p>
            </div>
            {cameras.length > 1 ? (
              <label className="prod-scan-camera__device">
                Cámara
                <select
                  value={cameraId}
                  onChange={(e) => setCameraId(e.target.value)}
                  data-testid="prod-piso-camera-select"
                >
                  {cameras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        ) : null}

        {lastRead ? (
          <p
            className="prod-scan-camera__last"
            role="status"
            data-testid="prod-piso-camera-last"
          >
            Última lectura: <code>{lastRead}</code>
          </p>
        ) : null}

        <form className="prod-scan-camera__manual" onSubmit={handleManualSubmit}>
          <label
            className="prod-scan-camera__manual-label"
            htmlFor="prod-piso-camera-manual"
          >
            Ingresar código a mano
          </label>
          <input
            id="prod-piso-camera-manual"
            type="text"
            className="prod-modulos__floor-select prod-scan-camera__manual-input"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="MOD-03, MOD-03-L2 o payload QR…"
            data-testid="prod-piso-camera-manual-input"
          />
          <button
            type="submit"
            className="btn btn--small"
            disabled={!manualCode.trim()}
            data-testid="prod-piso-camera-manual-submit"
          >
            <Camera size={14} strokeWidth={1.5} aria-hidden /> Enviar
          </button>
        </form>
      </div>
    </Modal>
  );
}
