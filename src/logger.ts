import { createConsola, LogLevels } from 'consola';

function localTimestamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

const base = createConsola({
  level: LogLevels.debug,
  formatOptions: {
    colors: true,
    compact: false,
    date: false, // usamos nuestro timestamp
  },
}).withDefaults({
  // Hook para prefixear timestamp local 24hs
});

// Wrappear para agregar timestamp local en formato 24hs
function withTimestamp(consola: ReturnType<typeof createConsola>) {
  const wrap = (method: 'info' | 'warn' | 'error' | 'debug' | 'success') => {
    const original = consola[method].bind(consola);
    return (...args: any[]) => original(`[${localTimestamp()}]`, ...args);
  };
  return {
    info: wrap('info'),
    warn: wrap('warn'),
    error: wrap('error'),
    debug: wrap('debug'),
    success: wrap('success'),
  };
}

/** Crear un logger con tag de contexto y timestamp local 24hs */
export function logger(tag: string) {
  const tagged = base.withTag(tag);
  return withTimestamp(tagged);
}

export const log = withTimestamp(base);
