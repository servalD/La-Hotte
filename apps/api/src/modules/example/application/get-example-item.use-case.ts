import { Injectable } from '@nestjs/common';
import {
  type ExampleProjection,
  type ExampleViewer,
  projectExampleItem,
} from '../domain/example-item-projection';
import { ExampleItemNotFoundError } from '../domain/example-item.errors';
import { ExampleItemRepository } from '../domain/example-item.repository';

export interface GetExampleItemInput {
  readonly id: string;
  readonly viewer: ExampleViewer;
}

@Injectable()
export class GetExampleItem {
  constructor(private readonly items: ExampleItemRepository) {}

  async execute(input: GetExampleItemInput): Promise<ExampleProjection> {
    const item = await this.items.findById(input.id);
    if (!item) throw new ExampleItemNotFoundError();
    return projectExampleItem(item, input.viewer);
  }
}
