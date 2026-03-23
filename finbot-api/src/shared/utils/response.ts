export interface Meta {
  timestamp: string;
  cached: boolean;
  latency_ms: number;
}

export interface ApiResponse<T> {
  success: true;
  data: T;
  meta: Meta;
}

export function ok<T>(data: T, meta: Partial<Meta> = {}): ApiResponse<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      cached: meta.cached ?? false,
      latency_ms: meta.latency_ms ?? 0,
    },
  };
}
