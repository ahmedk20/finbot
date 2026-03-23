import { NotFoundError, AppError } from '../../shared/utils/errors';

export const AssetNotFound      = () => new NotFoundError('Asset');
export const LLMParseError      = () => new AppError(502, 'LLM returned unparseable sentiment', 'LLM_PARSE_ERROR');
export const InternalKeyInvalid = () => new AppError(401, 'Invalid internal key', 'UNAUTHORIZED');
