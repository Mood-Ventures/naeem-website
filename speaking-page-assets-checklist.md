# /speaking Page — Media Assets Checklist

Everything below is built and structurally ready on the `speaking-page` branch. These are the real assets/copy still needed before this goes live.

## Videos

- [ ] **1 hero speaker reel** — currently using an existing clip (`dAJSFejHGWY`) as a placeholder. Confirm this is the reel you want front and center, or swap in a new one.
- [ ] **Custom hero reel thumbnail** — currently using YouTube's auto-generated thumbnail. Spec calls for a custom still, 1280x720, of you mid-keynote.
- [ ] **3 video testimonials** (name, title, company for each) — none exist yet. The "What Event Organizers Say" section currently shows your 4 real *text* testimonials (Emily Fletcher/Ziva, Eric Farber/Creators Legal, Noah Karesh/Feastly, Howie Diamond/Pure Ventures) styled to match the video-card format, per the spec's fallback rule. Swap in real video testimonials as they come in.
- [ ] **2-3 additional keynote clips + titles** — currently using 3 existing clips (`guwrdjcJvP4`, `KQnETNMaRXA`, `9VQjsBirOTI`) with no captions. Need real titles in the format `[Talk topic] — [Event type or client]`.
- [ ] **1 speaker reel transcript** — "Read speaker reel transcript" toggle is built and functional, just empty.

## Logos (SVG preferred, PNG fallback with transparent background)

13 placeholder slots are built in a responsive grid (4/3/2 per row desktop/tablet/mobile), each with the correct alt text ready to attach once you send files:

Northwestern Medicine, Alpha Bridge Ventures, Tony Robbins, Shima Capital, Deloitte, U.S. Army, Randstad Technologies, Salesforce, SoFi, Groupon, TotalEnergies, The University of Alabama, J.P. Morgan

File naming convention: `logo-[client-slug].svg` (e.g. `logo-northwestern-medicine.svg`)

**Flag:** I don't have independent confirmation these 13 are real past clients/relationships — I've published the names as text (in the "Trusted By" section) and reserved logo slots for them based on your brief. Since this makes specific, crawlable claims about real, well-known organizations, please double check the full list before this branch ever merges to main.

## Other assets from the original spec

- [ ] **Speaker one-sheet PDF** — button is built ("Download Speaker One-Sheet"), links to `#` placeholder.
- [ ] **4 signature talk descriptions** (2-3 sentences each) — titles and "Ideal for" lines are in per your spec; descriptions are placeholder comments (`<!-- DESCRIPTION TBD -->`) since you said you're supplying this copy separately.
- [ ] **Event types list** for the "Trusted By" section (optional, per spec) — placeholder comment in place.

## Already real, no action needed

- Hero positioning line, full 300+ word bio (all 8 required SEO phrases verified present verbatim), bio photo (your AFL stage photo), 6 FAQ answers, Person/Service/FAQPage/VideoObject schema, canonical/OG/Twitter tags, sitemap.xml, and the stat bar (1,000+ talks / 50,000+ people / 5 years).

## Verification already completed

- [x] Exactly one `<h1>`, clean h2→h3 hierarchy, no skipped levels
- [x] All 3 (Person, Service, FAQPage) + VideoObject schema blocks parse as valid JSON
- [x] FAQPage schema text matches visible FAQ text exactly, character-for-character
- [x] All 8 required SEO phrases present in the bio ("former Tony Robbins national speaker," "ICF-accredited coach," "NLP trainer," "hypnotist," "NYU cum laude," "Wall Street," "Silicon Valley," "peak performance")
- [x] Responsive: tested mobile (375px) and desktop (1200px) — hero is two-column desktop / stacked mobile per spec
- [x] All embeds site-wide now use `youtube-nocookie.com`, `?rel=0&modestbranding=1`, `loading="lazy"`, descriptive `title` attributes, no autoplay on load
- [x] Descriptive image filenames (`naeem-mahmood-keynote-stage.jpg`, not `IMG_XXXX.jpg`) and alt text

## Still needs manual/external verification (can't check from here)

- [ ] Rich-results validation at search.google.com/test/rich-results (all 4 schema blocks)
- [ ] Lighthouse SEO audit = 100
- [ ] CLS/LCP/INP Core Web Vitals targets
- [ ] Network-tab check that iframes truly don't request until clicked (should already be true — embeds are click-to-load, not just `loading="lazy"` — but worth confirming in a real browser, not this local dev setup)
