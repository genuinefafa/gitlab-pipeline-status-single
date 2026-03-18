import { logger } from './logger.ts';
const log = logger('SSE');

/**
 * SSE Manager — Gestiona conexiones Server-Sent Events y suscripciones de clientes.
 *
 * Cada cliente se conecta via un ReadableStream y se suscribe a "branches"
 * con formato "grupo/proyecto:rama". El manager se encarga de routear eventos
 * a los clientes correctos según sus suscripciones.
 */

export interface SSEEvent {
  type: string; // "connected" | "pipeline-update" | "branch-deleted" | "branches" | "error"
  data: unknown;
}

interface SSEClient {
  id: string;
  controller: ReadableStreamDefaultController;
  subscribedBranches: Set<string>; // "grupo/proyecto:rama"
}

export class SSEManager {
  private clients = new Map<string, SSEClient>();

  /**
   * Registrar nuevo cliente SSE.
   * Si ya existe un cliente con ese id, lo reemplaza (cierra el anterior).
   */
  addClient(clientId: string, controller: ReadableStreamDefaultController): void {
    // Si ya existía, limpiar el anterior
    if (this.clients.has(clientId)) {
      this.removeClient(clientId);
    }

    this.clients.set(clientId, {
      id: clientId,
      controller,
      subscribedBranches: new Set(),
    });

    log.info( ` Cliente conectado: ${clientId} (total: ${this.clients.size})`);
  }

  /**
   * Remover cliente y limpiar sus suscripciones.
   * Intenta cerrar el controller de forma segura.
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Intentar cerrar el stream
    try {
      client.controller.close();
    } catch {
      // Ya estaba cerrado, no pasa nada
    }

    client.subscribedBranches.clear();
    this.clients.delete(clientId);

    log.info( ` Cliente desconectado: ${clientId} (total: ${this.clients.size})`);
  }

  /**
   * Suscribir un cliente a una o más branches.
   * Formato esperado de cada branch: "grupo/proyecto:rama"
   */
  subscribe(clientId: string, branches: string[]): void {
    const client = this.clients.get(clientId);
    if (!client) {
      log.warn( ` subscribe: cliente ${clientId} no encontrado`);
      return;
    }

    for (const branch of branches) {
      client.subscribedBranches.add(branch);
    }
  }

  /**
   * Desuscribir un cliente de branches específicas.
   */
  unsubscribe(clientId: string, branches: string[]): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    for (const branch of branches) {
      client.subscribedBranches.delete(branch);
    }
  }

  /**
   * Desuscribir una branch de TODOS los clientes (ej: branch borrado).
   */
  unsubscribeAll(branchKey: string): void {
    for (const [, client] of this.clients) {
      client.subscribedBranches.delete(branchKey);
    }
  }

  /**
   * Obtener las branches de un cliente específico (como array).
   */
  getClientBranches(clientId: string): string[] {
    const client = this.clients.get(clientId);
    if (!client) return [];
    return Array.from(client.subscribedBranches);
  }

  /**
   * Obtener todas las branches que tienen al menos un suscriptor.
   * Retorna un Map de branchKey -> Set de clientIds suscriptos.
   */
  getWatchedBranches(): Map<string, Set<string>> {
    const watched = new Map<string, Set<string>>();

    for (const [clientId, client] of this.clients) {
      for (const branch of client.subscribedBranches) {
        let subscribers = watched.get(branch);
        if (!subscribers) {
          subscribers = new Set();
          watched.set(branch, subscribers);
        }
        subscribers.add(clientId);
      }
    }

    return watched;
  }

  /**
   * Enviar un evento SSE a todos los suscriptores de una branch específica.
   */
  pushToBranch(branchKey: string, event: SSEEvent): void {
    for (const [, client] of this.clients) {
      if (client.subscribedBranches.has(branchKey)) {
        this.sendToController(client, event);
      }
    }
  }

  /**
   * Enviar un evento SSE a un cliente específico.
   */
  pushToClient(clientId: string, event: SSEEvent): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.sendToController(client, event);
  }

  /**
   * Enviar un evento SSE a todos los clientes conectados (broadcast).
   */
  broadcast(event: SSEEvent): void {
    for (const [, client] of this.clients) {
      this.sendToController(client, event);
    }
  }

  /**
   * Cantidad de clientes conectados actualmente.
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Escribir un evento SSE al controller del cliente.
   * Formato: `event: {type}\ndata: {json}\n\n`
   *
   * Si falla (stream cerrado), remueve el cliente automáticamente.
   */
  private sendToController(client: SSEClient, event: SSEEvent): void {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    const encoder = new TextEncoder();

    try {
      client.controller.enqueue(encoder.encode(payload));
    } catch {
      // El stream ya se cerró — limpiar el cliente
      log.warn( ` Error escribiendo a cliente ${client.id}, removiendo`);
      this.clients.delete(client.id);
      client.subscribedBranches.clear();
    }
  }
}
