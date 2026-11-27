(function () {
  // Saved progress. Bumped from ph-peak-wheel-v2 when the wheel moved to the
  // seven Wheel of Life areas, so an in-progress eight-area session does not
  // resume. The quiz keeps this in sessionStorage. The old key is also cleared
  // from localStorage in case a previous session wrote it there.
  var STORAGE_KEY = 'ph-peak-wheel-v3';
  var RETIRED_PROGRESS_KEYS = ['ph-peak-wheel-v2'];

  // Wheel of Life areas, in Naeem's order. Use these names everywhere.
  var AREAS = [
    {
      id: 'physical-body',
      label: 'Physical Body',
      hint: 'Health, energy, and vitality.',
      followup: 'What would help your body feel healthier and more alive?',
      cost: 'A gap here usually means health, energy, or vitality is below where you want it. The day feels heavier, and you have less to give the rest of your life.'
    },
    {
      id: 'emotions-meaning',
      label: 'Emotions and Meaning',
      hint: 'This is the master area, because emotions run every other choice. Rate how well you find joy and positive meaning, even when circumstances are hard.',
      followup: 'When circumstances are hard, what helps you find joy and positive meaning?',
      cost: 'Emotions run every other choice on this wheel. A gap here usually means hard days take the joy and the positive meaning you use to choose well everywhere else.'
    },
    {
      id: 'relationships',
      label: 'Relationships',
      hint: 'Rate the one intimate relationship with the greatest emotional impact. Leave family and friends out of this score.',
      followup: 'In that one relationship, what would help it feel stronger?',
      cost: 'This score is the one intimate relationship with the greatest emotional impact. A gap here usually means that bond is getting less of you than it needs.'
    },
    {
      id: 'time',
      label: 'Time',
      hint: 'How you experience the hours you are given, and how you use them.',
      followup: 'What would help you experience and use your hours the way you want?',
      cost: 'A gap here usually means the hours slip away from you. Time feels rushed, scattered, or spent on things that do not match what you care about.'
    },
    {
      id: 'work-career-mission',
      label: 'Work, Career and Mission',
      hint: 'Name which one this is for you, then rate where you are in it.',
      followup: 'What would make this work a better fit for the life you want?',
      choices: [
        { id: 'job', label: 'A job I have to do' },
        { id: 'career', label: 'A career I\'ve chosen' },
        { id: 'mission', label: 'A mission that gives me unlimited energy' }
      ],
      costFor: function (kind) {
        if (kind === 'job') return 'You named this as a job you have to do. A gap here usually means the work drains you and leaves less of you for the rest of your life.';
        if (kind === 'career') return 'You named this as a career you have chosen. A gap here usually means the path is moving, but it is not yet work you are glad to build.';
        if (kind === 'mission') return 'You named this as a mission, work that can give you unlimited energy. A gap here usually means that energy is blocked, unclear, or used up.';
        return 'A gap here usually means the work is taking more than it gives. It may be a job you have to do, a career you have chosen, or a mission that gives you unlimited energy.';
      }
    },
    {
      id: 'finances',
      label: 'Finances',
      hint: 'Money serves the rest of your life. It does not lead.',
      followup: 'What would help your money support the rest of your life?',
      cost: 'Money is here to serve the other areas. It does not lead them. A gap here usually means money stress is steering choices that belong to the rest of your life.'
    },
    {
      id: 'celebrate-contribute',
      label: 'Celebrate and Contribute',
      hint: 'How often you celebrate the good in your life, and how often you give beyond yourself.',
      followup: 'What good have you stopped celebrating, or where could you give more?',
      cost: 'A gap here usually means celebration and giving have gone quiet. Good things pass without being marked, and less of you reaches beyond your own goals.'
    }
  ];

  var AT_PEAK = 'This area is at your peak. The standard you hold here can steady the rest of the wheel.';
  var COST_WHEN_CLOSE = 'This is close to your peak. A little more care here closes the small distance left to the standard you want.';

  dropRetiredProgress();
  var state = loadState();

  function dropRetiredProgress() {
    RETIRED_PROGRESS_KEYS.forEach(function (key) {
      try { sessionStorage.removeItem(key); } catch (err) {}
      try { localStorage.removeItem(key); } catch (err) {}
    });
  }

  function loadState() {
    var fresh = { screen: 'hero', index: 0, ratings: {}, notes: {}, kinds: {}, lead: null, submitted: false };
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return fresh;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return fresh;
      data.ratings = data.ratings || {};
      data.notes = data.notes || {};
      data.kinds = data.kinds && typeof data.kinds === 'object' ? data.kinds : {};
      if (typeof data.index !== 'number' || data.index < 0 || data.index >= AREAS.length) data.index = 0;
      return data;
    } catch (err) {
      return fresh;
    }
  }

  function saveState() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        screen: state.screen,
        index: state.index,
        ratings: state.ratings,
        notes: state.notes,
        kinds: state.kinds,
        lead: state.lead,
        submitted: state.submitted
      }));
    } catch (err) {
      // Private mode can block storage. The assessment still runs in memory.
    }
  }

  function formatScore(n) {
    var rounded = Math.round(Number(n) * 10) / 10;
    if (!isFinite(rounded)) return '0';
    if (Math.abs(rounded - Math.round(rounded)) < 0.001) return String(Math.round(rounded));
    return rounded.toFixed(1);
  }

  // 0 is a real score. Only a missing rating is skipped.
  function ratingNumber(ratings, id) {
    if (!ratings || !Object.prototype.hasOwnProperty.call(ratings, id)) return null;
    var value = Number(ratings[id]);
    if (!isFinite(value)) return null;
    return Math.max(0, Math.min(10, value));
  }

  function peakScore(ratings) {
    var sum = 0;
    var count = 0;
    AREAS.forEach(function (area) {
      var value = ratingNumber(ratings, area.id);
      if (value == null) return;
      sum += value;
      count += 1;
    });
    if (!count) return 0;
    return Math.round((sum / count) * 10) / 10;
  }

  function kindLabel(area, kind) {
    if (!area || !area.choices) return '';
    for (var i = 0; i < area.choices.length; i++) {
      if (area.choices[i].id === kind) return area.choices[i].label;
    }
    return '';
  }

  function gapCopy(area, score, kind) {
    if (score >= 10) return AT_PEAK;
    if (score >= 8) return COST_WHEN_CLOSE;
    if (typeof area.costFor === 'function') return area.costFor(kind);
    return area.cost;
  }

  function biggestGaps(ratings, kinds) {
    kinds = kinds || {};
    var ranked = AREAS.map(function (area, index) {
      var value = ratingNumber(ratings, area.id);
      return { area: area, index: index, score: value == null ? 0 : value };
    });
    ranked.sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      return a.index - b.index;
    });
    return ranked.slice(0, 2).map(function (item) {
      var kind = kinds[item.area.id] || '';
      return {
        id: item.area.id,
        label: item.area.label,
        score: item.score,
        kind: kind,
        kindLabel: kindLabel(item.area, kind),
        cost: gapCopy(item.area, item.score, kind)
      };
    });
  }

  function scoresPayload(ratings, notes, kinds) {
    var out = {};
    AREAS.forEach(function (area) {
      var value = ratingNumber(ratings, area.id);
      var entry = {
        label: area.label,
        score: value == null ? 0 : value,
        note: String(notes[area.id] || '').trim()
      };
      if (area.choices) {
        var kind = kinds[area.id] || '';
        entry.kind = kind;
        entry.kindLabel = kindLabel(area, kind);
      }
      out[area.id] = entry;
    });
    return out;
  }

  function validEmail(value) {
    if (value.length < 6 || value.length > 254) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function validPhone(value) {
    if (!value) return true;
    if (!/^[0-9+\-().\s]+$/.test(value)) return false;
    var digits = value.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15;
  }

  function postLead(payload) {
    var endpoint = String(window.LEAD_ENDPOINT || '').trim();
    if (!endpoint) return Promise.resolve();
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 6000) : 0;
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error('status');
    }).catch(function () {
      return null;
    }).then(function () {
      if (timer) clearTimeout(timer);
    });
  }

  function setSlider(value) {
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    var slider = document.getElementById('pw-slider');
    slider.style.setProperty('--n', String(n));
    slider.setAttribute('aria-valuenow', String(n));
    slider.setAttribute('aria-valuetext', n + ' out of 10');
    document.getElementById('pw-value').textContent = String(n);
  }

  function selectedKind() {
    var selected = document.querySelector('#pw-choice input:checked');
    return selected ? selected.value : '';
  }

  function captureQuestion() {
    var area = AREAS[state.index];
    var raw = Number(document.getElementById('pw-slider').value);
    state.ratings[area.id] = isFinite(raw) ? raw : 0;
    state.notes[area.id] = document.getElementById('pw-note').value.replace(/\s+/g, ' ').trim().slice(0, 180);
    if (area.choices) state.kinds[area.id] = selectedKind();
  }

  function renderChoices(area) {
    var box = document.getElementById('pw-choice');
    box.textContent = '';
    if (!area.choices) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    var legend = document.createElement('legend');
    legend.textContent = 'Which one is this for you?';
    box.appendChild(legend);
    area.choices.forEach(function (choice) {
      var label = document.createElement('label');
      label.className = 'pw-choice__opt';
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'pw-kind';
      input.value = choice.id;
      input.checked = state.kinds[area.id] === choice.id;
      var span = document.createElement('span');
      span.textContent = choice.label;
      label.appendChild(input);
      label.appendChild(span);
      box.appendChild(label);
    });
  }

  function renderQuestion() {
    var area = AREAS[state.index];
    var stored = ratingNumber(state.ratings, area.id);
    var value = stored == null ? 5 : stored;
    document.getElementById('pw-step').textContent = 'Area ' + (state.index + 1) + ' of ' + AREAS.length;
    document.getElementById('pw-bar').style.width = (((state.index + 1) / AREAS.length) * 100) + '%';
    var progress = document.getElementById('pw-progress');
    progress.setAttribute('aria-valuenow', String(state.index + 1));
    progress.setAttribute('aria-valuemax', String(AREAS.length));
    progress.setAttribute('aria-valuetext', 'Area ' + (state.index + 1) + ' of ' + AREAS.length + ': ' + area.label);
    document.getElementById('pw-area').textContent = area.label;
    document.getElementById('pw-hint').textContent = area.hint;
    document.getElementById('pw-follow-label').textContent = area.followup;
    document.getElementById('pw-note').value = state.notes[area.id] || '';
    document.getElementById('pw-qerror').textContent = '';
    renderChoices(area);
    var slider = document.getElementById('pw-slider');
    slider.value = String(value);
    setSlider(value);
    document.getElementById('pw-next').textContent = state.index === AREAS.length - 1 ? 'Continue' : 'Next';
    document.title = area.label + ' | Peak Wheel';
  }

  function point(index, dist, cx, cy) {
    var angle = -Math.PI / 2 + (index * 2 * Math.PI) / AREAS.length;
    return [cx + dist * Math.cos(angle), cy + dist * Math.sin(angle)];
  }

  function chartSvg(ratings) {
    var cx = 300;
    var cy = 250;
    var radius = 150;
    var rings = [0.25, 0.5, 0.75, 1];
    var parts = [];
    parts.push('<svg viewBox="0 0 600 500" role="img" aria-labelledby="pw-chart-title pw-chart-desc">');
    parts.push('<title id="pw-chart-title">Peak Wheel</title>');
    parts.push('<desc id="pw-chart-desc">A radar chart of your seven self-ratings, from 0 to 10. Area 1 starts at the top and the numbers continue clockwise.</desc>');
    rings.forEach(function (scale) {
      var ring = AREAS.map(function (_, index) {
        var p = point(index, radius * scale, cx, cy);
        return p[0].toFixed(1) + ',' + p[1].toFixed(1);
      }).join(' ');
      parts.push('<polygon points="' + ring + '" fill="none" stroke="rgba(245,245,245,0.16)" stroke-width="1"></polygon>');
    });
    AREAS.forEach(function (_, index) {
      var outer = point(index, radius, cx, cy);
      parts.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + outer[0].toFixed(1) + '" y2="' + outer[1].toFixed(1) + '" stroke="rgba(245,245,245,0.16)" stroke-width="1"></line>');
    });
    var shape = AREAS.map(function (area, index) {
      var score = ratingNumber(ratings, area.id);
      if (score == null) score = 0;
      var p = point(index, radius * (score / 10), cx, cy);
      return p[0].toFixed(1) + ',' + p[1].toFixed(1);
    }).join(' ');
    parts.push('<polygon points="' + shape + '" fill="rgba(0,240,255,0.30)" stroke="#00f0ff" stroke-width="2.5" stroke-linejoin="round"></polygon>');
    AREAS.forEach(function (area, index) {
      var score = ratingNumber(ratings, area.id);
      if (score == null) score = 0;
      var p = point(index, radius * (score / 10), cx, cy);
      var label = point(index, radius + 28, cx, cy);
      parts.push('<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="5" fill="#00f0ff"></circle>');
      parts.push('<text x="' + label[0].toFixed(1) + '" y="' + (label[1] + 5).toFixed(1) + '" text-anchor="middle" fill="#f5f5f5" font-size="15" font-family="Inter, sans-serif" font-weight="700">' + (index + 1) + '</text>');
    });
    parts.push('</svg>');
    return parts.join('');
  }

  function renderResults() {
    var peak = peakScore(state.ratings);
    var gaps = biggestGaps(state.ratings, state.kinds);
    var name = state.lead && state.lead.firstName ? state.lead.firstName : '';
    document.getElementById('pw-hello').textContent = name ? (name + ', here is your Peak Wheel.') : 'Here is your Peak Wheel.';
    document.getElementById('pw-peak').textContent = formatScore(peak);
    document.getElementById('pw-chart').innerHTML = chartSvg(state.ratings);
    var gapIds = {};
    gaps.forEach(function (gap) { gapIds[gap.id] = true; });

    var list = document.getElementById('pw-scorelist');
    list.textContent = '';
    AREAS.forEach(function (area, index) {
      var li = document.createElement('li');
      if (gapIds[area.id]) li.className = 'is-gap';
      var span = document.createElement('span');
      var num = document.createElement('i');
      num.textContent = String(index + 1);
      span.appendChild(num);
      span.appendChild(document.createTextNode(area.label));
      var named = kindLabel(area, state.kinds[area.id]);
      if (named) {
        var kind = document.createElement('em');
        kind.className = 'pw-kind';
        kind.textContent = named;
        span.appendChild(kind);
      }
      if (gapIds[area.id]) {
        var tag = document.createElement('em');
        tag.textContent = 'Biggest gap';
        span.appendChild(tag);
      }
      var score = document.createElement('b');
      var value = ratingNumber(state.ratings, area.id);
      score.textContent = String(value == null ? 0 : value);
      li.appendChild(span);
      li.appendChild(score);
      list.appendChild(li);
    });

    var wrap = document.getElementById('pw-gaps');
    wrap.textContent = '';
    gaps.forEach(function (gap) {
      var card = document.createElement('article');
      card.className = 'pw-gap';
      var heading = document.createElement('h3');
      heading.textContent = gap.label;
      var score = document.createElement('p');
      score.className = 'pw-gap__score';
      score.textContent = formatScore(gap.score) + ' out of 10';
      card.appendChild(heading);
      card.appendChild(score);
      if (gap.kindLabel) {
        var namedLine = document.createElement('p');
        namedLine.className = 'pw-gap__kind';
        namedLine.textContent = gap.kindLabel;
        card.appendChild(namedLine);
      }
      var copy = document.createElement('p');
      copy.textContent = gap.cost;
      card.appendChild(copy);
      wrap.appendChild(card);
    });
    document.title = 'Your Peak Score | Peak Humans';
  }

  function showScreen(name) {
    state.screen = name;
    ['hero', 'question', 'gate', 'results'].forEach(function (id) {
      document.getElementById('pw-' + id).hidden = id !== name;
    });
    if (name === 'hero') document.title = 'Free Peak Wheel Score | Peak Humans';
    if (name === 'question') renderQuestion();
    if (name === 'gate') document.title = 'See your Peak Wheel | Peak Humans';
    if (name === 'results') renderResults();
    saveState();
    var heading = document.getElementById('pw-' + name).querySelector('h1, h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    window.scrollTo(0, 0);
  }

  document.getElementById('pw-start').addEventListener('click', function () {
    state.index = 0;
    showScreen('question');
  });

  document.getElementById('pw-slider').addEventListener('input', function (event) {
    setSlider(event.target.value);
  });

  document.getElementById('pw-choice').addEventListener('change', function () {
    if (selectedKind()) document.getElementById('pw-qerror').textContent = '';
  });

  document.getElementById('pw-qform').addEventListener('submit', function (event) {
    event.preventDefault();
    var area = AREAS[state.index];
    if (area.choices && !selectedKind()) {
      document.getElementById('pw-qerror').textContent = 'Choose whether this is a job, a career, or a mission.';
      var first = document.querySelector('#pw-choice input');
      if (first) first.focus();
      return;
    }
    captureQuestion();
    if (state.index < AREAS.length - 1) {
      state.index += 1;
      showScreen('question');
      return;
    }
    showScreen('gate');
  });

  document.getElementById('pw-back').addEventListener('click', function () {
    captureQuestion();
    if (state.index === 0) {
      showScreen('hero');
      return;
    }
    state.index -= 1;
    showScreen('question');
  });

  document.getElementById('pw-gate-back').addEventListener('click', function () {
    state.index = AREAS.length - 1;
    showScreen('question');
  });

  document.getElementById('pw-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var firstName = document.getElementById('pw-name').value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    var email = document.getElementById('pw-email').value.trim().toLowerCase();
    var phone = document.getElementById('pw-phone').value.trim().slice(0, 40);
    var error = document.getElementById('pw-error');
    if (!firstName) {
      error.textContent = 'Enter your first name.';
      document.getElementById('pw-name').focus();
      return;
    }
    if (!validEmail(email)) {
      error.textContent = 'Enter a valid email.';
      document.getElementById('pw-email').focus();
      return;
    }
    if (!validPhone(phone)) {
      error.textContent = 'Enter a phone number, or leave it blank.';
      document.getElementById('pw-phone').focus();
      return;
    }
    error.textContent = '';
    state.lead = { firstName: firstName, email: email, phone: phone };
    state.submitted = true;
    saveState();

    var button = document.getElementById('pw-submit');
    button.disabled = true;
    button.textContent = 'Opening your score';
    var payload = {
      firstName: firstName,
      email: email,
      phone: phone,
      scores: scoresPayload(state.ratings, state.notes, state.kinds),
      gaps: biggestGaps(state.ratings, state.kinds),
      peakScore: peakScore(state.ratings),
      submittedAt: new Date().toISOString(),
      source: 'start-peak-wheel',
      company: document.getElementById('pw-company').value
    };
    postLead(payload).then(function () {
      button.disabled = false;
      button.textContent = 'Show my Peak Wheel';
      showScreen('results');
    });
  });

  document.getElementById('pw-retake').addEventListener('click', function () {
    state = { screen: 'hero', index: 0, ratings: {}, notes: {}, kinds: {}, lead: null, submitted: false };
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (err) {}
    document.getElementById('pw-form').reset();
    document.getElementById('pw-error').textContent = '';
    showScreen('hero');
  });

  if (state.lead) {
    document.getElementById('pw-name').value = state.lead.firstName || '';
    document.getElementById('pw-email').value = state.lead.email || '';
    document.getElementById('pw-phone').value = state.lead.phone || '';
  }
  if (state.screen === 'question' || state.screen === 'gate' || (state.screen === 'results' && state.submitted)) {
    showScreen(state.screen);
  }
})();
