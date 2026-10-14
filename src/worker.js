// Serves /blog from D1 (native posts and imported Substack letters) and
// /podcast from the Peak Humans RSS feed, Spotify show, and YouTube channel.
// An hourly cron imports the Substack feed, and /blog repeats that import
// when the last successful run is stale. Every other request falls through
// to static assets.
// POST /api/subscribe and the gift pop-up live in ./subscribe.js.

import { handleSubscribe, injectGiftPopup } from './subscribe.js';

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
    if (url.pathname === '/api/subscribe') return handleSubscribe(request, env);
    return injectGiftPopup(await route(request, env));
  },

  async scheduled(_controller, env, _ctx) {
    await importSubstackPosts(env);
  },
};

async function route(request, env) {
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

    if (path === '/podcast' || path === '/podcast/' || path === '/podcast.html') {
      return renderPodcast(request);
    }

    return env.ASSETS.fetch(request);
}

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
    const cls = tagAttr(raw, 'class');
    if (DROP_CLASSES.some((token) => hasClass(cls, token))) return true;
    if (/button|subscribe/i.test(tagAttr(raw, 'data-component-name'))) return true;
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
  return replaceBalanced(html, 'div', (raw) => hasClass(tagAttr(raw, 'class'), 'captioned-image-container'), (inner) => {
    const img = inner.match(/<img\b[^>]*>/i);
    if (!img) return '';
    return `<figure class="post-figure">${cleanImageTag(img[0])}</figure>`;
  });
}

function cleanImageTag(tag) {
  const src = tagAttr(tag, 'src').trim();
  if (!src || /^\s*javascript:/i.test(src)) return '';
  const alt = tagAttr(tag, 'alt');
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

function tagAttr(tag, name) {
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

// ---- Podcast ----
// Apple Podcasts id 1523759669. The RSS feed URL is looked up at request
// time (cached) so a host change does not require a code edit.
const APPLE_PODCAST_ID = '1523759669';
const ITUNES_LOOKUP_URL = `https://itunes.apple.com/lookup?id=${APPLE_PODCAST_ID}`;
const FALLBACK_PODCAST_FEED = 'https://anchor.fm/s/c2a01604/podcast/rss';
const SPOTIFY_SHOW_ID = '7GWOloL64hTzYc9Ej6bwCd';
const SPOTIFY_SHOW_URL = `https://open.spotify.com/show/${SPOTIFY_SHOW_ID}`;
const SPOTIFY_EMBED_URL = `https://open.spotify.com/embed/show/${SPOTIFY_SHOW_ID}`;
// Public episode listing for the same show (open.spotify.com does not publish
// the full episode list without an API token). Confirmed by the show id in
// the page payload, then merged onto the RSS catalog by episode UUID.
const SPOTIFY_CREATORS_URL = 'https://creators.spotify.com/pod/show/peakhumans';
// Channel UCX8yVR_m_pL3rzx-l6GRfQg (@NaeemSMahmood), resolved from the
// existing episode video 6NTLmvnrCSY. The public channel feed only returns
// the latest ~15 uploads, so older episodes are matched from the RSS catalog
// and the hand-listed videos below.
const YOUTUBE_CHANNEL_ID = 'UCX8yVR_m_pL3rzx-l6GRfQg';
const YOUTUBE_FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`;
const PODCAST_CACHE_SECONDS = 60 * 60;
const APPLE_PODCAST_URL = `https://podcasts.apple.com/us/podcast/peak-humans/id${APPLE_PODCAST_ID}`;

// YouTube videos that were hard-coded on public/podcast.html. Used when the
// channel feed (recent uploads only) does not include that episode.
const MANUAL_YOUTUBE = [
  { title: 'Be Iconic With Andrew Masanto', id: 'Bk7vc_cVHfI' },
  { title: 'The Art of the Heart with Salim Najjar', id: 'uI8nHUnzta8' },
  { title: 'Ageless Future With Regan Archibald', id: 'Xb2TysxpbcE' },
  { title: "You're A Lot Closer Than You Think with John O'Connor", id: 'wMqrSXMScmc' },
  { title: 'How to Raise Kids Who Jump Into Life with Brandon Webb', id: 'Nuv4MAA80F8' },
  { title: 'AI Acceleration and Business Transformation with Mike Koenigs', id: 'Kp0JOJiXAdE' },
  { title: 'Happy Life and Energy Mastery with Brett Harmeling', id: 'wrvL2Byiw5g' },
  { title: 'Beyond the Bottleneck with Jairek Robbins', id: 'e_WMvmB5_G8' },
  { title: 'Biological and Behavioral Mastery for High Performers with Jackson Hightower', id: 'K-tNnVKLNeo' },
  { title: 'Build Your AI Dream Team with Natalie MacNeil', id: 'GD27a7iToM0' },
  { title: "The High-Performer's Longevity Playbook with Billy Bosch", id: 'DMjGfe46YrI' },
  { title: 'From Welfare to Wealth with Christian Mickelsen', id: '_iYcajK6suE' },
  { title: 'Principles of Success with Jack Canfield', id: 'c71fXqRwCPw' },
  { title: 'Share Wisdom and Take Action with Taylor Conroy', id: 'NecXMrzDBBg' },
  { title: "It's All About the Ride with Scott Page", id: 'tVEg-y5mSPM' },
  { title: 'The Magic of Sharing with Zach Bell', id: '6NTLmvnrCSY' },
];

async function renderPodcast(request) {
  const cache = podcastCache();
  const pageRequest = new Request(new URL('/podcast', request.url).toString(), { method: 'GET' });
  if (cache) {
    try {
      const hit = await cache.match(pageRequest);
      if (hit) return hit;
    } catch (err) {
      console.error('podcast page cache read failed', err);
    }
  }

  let episodes = [];
  try {
    episodes = await loadPodcastEpisodes();
  } catch (err) {
    console.error('podcast feeds failed', err);
  }

  const html = podcastPage(episodes);
  const response = new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': `public, max-age=${PODCAST_CACHE_SECONDS}`,
    },
  });
  // Don't pin a feed-failure page in the edge cache for an hour.
  if (cache && episodes.length > MANUAL_YOUTUBE.length) {
    try {
      await cache.put(pageRequest, response.clone());
    } catch (err) {
      console.error('podcast page cache write failed', err);
    }
  }
  return response;
}

