import { describe, expect, it } from "vitest";

import { isCrawler } from "../src/crawler";

const CRAWLERS = [
  "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  "Twitterbot/1.0",
  "facebookexternalhit/1.1",
  "WhatsApp/2.23.20.0",
  "LinkedInBot/1.0 (compatible; Mozilla/5.0)",
  "Mozilla/5.0 (compatible; Discordbot/2.0)",
  "TelegramBot (like TwitterBot)",
  "Mozilla/5.0 (compatible; bingbot/2.0)",
];

const BROWSERS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
];

describe("isCrawler", () => {
  it.each(CRAWLERS)("classifies %s as a crawler", agent => {
    expect(isCrawler(agent)).toBe(true);
  });

  it.each(BROWSERS)("classifies %s as a human", agent => {
    expect(isCrawler(agent)).toBe(false);
  });

  it("treats a missing user agent as a human", () => {
    expect(isCrawler(null)).toBe(false);
  });
});
