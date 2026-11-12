import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../shared/domain';
import { uuidv7 } from './uuid-v7';

@Injectable()
export class UuidV7IdGenerator extends IdGenerator {
  next(): string {
    return uuidv7();
  }
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