async function loadPodcastEpisodes() {
  let feedUrl = FALLBACK_PODCAST_FEED;
  try {
    const lookup = JSON.parse(await fetchCached(ITUNES_LOOKUP_URL));
    const podcast = (lookup.results || []).find((row) => row.feedUrl);
    if (podcast && /^https:\/\//.test(podcast.feedUrl)) feedUrl = podcast.feedUrl;
  } catch (err) {
    console.error('itunes lookup failed', err);
  }

  const [rssXml, ytXml, embedHtml, creatorsHtml] = await Promise.all([
    fetchCached(feedUrl).catch((err) => {
      console.error('podcast rss failed', err);
      return '';
    }),
    fetchCached(YOUTUBE_FEED_URL).catch((err) => {
      console.error('youtube feed failed', err);
      return '';
    }),
    fetchCached(SPOTIFY_EMBED_URL).catch((err) => {
      console.error('spotify embed failed', err);
      return '';
    }),
    fetchCached(SPOTIFY_CREATORS_URL).catch((err) => {
      console.error('spotify creators page failed', err);
      return '';
    }),
  ]);

  const rss = parsePodcastRss(rssXml);
  const spotify = [
    ...parseSpotifyCreators(creatorsHtml),
    ...parseSpotifyEmbed(embedHtml),
  ];
  const episodes = mergePodcastEpisodes(rss.episodes, spotify, rss.artwork);
  if (!episodes.length) return manualFallbackEpisodes();
  assignYouTube(episodes, parseYouTubeFeed(ytXml), MANUAL_YOUTUBE);
  episodes.sort((a, b) => (b.publishedMs || 0) - (a.publishedMs || 0));
  return episodes;
}

function manualFallbackEpisodes() {
  return MANUAL_YOUTUBE.map((video) => ({
    title: video.title,
    publishedMs: 0,
    dateLabel: '',
    description: '',
    artwork: youtubeThumb(video.id),
    audioUrl: '',
    youtubeId: video.id,
  }));
}

async function fetchCached(url) {
  const cache = podcastCache();
  const cacheKey = new Request(url, { method: 'GET' });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit.text();
  }
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; naeemmood-podcast/1.0; +https://naeemmood.com/podcast)',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html;q=0.9, */*;q=0.8',
    },
    cf: { cacheTtl: PODCAST_CACHE_SECONDS, cacheEverything: true },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  const text = await res.text();
  if (cache) {
    try {
      await cache.put(cacheKey, new Response(text, {
        headers: { 'Cache-Control': `public, max-age=${PODCAST_CACHE_SECONDS}` },
      }));
    } catch (err) {
      console.error('podcast feed cache write failed', err);
    }
  }
  return text;
}

