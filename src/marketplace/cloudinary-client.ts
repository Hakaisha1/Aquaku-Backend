import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RUNTIME_CONFIG, RuntimeConfig } from '../config/runtime-config';

export const CLOUDINARY_CLIENT = Symbol('CLOUDINARY_CLIENT');

export interface CloudinaryAsset {
  readonly publicId: string;
  readonly secureUrl: string;
  readonly format: string;
  readonly bytes: number;
}

export interface CloudinaryClientPort {
  createUploadSignature(ownerId: string): {
    readonly cloudName: string;
    readonly apiKey: string;
    readonly timestamp: number;
    readonly publicId: string;
    readonly folder: string;
    readonly allowedFormats: string;
    readonly uploadPreset: string;
    readonly overwrite: 'false';
    readonly signature: string;
  };
  verifyUpload(publicId: string): Promise<CloudinaryAsset>;
  deleteAsset(publicId: string): Promise<void>;
}

export function cloudinarySignature(
  parameters: Readonly<Record<string, string | number>>,
  apiSecret: string,
): string {
  const payload = Object.entries(parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return createHash('sha1').update(`${payload}${apiSecret}`).digest('hex');
}

@Injectable()
export class CloudinaryClient implements CloudinaryClientPort {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  createUploadSignature(ownerId: string) {
    const credentials = this.requireCredentials();
    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `aquaku_${ownerId.replaceAll('-', '')}_${randomUUID().replaceAll('-', '')}`;
    const folder = 'aquaku/listings';
    const allowedFormats = 'jpg,png,webp';
    const uploadPreset = credentials.uploadPreset;
    const signature = cloudinarySignature({
      allowed_formats: allowedFormats,
      folder,
      public_id: publicId,
      timestamp,
      upload_preset: uploadPreset,
      overwrite: 'false',
    }, credentials.apiSecret);
    return {
      cloudName: credentials.cloudName,
      apiKey: credentials.apiKey,
      timestamp,
      publicId,
      folder,
      allowedFormats,
      uploadPreset,
      overwrite: 'false' as const,
      signature,
    };
  }

  async verifyUpload(publicId: string): Promise<CloudinaryAsset> {
    const credentials = this.requireCredentials();
    const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(credentials.cloudName)}` +
      `/resources/image/upload/${encodeURIComponent(publicId)}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64')}`,
        },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new ServiceUnavailableException('Media provider unavailable');
    }
    if (!response.ok) throw new ServiceUnavailableException('Media provider unavailable');
    const resource = await response.json() as Record<string, unknown>;
    if (
      resource.public_id !== publicId ||
      typeof resource.secure_url !== 'string' ||
      typeof resource.format !== 'string' ||
      typeof resource.bytes !== 'number'
    ) throw new ServiceUnavailableException('Media provider returned invalid asset metadata');
    return {
      publicId,
      secureUrl: resource.secure_url,
      format: resource.format.toLowerCase(),
      bytes: resource.bytes,
    };
  }

  async deleteAsset(publicId: string): Promise<void> {
    const credentials = this.requireCredentials();
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = cloudinarySignature({ invalidate: 'true', public_id: publicId, timestamp }, credentials.apiSecret);
    const body = new URLSearchParams({
      api_key: credentials.apiKey,
      invalidate: 'true',
      public_id: publicId,
      signature,
      timestamp: String(timestamp),
    });
    let response: Response;
    try {
      response = await fetch(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(credentials.cloudName)}/image/destroy`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(5000),
        },
      );
    } catch {
      throw new ServiceUnavailableException('Media provider unavailable');
    }
    if (!response.ok) throw new ServiceUnavailableException('Media provider unavailable');
    const result = await response.json() as { result?: unknown };
    if (result.result !== 'ok' && result.result !== 'not found') {
      throw new ServiceUnavailableException('Media provider could not delete the asset');
    }
  }

  private requireCredentials(): { cloudName: string; apiKey: string; apiSecret: string; uploadPreset: string } {
    const { cloudinaryCloudName, cloudinaryApiKey, cloudinaryApiSecret, cloudinaryUploadPreset } = this.config;
    if (!cloudinaryCloudName || !cloudinaryApiKey || !cloudinaryApiSecret || !cloudinaryUploadPreset) {
      throw new ServiceUnavailableException('Media provider is not configured');
    }
    return {
      cloudName: cloudinaryCloudName,
      apiKey: cloudinaryApiKey,
      apiSecret: cloudinaryApiSecret,
      uploadPreset: cloudinaryUploadPreset,
    };
  }
}
