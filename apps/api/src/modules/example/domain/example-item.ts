import { InvalidExampleTitleError } from './example-item.errors';

export const EXAMPLE_PRIORITIES = ['low', 'normal', 'high'] as const;
export type ExamplePriority = (typeof EXAMPLE_PRIORITIES)[number];

export const EXAMPLE_TITLE_MAX = 120;

/** Donnée d'offreur : un destinataire ne doit jamais la recevoir (VIS-20). */
export interface ExampleReservation {
  readonly byName: string;
  readonly at: Date;
}

export interface ExampleItemProps {
  readonly id: string;
  readonly title: string;
  readonly priority: ExamplePriority;
  readonly reservation: ExampleReservation | null;
  readonly version: number;
  readonly createdAt: Date;
}

/**
 * Entité du module type. TypeScript pur : ni décorateur, ni ORM (ADR 0002).
 * Construite par `create` (règles de création) ou `restore` (relecture, sans revalider).
 */
export class ExampleItem {
  private constructor(private readonly props: ExampleItemProps) {}

  static create(input: {
    id: string;
    title: string;
    priority?: ExamplePriority;
    now: Date;
  }): ExampleItem {
    const title = input.title.trim();
    if (title.length === 0 || title.length > EXAMPLE_TITLE_MAX) {
      throw new InvalidExampleTitleError();
    }
    return new ExampleItem({
      id: input.id,
      title,
      priority: input.priority ?? 'normal',
      reservation: null,
      version: 1,
      createdAt: input.now,
    });
  }

  static restore(props: ExampleItemProps): ExampleItem {
    return new ExampleItem(props);
  }

  get id(): string {
    return this.props.id;
  }
  get title(): string {
    return this.props.title;
  }
  get priority(): ExamplePriority {
    return this.props.priority;
  }
  get reservation(): ExampleReservation | null {
    return this.props.reservation;
  }
  get version(): number {
    return this.props.version;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
}
