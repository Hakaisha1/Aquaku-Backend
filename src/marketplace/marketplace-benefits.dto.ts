import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateMembershipRequestDto {
  @IsIn(['TOKO', 'JURAGAN'])
  tier!: 'TOKO' | 'JURAGAN';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  payment_amount!: number;
}

export class CreateAddonRequestDto {
  @IsIn(['SLOT_ADDON', 'COOLDOWN_BYPASS'])
  kind!: 'SLOT_ADDON' | 'COOLDOWN_BYPASS';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  payment_amount!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  slots?: number;
}

export class RequestBenefitQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export class ReviewBenefitRequestDto {
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  review_note?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  approved_slots?: number;
}
