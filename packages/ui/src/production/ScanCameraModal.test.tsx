/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScanCameraModal } from './ScanCameraModal';

afterEach(() => cleanup());

describe('ScanCameraModal (F089)', () => {
  it('shows honest fallback + manual entry when BarcodeDetector is unavailable', async () => {
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
