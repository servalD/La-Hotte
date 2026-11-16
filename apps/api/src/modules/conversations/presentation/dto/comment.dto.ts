import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const THREADS = ['PUBLIC', 'GIVERS'] as const;
export const REACTIONS = ['THUMBS_UP', 'HEART', 'LAUGH', 'WOW', 'PARTY', 'THANKS'] as const;

/** COM-17, API-15 */
export class CommentsQueryDto {
  @ApiProperty({ enum: THREADS, enumName: 'CommentThread' })
  @IsIn(THREADS)
  thread!: (typeof THREADS)[number];

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

/** COM-13 */
export class PostCommentDto {
  @ApiProperty({ enum: THREADS, enumName: 'CommentThread' })
  @IsIn(THREADS)
  thread!: (typeof THREADS)[number];

  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  body!: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  mentionIds?: string[];
}

/** COM-15 */
export class EditCommentDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  body!: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  mentionIds?: string[];
}
