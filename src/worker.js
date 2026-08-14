// Serves /blog by rendering the Peak Humans Substack RSS feed in the
// site's design; every other request falls through to static assets.

const FEED_URL = 'https://nmood.substack.com/feed';
const FEED_CACHE_SECONDS = 600;
const MAX_POSTS = 20;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/blog' || url.pathname === '/blog/' || url.pathname === '/blog.html') {
      return renderBlog();
    }
    return env.ASSETS.fetch(request);
  },
};

async function renderBlog() {
  let posts = [];
  let feedError = false;
  try {
    const res = await fetch(FEED_URL, {
      cf: { cacheTtl: FEED_CACHE_SECONDS, cacheEverything: true },
    });
    if (!res.ok) throw new Error('feed HTTP ' + res.status);
    posts = parseFeed(await res.text());
  } catch (e) {
    feedError = true;
  }

  const body = feedError || posts.length === 0
    ? `<p class="blog-empty">New essays are on the way. In the meantime, <a href="https://nmood.substack.com" target="_blank" rel="noopener">visit the Peak Humans Substack</a>.</p>`
    : `<div class="blog-list">${posts.map(postCard).join('\n')}</div>`;

  return new Response(pageShell(body), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': `public, max-age=${FEED_CACHE_SECONDS}`,
    },
  });
}

function parseFeed(xml) {
  const posts = [];
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const item of items.slice(0, MAX_POSTS)) {
    const title = extract(item, 'title');
    const link = extract(item, 'link');
    const description = extract(item, 'description');
    const pubDate = extract(item, 'pubDate');
    if (!title || !link) continue;
    posts.push({ title, link, description, date: formatDate(pubDate) });
  }
  return posts;
}

function extract(block, tag) {
  const m = block.match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>'));
  if (!m) return '';
  return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim());
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function formatDate(pubDate) {
  const d = new Date(pubDate);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function postCard(post) {
  return `<article class="post-card">
    <a class="post-card__link" href="${escapeHtml(post.link)}" target="_blank" rel="noopener">
      <h3>${escapeHtml(post.title)}</h3>
      ${post.date ? `<p class="post-card__date">${escapeHtml(post.date)}</p>` : ''}
      ${post.description ? `<p class="post-card__excerpt">${escapeHtml(post.description)}</p>` : ''}
      <span class="post-card__cta">Read on Substack &rarr;</span>
    </a>
  </article>`;
}

function pageShell(inner) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<!-- Meta Pixel Code -->
<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js'); fbq('init', '1361900318899592'); fbq('track', 'PageView');</script>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=1361900318899592&ev=PageView&noscript=1"/></noscript>
<!-- End Meta Pixel Code -->
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SuperMood | Naeem Mahmood &mdash; Executive Coach for Founders</title>
<meta name="description" content="Executive coaching for founders who are winning on paper and losing everywhere that matters. Peak Mind. Peak Body. Peak Love.">
<meta name="author" content="Naeem Mahmood">
<link rel="icon" type="image/svg+xml" href="/assets/img/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/styles.css">
</head>
<body>

<a class="skip-link" href="#main">Skip to content</a>

<nav class="nav">
  <div class="container nav__inner">
    <a class="nav__logo" href="/">SuperMood</a>
    <div class="nav__links">
      <a class="nav__link" href="/work-with-me">Work With Me</a>
      <a class="nav__link" href="/supermood-longevity">Longevity</a>
      <a class="nav__link" href="/speaking">Speaking</a>
      <a class="nav__link" href="/about">About</a>
      <a class="nav__link" href="/podcast">Podcast</a>
      <a class="nav__link" href="/blog">Blog</a>
      <a class="nav__link" href="/peak-life-os">Peak Life OS</a>
      <a class="nav__link" href="/daily">Daily</a>
      <a class="btn btn--primary btn--small" href="/breakthrough-call">Apply for a Breakthrough Call</a>
    </div>
    <button class="nav__toggle" aria-label="Toggle menu" aria-expanded="false">&#9776;</button>
  </div>
  <div class="nav__mobile container">
    <a class="nav__link" href="/work-with-me">Work With Me</a>
    <a class="nav__link" href="/supermood-longevity">Longevity</a>
    <a class="nav__link" href="/speaking">Speaking</a>
    <a class="nav__link" href="/about">About</a>
    <a class="nav__link" href="/podcast">Podcast</a>
    <a class="nav__link" href="/blog">Blog</a>
    <a class="nav__link" href="/peak-life-os">Peak Life OS</a>
    <a class="nav__link" href="/daily">Daily</a>
    <a class="btn btn--primary btn--small" href="/breakthrough-call">Apply for a Breakthrough Call</a>
  </div>
</nav>

<main id="main">

  <section class="hero">
    <div class="container hero__inner reveal">
      <h1>The Blog</h1>
      <p class="hero__subtitle">Essays on the work underneath the work &mdash; from the Peak Humans Substack.</p>
    </div>
  </section>

  <section class="section--alt">
    <div class="container container--narrow reveal">
      ${inner}
      <div class="cta-row">
        <a class="btn btn--primary" href="https://nmood.substack.com/subscribe" target="_blank" rel="noopener">Subscribe on Substack &rarr;</a>
      </div>
    </div>
  </section>

</main>

<footer class="site-footer">
  <div class="container">
    <div class="site-footer__grid">
      <span class="site-footer__copyright">SuperMood &copy; 2026</span>
      <div class="site-footer__links">
        <a href="/">Home</a>
        <a href="/work-with-me">Work With Me</a>
        <a href="/supermood-longevity">Longevity</a>
        <a href="/speaking">Speaking</a>
        <a href="/about">About</a>
        <a href="/podcast">Podcast</a>
        <a href="/blog">Blog</a>
        <a href="/peak-life-os">Peak Life OS</a>
        <a href="/daily">Daily</a>
      </div>
      <div class="site-footer__links">
        <a href="/breakthrough-call">Apply for a Breakthrough Call</a>
      </div>
    </div>
    <p class="site-footer__tagline">The operating system underneath everything.</p>
  </div>
</footer>

<script src="/assets/js/main.js"></script>
</body>
</html>`;
}
