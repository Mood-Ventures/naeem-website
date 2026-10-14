// Serves /blog from D1. Native posts (written in /admin/new) and newsletters
// imported from the Peak Humans Substack feed live in the same table.
// An hourly cron imports the feed, and /blog repeats that import when the
// last successful run is stale, so new letters show up before cron fires.
// Every other request falls through to static assets.

const FEED_URL = 'https://nmood.substack.com/feed';
const IMPORT_META_KEY = 'last_substack_import';
// Match the hourly cron so a page view does not refetch the feed all day.
const IMPORT_MAX_AGE_MS = 60 * 60 * 1000;

// Retired URLs that now fold into the Peak Human Protocol master page.
const RETIRED_TO_PROTOCOL = [
  '/mood-method', '/mood-method.html',
  '/supermood', '/supermood.html',
  '/supermood-standard', '/supermood-standard.html',
  '/work-with-me', '/work-with-me.html',
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (RETIRED_TO_PROTOCOL.includes(path)) {
      return Response.redirect(new URL('/peakhuman/', url.origin).toString(), 301);
    }

    // The old protocol URL now lives at /peakhuman/.
    if (
      path === '/peak-human-protocol' ||
      path === '/peak-human-protocol/' ||
      path === '/peak-human-protocol.html'
    ) {
      return Response.redirect(new URL('/peakhuman/', url.origin).toString(), 301);
    }

    // Directory indexes, served with or without a trailing slash.
    if (path === '/peakhuman' || path === '/peakhuman/') {
      return env.ASSETS.fetch(new Request(new URL('/peakhuman/index.html', url.origin), request));
    }
    if (path === '/peakhuman/offer' || path === '/peakhuman/offer/') {
      return env.ASSETS.fetch(new Request(new URL('/peakhuman/offer/index.html', url.origin), request));
    }

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

  async scheduled(_controller, env, _ctx) {
    await importSubstackPosts(env);
  },
};

// ---- Auth ----

function requireAuth(request, env) {
  const header = request.headers.get('Authorization') || '';
  const expected = 'Basic ' + btoa(`${env.ADMIN_USER}:${env.ADMIN_PASSWORD}`);
  if (header === expected) return null;
  return new Response('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Naeem Mahmood Admin"' },
  });
}

// ---- Post creation ----

async function handleCreatePost(request, env) {
  const form = await request.formData();
  const title = (form.get('title') || '').toString().trim();
  const bodyHtml = normalizePostHtml((form.get('body_html') || '').toString().trim());

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

// Strips scripts, handlers, and dangerous URLs. Pasted Substack markup is
// normalized further in normalizePostHtml.
function sanitizeHtml(html) {
  return html
    .replace(/<(script|style|iframe|object|embed|form|input|button|link|meta)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|input|button|link|meta)[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\s(href|src)\s*=\s*"\s*javascript:[^"]*"/gi, '')
    .replace(/\s(href|src)\s*=\s*'\s*javascript:[^']*'/gi, '');
}

const DROP_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'link', 'meta', 'svg', 'source', 'noscript',
]);
const DROP_CLASSES = [
  'button-wrapper',
  'captioned-button-wrap',
  'image-link-expand',
  'preamble',
  'subscription-widget',
  'subscribe-widget',
];
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);

