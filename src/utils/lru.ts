/**
 * Byte-budgeted LRU cache.
 *
 * A `Map` iterates in insertion order, so "least recently used" is simply the
 * first key. `Map` already gives us O(1) lookup, insert and delete, which
 * matters because this is touched on every page render and every frame of the
 * flip animation.
 *
 * The budget is expressed in *bytes of canvas backing store* rather than entry
 * count: a 600x800 CSS page at DPR 2 costs ~7.7 MB while a small page costs far
 * less, and entry counts would badly mispredict memory on real documents.
 */
export class ByteLruCache<K, V> {
  private readonly map = new Map<K, V>();

  private currentBytes = 0;

  private clock = 0;

  constructor(
    private budgetBytes: number,
    private readonly sizeOf: (value: V) => number,
    /** Called for every evicted (or replaced) value so it can be freed. */
    private readonly onEvict?: (key: K, value: V) => void,
  ) {}

  get bytes(): number {
    return this.currentBytes;
  }

  get budget(): number {
    return this.budgetBytes;
  }

  setBudget(bytes: number): void {
    this.budgetBytes = Math.max(1, bytes);
    this.prune();
  }

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Read without promoting to most-recently-used (for render decisions). */
  peek(key: K): V | undefined {
    return this.map.get(key);
  }

  /** Read and promote to most-recently-used (for display decisions). */
  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing !== undefined) {
      this.currentBytes -= this.sizeOf(existing);
      this.map.delete(key);
      if (existing !== value) this.onEvict?.(key, existing);
    }
    this.map.set(key, value);
    this.currentBytes += this.sizeOf(value);
    this.prune();
  }

  delete(key: K): void {
    const existing = this.map.get(key);
    if (existing === undefined) return;
    this.map.delete(key);
    this.currentBytes -= this.sizeOf(existing);
    this.onEvict?.(key, existing);
  }

  /** Mark as recently used without changing the value. */
  touch(key: K): void {
    const value = this.map.get(key);
    if (value === undefined) return;
    this.map.delete(key);
    this.map.set(key, value);
  }

  /**
   * A snapshot of the keys, least-recently-used first. Callers that must never
   * lose a page (the visible spread) can consult this before evicting.
   */
  keysByLru(): K[] {
    return Array.from(this.map.keys());
  }

  clear(): void {
    for (const [key, value] of this.map) this.onEvict?.(key, value);
    this.map.clear();
    this.currentBytes = 0;
  }

  /** Monotonic timestamp helper shared by cache entries. */
  tick(): number {
    this.clock += 1;
    return this.clock;
  }

  private prune(): void {
    if (this.currentBytes <= this.budgetBytes) return;
    // A single oversized entry is still worth keeping (it is likely on screen);
    // prune() will simply have nothing left to free until it is replaced.
    for (const [key, value] of this.map) {
      if (this.currentBytes <= this.budgetBytes) break;
      if (this.map.size <= 1) break;
      this.map.delete(key);
      this.currentBytes -= this.sizeOf(value);
      this.onEvict?.(key, value);
    }
  }
}