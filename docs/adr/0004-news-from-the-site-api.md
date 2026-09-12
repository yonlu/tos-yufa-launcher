# 0004 — News come from the site's API, not from the patch bucket

Date: 2026-09-09
Status: accepted

## Context

The launcher's news list was fed by a hand-written `news.json` in the patch bucket: bilingual items pushed with `yufa-publish news push`, its URL carried by every manifest (`newsUrl`). Meanwhile the site (`tos-classic`, tosclassic.com) grew a news system with an admin, Markdown bodies and a public JSON API written for this launcher: `GET /api/news` (a page of posts without bodies) and `GET /api/news/[slug]` (one post with its body), contract v1 frozen in the site's ADR 0007, additive-only, cached at the edge for five minutes and refreshed the moment a post is published.

Two sources for the same news means two places to write it and two shapes to keep in step.

## Decision

The site's API is the only source. The launcher fetches one page of `https://www.tosclassic.com/api/news` (the largest the contract allows, 50 posts) in the main process, keeps the page it last received next to its settings, and serves that page marked stale when the site does not answer. Posts open on the site in the browser through the `url` the feed carries. The bucket feed, the manifest's `newsUrl`, the CLI's `news push` and its `newsKey` / `newsImagesPrefix` config are gone; `newsUrl` in an already published manifest is ignored.

The launcher validates the fields it uses and drops the rest, and treats the category as free text with a name per known id, so the contract can grow without emptying the list.

## Consequences

- Whoever publishes news does it once, in the site's admin; the launcher shows it within minutes, with no operator step.
- The feed is single-language: the site stores one title and one excerpt per post. The launcher's bilingual news items are gone with the bucket feed.
- The launcher depends on the site being up for fresh news; the saved page and the stale mark cover an outage, as the cached bucket feed did.
- Native article rendering later means calling `/api/news/[slug]` for the Markdown body; nothing in the contract needs to change for that.
- The e2e sandbox serves a static page in the feed's shape (`YUFA_NEWS_URL`), so the screenshot smoke does not depend on the live site.
