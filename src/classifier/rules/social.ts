import type { Features } from "../features";
import { domainMatches } from "../features";

const SOCIAL_DOMAINS = [
  "linkedin.com", "linkedinmail.com",
  "facebook.com", "facebookmail.com", "fb.com",
  "instagram.com", "instagrammail.com",
  "twitter.com", "x.com",
  "reddit.com", "redditmail.com",
  "discord.com", "discordapp.com",
  "medium.com",
  "nextdoor.com",
  "slack.com",
  "quora.com", "quoramail.com",
  "tumblr.com",
  "pinterest.com",
  "youtube.com",
  "meetup.com",
  "strava.com",
  "goodreads.com",
];

export const matchesSocial = (f: Features): boolean => {
  return domainMatches(f.senderDomain, SOCIAL_DOMAINS);
}
