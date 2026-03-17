/** Cache in-memory con TTL configurable */
export class TTLCache<T> {
  private store = new Map<string, { data: T; timestamp: number }>();

  constructor(private ttlMs: number) {}

  /** Obtener un valor. Devuelve data y si está vencido (stale) */
  get(key: string): { data: T | null; isStale: boolean } {
    const entry = this.store.get(key);
    if (!entry) {
      return { data: null, isStale: true };
    }

    const age = Date.now() - entry.timestamp;
    const isStale = age > this.ttlMs;
    return { data: entry.data, isStale };
  }

  /** Guardar un valor */
  set(key: string, data: T): void {
    this.store.set(key, { data, timestamp: Date.now() });
  }

  /** Eliminar una entrada */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** Obtener todas las keys */
  keys(): string[] {
    return Array.from(this.store.keys());
  }

  /** Limpiar todo el cache */
  clear(): void {
    this.store.clear();
  }
}

// Instancias para los 3 niveles de cache
// L1: proyectos/grupos - 30 minutos
export const projectsCache = new TTLCache<any>(30 * 60 * 1000);

// L2: ramas - 5 minutos
export const branchesCache = new TTLCache<any>(5 * 60 * 1000);

// L3: pipelines/status - 30 segundos
export const pipelinesCache = new TTLCache<any>(30 * 1000);
