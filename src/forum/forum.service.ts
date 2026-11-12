import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { AuthenticatedUser } from '../auth/auth.service';
import { PrismaService } from '../database/prisma.service';
import { CLOUDINARY_CLIENT, CloudinaryClientPort } from '../marketplace/cloudinary-client';
import {
  CreateForumCategoryDto,
  CreateForumCommentDto,
  CreateForumPostDto,
  CreateForumReportDto,
  ForumCommentListQueryDto,
  ForumListQueryDto,
  ModerateForumPostDto,
  ReviewForumReportDto,
  UpdateForumPostDto,
} from './forum.dto';
import {
  ForumCategory,
  ForumComment,
  ForumModeration,
  ForumPost,
  ForumReport,
} from './forum.schemas';

const maximumPhotoBytes = 5 * 1024 * 1024;
const allowedPhotoFormats = new Set(['jpg', 'jpeg', 'png', 'webp']);
const duplicateKey = 11000;

type ForumPostRecord = {
  _id: Types.ObjectId;
  authorId: string;
  categoryId: Types.ObjectId;
  title: string;
  body: string;
  photoAssetIds: string[];
  status: string;
  commentsCount: number;
  reportsCount: number;
  moderationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};
type ForumCategoryRecord = { _id: Types.ObjectId; name: string; slug: string; description: string };
type ForumCommentRecord = {
  _id: Types.ObjectId; postId: Types.ObjectId; authorId: string; body: string; createdAt: Date; updatedAt: Date;
};
type ForumReportRecord = {
  _id: Types.ObjectId; postId: Types.ObjectId; reporterId: string; reason: string; details: string;
  status: string; reviewedBy: string | null; reviewedAt: Date | null; reviewNote: string | null; createdAt: Date;
};
type ForumAuthor = { id: string; display_name: string; avatar_url: string | null };

@Injectable()
export class ForumService {
  private readonly logger = new Logger(ForumService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(ForumCategory.name) private readonly categories: Model<ForumCategory>,
    @InjectModel(ForumPost.name) private readonly posts: Model<ForumPost>,
    @InjectModel(ForumComment.name) private readonly comments: Model<ForumComment>,
    @InjectModel(ForumReport.name) private readonly reports: Model<ForumReport>,
    @InjectModel(ForumModeration.name) private readonly moderation: Model<ForumModeration>,
    private readonly prisma: PrismaService,
    @Inject(CLOUDINARY_CLIENT) private readonly cloudinary: CloudinaryClientPort,
  ) {}

  async listCategories() {
    this.ensureMongoAvailable();
    const rows = await this.categories.find({ active: true }).sort({ name: 1 }).lean().exec();
    return rows.map((category) => this.presentCategory(category));
  }

  async createCategory(admin: AuthenticatedUser, input: CreateForumCategoryDto) {
    this.ensureMongoAvailable();
    const name = input.name.trim();
    const slug = this.slugify(name);
    if (slug.length < 2 || slug.length > 96) throw new BadRequestException('Category name cannot make a valid slug');
    try {
      const category = await this.categories.create({
        name,
        slug,
        description: input.description?.trim() ?? '',
        createdBy: admin.id,
      });
      return this.presentCategory(category.toObject());
    } catch (error) {
      if (this.isDuplicateKey(error)) throw new ConflictException('A forum category with this name already exists');
      throw error;
    }
  }

  async deactivateCategory(categoryId: string) {
    this.ensureMongoAvailable();
    const category = await this.categories.findOneAndUpdate(
      { _id: this.objectId(categoryId), active: true },
      { $set: { active: false } },
      { new: true },
    ).lean().exec();
    if (!category) throw new NotFoundException();
    return this.presentCategory(category);
  }

  async setCategoryActive(categoryId: string, active: boolean) {
    this.ensureMongoAvailable();
    const category = await this.categories.findByIdAndUpdate(
      this.objectId(categoryId),
      { $set: { active } },
      { new: true, runValidators: true },
    ).lean().exec();
    if (!category) throw new NotFoundException();
    return this.presentCategory(category);
  }

