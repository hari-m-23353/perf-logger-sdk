import { RingBuffer } from '../utils/RingBuffer.js';

/**
 * Learns "normal" performance baselines per metric.
 * Uses Welford's online algorithm for numerically stable stats.
 *
 * Each metric gets its own independent baseline that adapts over time.
 */
export class BaselineManager {
  /**
   * @param {number} learningPeriodSeconds
   * @param {number} [sampleRateHz=1]
   */
  constructor(learningPeriodSeconds, sampleRateHz = 1) {
    /** @type {Map<string, BaselineData>} */
    this._baselines = new Map();
    this._minSamples = learningPeriodSeconds * sampleRateHz;
  }

  /**
   * Record a new value for a metric
   */
  record(metricName, value) {
    if (!this._baselines.has(metricName)) {
      this._baselines.set(metricName, {
        values: new RingBuffer(500), // Keep last 500 values
        count: 0,
        mean: 0,
        m2: 0, // For Welford's algorithm
        min: Infinity,
        max: -Infinity,
      });
    }

    const data = this._baselines.get(metricName);
    data.values.push(value);
    data.count++;

    // Welford's online algorithm for mean + variance
    // Much more numerically stable than naive (sum/n) approach
    const delta = value - data.mean;
    data.mean += delta / data.count;
    const delta2 = value - data.mean;
    data.m2 += delta * delta2;

    data.min = Math.min(data.min, value);
    data.max = Math.max(data.max, value);
  }

  /**
   * Has this metric collected enough samples to make judgments?
   */
  isReady(metricName) {
    const data = this._baselines.get(metricName);
    return (data?.count ?? 0) >= this._minSamples;
  }

  /**
   * Get computed baseline stats for a metric
   */
  getBaseline(metricName) {
    const data = this._baselines.get(metricName);
    if (!data || !this.isReady(metricName)) return null;

    const variance = data.count > 1 ? data.m2 / (data.count - 1) : 0;
    const stdDev = Math.sqrt(variance);

    // Compute percentiles from the ring buffer
    const sorted = data.values.toArray().sort((a, b) => a - b);
    const n = sorted.length;

    return {
      mean: data.mean,
      stdDev,
      variance,
      min: data.min,
      max: data.max,
      p50: sorted[Math.floor(n * 0.5)] ?? 0,
      p90: sorted[Math.floor(n * 0.9)] ?? 0,
      p95: sorted[Math.floor(n * 0.95)] ?? 0,
      p99: sorted[Math.floor(n * 0.99)] ?? 0,
      sampleCount: data.count,
    };
  }

  /**
   * Get raw recent values for a metric
   */
  getValues(metricName) {
    return this._baselines.get(metricName)?.values.toArray() ?? [];
  }

  /**
   * Serialize baselines to JSON (for persistence across sessions)
   */
  serialize() {
    const output = {};
    for (const [name, data] of this._baselines) {
      output[name] = {
        count: data.count,
        mean: data.mean,
        m2: data.m2,
        min: data.min,
        max: data.max,
      };
    }
    return JSON.stringify(output);
  }

  /**
   * Restore baselines from a previous session
   */
  restore(json) {
    try {
      const parsed = JSON.parse(json);
      for (const [name, saved] of Object.entries(parsed)) {
        this._baselines.set(name, {
          values: new RingBuffer(500),
          count: saved.count,
          mean: saved.mean,
          m2: saved.m2,
          min: saved.min,
          max: saved.max,
        });
      }
    } catch {
      /* corrupted data, start fresh */
    }
  }
}
