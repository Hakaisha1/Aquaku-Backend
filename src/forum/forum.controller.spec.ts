import { ForumController } from './forum.controller';
import { ForumService } from './forum.service';
import { AuthenticatedUser } from '../auth/auth.service';

describe('ForumController', () => {
  let controller: ForumController;
  let forumService: {
    deletePost: jest.Mock;
    deleteComment: jest.Mock;
  };

  const adminUser: AuthenticatedUser = {
    id: 'admin-id',
    role: 'admin',
    phoneVerified: true,
  };

  const memberUser: AuthenticatedUser = {
    id: 'member-id',
    role: 'member',
    phoneVerified: true,
  };

  beforeEach(() => {
    forumService = {
      deletePost: jest.fn().mockResolvedValue({ id: 'post-1', deleted: true }),
      deleteComment: jest.fn().mockResolvedValue({ id: 'comment-1', deleted: true }),
    };
    controller = new ForumController(forumService as unknown as ForumService);
  });

  describe('deletePost', () => {
    it('passes isAdmin=true when an admin deletes a post', async () => {
      const result = await controller.deletePost(adminUser, 'post-1');
      expect(result).toEqual({ data: { id: 'post-1', deleted: true } });
      expect(forumService.deletePost).toHaveBeenCalledWith(adminUser, 'post-1', true);
    });

    it('passes isAdmin=false when a regular member deletes a post', async () => {
      const result = await controller.deletePost(memberUser, 'post-1');
      expect(result).toEqual({ data: { id: 'post-1', deleted: true } });
      expect(forumService.deletePost).toHaveBeenCalledWith(memberUser, 'post-1', false);
    });
  });

  describe('deleteComment', () => {
    it('passes isAdmin=true when an admin deletes a comment', async () => {
      const result = await controller.deleteComment(adminUser, 'post-1', 'comment-1');
      expect(result).toEqual({ data: { id: 'comment-1', deleted: true } });
      expect(forumService.deleteComment).toHaveBeenCalledWith(adminUser, 'post-1', 'comment-1', true);
    });

    it('passes isAdmin=false when a regular member deletes a comment', async () => {
      const result = await controller.deleteComment(memberUser, 'post-1', 'comment-1');
      expect(result).toEqual({ data: { id: 'comment-1', deleted: true } });
      expect(forumService.deleteComment).toHaveBeenCalledWith(memberUser, 'post-1', 'comment-1', false);
    });
  });
});
