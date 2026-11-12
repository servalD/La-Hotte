// Point d'entrée du client. Tout ce qui est sous generated/ est produit par `pnpm generate`.
export * from './generated/endpoints/example-items/example-items';
export * from './generated/model';
export { ApiError, setApiBaseUrl, type ProblemDetails } from './http/fetcher';
