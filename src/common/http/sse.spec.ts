import { SseFrames, dataOf, frame } from './sse';

/*
 * The boundary problem is the whole of this module. A chunk from the network
 * has nothing to do with an event boundary: one chunk may hold three events, or
 * a third of one. Getting that wrong means a proxy either drops the final
 * result or invents a half-event.
 */

describe('SseFrames', () => {
  it('returns each complete event in a chunk', () => {
    const frames = new SseFrames();
    const out = frames.push('data: {"a":1}\n\ndata: {"a":2}\n\n');
    expect(out).toEqual(['data: {"a":1}', 'data: {"a":2}']);
  });

  it('holds a partial event until the rest of it arrives', () => {
    const frames = new SseFrames();

    expect(frames.push('data: {"kind":"tool_')).toEqual([]);
    expect(frames.push('started"}\n\n')).toEqual(['data: {"kind":"tool_started"}']);
  });

  it('handles a split that lands inside the separator itself', () => {
    const frames = new SseFrames();

    expect(frames.push('data: {"a":1}\n')).toEqual([]);
    expect(frames.push('\ndata: {"a":2}\n\n')).toEqual([
      'data: {"a":1}',
      'data: {"a":2}',
    ]);
  });

  it('does not emit an empty frame when a chunk ends exactly on a boundary', () => {
    const frames = new SseFrames();
    expect(frames.push('data: {"a":1}\n\n')).toEqual(['data: {"a":1}']);
    expect(frames.push('\n\n')).toEqual([]);
  });

  it('keeps events in order across many small chunks', () => {
    const frames = new SseFrames();
    const source = 'data: {"i":1}\n\ndata: {"i":2}\n\ndata: {"i":3}\n\n';

    const seen: string[] = [];
    for (const char of source) seen.push(...frames.push(char));

    expect(seen.map((f) => dataOf<{ i: number }>(f)?.i)).toEqual([1, 2, 3]);
  });
});

describe('dataOf', () => {
  it('reads the payload of an event', () => {
    expect(dataOf('data: {"kind":"result"}')).toEqual({ kind: 'result' });
  });

  it('returns null for malformed JSON rather than throwing', () => {
    // A proxy must never fail a stream because it could not read one line.
    expect(dataOf('data: {not json')).toBeNull();
  });

  it('returns null for a comment or heartbeat', () => {
    expect(dataOf(': keep-alive')).toBeNull();
  });

  it('joins a payload split across several data lines', () => {
    expect(dataOf('data: {"a":\ndata: 1}')).toEqual({ a: 1 });
  });
});

describe('frame', () => {
  it('round-trips through the parser', () => {
    const frames = new SseFrames();
    const [out] = frames.push(frame({ kind: 'recorded', detail: { turnId: 't1' } }));
    expect(dataOf(out)).toEqual({ kind: 'recorded', detail: { turnId: 't1' } });
  });
});
