/**
 * Networks and communities: everything one person did that a platform decided
 * to tell you about.
 *
 * Domain-based on purpose, and it outranks Promos, so everything from one
 * network lands in one bundle rather than splitting a network's notifications
 * from its marketing across two.
 */
import type { Features } from "../features";
import { domainMatches, hasAnyHeaderPrefix } from "../features";

const SOCIAL_DOMAINS = [
  // Professional and general networks.
  "linkedin.com", "linkedinmail.com", "facebook.com", "facebookmail.com",
  "fb.com", "instagram.com", "instagrammail.com", "threads.net",
  // Ahead of Updates' google.com, which would otherwise claim it.
  "plus.google.com",
  "twitter.com", "x.com", "bsky.app", "blueskyweb.xyz", "mastodon.social",
  "joinmastodon.org", "tumblr.com", "pinterest.com", "snapchat.com",
  "tiktok.com", "tiktokmail.com", "vk.com", "xing.com", "nextdoor.com",
  // Messaging and voice.
  "discord.com", "discordapp.com", "telegram.org", "signal.org",
  "whatsapp.com", "matrix.org", "element.io", "guilded.gg", "groupme.com",
  "line.me",
  // Publishing, video and audio. Newsletter platforms (Substack, Ghost,
  // Buttondown, Medium) are deliberately absent: what they carry is a
  // newsletter, and newsletters belong to Updates or Promos on their own
  // merits. So are services that only talk about your own account — Spotify,
  // Duolingo, Peloton: membership in Social is for mail about other people.
  "youtube.com", "vimeo.com", "twitch.tv", "dailymotion.com", "rumble.com",
  "soundcloud.com", "bandsintown.com", "songkick.com", "note.com",
  "pixiv.net",
  "last.fm", "letterboxd.com", "goodreads.com", "storygraph.com",
  // Creative and hobby communities.
  "flickr.com", "500px.com", "deviantart.com", "behance.net", "dribbble.com",
  "artstation.com", "ravelry.com", "strava.com", "runkeeper.com",
  "alltrails.com", "untappd.com", "chess.com", "lichess.org",
  // Q&A, reviews and local.
  "reddit.com", "redditmail.com", "quora.com", "quoramail.com", "yelp.com",
  "foursquare.com", "meetup.com", "connpass.com", "researchgate.net",
  // Creator support.
  "patreon.com", "ko-fi.com", "buymeacoffee.com", "onlyfans.com",
  // Dating.
  "tinder.com", "gotinder.com", "bumble.com", "hinge.co", "okcupid.com",
  "match.com", "grindr.com", "coffeemeetsbagel.com",
];

/**
 * Platform fingerprints. LinkedIn and Facebook both stamp their own headers on
 * every notification, which classifies mail from a sending domain nobody has
 * ever heard of (`e.linkedinmail.com`, `mailer.fb.com`, …).
 */
export const SOCIAL_HEADER_PREFIXES = [
  "x-linkedin",
  "x-facebook",
  "x-fb-",
  "x-instagram",
  "x-twitter",
  "x-reddit",
  "x-discord",
  "x-pinterest",
  "x-tiktok",
  "x-snapchat",
  "x-meetup",
  "x-strava",
];

export const matchesSocial = (f: Features): boolean => {
  if (domainMatches(f.senderDomain, SOCIAL_DOMAINS)) return true;
  return hasAnyHeaderPrefix(f, SOCIAL_HEADER_PREFIXES);
}
