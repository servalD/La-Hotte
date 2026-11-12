// Ce que la présentation a le droit de connaître du module : cas d'usage, types d'entrée
// et de sortie. La présentation n'importe jamais le domaine directement (QA-03).
export {
  EXAMPLE_PRIORITIES,
  EXAMPLE_TITLE_MAX,
  type ExamplePriority,
} from '../domain/example-item';
export type {
  ExampleGiverProjection,
  ExampleProjection,
  ExampleRecipientProjection,
  ExampleViewer,
} from '../domain/example-item-projection';
export { CreateExampleItem, type CreateExampleItemInput } from './create-example-item.use-case';
export { GetExampleItem, type GetExampleItemInput } from './get-example-item.use-case';
