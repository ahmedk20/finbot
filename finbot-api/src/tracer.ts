// dd-trace MUST be the first import in the process.
// It monkey-patches Node modules at require-time — importing Express, pg,
// ioredis, or BullMQ before this file means those integrations won't be traced.
import tracer from 'dd-trace';

tracer.init({
  service: 'finbot-api',
  env: process.env.NODE_ENV ?? 'development',
  version: process.env.npm_package_version,
  logInjection: true,    // injects dd.trace_id + dd.span_id into pino JSON logs
  runtimeMetrics: true,  // Node.js heap, GC pause, event loop lag → Datadog metrics
});

export { tracer };