function podcastCache() {
  try {
    return caches.default;
  } catch {
    return null;
  }
}

function parsePodcastRss(xml) {
  if (!xml || !xml.includes('<item')) return { artwork: '', episodes: [] };
  const channel = xml.split('<item>')[0];
  const artwork = attrValue(channel, 'itunes:image', 'href');
  const items = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/g) || [];
  const episodes = [];
  for (const item of items) {
    const title = decodeEntities(extractXml(item, 'title'));
    if (!title) continue;
    const pubDate = extractXml(item, 'pubDate');
    const publishedMs = Date.parse(pubDate);
    const description = extractXml(item, 'description') || extractXml(item, 'itunes:summary');
    episodes.push({
      title,
      guid: extractXml(item, 'guid'),
      publishedMs: Number.isNaN(publishedMs) ? 0 : publishedMs,
      dateLabel: formatPublished(pubDate),
      description: shortDescription(description),
      artwork: attrValue(item, 'itunes:image', 'href') || artwork,
      link: safeHttps(extractXml(item, 'link')),
      enclosure: safeHttps(attrValue(item, 'enclosure', 'url')),
      spotifyUrl: '',
      audioUrl: '',
      youtubeId: '',
    });
  }
  return { artwork, episodes };
}

function parseYouTubeFeed(xml) {
  if (!xml) return [];
  const entries = xml.match(/<entry\b[^>]*>[\s\S]*?<\/entry>/g) || [];
  const videos = [];
  for (const entry of entries) {
    const id = extractXml(entry, 'yt:videoId').trim();
    const title = decodeEntities(extractXml(entry, 'title'));
    if (!isYouTubeId(id) || !title) continue;
    videos.push({ id, title });
  }
  return videos;
}

function parseSpotifyCreators(html) {
  if (!html || !html.includes(SPOTIFY_SHOW_ID) || !html.includes('window.__STATE__')) return [];
  const marker = html.indexOf('window.__STATE__');
  const start = html.indexOf('{', marker);
  if (start < 0) return [];
  const json = sliceJsonObject(html, start);
  if (!json) return [];
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const list = data && data.episodePreview && data.episodePreview.episodes;
  if (!Array.isArray(list)) return [];
  return list.map((episode) => ({
    title: episode.title || '',
    uuid: episode.podcastEpisodeUuid || '',
    spotifyUrl: safeHttps(episode.spotifyUrl || ''),
    artwork: safeHttps(episode.episodeImage || ''),
    description: shortDescription(episode.descriptionPreview || episode.description || ''),
    publishedMs: Date.parse(episode.publishOn) || 0,
  })).filter((episode) => episode.title);
}

