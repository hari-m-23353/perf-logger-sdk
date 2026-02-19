import { BaseCollector } from './BaseCollector.js';

/**
 * Captures:
 *  - Real FPS via requestAnimationFrame
 *  - Jank detection (missed frames)
 *  - Total Blocking Time (TBT)
 *  - Frame timing breakdown
 */
export class CPUCollector extends BaseCollector {
  constructor(eventBus, config) {
    super(eventBus, config);
    this._rafHandle = null;
    this._longTaskObserver = null;
    this._frameTimestamps = [];
    this._FPS_WINDOW = 60;
    this._tbt = 0; // Accumulated Total Blocking Time
    this._jankCount = 0;
    this._reportInterval = null;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this._measureFPS();
    this._measureTBT();
    this._startPeriodicReport();
  }

  stop() {
    if (this._rafHandle) cancelAnimationFrame(this._rafHandle);
    if (this._reportInterval) clearInterval(this._reportInterval);
    this._longTaskObserver?.disconnect();
    this.isRunning = false;
  }

  collect() {
    return [
      { name: 'fps', value: this._getCurrentFPS(), unit: 'fps', tags: {} },
      { name: 'total_blocking_time', value: this._tbt, unit: 'ms', tags: {} },
      { name: 'jank_count', value: this._jankCount, unit: 'count', tags: {} },
    ];
  }

  /**
   * Real FPS measurement via requestAnimationFrame loop.
   *
   * How it works:
   *   Each rAF callback tells us "a frame was painted."
   *   By measuring the gap between callbacks, we know:
   *   - Normal gap: ~16.67ms (60fps)
   *   - Gap > 33ms: at least 1 frame dropped
   *   - Gap > 100ms: severe jank, user will notice
   */
  _measureFPS() {
    let lastFrameTime = performance.now();

    const tick = (now) => {
      const delta = now - lastFrameTime;
      lastFrameTime = now;

      this._frameTimestamps.push(now);
      if (this._frameTimestamps.length > this._FPS_WINDOW) {
        this._frameTimestamps.shift();
      }

      // Jank: frame took > 2x expected (>33ms)
      if (delta > 33) {
        this._jankCount++;
        const missedFrames = Math.floor(delta / 16.67) - 1;

        let severity = 'info';
        if (delta > 200) severity = 'critical';
        else if (delta > 100) severity = 'warning';

        this.emit({
          name: 'frame_drop',
          value: Math.round(delta * 100) / 100,
          unit: 'ms',
          tags: { severity },
          metadata: {
            missedFrames,
            currentFPS: this._getCurrentFPS(),
          },
        });
      }

      this._rafHandle = requestAnimationFrame(tick);
    };

    this._rafHandle = requestAnimationFrame(tick);
  }

  /**
   * Total Blocking Time (TBT) — sum of blocking portions of long tasks.
   * TBT = Σ max(0, longTaskDuration - 50ms)
   *
   * A perfect proxy for INP/FID responsiveness.
   * Google considers TBT > 300ms as "needs improvement",
   * and > 600ms as "poor".
   */
  _measureTBT() {
    if (typeof PerformanceObserver === 'undefined') return;

    try {
      this._longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const blockingTime = Math.max(0, entry.duration - 50);
          this._tbt += blockingTime;
        }
      });

      this._longTaskObserver.observe({ type: 'longtask', buffered: true });
    } catch {
      /* not supported */
    }
  }

  /**
   * Periodic summary report (every 5s)
   */
  _startPeriodicReport() {
    this._reportInterval = setInterval(() => {
      const fps = this._getCurrentFPS();

      // Only emit if something interesting
      if (fps < 50 || this._jankCount > 0) {
        this.emit({
          name: 'fps',
          value: fps,
          unit: 'fps',
          tags: {
            severity: fps < 15 ? 'critical' : fps < 30 ? 'warning' : 'info',
          },
          metadata: {
            tbt: this._tbt,
            janksInWindow: this._jankCount,
          },
        });
      }
    }, 5000);
  }

  _getCurrentFPS() {
    const ts = this._frameTimestamps;
    if (ts.length < 2) return 60;
    const elapsed = ts[ts.length - 1] - ts[0];
    if (elapsed === 0) return 60;
    return Math.round(((ts.length - 1) / elapsed) * 1000);
  }
}
