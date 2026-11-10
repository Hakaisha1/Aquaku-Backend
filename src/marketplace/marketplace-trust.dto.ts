import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateSaleAssignmentDto {
  @IsUUID()
  buyer_id!: string;
}

export class CorrectSaleBuyerDto {
  @IsUUID()
  buyer_id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class RespondToSaleDto {
  @IsIn(['CONFIRM', 'REJECT'])
  decision!: 'CONFIRM' | 'REJECT';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateRatingDto {
  @IsInt()
  @Min(1)
  @Max(5)
  score!: number;
}

export class CreateReportDto {
  @IsIn(['LISTING', 'USER'])
  target_type!: 'LISTING' | 'USER';

  @IsUUID()
  target_id!: string;

  @IsIn(['SPAM', 'SCAM', 'PROHIBITED_ITEM', 'MISLEADING', 'HARASSMENT', 'OTHER'])
  reason!: 'SPAM' | 'SCAM' | 'PROHIBITED_ITEM' | 'MISLEADING' | 'HARASSMENT' | 'OTHER';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}

export class ReportListQueryDto {
  @IsOptional()
  @IsIn(['OPEN', 'RESOLVED', 'DISMISSED'])
  status?: 'OPEN' | 'RESOLVED' | 'DISMISSED';
}

export class ReviewReportDto {
  @IsIn(['RESOLVED', 'DISMISSED'])
  decision!: 'RESOLVED' | 'DISMISSED';

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  review_note!: string;
}

export class ModerateListingDto {
  @IsIn(['HIDE', 'RESTORE'])
  action!: 'HIDE' | 'RESTORE';

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
