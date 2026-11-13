import { cloudinarySignature } from './cloudinary-client';

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
