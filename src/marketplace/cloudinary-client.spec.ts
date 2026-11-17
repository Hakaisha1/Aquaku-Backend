import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CloudinaryClient, cloudinarySignature } from './cloudinary-client';
import { RuntimeConfig } from '../config/runtime-config';

describe('cloudinarySignature', () => {
  it('signs sorted upload parameters and does not expose the secret', () => {
    const signature = cloudinarySignature({
      timestamp: 1_700_000_000,
      public_id: 'aquaku_asset',
      asset_folder: 'aquaku/listings',
      allowed_formats: 'jpg,png,webp',
    }, 'private-secret');
    expect(signature).toBe('3d822b46f943417fcc2a15d9a28e0480585473b0');
    expect(signature).not.toContain('private-secret');
    expect(signature).toBe(cloudinarySignature({
      allowed_formats: 'jpg,png,webp',
      asset_folder: 'aquaku/listings',
      public_id: 'aquaku_asset',
      timestamp: 1_700_000_000,
    }, 'private-secret'));
  });
});

describe('CloudinaryClient', () => {
  const config = {
    cloudinaryCloudName: 'test-cloud',
    cloudinaryApiKey: 'test-key',
    cloudinaryApiSecret: 'test-secret',
    cloudinaryUploadPreset: 'test-preset',
  } as RuntimeConfig;

  let client: CloudinaryClient;

  beforeEach(() => {
    client = new CloudinaryClient(config);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createUploadSignature', () => {
    it('signs upload parameters without resource_type (Cloudinary excluded param)', () => {
      const sig = client.createUploadSignature('user-1', 'listing');
      expect(sig.resourceType).toBe('image');
      expect(sig.allowedFormats).toBe('jpg,png,webp');
      expect(sig.signature).toBe(cloudinarySignature({
        allowed_formats: sig.allowedFormats,
        asset_folder: sig.assetFolder,
        public_id: sig.publicId,
        timestamp: sig.timestamp,
        upload_preset: sig.uploadPreset,
        overwrite: 'false',
      }, 'test-secret'));
    });
  });

  describe('verifyUpload', () => {
    it('maps 404 response to NotFoundException', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 404,
        ok: false,
      } as Response);

      await expect(client.verifyUpload('non-existent-asset')).rejects.toThrow(NotFoundException);
    });

    it('maps 500 response to ServiceUnavailableException', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 500,
        ok: false,
      } as Response);

      await expect(client.verifyUpload('asset-error')).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