// Turn stored Substack (or pasted) HTML into the same simple markup native
// posts use: paragraphs, lists, links, and images. Existing rows are cleaned
// at render time, and new imports are stored already cleaned.
function normalizePostHtml(html) {
  if (!html) return '';
  let out = sanitizeHtml(String(html));
  out = replaceCaptionedImages(out);
  out = removeElements(out, (name, raw) => {
    const tag = name.toLowerCase();
    if (DROP_TAGS.has(tag)) return true;
    const cls = attrValue(raw, 'class');
    if (DROP_CLASSES.some((token) => hasClass(cls, token))) return true;
    if (/button|subscribe/i.test(attrValue(raw, 'data-component-name'))) return true;
    return false;
  });
  out = out.replace(/<a\b[^>]*\bclass\s*=\s*("[^"]*\bbutton\b[^"]*"|'[^']*\bbutton\b[^']*')[^>]*>[\s\S]*?<\/a>/gi, '');
  out = out.replace(/<p[^>]*>\s*<em>\s*If you found value in the newsletter share it[\s\S]*?<\/em>\s*<\/p>/gi, '');
  out = stripPresentationalAttrs(out);
  out = out.replace(/<img\b[^>]*>/gi, (tag) => cleanImageTag(tag));
  out = out.replace(/<\/?span\b[^>]*>/gi, '');
  for (let n = 0; n < 4; n++) {
    const next = out
      .replace(/<p[^>]*>\s*<\/p>/gi, '')
      .replace(/<div[^>]*>\s*<\/div>/gi, '')
      .replace(/<figure[^>]*>\s*<\/figure>/gi, '');
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s{2,}/g, ' ').replace(/>\s+</g, '>\n<').trim();
}

function replaceCaptionedImages(html) {
  return replaceBalanced(html, 'div', (raw) => hasClass(attrValue(raw, 'class'), 'captioned-image-container'), (inner) => {
    const img = inner.match(/<img\b[^>]*>/i);
    if (!img) return '';
    return `<figure class="post-figure">${cleanImageTag(img[0])}</figure>`;
  });
}

function cleanImageTag(tag) {
  const src = attrValue(tag, 'src').trim();
  if (!src || /^\s*javascript:/i.test(src)) return '';
  const alt = attrValue(tag, 'alt');
  return `<img src="${src}" alt="${alt}" loading="lazy">`;
}

function stripPresentationalAttrs(html) {
  return html.replace(/<([a-zA-Z][\w:-]*)\b([^>]*)>/g, (full, name, attrs) => {
    if (full.startsWith('</')) return full;
    const cleaned = attrs.replace(/\s(?:style|width|height|srcset|sizes|fetchpriority|data-[\w:-]+|class)\s*=\s*("[^"]*"|'[^']*')/gi, (attr) => {
      if (/^\sclass\s*=/i.test(attr) && /post-figure/.test(attr)) return attr;
      return '';
    });
    return `<${name}${cleaned}>`;
  });
}

function hasClass(classAttr, name) {
  return new RegExp('(?:^|\\s)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s|$)').test(classAttr || '');
}

function attrValue(tag, name) {
  const match = tag.match(new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i'));
  if (!match) return '';
  return match[2] != null ? match[2] : (match[3] || '');
}

function dropping(stack) {
  for (const frame of stack) if (frame.drop) return true;
  return false;
}

function removeElements(html, shouldRemove) {
  let i = 0;
  let out = '';
  const stack = [];
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      if (!dropping(stack)) out += html.slice(i);
      break;
    }
    if (!dropping(stack)) out += html.slice(i, lt);
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      const next = end === -1 ? html.length : end + 3;
      if (!dropping(stack)) out += html.slice(lt, next);
      i = next;
      continue;
    }
    const gt = html.indexOf('>', lt);
    if (gt === -1) {
      if (!dropping(stack)) out += html.slice(lt);
      break;
    }
    const raw = html.slice(lt, gt + 1);
    const nameMatch = raw.match(/^<\s*(\/?)\s*([a-zA-Z][\w:-]*)/);
    if (!nameMatch) {
      if (!dropping(stack)) out += raw;
      i = gt + 1;
      continue;
    }
    const isClose = nameMatch[1] === '/';
    const lower = nameMatch[2].toLowerCase();
    const selfClosing = /\/\s*>$/.test(raw) || VOID_TAGS.has(lower);
    if (isClose) {
      let dropThis = false;
      for (let s = stack.length - 1; s >= 0; s--) {
        const frame = stack.pop();
        dropThis = frame.drop;
        if (frame.name === lower) break;
      }
      if (!dropThis && !dropping(stack)) out += raw;
    } else if (selfClosing) {
      if (!(dropping(stack) || shouldRemove(nameMatch[2], raw))) out += raw;
    } else {
      const drop = dropping(stack) || shouldRemove(nameMatch[2], raw);
      stack.push({ name: lower, drop });
      if (!drop) out += raw;
    }
    i = gt + 1;
  }
  return out;
}

