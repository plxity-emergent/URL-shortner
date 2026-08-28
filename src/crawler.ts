// ABOUTME: Splits link-preview crawlers from human visitors by user agent.
// ABOUTME: Unknown agents count as human, so a miss costs a preview card, never a broken link.

const CRAWLER_PATTERN =
  /(slackbot|twitterbot|facebookexternalhit|whatsapp|linkedinbot|discordbot|telegrambot|googlebot|bingbot|redditbot|applebot|embedly|pinterest|skypeuripreview|quora link preview|iframely|vkshare)/i;

export function isCrawler(userAgent: string | null): boolean {
  return userAgent !== null && CRAWLER_PATTERN.test(userAgent);
}
