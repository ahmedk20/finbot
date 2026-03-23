import { NotFoundError } from '../../shared/utils/errors';

export const ArticleNotFound = () => new NotFoundError('Article');
