// Mobile nav toggle
document.querySelectorAll('.nav__toggle').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var panel = document.querySelector('.nav__mobile');
    if (!panel) return;
    var isOpen = panel.classList.toggle('is-open');
    btn.textContent = isOpen ? '✕' : '☰';
    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
});

// Click-to-load YouTube embeds
document.querySelectorAll('.video-embed').forEach(function (wrap) {
  var thumb = wrap.querySelector('.video-embed__thumb');
  if (!thumb) return;
  thumb.addEventListener('click', function () {
    var id = wrap.getAttribute('data-yt-id');
    var title = wrap.getAttribute('data-yt-title') || 'YouTube video player';
    var iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&modestbranding=1';
    iframe.title = title;
    iframe.loading = 'lazy';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    wrap.innerHTML = '';
    wrap.appendChild(iframe);
  });
});

// Scroll-triggered fade-ins
if ('IntersectionObserver' in window) {
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  document.querySelectorAll('.reveal').forEach(function (el) {
    observer.observe(el);
  });
} else {
  document.querySelectorAll('.reveal').forEach(function (el) {
    el.classList.add('is-visible');
  });
}
