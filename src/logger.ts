/**
 * Logger simple con timestamp y contexto.
 * Sin dependencias — wrappea console.log/warn/error.
 */

function ts(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 23);
}

export const log = {
  info(ctx: string, msg: string, ...args: unknown[]) {
    console.log(`${ts()} [${ctx}] ${msg}`, ...args);
  },
  warn(ctx: string, msg: string, ...args: unknown[]) {
    console.warn(`${ts()} [${ctx}] WARN ${msg}`, ...args);
  },
  error(ctx: string, msg: string, ...args: unknown[]) {
    console.error(`${ts()} [${ctx}] ERROR ${msg}`, ...args);
  },
};
