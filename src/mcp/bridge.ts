import { createServer, Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { serveMcp } from './server';
import { sendFrame, receiveFrames } from '../desktop/pipe';
import { RenderError, RenderResult } from '../engine/recipe';
import { FrameResult } from '../engine/media-recipe';
import { stopMediaProcesses } from '../desktop/media';

export async function startMcp(options: { executable: string; workerArgs: string[] }) {
  const token = randomUUID(), pipe = `\\\\.\\pipe\\localascii-${randomUUID()}`;
  const pending = new Map<string, { resolve: (value: RenderResult | FrameResult) => void; reject: (error: Error) => void }>();
  let socket: Socket | undefined;
  let accept: (socket: Socket) => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<Socket>((resolve, reject) => { accept = resolve; rejectReady = reject; });
  const listener = createServer(connection => {
    connection.on('error', () => { /* Rejected connections must not crash the MCP process. */ });
    receiveFrames(connection, message => {
      if (connection !== socket) {
        if (socket || message?.type !== 'hello' || message.token !== token) { connection.destroy(); return; }
        socket = connection; listener.close(); accept(connection);
        connection.on('close', () => { for (const task of pending.values()) task.reject(new RenderError('WORKER_CLOSED', 'The local renderer closed.'));
          pending.clear(); });
      } else if (message?.type === 'result' && typeof message.id === 'string') {
        const task = pending.get(message.id); if (!task) return; pending.delete(message.id);
        if (message.ok) task.resolve(message.value);
        else task.reject(new RenderError(message.error?.code || 'RENDER_FAILED', message.error?.message || 'Render failed.'));
      }
    });
  });
  await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(pipe, resolve); });
  const env: NodeJS.ProcessEnv = { ...process.env, LOCALASCII_WORKER_PIPE: pipe, LOCALASCII_WORKER_TOKEN: token };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(options.executable, [...options.workerArgs, '--render-worker'], {
    env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true
  });
  child.stderr?.on('data', chunk => process.stderr.write(chunk));
  child.once('error', error => rejectReady(error));
  child.once('exit', code => { rejectReady(new Error(`Renderer exited with code ${code}.`));
    socket?.destroy(); for (const task of pending.values()) task.reject(new Error('Renderer exited.')); pending.clear(); });
  const timeout = setTimeout(() => rejectReady(new Error('Renderer startup exceeded 30 seconds.')), 30_000);
  const cleanup = () => { clearTimeout(timeout); stopMediaProcesses(); socket?.destroy(); listener.close(); if (!child.killed) child.kill(); };
  process.once('exit', cleanup);
  process.once('SIGTERM', () => { cleanup(); process.exit(0); });
  process.once('SIGINT', () => { cleanup(); process.exit(0); });
  try {
    await ready; clearTimeout(timeout);
    const requestWorker = <T extends RenderResult | FrameResult>(type: 'render' | 'frame', request: unknown) => new Promise<T>((resolve, reject) => {
      if (!socket || socket.destroyed) { reject(new RenderError('WORKER_CLOSED', 'The local renderer is unavailable.')); return; }
      const id = randomUUID(); pending.set(id, { resolve: value => resolve(value as T), reject });
      try { sendFrame(socket, { type, id, request }); }
      catch (error) { pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
    });
    const server = await serveMcp(request => requestWorker<RenderResult>('render', request),
      request => requestWorker<FrameResult>('frame', request));
    process.stdin.once('end', async () => { await server.close(); cleanup(); });
    return server;
  } catch (error) { cleanup(); throw error; }
}

if (process.argv[1]?.endsWith('mcp.cjs')) {
  startMcp({ executable: process.execPath, workerArgs: [] }).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1;
  });
}