  async listPosts(query: ForumListQueryDto) {
    this.ensureMongoAvailable();
    const filter: Record<string, unknown> = { status: 'published' };
    if (query.category) {
      const category = await this.categories.findOne({ slug: query.category, active: true }).select({ _id: 1 }).lean().exec();
      if (!category) return this.page([], 0, query.page, query.limit);
      filter.categoryId = category._id;
    } else {
      const activeCategories = await this.categories.find({ active: true }).select({ _id: 1 }).lean().exec();
      if (!activeCategories.length) return this.page([], 0, query.page, query.limit);
      filter.categoryId = { $in: activeCategories.map((category) => category._id) };
    }
    const skip = (query.page - 1) * query.limit;
    const [rows, total] = await Promise.all([
      this.posts.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(query.limit).lean().exec(),
      this.posts.countDocuments(filter).exec(),
    ]);
    return this.page(await this.presentPosts(rows), total, query.page, query.limit);
  }

  async listModeratedPosts(query: ForumListQueryDto) {
    this.ensureMongoAvailable();
    const rows = await this.posts.find({ status: { $in: ['hidden', 'deleted'] } })
      .sort({ updatedAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean().exec();
    const total = await this.posts.countDocuments({ status: { $in: ['hidden', 'deleted'] } }).exec();
    return this.page(await this.presentPosts(rows), total, query.page, query.limit);
  }

  async getPost(postId: string) {
    this.ensureMongoAvailable();
    const post = await this.posts.findOne({ _id: this.objectId(postId), status: 'published' }).lean().exec();
    if (!post) throw new NotFoundException();
    const category = await this.categories.exists({ _id: post.categoryId, active: true });
    if (!category) throw new NotFoundException();
    return (await this.presentPosts([post]))[0];
  }

  async createPost(user: AuthenticatedUser, input: CreateForumPostDto) {
    this.ensureMongoAvailable();
    const category = await this.categories.findOne({ _id: this.objectId(input.category_id), active: true }).lean().exec();
    if (!category) throw new BadRequestException('Forum category is unavailable');
    const photoIds = input.photo_ids ?? [];
    const title = input.title.trim();
    const body = input.body.trim();
    if (!title || !body) throw new BadRequestException('Title and body cannot be blank');
    if (new Set(photoIds).size !== photoIds.length) throw new BadRequestException('Photo IDs must be unique');

    const post = await this.posts.create({
      authorId: user.id,
      categoryId: category._id,
      title,
      body,
      photoAssetIds: [],
    });
    try {
      if (photoIds.length) {
        const attached = await this.prisma.mediaAsset.updateMany({
          where: {
            id: { in: photoIds },
            ownerId: user.id,
            listingId: null,
            forumPostId: null,
            uploadedAt: { not: null },
            bytes: { lte: maximumPhotoBytes },
            format: { in: [...allowedPhotoFormats] },
          },
          data: { forumPostId: post.id },
        });
        if (attached.count !== photoIds.length) throw new BadRequestException('One or more photos are unavailable');
        post.photoAssetIds = photoIds;
        await post.save();
      }
      return (await this.presentPosts([post.toObject()]))[0];
    } catch (error) {
      await this.posts.deleteOne({ _id: post._id });
      await this.prisma.mediaAsset.updateMany({
        where: { ownerId: user.id, forumPostId: post.id },
        data: { forumPostId: null },
      });
      throw error;
    }
  }

  async updatePost(user: AuthenticatedUser, postId: string, input: UpdateForumPostDto) {
    this.ensureMongoAvailable();
    const updates: Record<string, unknown> = {};
    if (input.title !== undefined) {
      updates.title = input.title.trim();
      if (!updates.title) throw new BadRequestException('Title cannot be blank');
    }
    if (input.body !== undefined) {
      updates.body = input.body.trim();
      if (!updates.body) throw new BadRequestException('Body cannot be blank');
    }
    if (input.category_id !== undefined) {
      const category = await this.categories.findOne({ _id: this.objectId(input.category_id), active: true }).select({ _id: 1 }).lean().exec();
      if (!category) throw new BadRequestException('Forum category is unavailable');
      updates.categoryId = category._id;
    }
    if (!Object.keys(updates).length) throw new BadRequestException('At least one post field is required');
    const post = await this.posts.findOneAndUpdate(
      { _id: this.objectId(postId), authorId: user.id, status: 'published' },
      { $set: updates },
      { new: true, runValidators: true },
    ).lean().exec();
    if (!post) await this.assertPostOwnerOrNotFound(postId, user.id);
    return (await this.presentPosts([post!]))[0];
  }

  async deletePost(user: AuthenticatedUser, postId: string, isAdmin = false) {
    this.ensureMongoAvailable();
    const filter: Record<string, unknown> = { _id: this.objectId(postId), status: { $ne: 'deleted' } };
    if (!isAdmin) filter.authorId = user.id;
    const post = await this.posts.findOneAndUpdate(filter, { $set: { status: 'deleted' } }, { new: true }).lean().exec();
    if (!post) await this.assertPostOwnerOrNotFound(postId, user.id, isAdmin);
    await this.prisma.mediaAsset.updateMany({
      where: { forumPostId: postId },
      data: { forumPostId: null },
    });
    return { id: postId, deleted: true };
  }

  async createUploadSignature(user: AuthenticatedUser) {
    this.ensureMongoAvailable();
    const signature = this.cloudinary.createUploadSignature(user.id, 'forum');
    const asset = await this.prisma.mediaAsset.create({
      data: {
        ownerId: user.id,
        publicId: signature.publicId,
        signedAt: new Date(signature.timestamp * 1000),
      },
      select: { id: true },
    });
    return {
      asset_id: asset.id,
      cloud_name: signature.cloudName,
      api_key: signature.apiKey,
      timestamp: signature.timestamp,
      public_id: signature.publicId,
      folder: signature.folder,
      allowed_formats: signature.allowedFormats,
      upload_preset: signature.uploadPreset,
      overwrite: signature.overwrite,
      signature: signature.signature,
    };
  }

  async confirmUpload(user: AuthenticatedUser, assetId: string) {
    this.ensureMongoAvailable();
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id: assetId, ownerId: user.id } });
    if (!asset) throw new NotFoundException();
    if (asset.uploadedAt) return this.presentMediaAsset(asset);
    if (Date.now() - asset.signedAt.getTime() > 15 * 60_000) throw new BadRequestException('Upload signature has expired');
    if (!asset.publicId.startsWith(`aquaku_${user.id.replaceAll('-', '')}_`)) throw new ForbiddenException();