function replaceBalanced(html, tagName, matchOpen, replacer) {
  const lowerTag = tagName.toLowerCase();
  let i = 0;
  let out = '';
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      const next = end === -1 ? html.length : end + 3;
      out += html.slice(lt, next);
      i = next;
      continue;
    }
    const gt = html.indexOf('>', lt);
    if (gt === -1) {
      out += html.slice(lt);
      break;
    }
    const raw = html.slice(lt, gt + 1);
    const nameMatch = raw.match(/^<\s*([a-zA-Z][\w:-]*)/);
    const name = nameMatch ? nameMatch[1].toLowerCase() : '';
    const isOpen = name === lowerTag && !raw.startsWith('</') && !/\/\s*>$/.test(raw);
    if (isOpen && matchOpen(raw)) {
      const end = findBalancedEnd(html, gt + 1, lowerTag);
      if (!end) {
        out += raw;
        i = gt + 1;
        continue;
      }
      out += replacer(html.slice(gt + 1, end.closeStart), raw);
      i = end.after;
    } else {
      out += raw;
      i = gt + 1;
    }
  }
  return out;
}

function findBalancedEnd(html, from, tagName) {
  let depth = 1;
  let i = from;
  const openRe = new RegExp('^<' + tagName + '\\b', 'i');
  const closeRe = new RegExp('^</' + tagName + '\\b', 'i');
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) return null;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    const gt = html.indexOf('>', lt);
    if (gt === -1) return null;
    const raw = html.slice(lt, gt + 1);
    if (closeRe.test(raw)) {
      depth -= 1;
      if (depth === 0) return { closeStart: lt, after: gt + 1 };
    } else if (openRe.test(raw) && !/\/\s*>$/.test(raw)) {
      depth += 1;
    }
    i = gt + 1;
  }
  return null;
}

// ---- Rendering ----

