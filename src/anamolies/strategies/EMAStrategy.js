/**
 * Exponential Moving Average (EMA) Strategy
 *
 * Detects slow drifts and trend departures that Z-Score misses.
 * The EMA adapts to recent values, so a sudden shift from the
 * current TREND (not just the overall mean) triggers an alert.
 *
 * Perfect for:
 *  - Memory growth (gradual leak detection)
 *  - Slowly degrading render times
 *  - Seasonal load pattern changes
 *
 * How alpha works:
 *   α = 0.1 → very smooth, slow to react (good for long-term trends)
 *   α = 0.3 → balanced (default)
 *   α = 0.9 → very reactive, follows raw signal closely
 */
export class EMAStrategy {
  /**
   * @param {number} alpha - Smoothing factor (0-1)
   * @param {number} deviationThreshold - Number of σ to trigger
   */
  constructor(alpha = 0.3, deviationThreshold = 2.5) {
    this.name = 'ema';
    this.alpha = alpha;
    this.deviationThreshold = deviationThreshold;

    /** @type {Map<string, number>} current EMA per metric */
    this._emaValues = new Map();
  }

  detect(metric, baseline) {
    const base = baseline.getBaseline(metric.name);
    if (!base || base.stdDev === 0) return null;

    // Update EMA: new_ema = α * current_value + (1-α) * previous_ema
    const prevEma = this._emaValues.get(metric.name) ?? base.mean;
    const newEma = this.alpha * metric.value + (1 - this.alpha) * prevEma;
    this._emaValues.set(metric.name, newEma);

    // How far is the current value from the trend?
    const deviation = Math.abs(metric.value - newEma);
    const normalizedDeviation = deviation / base.stdDev;

    if (normalizedDeviation <= this.deviationThreshold) return null;

    const isCritical = normalizedDeviation > this.deviationThreshold * 2;

    return {
      type: 'drift',
      severity: isCritical ? 'critical' : 'warning',
      metric,
      message: `${metric.name} deviating from trend: value=${metric.value.toFixed(2)}, EMA=${newEma.toFixed(2)}, deviation=${normalizedDeviation.toFixed(1)}σ`,
      baseline: { mean: base.mean, stdDev: base.stdDev },
      score: Math.min(1, normalizedDeviation / (this.deviationThreshold * 2)),
      timestamp: Date.now(),
      context: {
        strategy: 'ema',
        ema: newEma,
        alpha: this.alpha,
        normalizedDeviation,
      },
    };
  }
