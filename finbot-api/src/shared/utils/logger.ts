import pino from 'pino';
import type { Request, Response, NextFunction } from 'express';

// Production: plain JSON so Datadog can parse logs and correlate with traces.
// dd-trace logInjection adds dd.trace_id + dd.span_id to each log record automatically.
// Development: pino-pretty for human-readable output.
export const logger = pino({
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    logger.info(
      { method: req.method, url: req.url, status: res.statusCode, latency_ms: Date.now() - start },
      'request',
    );
  });
  next();
}
