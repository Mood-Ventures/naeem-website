// Serves /blog with native posts stored in D1 (falling back to the Peak
// Humans Substack RSS feed when no native posts exist yet), and a
// password-protected /admin/new page for publishing new posts without
// touching code. Every other request falls through to static assets.

const FEED_URL = 'https://nmood.substack.com/feed';
const FEED_CACHE_SECONDS = 600;
const MAX_POSTS = 20;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/blog' || path === '/blog/' || path === '/blog.html') {
      return renderBlog(env);
    }

    if (path === '/admin/new' || path === '/admin/new/') {
      const authResponse = requireAuth(request, env);
      if (authResponse) return authResponse;
      if (request.method === 'POST') return handleCreatePost(request, env);
      return renderAdminForm();
    }

    const postMatch = path.match(/^\/blog\/([a-z0-9-]+)\/?$/);
    if (postMatch) {
      return renderPost(env, postMatch[1]);
    }

    return env.ASSETS.fetch(request);
  },
};

// ---- Auth ----

function requireAuth(request, env) {
  const header = request.headers.get('Authorization') || '';
  const expected = 'Basic ' + btoa(`${env.ADMIN_USER}:${env.ADMIN_PASSWORD}`);
  if (header === expected) return null;
  return new Response('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="SuperMood Admin"' },
  });
}

// ---- Post creation ----

async function handleCreatePost(request, env) {
  const form = await request.formData();
  const title = (form.get('title') || '').toString().trim();
  const bodyHtml = sanitizeHtml((form.get('body_html') || '').toString().trim());

  if (!title || !bodyHtml) {
    return renderAdminForm('Title and body are both required.');
  }

  const slug = await uniqueSlug(env, slugify(title));

  await env.BLOG_DB.prepare(
    'INSERT INTO posts (slug, title, body_html) VALUES (?, ?, ?)'
  ).bind(slug, title, bodyHtml).run();

  return new Response(null, { status: 302, headers: { Location: `/blog/${slug}` } });
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/-+$/, '') || 'post';
}

async function uniqueSlug(env, base) {
  let slug = base;
  let n = 2;
  while (true) {
    const existing = await env.BLOG_DB.prepare('SELECT 1 FROM posts WHERE slug = ?').bind(slug).first();
    if (!existing) return slug;
    slug = `${base}-${n}`;
    n++;
  }
}

// Allowlist-based sanitizer. The admin form is password-gated (single
// trusted assistant), so this is defense in depth, not a public-input
// sanitizer: it strips scripts/handlers/dangerous URLs but otherwise
// preserves the pasted formatting.
function sanitizeHtml(html) {
  return html
    .replace(/<(script|style|iframe|object|embed|form|input|button|link|meta)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|input|button|link|meta)[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\s(href|src)\s*=\s*"\s*javascript:[^"]*"/gi, '')
    .replace(/\s(href|src)\s*=\s*'\s*javascript:[^']*'/gi, '');
}

// ---- Rendering ----

async function renderBlog(env) {
  const { results } = await env.BLOG_DB
    .prepare('SELECT slug, title, body_html, published_at FROM posts ORDER BY published_at DESC LIMIT 50')
    .all();

  if (results && results.length > 0) {
    const body = `<div class="blog-list">${results.map(nativePostCard).join('\n')}</div>`;
    return new Response(pageShell(body, 'The Blog', 'Essays on the work underneath the work.'), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  return renderSubstackBlog();
}

function nativePostCard(post) {
  const excerpt = decodeEntities(post.body_html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 180);
  return `<article class="post-card">
    <a class="post-card__link" href="/blog/${escapeHtml(post.slug)}">
      <h3>${escapeHtml(post.title)}</h3>
      <p class="post-card__date">${escapeHtml(formatDate(post.published_at))}</p>
      <p class="post-card__excerpt">${escapeHtml(excerpt)}&hellip;</p>
      <span class="post-card__cta">Read more &rarr;</span>
    </a>
  </article>`;
}

async function renderPost(env, slug) {
  const post = await env.BLOG_DB
    .prepare('SELECT title, body_html, published_at FROM posts WHERE slug = ?')
    .bind(slug)
    .first();

  if (!post) {
    return new Response(pageShell('<p style="text-align:center;">That post doesn&rsquo;t exist.</p>', 'Not Found', ''), {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  const body = `
    <p class="post-meta">${escapeHtml(formatDate(post.published_at))}</p>
    <div class="post-body">${post.body_html}</div>
    <a class="post-back" href="/blog">&larr; Back to the blog</a>
  `;
  return new Response(pageShell(body, post.title, ''), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function renderAdminForm(error) {
  const body = `
    <h2>New Post</h2>
    ${error ? `<p style="color:#ff6b6b; text-align:center;">${escapeHtml(error)}</p>` : ''}
    <form class="admin-form" method="POST" action="/admin/new" onsubmit="document.getElementById('body_html').value = document.getElementById('editor').innerHTML;">
      <label for="title">Title</label>
      <input type="text" id="title" name="title" required>

      <label for="editor">Body</label>
      <div id="editor" class="admin-editor" contenteditable="true"></div>
      <p class="admin-hint">Paste your newsletter directly into the box above &mdash; formatting like bold, links, and paragraphs will carry over.</p>
      <input type="hidden" id="body_html" name="body_html">

      <div class="cta-row">
        <button type="submit" class="btn btn--primary">Publish</button>
      </div>
    </form>
  `;
  return new Response(pageShell(body, 'New Post', ''), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

async function renderSubstackBlog() {
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
    : `<div class="blog-list">${posts.map(substackPostCard).join('\n')}</div>`;

  return new Response(pageShell(body, 'The Blog', 'Essays on the work underneath the work.'), {
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
    posts.push({ title, link, description, date: formatRssDate(pubDate) });
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
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function formatRssDate(pubDate) {
  const d = new Date(pubDate);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDate(isoDate) {
  const d = new Date(isoDate.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function substackPostCard(post) {
  return `<article class="post-card">
    <a class="post-card__link" href="${escapeHtml(post.link)}" target="_blank" rel="noopener">
      <h3>${escapeHtml(post.title)}</h3>
      ${post.date ? `<p class="post-card__date">${escapeHtml(post.date)}</p>` : ''}
      ${post.description ? `<p class="post-card__excerpt">${escapeHtml(post.description)}</p>` : ''}
      <span class="post-card__cta">Read on Substack &rarr;</span>
    </a>
  </article>`;
}

function pageShell(inner, title, description) {
  const pageTitle = title === 'The Blog' ? 'SuperMood | Naeem Mahmood &mdash; Executive Coach for Founders' : `${escapeHtml(title)} | SuperMood`;
  const heroTitle = title || 'The Blog';
  const heroSubtitle = description || '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<!-- Meta Pixel Code -->
<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js'); fbq('init', '1361900318899592'); fbq('track', 'PageView');</script>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=1361900318899592&ev=PageView&noscript=1"/></noscript>
<!-- End Meta Pixel Code -->
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pageTitle}</title>
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
    <a class="nav__logo" href="/">Super<span>Mood</span></a>
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
      <h1>${escapeHtml(heroTitle)}</h1>
      ${heroSubtitle ? `<p class="hero__subtitle">${escapeHtml(heroSubtitle)}</p>` : ''}
    </div>
  </section>

  <section class="section--alt">
    <div class="container container--narrow reveal">
      ${inner}
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