function parseSpotifyEmbed(html) {
  if (!html || !html.includes(SPOTIFY_SHOW_ID)) return [];
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return [];
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return [];
  }
  const entity = data && data.props && data.props.pageProps && data.props.pageProps.state
    && data.props.pageProps.state.data && data.props.pageProps.state.data.entity;
  if (!entity || entity.type !== 'episode') return [];
  const related = entity.relatedEntityUri || '';
  if (!related.includes(SPOTIFY_SHOW_ID)) return [];
  const images = (entity.visualIdentity && entity.visualIdentity.image) || [];
  const bestImage = images.reduce((best, image) => {
    if (!image || !image.url) return best;
    if (!best || (image.maxHeight || 0) > (best.maxHeight || 0)) return image;
    return best;
  }, null);
  const title = entity.title || entity.name || '';
  if (!title) return [];
  const episodeId = /^[A-Za-z0-9]+$/.test(entity.id || '') ? entity.id : '';
  return [{
    title,
    uuid: '',
    spotifyUrl: episodeId ? `https://open.spotify.com/episode/${episodeId}` : '',
    artwork: safeHttps((bestImage && bestImage.url) || ''),
    description: '',
    publishedMs: Date.parse(entity.releaseDate && entity.releaseDate.isoString) || 0,
  }];
}

function mergePodcastEpisodes(rssEpisodes, spotifyEpisodes, showArtwork) {
  const byUuid = new Map();
  const byTitle = new Map();
  for (const episode of rssEpisodes) {
    if (episode.guid) byUuid.set(episode.guid, episode);
    const key = normalizeTitle(episode.title);
    if (!key) continue;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(episode);
  }
  const titleCursor = new Map();
  for (const spotify of spotifyEpisodes) {
    let episode = spotify.uuid ? byUuid.get(spotify.uuid) : null;
    if (!episode) {
      const key = normalizeTitle(spotify.title);
      const list = byTitle.get(key) || [];
      const index = titleCursor.get(key) || 0;
      episode = list[index] || null;
      if (episode) titleCursor.set(key, index + 1);
    }
    if (episode) {
      if (!episode.spotifyUrl && spotify.spotifyUrl) episode.spotifyUrl = spotify.spotifyUrl;
      if (!episode.artwork && spotify.artwork) episode.artwork = spotify.artwork;
      if (!episode.description && spotify.description) episode.description = spotify.description;
      continue;
    }
    if (!spotify.title) continue;
    const created = {
      title: spotify.title,
      guid: spotify.uuid || '',
      publishedMs: spotify.publishedMs || 0,
      dateLabel: spotify.publishedMs ? formatPublished(spotify.publishedMs) : '',
      description: spotify.description || '',
      artwork: spotify.artwork || showArtwork || '',
      link: '',
      enclosure: '',
      spotifyUrl: spotify.spotifyUrl || '',
      audioUrl: '',
      youtubeId: '',
    };
    rssEpisodes.push(created);
    if (created.guid) byUuid.set(created.guid, created);
  }
  for (const episode of rssEpisodes) {
    if (!episode.artwork) episode.artwork = showArtwork || '';
    episode.audioUrl = episode.spotifyUrl || episode.link || episode.enclosure || '';
  }
  return rssEpisodes;
}

function assignYouTube(episodes, feedVideos, manualVideos) {
  const usedFeed = new Set();
  assignExactTitle(episodes, feedVideos, usedFeed);
  assignContainedTitle(episodes, feedVideos, usedFeed);
  const usedManual = new Set();
  assignExactTitle(episodes, manualVideos, usedManual);
  assignContainedTitle(episodes, manualVideos, usedManual);
}

function assignExactTitle(episodes, videos, used) {
  const byKey = new Map();
  for (const video of videos) {
    if (!isYouTubeId(video.id) || used.has(video.id)) continue;
    const key = normalizeTitle(video.title);
    if (key && !byKey.has(key)) byKey.set(key, video);
  }
  for (const episode of episodes) {
    if (episode.youtubeId) continue;
    const video = byKey.get(normalizeTitle(episode.title));
    if (!video || used.has(video.id)) continue;
    episode.youtubeId = video.id;
    used.add(video.id);
  }
}

