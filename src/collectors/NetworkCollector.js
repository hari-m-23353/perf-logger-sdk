import { BaseCollector } from './BaseCollector.js';

/**
 * Captures:
 *  - Resource load timing (waterfall data)
 *  - Slow API calls
 *  - Large payloads
 *  - Failed requests
 *  - XHR/Fetch interception
 */
export class NetworkCollector extends BaseCollector {
  constructor(eventBus, config) {
    super(eventBus, config);
    this._resourceObserver = null;
    this._originalFetch = null;
    this._originalXHROpen = null;
    this._originalXHRSend = null;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this._observeResources();
    this._interceptFetch();
    this._interceptXHR();
  }

  stop() {
    this._resourceObserver?.disconnect();
    if (this._originalFetch) window.fetch = this._originalFetch;
    if (this._originalXHROpen) XMLHttpRequest.prototype.open = this._originalXHROpen;
    if (this._originalXHRSend) XMLHttpRequest.prototype.send = this._originalXHRSend;
    this.isRunning = false;
  }

  collect() {
    return [];
  }

  /**
   * Resource Timing API — captures waterfall data for all resources
   */
  _observeResources() {
    try {
      this._resourceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // Only report slow or large resources
          const isSlow = entry.duration > 500;
          const isLarge = (entry.transferSize || 0) > 500 * 1024; // >500KB

          if (isSlow || isLarge) {
            this.emit({
              name: 'slow_resource',
              value: entry.duration,
              unit: 'ms',
              tags: {
                type: entry.initiatorType, // 'script', 'fetch', 'xmlhttprequest', 'img', etc.
                url: this._truncateUrl(entry.name),
                severity: entry.duration > 2000 ? 'critical' : 'warning',
              },
              metadata: {
                fullUrl: entry.name,
                transferSize: entry.transferSize,
                encodedBodySize: entry.encodedBodySize,
                decodedBodySize: entry.decodedBodySize,
                // Waterfall breakdown
                dns: entry.domainLookupEnd - entry.domainLookupStart,
                tcp: entry.connectEnd - entry.connectStart,
                tls: entry.secureConnectionStart > 0 ? entry.connectEnd - entry.secureConnectionStart : 0,
                ttfb: entry.responseStart - entry.requestStart,
                download: entry.responseEnd - entry.responseStart,
                // Was this from cache?
                cached: entry.transferSize === 0 && entry.decodedBodySize > 0,
              },
            });
          }
        }
      });

      this._resourceObserver.observe({ type: 'resource', buffered: false });
    } catch {
      /* not supported */
    }
  }

  /**
   * Intercept fetch() to capture:
   *  - Request/response timing for API calls
   *  - HTTP errors (4xx, 5xx)
   *  - Payload sizes
   */
  _interceptFetch() {
    this._originalFetch = window.fetch;
    const self = this;

    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input?.url || 'unknown';
      const method = init?.method || 'GET';
      const start = performance.now();

      return self._originalFetch
        .apply(this, arguments)
        .then((response) => {
          const duration = performance.now() - start;

          // Clone response to read body size without consuming it
          const clone = response.clone();

          // Report API call metrics
          self.emit({
            name: 'api_call',
            value: duration,
            unit: 'ms',
            tags: {
              method,
              url: self._truncateUrl(url),
              status: response.status,
              ok: response.ok,
              severity: !response.ok ? 'critical' : duration > 1000 ? 'warning' : 'info',
            },
            metadata: {
              fullUrl: url,
              statusText: response.statusText,
            },
          });

          // Report errors separately for visibility
          if (!response.ok) {
            self.eventBus.emit('anomaly:detected', 'NetworkCollector', {
              type: 'threshold_breach',
              severity: response.status >= 500 ? 'critical' : 'warning',
              message: `API error: ${method} ${self._truncateUrl(url)} → ${response.status} ${response.statusText} (${duration.toFixed(0)}ms)`,
              metric: { name: 'api_error', value: response.status, unit: 'count', tags: {} },
              score: 1,
              timestamp: Date.now(),
              context: { url, method, status: response.status, duration },
            });
          }

          return response;
        })
        .catch((error) => {
          const duration = performance.now() - start;

          self.eventBus.emit('anomaly:detected', 'NetworkCollector', {
            type: 'threshold_breach',
            severity: 'critical',
            message: `Network failure: ${method} ${self._truncateUrl(url)} — ${error.message} (${duration.toFixed(0)}ms)`,
            metric: { name: 'network_error', value: duration, unit: 'ms', tags: {} },
            score: 1,
            timestamp: Date.now(),
            context: { url, method, error: error.message },
          });

          throw error;
        });
    };
  }

  /**
   * Intercept XMLHttpRequest for legacy CRM code paths
   */
  _interceptXHR() {
    this._originalXHROpen = XMLHttpRequest.prototype.open;
    this._originalXHRSend = XMLHttpRequest.prototype.send;
    const self = this;

    XMLHttpRequest.prototype.open = function (method, url) {
      this._perfSDK = { method, url, start: 0 };
      return self._originalXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      if (this._perfSDK) {
        this._perfSDK.start = performance.now();

        this.addEventListener('loadend', function () {
          const duration = performance.now() - this._perfSDK.start;

          if (duration > 500 || this.status >= 400) {
            self.emit({
              name: 'api_call',
              value: duration,
              unit: 'ms',
              tags: {
                method: this._perfSDK.method,
                url: self._truncateUrl(this._perfSDK.url),
                status: this.status,
                transport: 'xhr',
                severity: this.status >= 500 ? 'critical' : duration > 1000 ? 'warning' : 'info',
              },
            });
          }
        });
      }

      return self._originalXHRSend.apply(this, arguments);
    };
  }

  _truncateUrl(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      return parsed.pathname + (parsed.search ? '?...' : '');
    } catch {
      return url?.slice?.(0, 80) || 'unknown';
    }
  }
}
