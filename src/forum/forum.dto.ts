import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateForumCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

export class SetForumCategoryActiveDto {
  @IsBoolean()
  active!: boolean;
}

export class CreateForumPostDto {
  @IsMongoId()
  category_id!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  body!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  photo_ids?: string[];
}

export class UpdateForumPostDto {
  @IsOptional()
  @IsMongoId()
  category_id?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  body?: string;
}

export class CreateForumCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5_000)
  body!: string;
}

export class ForumListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(96)
  category?: string;
}

export class ForumReportListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @IsOptional()
  @IsIn(['open', 'resolved', 'dismissed'])
  status?: 'open' | 'resolved' | 'dismissed';
}

export class ForumCommentListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class CreateForumReportDto {
  @IsIn(['spam', 'harassment', 'inappropriate', 'misinformation', 'other'])
  reason!: 'spam' | 'harassment' | 'inappropriate' | 'misinformation' | 'other';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}

export class ReviewForumReportDto {
  @IsIn(['resolved', 'dismissed'])
  decision!: 'resolved' | 'dismissed';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  review_note?: string;
}

export class ModerateForumPostDto {
  @IsIn(['hide', 'restore'])
  action!: 'hide' | 'restore';

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ConfirmForumUploadDto {
  @IsUUID('4')
  asset_id!: string;
}
