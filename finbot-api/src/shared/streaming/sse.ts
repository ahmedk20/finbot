import type { Response } from 'express';

// Initialise an SSE stream — sets headers and flushes them immediately.
// Must be called before writing any events.
export function initSSE(res: Response): void {
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  // X-Accel-Buffering: no — tells nginx/reverse proxies not to buffer this response.
  // Without it, nginx holds events in memory until its buffer fills (~4KB).
  // Clients would receive events in batches, not in real time.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders(); // send headers immediately — this establishes the stream
}

// Write a named SSE event.
// Format: "event: <name>\ndata: <json>\n\n"
// The double newline (\n\n) signals end of one event to the browser's EventSource.
export function writeEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Write a heartbeat comment — keeps the TCP connection alive.
// Proxies and load balancers close connections idle for >60s.
// Comment lines (starting with :) are ignored by EventSource but prevent idle timeout.
export function writeHeartbeat(res: Response): void {
  res.write(': heartbeat\n\n');
}
