/**
 * Fixed-size circular buffer - O(1) push, no memory allocation after init.
 * Critical for keeping memory usage constant in a monitoring SDK.
 */
export class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0;
    this.count = 0;
  }

  push(item) {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  toArray() {
    if (this.count === 0) return [];

    const result = [];
    const start = this.count < this.capacity ? 0 : this.head;

    for (let i = 0; i < this.count; i++) {
      result.push(this.buffer[(start + i) % this.capacity]);
    }

    return result;
  }

  get length() {
    return this.count;
  }

  get latest() {
    if (this.count === 0) return undefined;
    return this.buffer[(this.head - 1 + this.capacity) % this.capacity];
  }
}