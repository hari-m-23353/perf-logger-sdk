import { BaseCollector } from './BaseCollector.js';

/**
 * Captures Core Web Vitals:
 *  - LCP  (Largest Contentful Paint)
 *  - FID  (First Input Delay) — deprecated but still useful
 *  - CLS  (Cumulative Layout Shift)
 *  - INP  (Interaction to Next Paint) — the new FID
 *  - TTFB (Time to First Byte)
 *  - FCP  (First Contentful Paint)
 */
export class WebVitalsCollector extends BaseCollector {
  constructor(eventBus, config) {
    super(eventBus, config);
    this._observers = [];
    this._clsValue = 0;
    this._clsEntries = [];
    this._inpValue = 0;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this._observeLCP();
    this._observeFCP();
    this._observeCLS();
    this._observeINP();
    this._measureTTFB();
  }

  stop() {
    this._observers.forEach((o) => o.disconnect());
    this._observers = [];
    this.isRunning = false;
  }

  collect() {
    return [
      { name: 'cls', value: this._clsValue, unit: 'score', tags: {} },
      { name: 'inp', value: this._inpValue, unit: 'ms', tags: {} },
    ];
  }

  _observeLCP() {
    this._observe('largest-contentful-paint', (entries) => {
      const last = entries[entries.length - 1];
      this.emit({
        name: 'lcp',
        value: last.startTime,
        unit: 'ms',
        tags: {
          element: last.element?.tagName || 'unknown',
          rating: last.startTime <= 2500 ? 'good' : last.startTime <= 4000 ? 'needs-improvement' : 'poor',
        },
        metadata: {
          size: last.size,
          url: last.url || null,
          id: last.id || null,
        },
      });
    });
  }

  _observeFCP() {
    this._observe('paint', (entries) => {
      for (const entry of entries) {
        if (entry.name === 'first-contentful-paint') {
          this.emit({
            name: 'fcp',
            value: entry.startTime,
            unit: 'ms',
            tags: {
              rating: entry.startTime <= 1800 ? 'good' : entry.startTime <= 3000 ? 'needs-improvement' : 'poor',
            },
          });
        }
      }
    });
  }

  /**
   * CLS — Cumulative Layout Shift
   * Uses the "session window" approach (same as Chrome UX Report)
   */
  _observeCLS() {
    let sessionValue = 0;
    let sessionEntries = [];
    let previousEndTime = 0;

    this._observe('layout-shift', (entries) => {
      for (const entry of entries) {
        if (entry.hadRecentInput) continue; // Ignore user-initiated shifts

        // Session window: gap < 1s and max 5s window
        if (
          entry.startTime - previousEndTime > 1000 ||
          entry.startTime - (sessionEntries[0]?.startTime ?? 0) > 5000
        ) {
          sessionValue = 0;
          sessionEntries = [];
        }

        sessionEntries.push(entry);
        sessionValue += entry.value;
        previousEndTime = entry.startTime + entry.duration;

        if (sessionValue > this._clsValue) {
          this._clsValue = sessionValue;

          this.emit({
            name: 'cls',
            value: this._clsValue,
            unit: 'score',
            tags: {
              rating: this._clsValue <= 0.1 ? 'good' : this._clsValue <= 0.25 ? 'needs-improvement' : 'poor',
            },
            metadata: {
              shiftedElements: entry.sources?.map((s) => s.node?.tagName).filter(Boolean) || [],
              entryCount: sessionEntries.length,
            },
          });
        }
      }
    });
  }

  /**
   * INP — Interaction to Next Paint
   * Track the worst interaction latency
   */
  _observeINP() {
    const interactions = new Map();

    this._observe('event', (entries) => {
      for (const entry of entries) {
        if (!entry.interactionId) continue;

        const existing = interactions.get(entry.interactionId) || 0;
        if (entry.duration > existing) {
          interactions.set(entry.interactionId, entry.duration);
        }
      }

      // INP is the p98 of all interactions
      if (interactions.size > 0) {
        const sorted = [...interactions.values()].sort((a, b) => b - a);
        // Use the 98th percentile (or worst if < 50 interactions)
        const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.02));
        this._inpValue = sorted[index];

        this.emit({
          name: 'inp',
          value: this._inpValue,
          unit: 'ms',
          tags: {
            rating: this._inpValue <= 200 ? 'good' : this._inpValue <= 500 ? 'needs-improvement' : 'poor',
            totalInteractions: interactions.size,
          },
        });
      }
    }, { durationThreshold: 16 });
  }

  _measureTTFB() {
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav) {
        this.emit({
          name: 'ttfb',
          value: nav.responseStart,
          unit: 'ms',
          tags: {
            rating: nav.responseStart <= 800 ? 'good' : nav.responseStart <= 1800 ? 'needs-improvement' : 'poor',
          },
          metadata: {
            dns: nav.domainLookupEnd - nav.domainLookupStart,
            tcp: nav.connectEnd - nav.connectStart,
            requestTime: nav.responseStart - nav.requestStart,
          },
        });
      }
    } catch {
      /* not supported */
    }
  }

  _observe(type, callback, options) {
    try {
      const observer = new PerformanceObserver((list) => {
        callback(list.getEntries());
      });
      observer.observe({ type, buffered: true, ...options });
      this._observers.push(observer);
    } catch {
      /* observer type not supported */
    }
  }
}
