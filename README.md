# SuperMood — naeemmood.com

Static site for Naeem Mahmood / SuperMood. Plain HTML/CSS/JS, no build step, no framework.

## Local preview

```
python3 -m http.server 8843
```

Then open http://localhost:8843/public/

## Structure

- `index.html` — Home
- `connect.html`: hidden contact card at `/connect` (business-card QR). Not in the nav, footer, or sitemap. `noindex, nofollow`.
- `work-with-me.html` — The SuperMood Standard
- `speaking.html` — Keynote Speaking
- `about.html` — About Naeem
- Apply and discovery-call buttons open https://tidycal.com/peakhumans/peakhuman-protocol-30. `/breakthrough-call` redirects there.
- `assets/css/styles.css` — all styles
- `assets/js/main.js` — mobile nav toggle + scroll-reveal animations
- `assets/img/favicon.svg` — inline SVG favicon

## Blog posts

Links inside a blog post (the article body, sources, calls to action, and inline links) open in a new tab with `target="_blank"` and `rel="noopener"`. The renderer adds those attributes to anchors in post bodies and on the blog index cards. Leave site navigation, the footer, and the logo in the same tab.

## Deploying (GitHub + Cloudflare)

This project deploys as a Cloudflare Workers static-assets site (see `wrangler.jsonc`). Push to `main` to deploy. Point the `naeemmood.com` custom domain at the Worker from the Cloudflare dashboard once ready to cut over DNS.
