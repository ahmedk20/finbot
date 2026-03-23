import type { AuthUser } from '../../modules/auth/auth.types';

// Augment Express's core Request interface so req.user and req.correlationId
// are typed everywhere — no casting needed
// Same pattern as food-delivery-core-service common/types/express.d.ts
declare module 'express-serve-static-core' {
  interface Request {
    user?:          AuthUser;
    correlationId?: string;
  }
}
