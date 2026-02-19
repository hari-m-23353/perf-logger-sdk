/**
 * Z-Score Strategy
 * 
 * Flags a metric as anomalous if it deviates more than N standard
 * deviations from the learned mean.
 *
 * Best for: normally distributed metrics (latency, execution time)
 * Not great for: metrics with heavy tails (network calls)
 *
 * Visual intuition:
 * 
 *     ▁▂▃▅██▅▃▂▁        ← Normal distribution of values
 *   ──────────────────
 *   -3σ  -2σ  μ  2σ  3σ
 *                     ↑ anything beyond threshold is anomalous
 */
export class ZScoreStrategy {
  /**
   * @param {number} threshold - Number of std devs to trigger (default 2.5)
   */
  constructor(threshold = 2.5) {
    this.name = 'zscore';
    this.threshold = threshold;
  }

  /**
   * @param {object} metric
   * @param {import('../BaselineManager').BaselineManager} baseline
   * @returns {object|null} AnomalyEvent or null
   */
  detect(metric, baseline) {
    const base = baseline.getBaseline(metric.name);
    if (!base || base.stdDev === 0) return null;

    const zScore = (metric.value - base.mean) / base.stdDev;

    if (Math.abs(zScore) <= this.threshold) return null;

    const isCritical = Math.abs(zScore) > this.threshold * 2;

    return {
      type: 'spike',
      severity: isCritical ? 'critical' : 'warning',
      metric,
      message: `${metric.name} = ${metric.value.toFixed(2)}${metric.unit} is ${zScore.toFixed(1)}σ from mean (${base.mean.toFixed(2)}${metric.unit})`,
      baseline: { mean: base.mean, stdDev: base.stdDev },
      score: Math.min(1, Math.abs(zScore) / (this.threshold * 2)),
      timestamp: Date.now(),
      context: {
        strategy: 'zscore',
        zScore,
        threshold: this.threshold,
        p95: base.p95,
        p99: base.p99,
      },
    };
  }
}
