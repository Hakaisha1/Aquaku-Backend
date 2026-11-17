import { sanitizeForumContent, sanitizeForumTitle } from './forum-sanitizer';

describe('forum-sanitizer', () => {
  describe('sanitizeForumTitle', () => {
    it('strips all html tags from title while keeping text', () => {
      const input = '<script>alert("xss")</script>How to care for <b>Discus</b>?';
      expect(sanitizeForumTitle(input)).toBe('How to care for Discus?');
    });

    it('returns empty string if title contains only html tags', () => {
      const input = '<script>alert(1)</script>';
      expect(sanitizeForumTitle(input)).toBe('');
    });
  });

  describe('sanitizeForumContent', () => {
    it('strips script, iframe, object, and embed tags with inner content', () => {
      const input = 'Normal text <script>evil()</script><iframe src="evil.com"></iframe><object data="bad"></object><embed src="bad">';
      expect(sanitizeForumContent(input)).toBe('Normal text');
    });

    it('strips inline event handlers like onerror and onload', () => {
      const input = 'Click <img src="x" onerror="alert(1)"> or <div onload="alert(2)">test</div>';
      expect(sanitizeForumContent(input)).toBe('Click  or test');
    });

    it('strips dangerous javascript: attributes in raw HTML', () => {
      const input = '<a href="javascript:alert(1)">malicious link</a>';
      expect(sanitizeForumContent(input)).toBe('malicious link');
    });

    it('neutralizes javascript: pseudoprotocol in markdown links', () => {
      const input = 'Check this [malicious link](javascript:alert(document.cookie))';
      expect(sanitizeForumContent(input)).toBe('Check this [malicious link](#)');
    });

    it('preserves standard markdown formatting', () => {
      const input = '# Heading 1\n\n**Bold text** and *italic text*\n\n- List item 1\n- List item 2\n\n> Quote block\n\n`const x = 10;`\n\n[Aquaku](https://aquaku.id)';
      expect(sanitizeForumContent(input)).toBe(input);
    });
  });
});
