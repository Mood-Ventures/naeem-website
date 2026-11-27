(function () {
  var STORAGE_KEY = 'ph-peak-wheel-v2';

  // Peak Humans Gap Map life areas, in Naeem's order.
  // Tribe is friends, peer group, and community.
  // Mission is purpose and work that matters.
  // Impact and Joy is contribution, fun, and celebration.
  var AREAS = [
    {
      id: 'body',
      label: 'Body',
      followup: 'What would raise how your body feels and performs?',
      cost: 'A gap here usually costs how you feel and perform in your body. Strength, health, and recovery sit below your standard, and that shows up in how you carry the day.'
    },
    {
      id: 'mind',
      label: 'Mind',
      followup: 'What tends to pull you out of a clear head?',
      cost: 'A gap here usually costs clarity. Mental noise leaks into decisions and leadership, and the next hard call gets delayed or forced.'
    },
    {
      id: 'love',
      label: 'Love',
      followup: 'Who needs more of you than they are getting?',
      cost: 'A gap here usually costs the relationship closest to you. Love gets what is left after the business, and the bond that makes a big life worth building thins out.'
    },
    {
      id: 'tribe',
      label: 'Tribe',
      followup: 'Where does your circle fall short of the level you want around you?',
      cost: 'A gap here usually costs the people you rise with. Friends, your peer group, and your community stay behind the level you are playing at, so the big calls get made with too few people beside you.'
    },
    {
      id: 'mission',
      label: 'Mission',
      followup: 'What would make the work feel like it matters?',
      cost: 'A gap here usually costs the sense that the work matters. The business can keep moving and stop feeling like your mission, so performance turns into maintenance.'
    },
    {
      id: 'wealth',
      label: 'Wealth',
      followup: 'What would move your wealth forward?',
      cost: 'A gap here usually shows up as wealth that stays flat while the calendar stays full. What you earn, price, and keep does not compound.'
    },
    {
      id: 'time-energy',
      label: 'Time and Energy',
      followup: 'What keeps taking the hours and the energy that matter?',
      cost: 'A gap here usually costs the few moves that actually grow the business. Hours and energy go to noise, and the work that matters keeps getting pushed.'
    },
    {
      id: 'impact-joy',
      label: 'Impact and Joy',
      followup: 'What have you stopped contributing to, enjoying, or celebrating?',
      cost: 'A gap here usually costs contribution and the joy of the life you are building. Fun, celebration, and the mark you leave on other people go quiet, and the days narrow to output.'
    }
  ];

  var COST_WHEN_CLOSE = 'This is close to your peak. What it still costs is the last bit of performance and influence left on the table in this area.';

  var state = loadState();

  function loadState() {
    var fresh = { screen: 'hero', index: 0, ratings: {}, notes: {}, lead: null, submitted: false };
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return fresh;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return fresh;
      data.ratings = data.ratings || {};
      data.notes = data.notes || {};
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

  function peakScore(ratings) {
    var sum = 0;
    var count = 0;
    AREAS.forEach(function (area) {
      var value = Number(ratings[area.id]);
      if (!value) return;
      sum += value;
      count += 1;
    });
    if (!count) return 0;
    return Math.round((sum / count) * 10) / 10;
  }

  function biggestGaps(ratings) {
    var ranked = AREAS.map(function (area, index) {
      return { area: area, index: index, score: Number(ratings[area.id]) || 0 };
    });
    ranked.sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      return a.index - b.index;
    });
    return ranked.slice(0, 2).map(function (item) {
      return {
        id: item.area.id,
        label: item.area.label,
        score: item.score,
        cost: item.score >= 8 ? COST_WHEN_CLOSE : item.area.cost
      };
    });
  }

  function scoresPayload(ratings, notes) {
    var out = {};
    AREAS.forEach(function (area) {
      out[area.id] = {
        label: area.label,
        score: Number(ratings[area.id]) || 0,
        note: String(notes[area.id] || '').trim()
      };
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
    var slider = document.getElementById('pw-slider');
    slider.style.setProperty('--n', String(n));
    slider.setAttribute('aria-valuenow', String(n));
    slider.setAttribute('aria-valuetext', n + ' out of 10');
    document.getElementById('pw-value').textContent = String(n);
  }

  function captureQuestion() {
    var area = AREAS[state.index];
    state.ratings[area.id] = Number(document.getElementById('pw-slider').value);
    state.notes[area.id] = document.getElementById('pw-note').value.replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  function renderQuestion() {
    var area = AREAS[state.index];
    var value = state.ratings[area.id] || 5;
    document.getElementById('pw-step').textContent = 'Area ' + (state.index + 1) + ' of ' + AREAS.length;
    document.getElementById('pw-bar').style.width = (((state.index + 1) / AREAS.length) * 100) + '%';
    var progress = document.getElementById('pw-progress');
    progress.setAttribute('aria-valuenow', String(state.index + 1));
    progress.setAttribute('aria-valuemax', String(AREAS.length));
    progress.setAttribute('aria-valuetext', 'Area ' + (state.index + 1) + ' of ' + AREAS.length + ': ' + area.label);
    document.getElementById('pw-area').textContent = area.label;
    document.getElementById('pw-follow-label').textContent = area.followup;
    document.getElementById('pw-note').value = state.notes[area.id] || '';
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
    parts.push('<desc id="pw-chart-desc">A radar chart of your eight self-ratings, from 1 to 10. Area 1 starts at the top and the numbers continue clockwise.</desc>');
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
      var score = Math.max(1, Math.min(10, Number(ratings[area.id]) || 1));
      var p = point(index, radius * (score / 10), cx, cy);
      return p[0].toFixed(1) + ',' + p[1].toFixed(1);
    }).join(' ');
    parts.push('<polygon points="' + shape + '" fill="rgba(0,240,255,0.30)" stroke="#00f0ff" stroke-width="2.5" stroke-linejoin="round"></polygon>');
    AREAS.forEach(function (area, index) {
      var score = Math.max(1, Math.min(10, Number(ratings[area.id]) || 1));
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
    var gaps = biggestGaps(state.ratings);
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
      if (gapIds[area.id]) {
        var tag = document.createElement('em');
        tag.textContent = 'Biggest gap';
        span.appendChild(tag);
      }
      var score = document.createElement('b');
      score.textContent = String(Number(state.ratings[area.id]) || 0);
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
      var copy = document.createElement('p');
      copy.textContent = gap.cost;
      card.appendChild(heading);
      card.appendChild(score);
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

  document.getElementById('pw-qform').addEventListener('submit', function (event) {
    event.preventDefault();
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
      scores: scoresPayload(state.ratings, state.notes),
      gaps: biggestGaps(state.ratings),
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
    state = { screen: 'hero', index: 0, ratings: {}, notes: {}, lead: null, submitted: false };
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