async function renderBlog(env) {
  try {
    await maybeImportSubstack(env);
  } catch (err) {
    console.error('Substack import failed', err);
  }

  const { results } = await env.BLOG_DB
    .prepare('SELECT slug, title, body_html, published_at FROM posts ORDER BY published_at DESC LIMIT 50')
    .all();

  const posts = results || [];
  const body = posts.length
    ? `<div class="blog-list">${posts.map(nativePostCard).join('\n')}</div>`
    : `<p class="blog-empty">New essays are on the way. In the meantime, <a href="https://nmood.substack.com" target="_blank" rel="noopener">visit the Peak Humans Substack</a>.</p>`;

  return new Response(pageShell(body, 'The Blog', 'Essays on the work underneath the work.'), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function nativePostCard(post) {
  const html = normalizePostHtml(post.body_html || '');
  const imgMatch = html.match(/<img\b[^>]*\ssrc="([^"]+)"/i);
  const thumb = imgMatch
    ? `<div class="post-card__thumb"><img src="${escapeHtml(decodeEntities(imgMatch[1]))}" alt="" loading="lazy"></div>`
    : '';
  const plain = decodeEntities(
    html.replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, ' ').replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
  const excerpt = plain.slice(0, 180);
  const more = plain.length > 180 ? '&hellip;' : '';
  return `<article class="post-card">
    <a class="post-card__link" href="/blog/${escapeHtml(post.slug)}">
      ${thumb}
      <h3>${escapeHtml(post.title)}</h3>
      <p class="post-card__date">${escapeHtml(formatDate(post.published_at))}</p>
      ${excerpt ? `<p class="post-card__excerpt">${escapeHtml(excerpt)}${more}</p>` : ''}
      <span class="post-card__cta">Read more &rarr;</span>
    </a>
  </article>`;
}

async function renderPost(env, slug) {
  await ensureSchema(env);
  const post = await env.BLOG_DB
    .prepare('SELECT title, body_html, published_at, source_url FROM posts WHERE slug = ?')
    .bind(slug)
    .first();

  if (!post) {
    return new Response(pageShell('<p style="text-align:center;">That post doesn&rsquo;t exist.</p>', 'Not Found', ''), {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  const source = post.source_url
    ? `<a class="post-back" href="${escapeHtml(post.source_url)}" rel="noopener">Originally published on Substack</a>`
    : '';
  const body = `
    <article class="post-article">
      <p class="post-meta">${escapeHtml(formatDate(post.published_at))}</p>
      <div class="post-body">${normalizePostHtml(post.body_html || '')}</div>
      ${source}
      <a class="post-back" href="/blog">&larr; Back to the blog</a>
    </article>
  `;
  return new Response(pageShell(body, post.title, '', { canonical: post.source_url || '' }), {
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
      <p class="admin-hint">Paste your newsletter directly into the box above. Formatting like bold, links, and paragraphs will carry over.</p>
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

// ---- Substack import ----

let schemaReady = false;

async function ensureSchema(env) {
  if (schemaReady) return;
  const info = await env.BLOG_DB.prepare('PRAGMA table_info(posts)').all();
  const names = new Set((info.results || []).map((col) => col.name));
  if (!names.has('source_url')) {
    try {
      await env.BLOG_DB.prepare('ALTER TABLE posts ADD COLUMN source_url TEXT').run();
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      if (!/duplicate column/i.test(message)) throw err;
    }
  }
  await env.BLOG_DB.prepare(
    `CREATE TABLE IF NOT EXISTS import_meta (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`
  ).run();
  schemaReady = true;
}

async function maybeImportSubstack(env) {
  await ensureSchema(env);
  const row = await env.BLOG_DB
    .prepare('SELECT value FROM import_meta WHERE key = ?')
    .bind(IMPORT_META_KEY)
    .first();
  const last = row ? Date.parse(row.value) : NaN;
  if (!Number.isNaN(last) && Date.now() - last < IMPORT_MAX_AGE_MS) return;
  await importSubstackPosts(env);
}

async function importSubstackPosts(env) {
  await ensureSchema(env);
  const res = await fetch(FEED_URL, {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!res.ok) throw new Error('feed HTTP ' + res.status);
  const xml = await res.text();
  const posts = parseFeedItems(xml);
  const itemCount = (xml.match(/<item\b/g) || []).length;
  if (itemCount > 0 && posts.length === 0) {
    throw new Error('Substack feed had items but none could be parsed');
  }

  const seen = new Set();
  const statements = [];
  for (const post of posts) {
    if (seen.has(post.slug)) continue;
    seen.add(post.slug);
    statements.push(
      env.BLOG_DB.prepare(
        `INSERT INTO posts (slug, title, body_html, published_at, source_url)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO NOTHING`
      ).bind(post.slug, post.title, post.bodyHtml, post.publishedAt, post.canonical)
    );
  }
  if (statements.length) await env.BLOG_DB.batch(statements);

  await env.BLOG_DB.prepare(
    `INSERT INTO import_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(IMPORT_META_KEY, new Date().toISOString()).run();
}

function parseFeedItems(xml) {
  const posts = [];
  const items = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/g) || [];
  for (const item of items) {
    const title = extractXml(item, 'title');
    const link = extractXml(item, 'link');
    const pubDate = extractXml(item, 'pubDate');
    const content = extractXml(item, 'content:encoded');
    const description = extractXml(item, 'description');
    if (!title || !link) continue;
    const canonical = canonicalUrl(link);
    const slug = slugFromSubstack(link, title);
    const rawBody = content.trim() || (description ? `<p>${escapeHtml(description)}</p>` : '');
    const bodyHtml = normalizePostHtml(rawBody);
    if (!canonical || !slug || !bodyHtml) continue;
    posts.push({
      slug,
      title,
      bodyHtml,
      publishedAt: toSqliteUtc(pubDate),
      canonical,
    });
  }
  return posts;
}

function extractXml(block, tag) {
  const safe = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = block.match(new RegExp('<' + safe + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + safe + '>'));
  if (!m) return '';
  return unwrapXmlText(m[1]).trim();
}

function unwrapXmlText(raw) {
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/);
  if (cdata) return cdata[1];
  return decodeEntities(raw.trim());
}

function canonicalUrl(link) {
  try {
    const url = new URL(link.trim());
    if (url.protocol !== 'https:' || url.hostname !== 'nmood.substack.com') return '';
    url.hash = '';
    url.search = '';
    return url.toString();
  } catch {
    return '';
  }
}

function slugFromSubstack(link, title) {
  try {
    const path = new URL(link.trim()).pathname;
    const match = path.match(/\/p\/([^/]+)\/?$/);
    if (match) return slugify(decodeURIComponent(match[1]));
  } catch {
    // Fall through to the title.
  }
  return slugify(title);
}

function toSqliteUtc(pubDate) {
  const date = new Date(pubDate);
  const stamp = Number.isNaN(date.getTime()) ? new Date() : date;
  return stamp.toISOString().slice(0, 19).replace('T', ' ');
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

function formatDate(isoDate) {
  const d = new Date(isoDate.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pageShell(inner, title, description, options = {}) {
  const pageTitle = title === 'The Blog' ? 'Naeem Mahmood — Peak Performance for High Achievers' : `${escapeHtml(title)} | Naeem Mahmood`;
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
${options.canonical && /^https?:\/\//i.test(options.canonical) ? `<link rel="canonical" href="${escapeHtml(options.canonical)}">` : ''}
<meta name="description" content="Executive coaching for high performers who are winning on paper and losing everywhere that matters. Peak Mind. Peak Body. Peak Love.">
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
    <a class="nav__logo" href="/">Naeem<span>Mahmood</span></a>
    <div class="nav__links">
      <a class="nav__link" href="/speaking">Speaking</a>
      <a class="nav__link" href="/peakhuman/">Peak Human Protocol</a>
      <a class="nav__link" href="/podcast">Podcast</a>
      <a class="nav__link" href="/about">About</a>
      <a class="nav__link" href="/books">Books</a>
      <a class="nav__link" href="/blog">Blog</a>
      <a class="btn btn--primary btn--small" href="/breakthrough-call">Apply</a>
    </div>
    <button class="nav__toggle" aria-label="Toggle menu" aria-expanded="false">&#9776;</button>
  </div>
  <div class="nav__mobile container">
    <a class="nav__link" href="/speaking">Speaking</a>
    <a class="nav__link" href="/peakhuman/">Peak Human Protocol</a>
    <a class="nav__link" href="/podcast">Podcast</a>
    <a class="nav__link" href="/about">About</a>
    <a class="nav__link" href="/books">Books</a>
    <a class="nav__link" href="/blog">Blog</a>
    <a class="btn btn--primary btn--small" href="/breakthrough-call">Apply</a>
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
    <div class="container container--narrow">
      ${inner}
    </div>
  </section>

</main>

<footer class="site-footer">
  <div class="container">
    <div class="site-footer__grid">
      <span class="site-footer__copyright">&copy; Mood Ventures LLC | 2026</span>
      <div class="site-footer__links">
        <a href="/peakhuman/">Peak Human Protocol</a>
        <a href="/podcast">Podcast</a>
        <a href="/about">About</a>
        <a href="/speaking">Speaking</a>
        <a href="/books">Books</a>
        <a href="/blog">Blog</a>
      </div>
      <div class="site-footer__links">
        <a href="/breakthrough-call">Apply</a>
      </div>
    </div>
    <div class="footer-contact">
      <a class="footer-contact__phone" href="tel:+14154137426"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg><span>415-413-7426</span></a>
      <a href="mailto:team@naeemmahmood.com">team@naeemmahmood.com</a>
    </div>
    <p class="site-footer__tagline">The operating system underneath everything.</p>
  </div>
</footer>

<script src="/assets/js/main.js"></script>
</body>
</html>`;
}

export { normalizePostHtml };
