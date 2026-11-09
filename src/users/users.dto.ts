import { IsString, IsUrl, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class UpdateProfileDto {
  @ValidateIf((object: UpdateProfileDto) => object.display_name !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  display_name?: string;

  @ValidateIf((object: UpdateProfileDto) => object.avatar_url !== undefined)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  avatar_url?: string;

  @ValidateIf((object: UpdateProfileDto) => object.whatsapp_number !== undefined)
  @IsString()
  @MaxLength(24)
  whatsapp_number?: string;

  @ValidateIf((object: UpdateProfileDto) => object.bio !== undefined)
  @IsString()
  @MaxLength(500)
  bio?: string;
}
