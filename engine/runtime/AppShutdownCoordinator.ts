import { SessionSummarizer } from "../SessionSummarizer";
import { RuntimeTelemetry } from "../RuntimeTelemetry";
import type { AppSessionRuntimeDeps } from "./AppSessionRuntimeTypes";

export async function cleanupRuntimeResources(d: AppSessionRuntimeDeps) {
  d.sessionLoggerRef.current.log("SYSTEM", "App closing - session ended");
  d.sessionLoggerRef.current.printSummary();

  d.audioManagerRef.current?.stopRecording();
  d.micGateRef.current?.dispose();
  d.micGateRef.current = null;
  d.transcriptCoordinatorRef.current?.dispose();
  d.transcriptCoordinatorRef.current = null;
  d.playbackControllerRef.current?.dispose();
  d.playbackControllerRef.current = null;
  d.fillerCoordinatorRef.current?.dispose();
  d.fillerCoordinatorRef.current = null;
  d.autonomousLoopRef.current?.stop();
  d.autonomousLoopRef.current = null;
  d.memoryEngineRef.current?.dispose();
  d.geminiClientRef.current?.disconnect();
  d.audioManagerRef.current?.dispose();

  d.accelSubRef.current?.remove();
  if (d.idleTimerRef.current) clearInterval(d.idleTimerRef.current);
  if (d.idleFillerTimerRef.current) clearInterval(d.idleFillerTimerRef.current);
  if (d.emotionTimeoutRef.current) clearTimeout(d.emotionTimeoutRef.current);
  if (d.greetingTimerRef.current) clearTimeout(d.greetingTimerRef.current);
  if (d.micHealthIntervalRef.current)
    clearInterval(d.micHealthIntervalRef.current);
  if (d.responseWatchdogRef.current)
    clearInterval(d.responseWatchdogRef.current);

  const avg = d.turnLatencyTrackerRef.current.getAverage();
  if (avg !== null) {
    RuntimeTelemetry.metric("gemini_round_trip_avg_ms", avg, {
      samples: d.turnLatencyTrackerRef.current.getSampleCount(),
    });
  }

  try {
    await d.sessionLoggerRef.current.saveToFile();
  } catch (e) {
    RuntimeTelemetry.error("session_log_save_failed", e);
  }

  try {
    await d.memoryEngineRef.current?.flushPendingWrites();
  } catch (e) {
    RuntimeTelemetry.error("memory_flush_on_cleanup_failed", e);
  }

  const apiKey = d.apiKey;
  if (apiKey && d.memoryEngineRef.current && d.relationshipEngineRef.current) {
    try {
      const summarizer = new SessionSummarizer(
        apiKey,
        d.memoryEngineRef.current,
        d.relationshipEngineRef.current
      );
      await summarizer.summarizeSession();
      await d.relationshipEngineRef.current.endSession();
    } catch (e) {
      RuntimeTelemetry.error("session_finalize_failed", e);
    }
  }
}
