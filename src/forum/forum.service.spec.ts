import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { ForumService } from './forum.service';
import { ForumCategory, ForumComment, ForumModeration, ForumPost, ForumReport } from './forum.schemas';

function queryResult<T>(value: T) {
  type QueryMock = {
    sort: () => QueryMock;
    skip: () => QueryMock;
    limit: () => QueryMock;
    select: () => QueryMock;
    lean: () => QueryMock;
    exec: jest.Mock;
  };
  const query: QueryMock = {
    sort: () => query,
    skip: () => query,
    limit: () => query,
    select: () => query,
    lean: () => query,
    exec: jest.fn().mockResolvedValue(value),
  };
  return query;
}

function setup() {
  const categoryId = new Types.ObjectId();
  const postId = new Types.ObjectId();
  const categories = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  };
  const posts = {
    create: jest.fn(), find: jest.fn(), findOne: jest.fn(),
    findOneAndUpdate: jest.fn(), findById: jest.fn(),
  };
  const comments = {};
  const reports = {};
  const moderation = {};
  const prisma = {
    mediaAsset: { updateMany: jest.fn(), findMany: jest.fn() },
    user: { findMany: jest.fn() },
  };
  const cloudinary = { createUploadSignature: jest.fn(), verifyUpload: jest.fn(), deleteAsset: jest.fn() };
  const connection = { readyState: 1 };
  const service = new ForumService(
    connection as never,
    categories as unknown as Model<ForumCategory>,
    posts as unknown as Model<ForumPost>,
    comments as unknown as Model<ForumComment>,
    reports as unknown as Model<ForumReport>,
    moderation as unknown as Model<ForumModeration>,
    prisma as never,
    cloudinary as never,
  );
  return { service, categories, posts, prisma, cloudinary, connection, categoryId, postId };
}

describe('ForumService', () => {
  it('does not attempt forum queries when MongoDB is unavailable', async () => {
    const { service, categories, connection } = setup();
    connection.readyState = 0;
    await expect(service.listCategories()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(categories.find).not.toHaveBeenCalled();
  });

  it('creates categories with normalized slugs', async () => {
    const { service, categories } = setup();
    const created = {
      _id: new Types.ObjectId(), name: 'Tanaman Air', slug: 'tanaman-air', description: '',
    };
    categories.create.mockResolvedValue({ toObject: () => created });
    await expect(service.createCategory(
      { id: 'user-uuid' } as never,
      { name: '  Tanaman Air  ' },
    )).resolves.toMatchObject({ name: 'Tanaman Air', slug: 'tanaman-air' });
    expect(categories.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Tanaman Air', slug: 'tanaman-air', createdBy: 'user-uuid',
    }));
  });

  it('maps duplicate category slugs to a conflict', async () => {
    const { service, categories } = setup();
    categories.create.mockRejectedValue({ code: 11000 });
    await expect(service.createCategory(
      { id: 'user-uuid' } as never,
      { name: 'Tanaman Air' },
    )).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not let a different user edit an existing post', async () => {
    const { service, posts, connection, postId } = setup();
    posts.findOneAndUpdate.mockReturnValue(queryResult(null));
    posts.findById.mockReturnValue(queryResult({ _id: postId, authorId: 'original-author', status: 'published' }));
    await expect(service.updatePost(
      { id: 'another-author' } as never,
      String(postId),
      { body: 'Attempted edit' },
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(connection.readyState).toBe(1);
  });

  it('persists a post only with owned confirmed photos and resolves its author from PostgreSQL', async () => {
    const { service, categories, posts, prisma, categoryId, postId } = setup();
    const assetId = '6b91e024-09f6-4b45-bca7-ff623af4c57c';
    const category = { _id: categoryId };
    categories.findOne.mockReturnValue(queryResult(category));
    const created = {
      _id: postId,
      id: String(postId),
      authorId: 'author-uuid',
      categoryId,
      title: 'Tank update',
      body: 'Plant growth update',
      photoAssetIds: [],
      status: 'published',
      commentsCount: 0,
      reportsCount: 0,
      moderationReason: null,
      createdAt: new Date('2026-11-12T00:00:00.000Z'),
      updatedAt: new Date('2026-11-12T00:00:00.000Z'),
      save: jest.fn(),
      toObject: jest.fn(),
    };
    created.toObject.mockImplementation(() => created);
    posts.create.mockResolvedValue(created);
    prisma.mediaAsset.updateMany.mockResolvedValue({ count: 1 });
    categories.find.mockReturnValue(queryResult([{
      _id: categoryId, name: 'Tanaman', slug: 'tanaman', description: '',
    }]));
    prisma.user.findMany.mockResolvedValue([{
      id: 'author-uuid', displayName: 'Nadia', avatarUrl: null,
    }]);
    prisma.mediaAsset.findMany.mockResolvedValue([{ id: assetId, secureUrl: 'https://res.cloudinary.com/test/image/upload/photo.jpg' }]);

    const result = await service.createPost(
      { id: 'author-uuid' } as never,
      { category_id: String(categoryId), title: ' Tank update ', body: ' Plant growth update ', photo_ids: [assetId] },
    );

    expect(prisma.mediaAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerId: 'author-uuid', listingId: null, forumPostId: null, uploadedAt: { not: null } }),
      data: { forumPostId: String(postId) },
    }));
    expect(result).toMatchObject({
      id: String(postId), title: 'Tank update', author: { display_name: 'Nadia' },
      photos: [{ id: assetId, url: 'https://res.cloudinary.com/test/image/upload/photo.jpg' }],
    });
  });
});
