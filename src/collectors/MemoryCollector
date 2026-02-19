import { BaseCollector } from './BaseCollector.js';

/**
 * Captures:
 *  - JS Heap usage (size, growth rate)
 *  - Memory leak detection via linear regression
 *  - DOM node count explosion
 *  - Detached DOM node estimation
 */
export class MemoryCollector extends BaseCollector {
  constructor(eventBus, config) {
    super(eventBus, config);
    this._pollingInterval = null;
    this._mutationObserver = null;

    /** @type {Array<{timestamp: number, usedJSHeapSize: number, totalJSHeapSize: number}>} */
    this._heapHistory = [];
    this._MAX_HISTORY = 120; // 2 min at 1s intervals
    this._LEAK_WINDOW = 60; // Check over 60 samples
    this._nodeCount = 0;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this._startHeapPolling();
    this._observeDOMNodeCount();
  }

  stop() {
    if (this._pollingInterval) clearInterval(this._pollingInterval);
    this._mutationObserver?.disconnect();
    this.isRunning = false;
  }

  collect() {
    if (this._heapHistory.length === 0) return [];
    const latest = this._heapHistory[this._heapHistory.length - 1];
    return [
      { name: 'heap_used', value: latest.usedJSHeapSize, unit: 'bytes', tags: {} },
      { name: 'heap_total', value: latest.totalJSHeapSize, unit: 'bytes', tags: {} },
      { name: 'heap_limit', value: latest.jsHeapSizeLimit, unit: 'bytes', tags: {} },
      { name: 'dom_nodes', value: this._nodeCount, unit: 'count', tags: {} },
    ];
  }

  /**
   * Poll performance.memory for heap trends (Chrome/Edge only).
   * Runs linear regression to detect monotonic growth = leak.
   */
  _startHeapPolling() {
    const perf = performance;

    if (!perf.memory) {
      if (this.config.debug) {
        console.warn('[PerfSDK] performance.memory not available (Chrome/Edge only)');
      }

      // Fallback: try the newer measureUserAgentSpecificMemory API
      this._tryModernMemoryAPI();
      return;
    }

    this._pollingInterval = setInterval(() => {
      const mem = perf.memory;

      const snapshot = {
        timestamp: Date.now(),
        usedJSHeapSize: mem.usedJSHeapSize,
        totalJSHeapSize: mem.totalJSHeapSize,
        jsHeapSizeLimit: mem.jsHeapSizeLimit,
      };

      this._heapHistory.push(snapshot);
      if (this._heapHistory.length > this._MAX_HISTORY) {
        this._heapHistory.shift();
      }

      // Emit current usage
      const utilization = (snapshot.usedJSHeapSize / snapshot.jsHeapSizeLimit) * 100;

      this.emit({
        name: 'heap_used',
        value: snapshot.usedJSHeapSize,
        unit: 'bytes',
        tags: {
          utilization: utilization.toFixed(1) + '%',
          heapMB: (snapshot.usedJSHeapSize / 1048576).toFixed(1),
        },
      });

      // Alert if heap utilization is extreme
      if (utilization > 85) {
        this.eventBus.emit('anomaly:detected', 'MemoryCollector', {
          type: 'threshold_breach',
          severity: utilization > 95 ? 'critical' : 'warning',
          message: `Heap utilization at ${utilization.toFixed(1)}% — ${(snapshot.usedJSHeapSize / 1048576).toFixed(1)}MB / ${(snapshot.jsHeapSizeLimit / 1048576).toFixed(1)}MB`,
          metric: { name: 'heap_used', value: snapshot.usedJSHeapSize, unit: 'bytes', tags: {} },
          score: utilization / 100,
          timestamp: Date.now(),
          context: { snapshot },
        });
      }

      // Run leak detection
      this._detectMemoryLeak();
    }, 1000);
  }

