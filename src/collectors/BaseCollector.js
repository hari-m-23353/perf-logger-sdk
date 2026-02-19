/**
 * Abstract base class for all metric collectors.
 * Each collector observes one category of performance data.
 *
 * MetricEntry shape:
 * {
 *   name: string,
 *   value: number,
 *   unit: string,
 *   tags: Object,
 *   metadata: Object|null,
 *   timestamp: number
 * }
 */
export class BaseCollector {
  constructor(eventBus, config) {
    this.eventBus = eventBus;
    this.config = config;
    this.isRunning = false;
    this.collectorName = this.constructor.name;
  }

  start() {
    throw new Error('start() must be implemented');
  }

  stop() {
    throw new Error('stop() must be implemented');
  }

  collect() {
    return [];
  }

  emit(metric) {
    metric.timestamp = metric.timestamp || performance.now();
    this.eventBus.emit('metric:collected', this.collectorName, metric);
  }

  emitBatch(metrics) {
    metrics.forEach((m) => this.emit(m));
  }
}