function assignContainedTitle(episodes, videos, used) {
  for (const episode of episodes) {
    if (episode.youtubeId) continue;
    const key = normalizeTitle(episode.title);
    if (!key) continue;
    let best = null;
    let bestScore = Infinity;
    for (const video of videos) {
      if (!isYouTubeId(video.id) || used.has(video.id)) continue;
      const videoKey = normalizeTitle(video.title);
      if (!videoKey || videoKey === key) continue;
      const short = videoKey.length <= key.length ? videoKey : key;
      const long = videoKey.length <= key.length ? key : videoKey;
      if (short.length < 18 || !long.includes(short)) continue;
      const score = long.length - short.length;
      if (score < bestScore) {
        best = video;
        bestScore = score;
      }
    }
    if (!best) continue;
    episode.youtubeId = best.id;
    used.add(best.id);
  }
}

function normalizeTitle(title) {
  return decodeEntities(String(title || ''))
    .toLowerCase()
    .replace(/\b(?:ep|episode)\s*#?\s*\d+\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortDescription(html) {
  let text = String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text).replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '').replace(/\s+/g, ' ').trim();
  const cut = text.search(/\b(?:work with naeem|subscribe \+|about naeem|connect with naeem|i would really appreciate|interested in sponsoring)\b|\*{5,}/i);
  if (cut > 40) text = text.slice(0, cut).trim();
  if (text.length > 280) {
    const slice = text.slice(0, 277);
    const last = slice.lastIndexOf(' ');
    text = (last > 180 ? slice.slice(0, last) : slice).trim() + '…';
  }
  return text;
}

function formatPublished(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function attrValue(block, tag, name) {
  const safeTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp('<' + safeTag + '\\b[^>]*\\s' + safeName + '="([^"]*)"', 'i'));
  return match ? decodeEntities(match[1]) : '';
}

function sliceJsonObject(text, start) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