    const uploaded = await this.cloudinary.verifyUpload(asset.publicId);
    if (
      uploaded.publicId !== asset.publicId || uploaded.bytes < 1 || uploaded.bytes > maximumPhotoBytes ||
      !allowedPhotoFormats.has(uploaded.format.toLowerCase())
    ) {
      try {
        await this.cloudinary.deleteAsset(asset.publicId);
      } catch {
        this.logger.warn('Rejected forum upload could not be cleaned up');
      }
      throw new BadRequestException('Photo must be JPEG, PNG, or WebP up to 5 MB');
    }
    const saved = await this.prisma.mediaAsset.updateMany({
      where: { id: asset.id, ownerId: user.id, uploadedAt: null, listingId: null, forumPostId: null },
      data: {
        secureUrl: uploaded.secureUrl,
        format: uploaded.format.toLowerCase(),
        bytes: uploaded.bytes,
        uploadedAt: new Date(),
      },
    });
    if (saved.count !== 1) throw new ConflictException('Upload has already been confirmed or used');
    return this.presentMediaAsset(await this.prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } }));
  }

  async listComments(postId: string, query: ForumCommentListQueryDto) {
    this.ensureMongoAvailable();
    const id = this.objectId(postId);
    const post = await this.posts.findOne({ _id: id, status: 'published' }).select({ categoryId: 1 }).lean().exec();
    if (!post || !await this.categories.exists({ _id: post.categoryId, active: true })) throw new NotFoundException();
    const filter = { postId: id, status: 'published' as const };
    const [rows, total] = await Promise.all([
      this.comments.find(filter).sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit).limit(query.limit).lean().exec(),
      this.comments.countDocuments(filter).exec(),
    ]);
    const authors = await this.getAuthors(rows.map((row) => row.authorId));
    return this.page(rows.map((row) => this.presentComment(row, authors)), total, query.page, query.limit);
  }

  async createComment(user: AuthenticatedUser, postId: string, input: CreateForumCommentDto) {
    this.ensureMongoAvailable();
    const body = input.body.trim();
    if (!body) throw new BadRequestException('Comment cannot be blank');
    const id = this.objectId(postId);
    const post = await this.posts.findOne({ _id: id, status: 'published' }).select({ categoryId: 1 }).lean().exec();
    if (!post || !await this.categories.exists({ _id: post.categoryId, active: true })) throw new NotFoundException();
    const postUpdated = await this.posts.updateOne(
      { _id: id, status: 'published' },
      { $inc: { commentsCount: 1 } },
    ).exec();
    if (!postUpdated.matchedCount) throw new NotFoundException();
    try {
      const comment = await this.comments.create({ postId: id, authorId: user.id, body });
      return this.presentComment(comment.toObject(), new Map([[user.id, await this.getAuthor(user.id)]]));
    } catch (error) {
      await this.posts.updateOne({ _id: id }, { $inc: { commentsCount: -1 } }).exec();
      throw error;
    }
  }

  async deleteComment(user: AuthenticatedUser, postId: string, commentId: string, isAdmin = false) {
    this.ensureMongoAvailable();
    const postObjectId = this.objectId(postId);
    const commentObjectId = this.objectId(commentId);
    const filter: Record<string, unknown> = { _id: commentObjectId, postId: postObjectId };
    if (!isAdmin) filter.authorId = user.id;
    const comment = await this.comments.findOneAndDelete(filter).lean().exec();
    if (!comment) {
      const exists = await this.comments.exists({ _id: commentObjectId, postId: postObjectId });
      if (exists && !isAdmin) throw new ForbiddenException();
      throw new NotFoundException();
    }
    await this.posts.updateOne({ _id: postObjectId }, { $inc: { commentsCount: -1 } }).exec();
    return { id: commentId, deleted: true };
  }

  async reportPost(user: AuthenticatedUser, postId: string, input: CreateForumReportDto) {
    this.ensureMongoAvailable();
    const id = this.objectId(postId);
    const post = await this.posts.findOne({ _id: id, status: 'published' }).select({ authorId: 1, categoryId: 1 }).lean().exec();
    if (!post || !await this.categories.exists({ _id: post.categoryId, active: true })) throw new NotFoundException();
    if (post.authorId === user.id) throw new BadRequestException('You cannot report your own post');
    try {
      const report = await this.reports.create({
        postId: id,
        reporterId: user.id,
        reason: input.reason,
        details: input.details?.trim() ?? '',
      });
      await this.posts.updateOne({ _id: id }, { $inc: { reportsCount: 1 } }).exec();
      return this.presentReport(report.toObject());
    } catch (error) {
      if (this.isDuplicateKey(error)) throw new ConflictException('You have already reported this post');
      throw error;
    }
  }

  async listReports(page: number, limit: number, status?: 'open' | 'resolved' | 'dismissed') {
    this.ensureMongoAvailable();
    const filter: { status?: 'open' | 'resolved' | 'dismissed' } = status ? { status } : {};
    const [rows, total] = await Promise.all([
      this.reports.find(filter).sort({ createdAt: 1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.reports.countDocuments(filter).exec(),
    ]);
    return this.page(rows.map((row) => this.presentReport(row)), total, page, limit);
  }

  async reviewReport(admin: AuthenticatedUser, reportId: string, input: ReviewForumReportDto) {
    this.ensureMongoAvailable();
    const report = await this.reports.findOneAndUpdate(
      { _id: this.objectId(reportId), status: 'open' },
      {
        $set: {
          status: input.decision,
          reviewedBy: admin.id,
          reviewedAt: new Date(),
          reviewNote: input.review_note?.trim() ?? '',
        },
      },
      { new: true },
    ).lean().exec();
    if (!report) throw new NotFoundException('Open forum report not found');
    return this.presentReport(report);
  }

  async listModerationHistory(postId: string) {
    this.ensureMongoAvailable();
    const id = this.objectId(postId);
    if (!await this.posts.exists({ _id: id })) throw new NotFoundException();
    const rows = await this.moderation.find({ postId: id }).sort({ createdAt: -1 }).lean().exec();
    return rows.map((row) => ({
      id: String(row._id),
      post_id: String(row.postId),
      admin_id: row.adminId,
      action: row.action,
      reason: row.reason,
      created_at: row.createdAt,
    }));
  }

  async moderatePost(admin: AuthenticatedUser, postId: string, input: ModerateForumPostDto) {
    this.ensureMongoAvailable();
    const id = this.objectId(postId);
    const expectedStatus = input.action === 'hide' ? 'published' : 'hidden';
    const status = input.action === 'hide' ? 'hidden' : 'published';
    const audit = await this.moderation.create({
      postId: id,
      adminId: admin.id,
      action: input.action,
      reason: input.reason.trim(),
    });
    let post: ForumPostRecord | null;
    try {
      post = await this.posts.findOneAndUpdate(
        { _id: id, status: expectedStatus },
        {
          $set: {
            status,
            moderationReason: input.action === 'hide' ? input.reason.trim() : null,
            moderatedAt: new Date(),
            moderatedBy: admin.id,
          },
        },
        { new: true },
      ).lean().exec() as ForumPostRecord | null;
      if (!post) {
        if (!await this.posts.exists({ _id: id })) throw new NotFoundException();
        throw new ConflictException('Post is not in a state that can be moderated with this action');
      }
    } catch (error) {
      await this.moderation.deleteOne({ _id: audit._id }).exec();
      throw error;
    }
    return (await this.presentPosts([post]))[0];
  }

  private async presentPosts(rows: ForumPostRecord[]) {
    if (!rows.length) return [];
    const categoryIds = rows.map((row) => row.categoryId as Types.ObjectId);
    const authorIds = rows.map((row) => String(row.authorId));
    const photoIds = rows.flatMap((row) => row.photoAssetIds as string[]);
    const [categories, authors, photos] = await Promise.all([
      this.categories.find({ _id: { $in: categoryIds } }).lean().exec(),
      this.getAuthors(authorIds),
      photoIds.length
        ? this.prisma.mediaAsset.findMany({ where: { id: { in: photoIds } }, select: { id: true, secureUrl: true } })
        : Promise.resolve([]),
    ]);
    const categoryMap = new Map(categories.map((category) => [String(category._id), this.presentCategory(category)]));
    const photoMap = new Map(photos.map((photo) => [photo.id, photo.secureUrl]));
    return rows.map((post) => ({
      id: String(post._id),
      title: post.title,
      body: post.body,
      status: post.status,
      category: categoryMap.get(String(post.categoryId)) ?? null,
      author: authors.get(String(post.authorId)) ?? null,
      photos: (post.photoAssetIds as string[]).flatMap((id) => {
        const url = photoMap.get(id);
        return url ? [{ id, url }] : [];
      }),
      comments_count: post.commentsCount,
      reports_count: post.reportsCount,
      moderation_reason: post.moderationReason ?? null,
      created_at: post.createdAt,
      updated_at: post.updatedAt,
    }));
  }

  private async getAuthors(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return new Map<string, ForumAuthor>();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, displayName: true, avatarUrl: true },
    });
    return new Map(rows.map((row) => [row.id, { id: row.id, display_name: row.displayName, avatar_url: row.avatarUrl }]));
  }

  private async getAuthor(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, displayName: true, avatarUrl: true },
    });
    return user ? { id: user.id, display_name: user.displayName, avatar_url: user.avatarUrl } : null;
  }

  private presentComment(comment: ForumCommentRecord, authors: Map<string, ForumAuthor | null>) {
    return {
      id: String(comment._id),
      post_id: String(comment.postId),
      body: comment.body,
      author: authors.get(String(comment.authorId)) ?? null,
      created_at: comment.createdAt,
      updated_at: comment.updatedAt,
    };
  }

  private presentCategory(category: ForumCategoryRecord) {
    return {
      id: String(category._id),
      name: category.name,
      slug: category.slug,
      description: category.description,
    };
  }

  private presentReport(report: ForumReportRecord) {
    return {
      id: String(report._id),
      post_id: String(report.postId),
      reporter_id: report.reporterId,
      reason: report.reason,
      details: report.details,
      status: report.status,
      reviewed_by: report.reviewedBy,
      reviewed_at: report.reviewedAt,
      review_note: report.reviewNote,
      created_at: report.createdAt,
    };
  }

  private presentMediaAsset(asset: {
    id: string;
    secureUrl: string | null;
    format: string | null;
    bytes: number | null;
    uploadedAt: Date | null;
  }) {
    return { id: asset.id, url: asset.secureUrl, format: asset.format, bytes: asset.bytes, uploaded_at: asset.uploadedAt };
  }

  private page<T>(items: T[], total: number, page: number, limit: number) {
    return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  private slugify(value: string) {
    return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  private objectId(value: string) {
    if (!/^[a-f\d]{24}$/i.test(value)) throw new BadRequestException('Invalid forum resource ID');
    return new Types.ObjectId(value);
  }

  private async assertPostOwnerOrNotFound(postId: string, userId: string, isAdmin = false): Promise<never> {
    const post = await this.posts.findById(this.objectId(postId)).select({ authorId: 1 }).lean().exec();
    if (!post || post.status === 'deleted') throw new NotFoundException();
    if (!isAdmin && post.authorId !== userId) throw new ForbiddenException();
    throw new ConflictException('Post is not currently editable');
  }

  private isDuplicateKey(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === duplicateKey;
  }

  private ensureMongoAvailable() {
    if (this.connection.readyState !== 1) throw new ServiceUnavailableException('Forum database unavailable');
  }
}
