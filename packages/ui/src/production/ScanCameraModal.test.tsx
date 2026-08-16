/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScanCameraModal } from './ScanCameraModal';

afterEach(() => cleanup());

describe('ScanCameraModal (F089)', () => {
  it('shows honest fallback + manual entry when the camera API is unavailable', async () => {
    const onDetect = vi.fn();
    const user = userEvent.setup();
    render(
      <ScanCameraModal open onClose={() => undefined} onDetect={onDetect} />,
    );

    expect(screen.getByTestId('prod-piso-camera-unsupported')).toBeTruthy();
    const input = screen.getByTestId('prod-piso-camera-manual-input');
    await user.type(input, 'GAB-01');
    await user.click(screen.getByTestId('prod-piso-camera-manual-submit'));

    expect(onDetect).toHaveBeenCalledTimes(1);
    expect(onDetect).toHaveBeenCalledWith('GAB-01');
    expect(screen.getByTestId('prod-piso-camera-last').textContent).toContain(
      'GAB-01',
    );
  });

  it('runs the camera (jsQR path) when getUserMedia exists but BarcodeDetector does not', async () => {
    const original = navigator.mediaDevices;
    const stop = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }),
        enumerateDevices: vi.fn().mockResolvedValue([]),
      },
    });
    try {
      render(
        <ScanCameraModal
          open
          onClose={() => undefined}
          onDetect={() => undefined}
        />,
      );
      // No native detector in jsdom — the video surface must still mount
      // (jsQR fallback) instead of the unsupported notice.
      await waitFor(() =>
        expect(screen.getByTestId('prod-piso-camera-video')).toBeTruthy(),
      );
      expect(
        screen.queryByTestId('prod-piso-camera-unsupported'),
      ).toBeNull();
    } finally {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: original,
      });
    }
  });

  it('debounces a repeated manual code within the window', async () => {
    const onDetect = vi.fn();
    const user = userEvent.setup();
    render(
      <ScanCameraModal
        open
        onClose={() => undefined}
        onDetect={onDetect}
        repeatDebounceMs={1500}
      />,
    );
    const input = screen.getByTestId('prod-piso-camera-manual-input');
    const submit = screen.getByTestId('prod-piso-camera-manual-submit');
    await user.type(input, 'ALT-01');
    await user.click(submit);
    await user.clear(input);
    await user.type(input, 'ALT-01');
    await user.click(submit);

    expect(onDetect).toHaveBeenCalledTimes(1);
  });

  it('manual submit via Enter key also emits', async () => {
    const onDetect = vi.fn();
    const user = userEvent.setup();
    render(
      <ScanCameraModal open onClose={() => undefined} onDetect={onDetect} />,
    );
    const input = screen.getByTestId('prod-piso-camera-manual-input');
    await user.type(input, 'MOD-9{Enter}');
    expect(onDetect).toHaveBeenCalledWith('MOD-9');
  });
});
