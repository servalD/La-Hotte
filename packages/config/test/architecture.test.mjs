// QA-03 : la règle d'architecture refuse les imports interdits.
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, it } from 'vitest';
import { architectureRule } from '../eslint/rules/architecture.mjs';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module' },
});

const M = '/repo/apps/api/src/modules';
const file = (p) => `${M}/${p}`;

tester.run('architecture/layers (QA-03)', architectureRule, {
  valid: [
    { filename: file('lists/domain/list.ts'), code: "import { X } from './value';" },
    {
      filename: file('lists/domain/list.ts'),
      code: "import { DomainError } from '../../../shared/domain/domain-error';",
    },
    {
      filename: file('lists/application/create-list.use-case.ts'),
      code: "import { List } from '../domain/list';",
    },
    {
      filename: file('lists/application/create-list.use-case.ts'),
      code: "import { Injectable } from '@nestjs/common';",
    },
    {
      filename: file('lists/infrastructure/prisma-list.repository.ts'),
      code: "import { List } from '../domain/list';",
    },
    {
      filename: file('lists/infrastructure/prisma-list.repository.ts'),
      code: "import { PrismaService } from '../../../platform/prisma/prisma.service';",
    },
    {
      filename: file('lists/presentation/lists.controller.ts'),
      code: "import { CreateList } from '../application/create-list.use-case';",
    },
    {
      filename: file('lists/application/get-list.use-case.ts'),
      code: "import { canRead } from '../../visibility';",
    },
    {
      filename: file('lists/application/get-list.use-case.ts'),
      code: "import { canRead } from '../../visibility/index';",
    },
    {
      filename: file('lists/lists.module.ts'),
      code: "import { X } from './infrastructure/x'; import { Y } from '../visibility';",
    },
    {
      filename: '/repo/apps/api/src/app.module.ts',
      code: "import { ListsModule } from './modules/lists';",
    },
    {
      filename: file('lists/domain/list.ts'),
      code: "import { z } from 'some-pure-lib';",
      options: [{ domainAllowedPackages: ['some-pure-lib'] }],
    },
    { filename: '/repo/apps/web/src/app/page.tsx', code: "import x from '../lib/x';" },
  ],
  invalid: [
    {
      filename: file('lists/domain/list.ts'),
      code: "import { PrismaClient } from '@prisma/client';",
      errors: [{ messageId: 'domainPackage' }],
    },
    {
      filename: file('lists/domain/list.ts'),
      code: "import { Injectable } from '@nestjs/common';",
      errors: [{ messageId: 'domainPackage' }],
    },
    {
      filename: file('lists/domain/list.ts'),
      code: "import { readFile } from 'node:fs';",
      errors: [{ messageId: 'domainPackage' }],
    },
    {
      filename: file('lists/domain/list.ts'),
      code: "import { CreateList } from '../application/create-list.use-case';",
      errors: [{ messageId: 'layer' }],
    },
    {
      filename: file('lists/domain/list.ts'),
      code: "import { Repo } from '../infrastructure/repo';",
      errors: [{ messageId: 'layer' }],
    },
    {
      filename: file('lists/application/create-list.use-case.ts'),
      code: "import { Repo } from '../infrastructure/prisma-list.repository';",
      errors: [{ messageId: 'layer' }],
    },
    {
      filename: file('lists/presentation/lists.controller.ts'),
      code: "import { Repo } from '../infrastructure/prisma-list.repository';",
      errors: [{ messageId: 'layer' }],
    },
    {
      filename: file('lists/presentation/lists.controller.ts'),
      code: "import { List } from '../domain/list';",
      errors: [{ messageId: 'layer' }],
    },
    {
      filename: file('lists/application/get-list.use-case.ts'),
      code: "import { rule } from '../../visibility/domain/rule';",
      errors: [{ messageId: 'crossModule' }],
    },
    {
      filename: file('lists/application/get-list.use-case.ts'),
      code: "export * from '../../visibility/application/x';",
      errors: [{ messageId: 'crossModule' }],
    },
    {
      filename: file('lists/application/get-list.use-case.ts'),
      code: "const m = await import('../../visibility/domain/rule');",
      errors: [{ messageId: 'crossModule' }],
    },
    {
      filename: file('lists/application/get-list.use-case.ts'),
      code: "import { PrismaService } from '../../../platform/prisma/prisma.service';",
      errors: [{ messageId: 'platform' }],
    },
    {
      filename: file('lists/application/get-list.use-case.ts'),
      code: "import { X } from '..';",
      errors: [{ messageId: 'ownIndex' }],
    },
    {
      filename: file('lists/helpers/x.ts'),
      code: "import { X } from '../domain/list';",
      errors: [{ messageId: 'unknownLayer' }],
    },
    {
      filename: '/repo/apps/api/src/shared/domain/x.ts',
      code: "import { X } from '../../modules/lists';",
      errors: [{ messageId: 'sharedToModule' }],
    },
    {
      filename: '/repo/apps/api/src/app.module.ts',
      code: "import { ListsModule } from './modules/lists/lists.module';",
      errors: [{ messageId: 'crossModule' }],
    },
    {
      filename: '/repo/apps/api/src/app.module.ts',
      code: "import { X } from './modules/lists/infrastructure/x';",
      errors: [{ messageId: 'crossModule' }],
    },
  ],
});
