import { AppError, UnauthorizedError } from '../../shared/utils/errors';

// Factory functions — named errors are readable and searchable
// Adopted from food-delivery-core-service pattern
export const UserAlreadyExists  = () => new AppError(409, 'An account with this email already exists', 'USER_EXISTS');
export const InvalidCredentials = () => new UnauthorizedError('Invalid email or password');
export const InvalidApiKey      = () => new UnauthorizedError('Invalid or revoked API key');
export const ApiKeyNotFound     = () => new AppError(404, 'API key not found', 'KEY_NOT_FOUND');
export const KeyLimitReached    = () => new AppError(403, 'API key limit reached for your plan. Upgrade to create more.', 'KEY_LIMIT');