function safeHttps(url) {
  const value = String(url || '').trim();
  if (!/^https:\/\//i.test(value)) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function isYouTubeId(id) {
  return /^[A-Za-z0-9_-]{11}$/.test(id || '');
}

function youtubeThumb(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function podcastPage(episodes) {
  const cards = episodes.length
    ? episodes.map(episodeCard).join('\n')
    : '<p class="episode-card__desc">Episodes are temporarily unavailable. Use the Apple Podcasts or Spotify buttons above.</p>';
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
<!-- Meta Pixel Code -->
<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js'); fbq('init', '1361900318899592'); fbq('track', 'PageView');</script>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=1361900318899592&ev=PageView&noscript=1"/></noscript>
<!-- End Meta Pixel Code -->
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Naeem Mahmood: Peak Performance for High Achievers</title>
<meta name="description" content="Executive coaching for high performers who are winning on paper and losing everywhere that matters. Peak Mind. Peak Body. Peak Love.">
<meta name="author" content="Naeem Mahmood">
<link rel="icon" type="image/svg+xml" href="/assets/img/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/styles.css">
<style>
  .video-embed-card { min-width: 0; max-width: 100%; }
  .episode-card__desc,
  .video-embed-card__title,
  .episode-card__audio { overflow-wrap: anywhere; }
  .episode-card__date {
    margin: 0.35rem 0 0;
    font-size: 0.8rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }
  .episode-card__desc {
    margin: 0.55rem 0 0;
    font-size: 0.92rem;
    color: var(--color-text-muted);
  }
  .episode-card__audio {
    display: inline-block;
    margin-top: 0.75rem;
    color: var(--color-accent);
    font-weight: 600;
    text-decoration: none;
  }
  .video-embed__thumb img,
  .episode-card__art img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .episode-card__art { display: block; }
</style>
</head>
<body>

<a class="skip-link" href="#main">Skip to content</a>

<nav class="nav">
  <div class="container nav__inner">
    <a class="nav__logo" href="/">Naeem<span>Mahmood</span></a>
    <div class="nav__links">
      <a class="nav__link" href="/speaking.html">Speaking</a>
      <a class="nav__link" href="/peakhuman/">Peak Human Protocol</a>
      <a class="nav__link" href="/podcast">Podcast</a>
      <a class="nav__link" href="/about.html">About</a>
      <a class="nav__link" href="/books.html">Books</a>
      <a class="nav__link" href="/blog">Blog</a>
      <a class="btn btn--primary btn--small" href="/breakthrough-call.html">Apply</a>
    </div>
    <button class="nav__toggle" aria-label="Toggle menu" aria-expanded="false">&#9776;</button>
  </div>
  <div class="nav__mobile container">
    <a class="nav__link" href="/speaking.html">Speaking</a>
    <a class="nav__link" href="/peakhuman/">Peak Human Protocol</a>
    <a class="nav__link" href="/podcast">Podcast</a>
    <a class="nav__link" href="/about.html">About</a>
    <a class="nav__link" href="/books.html">Books</a>
    <a class="nav__link" href="/blog">Blog</a>
    <a class="btn btn--primary btn--small" href="/breakthrough-call.html">Apply</a>
  </div>
</nav>

<main id="main">

  <section class="hero">
    <div class="container hero__inner reveal">
      <h1>Peak Humans Podcast</h1>
      <p class="hero__subtitle">Conversations on mastering the art of peak performance.</p>
    </div>
  </section>

  <section class="section--alt">
    <div class="container container--narrow reveal" style="text-align:center;">
      <h2>Listen wherever you are.</h2>
      <div class="listen-row">
        <a class="btn btn--primary" href="${APPLE_PODCAST_URL}" target="_blank" rel="noopener">Listen on Apple Podcasts</a>
        <a class="btn btn--primary" href="${SPOTIFY_SHOW_URL}" target="_blank" rel="noopener">Listen on Spotify</a>
      </div>
    </div>
  </section>

  <section>
    <div class="container reveal">
      <h2>Episodes.</h2>
      <div class="video-grid video-grid--roomy">
        ${cards}
      </div>
    </div>
  </section>

  <section class="section--alt">
    <div class="container container--narrow reveal" style="text-align:center;">
      <h2>Want to go deeper?</h2>
      <a class="btn btn--primary" href="/breakthrough-call.html">Apply for a Breakthrough Call &rarr;</a>
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
        <a href="/about.html">About</a>
        <a href="/speaking.html">Speaking</a>
        <a href="/books.html">Books</a>
        <a href="/blog">Blog</a>
      </div>
      <div class="site-footer__links">
        <a href="/breakthrough-call.html">Apply</a>
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
  return body;
}

function episodeCard(episode) {
  const title = escapeHtml(episode.title);
  const date = episode.dateLabel ? `<p class="episode-card__date">${escapeHtml(episode.dateLabel)}</p>` : '';
  const description = episode.description ? `<p class="episode-card__desc">${escapeHtml(episode.description)}</p>` : '';
  const media = episode.youtubeId
    ? youtubeEmbed(episode)
    : audioArt(episode);
  const audio = !episode.youtubeId && episode.audioUrl
    ? `<a class="episode-card__audio" href="${escapeHtml(episode.audioUrl)}" target="_blank" rel="noopener">${episode.spotifyUrl ? 'Listen on Spotify' : 'Play audio'}</a>`
    : '';
  return `<div class="video-embed-card">
          ${media}
          <p class="video-embed-card__title">${title}</p>
          ${date}
          ${description}
          ${audio}
        </div>`;
}

function youtubeEmbed(episode) {
  const id = episode.youtubeId;
  const title = escapeHtml(episode.title);
  return `<div class="video-embed" data-yt-id="${id}" data-yt-title="${title}">
            <button class="video-embed__thumb" type="button" aria-label="Play ${title}">
              <img src="${youtubeThumb(id)}" alt="" loading="lazy">
              <span class="video-embed__play">&#9658;</span>
            </button>
          </div>`;
}

function audioArt(episode) {
  const title = escapeHtml(episode.title);
  const image = episode.artwork
    ? `<img src="${escapeHtml(episode.artwork)}" alt="" loading="lazy">`
    : '';
  if (episode.audioUrl) {
    return `<a class="video-embed episode-card__art" href="${escapeHtml(episode.audioUrl)}" target="_blank" rel="noopener" aria-label="Listen to ${title}">
            ${image}
            <span class="video-embed__play">&#9658;</span>
          </a>`;
  }
  return `<div class="video-embed episode-card__art" aria-hidden="true">${image}</div>`;
}
