// Peak Humans Daily Protocol opt-in.
// Shows after 15s, at 50% scroll, or on desktop exit intent.
// Dismiss hides it for 14 days. A signup hides it for good.
(function () {
  if (window.__phGiftPopup) return;
  window.__phGiftPopup = true;
  if (location.pathname.indexOf('/admin') === 0) return;

  var SUB_KEY = 'ph-daily-protocol-subscribed';
  var DISMISS_KEY = 'ph-daily-protocol-dismissed';
  var SHOW_DELAY_MS = 15000;
  var SCROLL_RATIO = 0.5;
  var DISMISS_FOR_MS = 14 * 24 * 60 * 60 * 1000;
  var PDF_FALLBACK = '/gifts/peak-humans-daily-protocol.pdf';

  if (alreadyDone()) return;

  var link = document.createElement('link');
  link.id = 'gift-popup-css';
  link.rel = 'stylesheet';
  link.href = '/assets/css/gift-popup.css';
  document.head.appendChild(link);

  // Solid card colors before the stylesheet arrives, so the dialog never
  // paints as transparent text over the page.
  var critical = document.createElement('style');
  critical.textContent = [
    'dialog.gift-popup{background:transparent;color:#f5f5f5;border:0;padding:0}',
    'dialog.gift-popup .gift-popup__card{background:#141414;color:#f5f5f5;border:1px solid rgba(245,245,245,.12);border-radius:16px;padding:2.25rem 1.75rem 1.75rem}',
    'dialog.gift-popup .gift-popup__card h2{color:#fff;font-family:Georgia,serif}',
    'dialog.gift-popup .gift-popup__input{background:#0a0a0a;color:#fff;border:1px solid rgba(245,245,245,.2);font-size:16px}',
    'dialog.gift-popup .gift-popup__submit,dialog.gift-popup .gift-popup__download{background:#00f0ff;color:#0a0a0a}'
  ].join('');
  document.head.appendChild(critical);

  var dialog = null;
  var opened = false;
  var previousFocus = null;
  var timer = 0;
  var desktopExit = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 900px)').matches;

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (err) { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (err) { /* private mode */ }
  }

  function alreadyDone() {
    if (storageGet(SUB_KEY) === '1') return true;
    var dismissed = storageGet(DISMISS_KEY);
    if (!dismissed) return false;
    var at = Date.parse(dismissed);
    if (Number.isNaN(at)) return false;
    return Date.now() - at < DISMISS_FOR_MS;
  }

  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'gift-popup';
    dialog.setAttribute('aria-labelledby', 'gift-popup-title');
    dialog.innerHTML = [
      '<div class="gift-popup__card">',
      '<button class="gift-popup__close" type="button" aria-label="Close">&times;</button>',
      '<p class="gift-popup__eyebrow">Free gift</p>',
      '<h2 id="gift-popup-title">Get The Peak Humans Daily Protocol</h2>',
      '<p class="gift-popup__lead">A simple daily system for energy, focus, and presence.</p>',
      '<form class="gift-popup__form" novalidate>',
      '<label class="gift-popup__label" for="gift-first-name">First name <span>optional</span>',
      '<input class="gift-popup__input" id="gift-first-name" name="first_name" type="text" autocomplete="given-name" maxlength="80">',
      '</label>',
      '<label class="gift-popup__label" for="gift-email">Email',
      '<input class="gift-popup__input" id="gift-email" name="email" type="email" autocomplete="email" inputmode="email" required maxlength="254">',
      '</label>',
      '<button class="gift-popup__submit" type="submit">Send me the protocol</button>',
      '<p class="gift-popup__error" role="alert" aria-live="polite"></p>',
      '<p class="gift-popup__note">No spam. Unsubscribe any time.</p>',
      '</form>',
      '<div class="gift-popup__thanks" hidden>',
      '<p>Download The Peak Humans Daily Protocol now. A copy is also coming to your inbox.</p>',
      '<a class="gift-popup__download" href="' + PDF_FALLBACK + '" target="_blank" rel="noopener">Download the PDF</a>',
      '</div>',
      '</div>'
    ].join('');
    document.body.appendChild(dialog);

    dialog.querySelector('.gift-popup__close').addEventListener('click', dismiss);
    dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      dismiss();
    });
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) dismiss();
    });
    dialog.addEventListener('keydown', trapTab);
    dialog.querySelector('form').addEventListener('submit', onSubmit);
  }

  function cssApplied() {
    try {
      return !!(link.sheet && link.sheet.cssRules && link.sheet.cssRules.length);
    } catch (err) {
      return false;
    }
  }

  function whenCssReady(fn) {
    if (cssApplied()) {
      fn();
      return;
    }
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      fn();
    }
    link.addEventListener('load', finish, { once: true });
    link.addEventListener('error', finish, { once: true });
    // A cached sheet can finish before this listener is attached.
    if (cssApplied()) finish();
  }

  function openPopup() {
    if (opened || alreadyDone()) return;
    opened = true;
    clearTriggers();
    whenCssReady(function () {
      if (!dialog) build();
      previousFocus = document.activeElement;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      document.body.style.overflow = 'hidden';
      var first = dialog.querySelector('#gift-first-name');
      if (first) first.focus();
    });
  }

  function closeDialog() {
    if (!dialog) return;
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    document.body.style.overflow = '';
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
  }

  function dismiss() {
    if (storageGet(SUB_KEY) !== '1') storageSet(DISMISS_KEY, new Date().toISOString());
    closeDialog();
  }

  function focusable() {
    return Array.prototype.filter.call(
      dialog.querySelectorAll('a, button, input, textarea, select, [tabindex]:not([tabindex="-1"])'),
      function (el) {
        if (el.disabled) return false;
        if (el.closest('[hidden]')) return false;
        return el.getClientRects().length > 0;
      }
    );
  }

  function trapTab(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key !== 'Tab' || !dialog) return;
    var items = focusable();
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function showThanks(downloadUrl) {
    storageSet(SUB_KEY, '1');
    var form = dialog.querySelector('.gift-popup__form');
    var thanks = dialog.querySelector('.gift-popup__thanks');
    var lead = dialog.querySelector('.gift-popup__lead');
    var title = dialog.querySelector('#gift-popup-title');
    form.hidden = true;
    if (lead) lead.hidden = true;
    thanks.hidden = false;
    title.textContent = 'Your protocol is ready';
    var linkEl = thanks.querySelector('a');
    // Open the PDF in a new tab. Do not assign window.location or follow the
    // link in this page; the thank-you message has to stay visible.
    linkEl.href = downloadUrl || PDF_FALLBACK;
    linkEl.target = '_blank';
    linkEl.rel = 'noopener';
    linkEl.removeAttribute('download');
    linkEl.focus();
  }

  function onSubmit(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var error = form.querySelector('.gift-popup__error');
    var button = form.querySelector('.gift-popup__submit');
    var email = form.email.value.trim();
    var firstName = form.first_name.value.trim();
    error.textContent = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      error.textContent = 'Enter a valid email address.';
      form.email.focus();
      return;
    }
    button.disabled = true;
    button.textContent = 'Sending...';
    fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        email: email,
        first_name: firstName,
        source: location.pathname
      })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Please try again.');
        showThanks(data.downloadUrl);
      });
    }).catch(function (err) {
      error.textContent = err.message || 'Please try again.';
      button.disabled = false;
      button.textContent = 'Send me the protocol';
    });
  }

  function scrollRatio() {
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    if (max <= 0) return 0;
    return window.scrollY / max;
  }

  function onScroll() {
    if (scrollRatio() >= SCROLL_RATIO) openPopup();
  }

  function onExit(event) {
    if (!armed) return;
    if (event.clientY > 8) return;
    if (event.relatedTarget || event.toElement) return;
    openPopup();
  }

  var armed = false;
  function armExit() { armed = true; }

  function clearTriggers() {
    window.clearTimeout(timer);
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('mouseout', onExit);
    document.removeEventListener('mouseover', armExit);
  }

  timer = window.setTimeout(openPopup, SHOW_DELAY_MS);
  window.addEventListener('scroll', onScroll, { passive: true });
  if (scrollRatio() >= SCROLL_RATIO) openPopup();
  if (desktopExit) {
    document.addEventListener('mouseover', armExit, { once: true });
    document.addEventListener('mouseout', onExit);
  }
})();
