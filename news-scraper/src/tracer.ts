// dd-trace MUST be the first import in the process.
import tracer from 'dd-trace';

tracer.init({
  service: 'news-scraper',
  env: process.env.NODE_ENV ?? 'development',
  version: process.env.npm_package_version,
  logInjection: true,
  runtimeMetrics: true,
});

export { tracer };
