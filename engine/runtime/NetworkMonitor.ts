import NetInfo, {
  type NetInfoState,
  type NetInfoSubscription,
} from "@react-native-community/netinfo";
import { RuntimeTelemetry } from "../RuntimeTelemetry";

const DEBOUNCE_MS = 2000;

interface NetworkMonitorDeps {
  onOnline: () => void;
  onOffline: () => void;
}

type LastFired = "online" | "offline" | null;

export class NetworkMonitor {
  private readonly onOnline: () => void;
  private readonly onOffline: () => void;

  private subscription: NetInfoSubscription | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingState: LastFired = null;
  private lastFired: LastFired = null;
  private disposed = false;

  constructor(deps: NetworkMonitorDeps) {
    this.onOnline = deps.onOnline;
    this.onOffline = deps.onOffline;
  }

  public start(): void {
    if (this.subscription || this.disposed) return;
    this.subscription = NetInfo.addEventListener((state) =>
      this.handleState(state)
    );
    NetInfo.fetch()
      .then((state) => {
        if (this.disposed) return;
        this.fireImmediately(state);
      })
      .catch((err) => {
        RuntimeTelemetry.error("network_monitor_failed", err);
      });
  }

  public dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingState = null;
    if (this.subscription) {
      this.subscription();
      this.subscription = null;
    }
  }

  private handleState(state: NetInfoState): void {
    if (this.disposed) return;
    const next: LastFired = state.isConnected ? "online" : "offline";
    this.pendingState = next;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const final = this.pendingState;
      this.pendingState = null;
      if (final === null) return;
      this.emit(final);
    }, DEBOUNCE_MS);
  }

  private fireImmediately(state: NetInfoState): void {
    const current: LastFired = state.isConnected ? "online" : "offline";
    this.emit(current);
  }

  private emit(state: LastFired): void {
    if (state === null) return;
    if (this.lastFired === state) return;
    this.lastFired = state;
    try {
      if (state === "online") {
        this.onOnline();
      } else {
        this.onOffline();
      }
    } catch (err) {
      RuntimeTelemetry.error("network_monitor_callback_failed", err, {
        state,
      });
    }
  }
}
