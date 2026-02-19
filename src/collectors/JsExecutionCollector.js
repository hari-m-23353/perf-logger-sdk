import { BaseCollector } from './BaseCollector.js';

/**
 * Captures:
 *  - Long Tasks (>50ms) with attribution
 *  - Event Loop Lag (via MessageChannel trick)
 *  - Script evaluation / compilation time
 *  - Interaction-to-handler delay
 */
export class JSExecutionCollector extends BaseCollector {
  constructor(eventBus, config) {
    super(eventBus, config);
    this._longTaskObserver = null;
    this._eventLoopInterval = null;
    this._interactionObserver = null;
    this._metrics = [];
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this._observeLongTasks();
    this._monitorEventLoopLag();
    this._observeScriptTiming();
    this._observeInteractions();
  }

  stop() {
    this._longTaskObserver?.disconnect();
    this._interactionObserver?.disconnect();
    if (this._eventLoopInterval) clearInterval(this._eventLoopInterval);
    this.isRunning = false;
  }

  collect() {
    const snapshot = [...this._metrics];
    this._metrics = [];
    return snapshot;
  }

  /**
   * Long Task API — detects any task blocking main thread > 50ms.
   * Provides attribution (which script / iframe caused it).
   */
  _observeLongTasks() {
    if (typeof PerformanceObserver === 'undefined') return;

    try {
      this._longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // Classify severity based on duration
          let severity = 'info';
          if (entry.duration > 500) severity = 'critical';
          else if (entry.duration > 200) severity = 'warning';

          const metric = {
            name: 'long_task',
            value: entry.duration,
            unit: 'ms',
            tags: {
              severity,
              culprit: this._attributeTask(entry),
            },
            metadata: {
              startTime: entry.startTime,
              attribution: entry.attribution?.[0] ?? null,
              missedFrames: Math.floor(entry.duration / 16.67) - 1,
            },
          };

          this._metrics.push(metric);
          this.emit(metric);
        }
      });

      this._longTaskObserver.observe({ type: 'longtask', buffered: true });
    } catch (e) {
      if (this.config.debug) {
        console.warn('[PerfSDK] Long Task API not supported:', e.message);
      }
    }
  }

  /**
   * Event Loop Lag — measures "hidden" main thread saturation
   * that isn't caught by the Long Task API.
   *
   * Trick: Post a message via MessageChannel and measure how long
   * it takes for the event loop to pick it up. In a healthy app
   * this is <1ms. Anything >5ms means the thread is busy.
   */
  _monitorEventLoopLag() {
    const measure = () => {
      const start = performance.now();
      const channel = new MessageChannel();

      channel.port2.onmessage = () => {
        const lag = performance.now() - start;

        if (lag > 5) {
          let severity = 'info';
          if (lag > 200) severity = 'critical';
          else if (lag > 50) severity = 'warning';

          const metric = {
            name: 'event_loop_lag',
            value: Math.round(lag * 100) / 100,
            unit: 'ms',
            tags: { severity },
            metadata: {
              threshold: { info: 5, warning: 50, critical: 200 },
            },
          };

          this._metrics.push(metric);
          this.emit(metric);
        }
      };

      channel.port1.postMessage(undefined);
    };

    this._eventLoopInterval = setInterval(measure, 1000);
  }

  /**
   * Script compilation & evaluation timing via Resource Timing API
   */
  _observeScriptTiming() {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // Only care about scripts, not images/css
          if (entry.initiatorType !== 'script') continue;
          if (entry.duration < 10) continue; // Ignore trivial scripts

          const metric = {
            name: 'script_evaluation',
            value: entry.duration,
            unit: 'ms',
            tags: {
              scriptUrl: this._truncateUrl(entry.name),
              transferSize: entry.transferSize || 0,
            },
            metadata: {
              fullUrl: entry.name,
              encodedBodySize: entry.encodedBodySize,
              decodedBodySize: entry.decodedBodySize,
              // Time spent on network vs execution
              networkTime: entry.responseEnd - entry.requestStart,
            },
          };

          this._metrics.push(metric);
          this.emit(metric);
        }
      });

      observer.observe({ type: 'resource', buffered: true });
    } catch {
      /* not supported */
    }
  }

  /**
   * Interaction timing — measures delay from user input to handler execution.
   * Uses the Event Timing API (INP data source).
   */
  _observeInteractions() {
    try {
      this._interactionObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // Only care about slow interactions (>100ms)
          if (entry.duration < 100) continue;

          const metric = {
            name: 'slow_interaction',
            value: entry.duration,
            unit: 'ms',
            tags: {
              eventType: entry.name, // 'click', 'keydown', etc.
              severity: entry.duration > 500 ? 'critical' : 'warning',
            },
            metadata: {
              processingStart: entry.processingStart,
              processingEnd: entry.processingEnd,
              inputDelay: entry.processingStart - entry.startTime,
              processingTime: entry.processingEnd - entry.processingStart,
              presentationDelay: entry.startTime + entry.duration - entry.processingEnd,
              target: entry.target?.tagName || 'unknown',
            },
          };

          this._metrics.push(metric);
          this.emit(metric);
        }
      });

      this._interactionObserver.observe({ type: 'event', buffered: true, durationThreshold: 100 });
    } catch {
      /* Event Timing API not supported */
    }
  }

  /**
   * Extract attribution info from a long task entry
   */
  _attributeTask(entry) {
    const attr = entry.attribution?.[0];
    if (!attr) return 'unknown';
    return attr.containerName || attr.containerSrc || attr.containerId || 'self';
  }

  _truncateUrl(url) {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split('/');
      return segments[segments.length - 1] || parsed.pathname;
    } catch {
      return url.slice(-60);
    }
  }
}
