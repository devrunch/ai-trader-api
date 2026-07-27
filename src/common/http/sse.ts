/**
 * Server-Sent Events framing.
 *
 * A proxy that forwards a stream still has to understand it: the last event of
 * a chat turn carries the result we must record. Parsing is separated from
 * forwarding so the bytes reaching the browser are exactly the bytes upstream
 * sent — re-serialising a frame we half-understood is how a stream quietly
 * corrupts.
 *
 * The only real work here is the boundary problem: a chunk from the network has
 * nothing to do with an event boundary, so one chunk may hold three events, or
 * a third of one.
 */

/** Events are separated by a blank line. */
const FRAME_SEPARATOR = '\n\n';

export class SseFrames {
  private buffer = '';

  /**
   * Feed a chunk; get back whatever complete frames it completed.
   *
   * A trailing partial frame is held until the rest of it arrives.
   */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const parts = this.buffer.split(FRAME_SEPARATOR);
    // The last element is either an incomplete frame or an empty string when
    // the chunk ended exactly on a boundary. Either way it is not ready.
    this.buffer = parts.pop() ?? '';
    return parts.filter((p) => p.trim().length > 0);
  }
}

/**
 * The JSON payload of one frame, or null if it carries none.
 *
 * A frame that is a comment, a heartbeat, or malformed JSON returns null rather
 * than throwing — a proxy must never fail a stream because it could not read
 * one line of it.
 */
export function dataOf<T = Record<string, unknown>>(frame: string): T | null {
  const lines = frame.split('\n');
  const payload = lines
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice('data:'.length).trim())
    .join('\n');

  if (!payload) return null;
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

/** Encode one event for the wire. */
export function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}${FRAME_SEPARATOR}`;
}
