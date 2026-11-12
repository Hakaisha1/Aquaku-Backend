import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import {
  ForumCategory,
  ForumCategorySchema,
  ForumComment,
  ForumCommentSchema,
  ForumModeration,
  ForumModerationSchema,
  ForumPost,
  ForumPostSchema,
  ForumReport,
  ForumReportSchema,
} from './forum.schemas';
import { ForumController } from './forum.controller';
import { ForumService } from './forum.service';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    MarketplaceModule,
    MongooseModule.forFeature([
      { name: ForumCategory.name, schema: ForumCategorySchema },
      { name: ForumPost.name, schema: ForumPostSchema },
      { name: ForumComment.name, schema: ForumCommentSchema },
      { name: ForumReport.name, schema: ForumReportSchema },
      { name: ForumModeration.name, schema: ForumModerationSchema },
    ]),
  ],
  controllers: [ForumController],
  providers: [ForumService],
})
export class ForumModule {}
