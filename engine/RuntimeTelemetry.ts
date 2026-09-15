type TelemetryMeta = Record<string, unknown> | undefined;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export class RuntimeTelemetry {
  private static globalHandlersInstalled = false;
  private static sessionStartAtMs = Date.now();
  private static sequence = 0;

  private static envelope(meta?: TelemetryMeta): string {
    RuntimeTelemetry.sequence += 1;
    const payload = {
      seq: RuntimeTelemetry.sequence,
      tMs: Date.now() - RuntimeTelemetry.sessionStartAtMs,
      ...(meta ?? {}),
    };
    return JSON.stringify(payload);
  }

  public static metric(name: string, value: number, meta?: TelemetryMeta) {
    console.log(`[TELEMETRY][METRIC] ${name}=${value} ${RuntimeTelemetry.envelope(meta)}`);
  }

  public static event(name: string, meta?: TelemetryMeta) {
    console.log(`[TELEMETRY][EVENT] ${name} ${RuntimeTelemetry.envelope(meta)}`);
  }

  public static error(scope: string, error: unknown, meta?: TelemetryMeta) {
    console.error(`[TELEMETRY][ERROR] ${scope}: ${toErrorMessage(error)} ${RuntimeTelemetry.envelope(meta)}`);
  }

  public static installGlobalHandlers() {
    if (RuntimeTelemetry.globalHandlersInstalled) return;
    RuntimeTelemetry.globalHandlersInstalled = true;

    const errorUtils = (globalThis as any).ErrorUtils;
    if (errorUtils?.getGlobalHandler && errorUtils?.setGlobalHandler) {
      const previousHandler = errorUtils.getGlobalHandler();
      errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
        RuntimeTelemetry.error('global_exception', error, { isFatal: Boolean(isFatal) });
        if (typeof previousHandler === 'function') {
          previousHandler(error, isFatal);
        }
      });
    }

    const previousUnhandled = (globalThis as any).onunhandledrejection;
    (globalThis as any).onunhandledrejection = (event: any) => {
      RuntimeTelemetry.error('unhandled_rejection', event?.reason ?? event);
      if (typeof previousUnhandled === 'function') {
        previousUnhandled(event);
      }
    };
  }
}
