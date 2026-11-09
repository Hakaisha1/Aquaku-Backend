import { cloudinarySignature } from './cloudinary-client';

describe('cloudinarySignature', () => {
  it('signs sorted upload parameters and does not expose the secret', () => {
    const signature = cloudinarySignature({
      timestamp: 1_700_000_000,
      public_id: 'aquaku_asset',
      folder: 'aquaku/listings',
      allowed_formats: 'jpg,png,webp',
    }, 'private-secret');
    expect(signature).toMatch(/^[a-f0-9]{40}$/);
    expect(signature).not.toContain('private-secret');
    expect(signature).toBe(cloudinarySignature({
      allowed_formats: 'jpg,png,webp',
      folder: 'aquaku/listings',
      public_id: 'aquaku_asset',
      timestamp: 1_700_000_000,
    }, 'private-secret'));
  });
});
