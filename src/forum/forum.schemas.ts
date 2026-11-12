import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ForumCategoryDocument = HydratedDocument<ForumCategory>;
export type ForumPostDocument = HydratedDocument<ForumPost>;
export type ForumCommentDocument = HydratedDocument<ForumComment>;
export type ForumReportDocument = HydratedDocument<ForumReport>;
export type ForumModerationDocument = HydratedDocument<ForumModeration>;

@Schema({ timestamps: true, collection: 'forum_categories' })
export class ForumCategory {
  @Prop({ required: true, trim: true, maxlength: 80 })
  name!: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true, maxlength: 96 })
  slug!: string;

  @Prop({ default: '', trim: true, maxlength: 300 })
  description!: string;

  @Prop({ default: true, index: true })
  active!: boolean;

  @Prop({ required: true, index: true })
  createdBy!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ForumCategorySchema = SchemaFactory.createForClass(ForumCategory);
ForumCategorySchema.index({ active: 1, name: 1 });

@Schema({ timestamps: true, collection: 'forum_posts' })
export class ForumPost {
  @Prop({ required: true, index: true })
  authorId!: string;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  categoryId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 160 })
  title!: string;

  @Prop({ required: true, trim: true, maxlength: 20_000 })
  body!: string;

  @Prop({ type: [String], default: [] })
  photoAssetIds!: string[];

  @Prop({ enum: ['published', 'hidden', 'deleted'], default: 'published', index: true })
  status!: 'published' | 'hidden' | 'deleted';

  @Prop({ default: 0, min: 0 })
  commentsCount!: number;

  @Prop({ default: 0, min: 0 })
  reportsCount!: number;

  @Prop({ type: String, default: null, maxlength: 500 })
  moderationReason!: string | null;

  @Prop({ type: Date, default: null })
  moderatedAt!: Date | null;

  @Prop({ type: String, default: null })
  moderatedBy!: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ForumPostSchema = SchemaFactory.createForClass(ForumPost);
ForumPostSchema.index({ status: 1, createdAt: -1 });
ForumPostSchema.index({ categoryId: 1, status: 1, createdAt: -1 });
ForumPostSchema.index({ authorId: 1, createdAt: -1 });

@Schema({ timestamps: true, collection: 'forum_comments' })
export class ForumComment {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  postId!: Types.ObjectId;

  @Prop({ required: true, index: true })
  authorId!: string;

  @Prop({ required: true, trim: true, maxlength: 5_000 })
  body!: string;

  @Prop({ enum: ['published', 'hidden'], default: 'published', index: true })
  status!: 'published' | 'hidden';

  createdAt!: Date;
  updatedAt!: Date;
}

export const ForumCommentSchema = SchemaFactory.createForClass(ForumComment);
ForumCommentSchema.index({ postId: 1, status: 1, createdAt: -1 });

@Schema({ timestamps: true, collection: 'forum_reports' })
export class ForumReport {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  postId!: Types.ObjectId;

  @Prop({ required: true, index: true })
  reporterId!: string;

  @Prop({ enum: ['spam', 'harassment', 'inappropriate', 'misinformation', 'other'], required: true })
  reason!: string;

  @Prop({ default: '', trim: true, maxlength: 1000 })
  details!: string;

  @Prop({ enum: ['open', 'resolved', 'dismissed'], default: 'open', index: true })
  status!: 'open' | 'resolved' | 'dismissed';

  @Prop({ type: String, default: null, index: true })
  reviewedBy!: string | null;

  @Prop({ type: Date, default: null })
  reviewedAt!: Date | null;

  @Prop({ type: String, default: null, trim: true, maxlength: 1000 })
  reviewNote!: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ForumReportSchema = SchemaFactory.createForClass(ForumReport);
ForumReportSchema.index({ postId: 1, reporterId: 1 }, { unique: true });
ForumReportSchema.index({ status: 1, createdAt: 1 });

@Schema({ timestamps: true, collection: 'forum_moderation_actions' })
export class ForumModeration {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  postId!: Types.ObjectId;

  @Prop({ required: true, index: true })
  adminId!: string;

  @Prop({ enum: ['hide', 'restore', 'delete'], required: true })
  action!: 'hide' | 'restore' | 'delete';

  @Prop({ required: true, trim: true, maxlength: 500 })
  reason!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ForumModerationSchema = SchemaFactory.createForClass(ForumModeration);
ForumModerationSchema.index({ postId: 1, createdAt: -1 });
