/**
 * Strips all HTML tags from titles to ensure plain-text headers.
 */
export function sanitizeForumTitle(title: string): string {
  if (!title) return '';
  let sanitized = title;
  sanitized = sanitized.replace(/<script\b[\s\S]*?(?:<\/script>|$)/gi, '');
  sanitized = sanitized.replace(/<style\b[\s\S]*?(?:<\/style>|$)/gi, '');
  sanitized = sanitized.replace(/<[^>]*>/g, '');
  return sanitized.trim();
}

function neutralizeDangerousMarkdownLinks(text: string): string {
  const pattern = /\[([^\]]*)\]\(\s*(?:javascript|vbscript|data):/gi;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const linkText = match[1];
    result += text.slice(lastIndex, match.index);

    let depth = 1;
    let i = pattern.lastIndex;
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      i++;
    }

    result += `[${linkText}](#)`;
    lastIndex = i;
    pattern.lastIndex = i;
  }
  result += text.slice(lastIndex);
  return result;
}

/**
 * Sanitizes forum post and comment bodies by stripping dangerous raw HTML tags,
 * inline event handlers, and malicious pseudo-protocol links while preserving
 * standard Markdown formatting and safe content.
 */
export function sanitizeForumContent(content: string): string {
  if (!content) return '';

  // 1. Neutralize javascript:, vbscript:, and data: URLs in markdown links/images: [text](javascript:...)
  let sanitized = neutralizeDangerousMarkdownLinks(content);

  // 2. Strip dangerous block/executable tags and their inner content: <script>, <style>, <iframe...>, etc.
  const dangerousBlockTags = [
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'applet',
    'frameset',
    'frame',
    'form',
  ];
  for (const tag of dangerousBlockTags) {
    sanitized = sanitized.replace(new RegExp(`<${tag}\\b[\\s\\S]*?(?:<\\/${tag}>|$)`, 'gi'), '');
  }

  // 3. Strip standalone dangerous self-closing/void/executable tags
  sanitized = sanitized.replace(
    /<\/?(?:base|meta|link|embed|object|iframe|script|applet|form|input|button|svg|math)\b[^>]*>/gi,
    '',
  );

  // 4. Strip dangerous raw HTML links with javascript: or vbscript:
  sanitized = sanitized.replace(
    /<a\b[^>]*?\s*href\s*=\s*(?:'javascript:[^']*'|"javascript:[^"]*"|javascript:[^\s>]+)[^>]*>([\s\S]*?)<\/a>/gi,
    '$1',
  );
  sanitized = sanitized.replace(
    /<a\b[^>]*?\s*href\s*=\s*(?:'vbscript:[^']*'|"vbscript:[^"]*"|vbscript:[^\s>]+)[^>]*>([\s\S]*?)<\/a>/gi,
    '$1',
  );

  // 5. Strip container tags containing inline event handlers (leaving text content intact)
  sanitized = sanitized.replace(
    /<([a-z0-9_-]+)\b[^>]*?\son[a-z0-9_-]+\s*=(?:'[^']*'|"[^"]*"|[^\s>]+)[^>]*>([\s\S]*?)<\/\1>/gi,
    '$2',
  );

  // 6. Strip self-closing / void tags containing inline event handlers (e.g. <img src=x onerror=...>)
  sanitized = sanitized.replace(
    /<[a-z0-9_-]+\b[^>]*?\son[a-z0-9_-]+\s*=(?:'[^']*'|"[^"]*"|[^\s>]+)[^>]*\/?>/gi,
    '',
  );

  // 7. Strip any remaining inline event handlers on any remaining tags
  sanitized = sanitized.replace(
    /\s+on[a-z0-9_-]+\s*=(?:'[^']*'|"[^"]*"|[^\s>]+)/gi,
    '',
  );

  return sanitized.trim();
}