  /**
   * Memory leak detection using simple linear regression.
   *
   * Strategy: Take the last N heap snapshots and fit a line.
   * If slope is consistently positive and above a threshold,
   * flag it as a suspected leak.
   *
   * Why linear regression?
   *  - GC causes sawtooth patterns, but the TREND should be flat
   *    for healthy apps. A positive trend = leak.
   *
   *    Heap
   *    ▲  /\  /\  /\  /\  ← HEALTHY (sawtooth, flat trend)
   *    │ /  \/  \/  \/  \
   *    └──────────────────► Time
   *
   *    Heap
   *    ▲      /\   /\  /\
   *    │    /\/ \ /  \/   ← LEAK (sawtooth, upward trend ↗)
   *    │  /\/    /
   *    │ /
   *    └──────────────────► Time
   */
  _detectMemoryLeak() {
    if (this._heapHistory.length < this._LEAK_WINDOW) return;

    const recent = this._heapHistory.slice(-this._LEAK_WINDOW);
    const n = recent.length;

    // Linear regression: y = mx + b
    // where x = sample index, y = heap size
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    for (let i = 0; i < n; i++) {
      const x = i;
      const y = recent[i].usedJSHeapSize;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

    // Calculate R² to check if growth is consistent (not just noise)
    const meanY = sumY / n;
    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < n; i++) {
      const predicted = slope * i + (meanY - slope * (sumX / n));
      ssRes += (recent[i].usedJSHeapSize - predicted) ** 2;
      ssTot += (recent[i].usedJSHeapSize - meanY) ** 2;
    }
    const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    // Threshold: heap growing > 100KB/s with R² > 0.7 (consistent growth)
    const LEAK_THRESHOLD_BYTES_PER_SEC = 100 * 1024; // 100KB/s

    if (slope > LEAK_THRESHOLD_BYTES_PER_SEC && rSquared > 0.7) {
      const startHeap = recent[0].usedJSHeapSize;
      const endHeap = recent[n - 1].usedJSHeapSize;
      const growthMB = ((endHeap - startHeap) / 1048576).toFixed(2);

      this.eventBus.emit('anomaly:detected', 'MemoryCollector', {
        type: 'memory_leak_suspected',
        severity: 'critical',
        message: `🔴 Potential memory leak: heap grew ${growthMB}MB over ${n}s (${(slope / 1024).toFixed(1)}KB/s, R²=${rSquared.toFixed(2)})`,
        metric: { name: 'heap_used', value: endHeap, unit: 'bytes', tags: {} },
        baseline: { mean: meanY, stdDev: 0 },
        score: Math.min(1, rSquared),
        timestamp: Date.now(),
        context: {
          slope,
          rSquared,
          startHeapMB: (startHeap / 1048576).toFixed(1),
          endHeapMB: (endHeap / 1048576).toFixed(1),
          durationSeconds: n,
          recentSnapshots: recent.slice(-5),
        },
      });
    }
  }

  /**
   * Watch for DOM node count explosion.
   * CRM apps often leak DOM nodes via:
   *  - Modals that aren't properly destroyed
   *  - Infinite scroll items never reclaimed
   *  - Tooltip/dropdown overlays accumulating
   */
  _observeDOMNodeCount() {
    this._nodeCount = document.querySelectorAll('*').length;

    this._mutationObserver = new MutationObserver((mutations) => {
      let added = 0;
      let removed = 0;

      for (const mutation of mutations) {
        added += mutation.addedNodes.length;
        removed += mutation.removedNodes.length;
      }

      this._nodeCount = this._nodeCount + added - removed;

      // Recount periodically to correct drift
      if (Math.random() < 0.01) {
        this._nodeCount = document.querySelectorAll('*').length;
      }

      if (this._nodeCount > 3000) {
        this.emit({
          name: 'dom_node_count',
          value: this._nodeCount,
          unit: 'count',
          tags: {
            severity: this._nodeCount > 5000 ? 'critical' : 'warning',
            netDelta: `+${added - removed}`,
          },
        });
      }
    });

    this._mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Modern cross-browser memory API (requires cross-origin isolation)
   */
  _tryModernMemoryAPI() {
    if (typeof performance.measureUserAgentSpecificMemory !== 'function') return;

    const poll = async () => {
      try {
        const result = await performance.measureUserAgentSpecificMemory();
        this.emit({
          name: 'heap_used',
          value: result.bytes,
          unit: 'bytes',
          tags: { source: 'measureUserAgentSpecificMemory' },
          metadata: { breakdown: result.breakdown },
        });
      } catch {
        /* requires cross-origin isolation headers */
      }
    };

    setInterval(poll, 5000); // This API is rate-limited, so poll less often
  }
}
