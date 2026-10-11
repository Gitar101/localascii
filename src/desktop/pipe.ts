import type { Socket } from 'node:net';

const maxFrame = 128 * 1024 * 1024;
export function sendFrame(socket: Socket, message: unknown) {
  const body = Buffer.from(JSON.stringify(message));
  if (body.length > maxFrame) throw new Error('Renderer message exceeds 128 MiB.');
  const header = Buffer.allocUnsafe(4); header.writeUInt32BE(body.length);
  socket.write(header); socket.write(body);
}

export function receiveFrames(socket: Socket, receive: (message: any) => void) {
  const header = Buffer.alloc(4); let headBytes = 0, body: Buffer | null = null, bodyBytes = 0;
  socket.on('data', chunk => {
    let offset = 0;
    try {
      while (offset < chunk.length) {
        if (!body) {
          const take = Math.min(4 - headBytes, chunk.length - offset);
          chunk.copy(header, headBytes, offset, offset + take); headBytes += take; offset += take;
          if (headBytes !== 4) continue;
          const size = header.readUInt32BE(); headBytes = 0;
          if (!size || size > maxFrame) throw new Error('Invalid renderer frame length.');
          body = Buffer.allocUnsafe(size); bodyBytes = 0;
        }
        const take = Math.min(body.length - bodyBytes, chunk.length - offset);
        chunk.copy(body, bodyBytes, offset, offset + take); bodyBytes += take; offset += take;
        if (bodyBytes === body.length) { const message = JSON.parse(body.toString('utf8'));
          body = null; bodyBytes = 0; receive(message); }
      }
    } catch (error) { socket.destroy(error instanceof Error ? error : new Error(String(error))); }
  });
}
