import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard, RolesGuard, VerifiedPhoneGuard } from '../auth/auth.guards';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { AuthenticatedUser } from '../auth/auth.service';
import {
  ConfirmForumUploadDto,
  CreateForumCategoryDto,
  CreateForumCommentDto,
  CreateForumPostDto,
  CreateForumReportDto,
  ForumCommentListQueryDto,
  ForumListQueryDto,
  ForumReportListQueryDto,
  ModerateForumPostDto,
  ReviewForumReportDto,
  SetForumCategoryActiveDto,
  UpdateForumPostDto,
} from './forum.dto';
import { ForumService } from './forum.service';

@Controller('forum')
export class ForumController {
  constructor(private readonly forum: ForumService) {}

  @Get('categories')
  async listCategories() {
    return { data: await this.forum.listCategories() };
  }

  @Get('posts')
  async listPosts(@Query() query: ForumListQueryDto) {
    return { data: await this.forum.listPosts(query) };
  }

  @Get('posts/:postId')
  async getPost(@Param('postId') postId: string) {
    return { data: await this.forum.getPost(postId) };
  }

  @Get('posts/:postId/comments')
  async listComments(@Param('postId') postId: string, @Query() query: ForumCommentListQueryDto) {
    return { data: await this.forum.listComments(postId, query) };
  }

  @Post('posts')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async createPost(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateForumPostDto) {
    return { data: await this.forum.createPost(user, body) };
  }

  @Patch('posts/:postId')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async updatePost(
    @CurrentUser() user: AuthenticatedUser,
    @Param('postId') postId: string,
    @Body() body: UpdateForumPostDto,
  ) {
    return { data: await this.forum.updatePost(user, postId, body) };
  }

  @Delete('posts/:postId')
  @UseGuards(AccessTokenGuard)
  async deletePost(@CurrentUser() user: AuthenticatedUser, @Param('postId') postId: string) {
    return { data: await this.forum.deletePost(user, postId) };
  }

  @Post('posts/:postId/comments')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async createComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('postId') postId: string,
    @Body() body: CreateForumCommentDto,
  ) {
    return { data: await this.forum.createComment(user, postId, body) };
  }

  @Delete('posts/:postId/comments/:commentId')
  @UseGuards(AccessTokenGuard)
  async deleteComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('postId') postId: string,
    @Param('commentId') commentId: string,
  ) {
    return { data: await this.forum.deleteComment(user, postId, commentId) };
  }

  @Post('posts/:postId/reports')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async reportPost(
    @CurrentUser() user: AuthenticatedUser,
    @Param('postId') postId: string,
    @Body() body: CreateForumReportDto,
  ) {
    return { data: await this.forum.reportPost(user, postId, body) };
  }

  @Post('media/upload-signatures')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async createUploadSignature(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.forum.createUploadSignature(user) };
  }

  @Post('media/confirm-upload')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async confirmUpload(@CurrentUser() user: AuthenticatedUser, @Body() body: ConfirmForumUploadDto) {
    return { data: await this.forum.confirmUpload(user, body.asset_id) };
  }

  @Post('admin/categories')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  async createCategory(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateForumCategoryDto) {
    return { data: await this.forum.createCategory(user, body) };
  }

  @Patch('admin/categories/:categoryId')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  async setCategoryActive(@Param('categoryId') categoryId: string, @Body() body: SetForumCategoryActiveDto) {
    return { data: await this.forum.setCategoryActive(categoryId, body.active) };
  }

  @Get('admin/posts')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  async listModeratedPosts(@Query() query: ForumListQueryDto) {
    return { data: await this.forum.listModeratedPosts(query) };
  }

  @Get('admin/posts/:postId/moderation')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  async listModerationHistory(@Param('postId') postId: string) {
    return { data: await this.forum.listModerationHistory(postId) };
  }

  @Post('admin/posts/:postId/moderation')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  async moderatePost(@CurrentUser() user: AuthenticatedUser, @Param('postId') postId: string, @Body() body: ModerateForumPostDto) {
    return { data: await this.forum.moderatePost(user, postId, body) };
  }

  @Get('admin/reports')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  async listReports(@Query() query: ForumReportListQueryDto) {
    return { data: await this.forum.listReports(query.page, query.limit, query.status) };
  }

  @Post('admin/reports/:reportId/review')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  async reviewReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reportId') reportId: string,
    @Body() body: ReviewForumReportDto,
  ) {
    return { data: await this.forum.reviewReport(user, reportId, body) };
  }
}
