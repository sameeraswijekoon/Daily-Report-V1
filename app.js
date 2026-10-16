/* Daily Report — frontend (rewritten UI, same backend API) */
(function () {
  'use strict';

  var API_URL = (window.DR_API_URL || '').trim();
  var CONFIGURED = !!API_URL && API_URL.indexOf('PASTE_YOUR') === -1 && API_URL.indexOf('https://') === 0;
  var SESSION_KEY = 'dr_session_v1';

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function todayColombo() {
    try {
      return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });
    } catch (e) {
      var d = new Date();
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    }
  }

  function nowColombo() {
    try {
      return new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      var d = new Date();
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
  }

  function firstOfMonth() { return todayColombo().slice(0, 7) + '-01'; }

  function minutesBetween(a, b) {
    // "HH:MM" -> minutes; returns 0 when unparseable or end <= start
    function toMin(t) {
      var m = /^(\d{1,2}):(\d{2})/.exec(t || '');
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    }
    var s = toMin(a), e = toMin(b);
    if (s == null || e == null || e <= s) return 0;
    return e - s;
  }

  /* ---------------- toast ---------------- */
  var toastTimer = null;
  function toast(msg, ok) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + (ok === false ? 'error' : 'ok');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 3500);
  }

  /* ---------------- session & crypto ---------------- */
  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function setSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {} }
  function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }

  function sha256Hex(text) {
    var bytes = new TextEncoder().encode(text);
    return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    });
  }

  /* ---------------- api ---------------- */
  function api(action, payload) {
    payload = payload || {};
    var s = getSession();
    var body = { action: action };
    Object.keys(payload).forEach(function (k) { body[k] = payload[k]; });
    if (s) body._auth = { username: s.username, passwordHash: s.passwordHash };
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (txt) {
        var data;
        try { data = JSON.parse(txt); }
        catch (e) { throw new Error('Bad response from server'); }
        if (!data.ok) throw new Error(data.error || 'Request failed');
        return data;
      });
    }).catch(function (err) {
      if (err && (err.message === 'Failed to fetch' || err.name === 'TypeError')) {
        throw new Error('Cannot reach the server. Check your connection and try again.');
      }
      throw err;
    });
  }

  /* ---------------- views & tabs ---------------- */
  function show(id) {
    ['view-login', 'view-setup', 'view-app'].forEach(function (v) { $(v).hidden = v !== id; });
    window.scrollTo(0, 0);
  }

  function showTab(name) {
    var btns = document.querySelectorAll('.tab-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-tab') === name);
    }
    var panels = document.querySelectorAll('.tab-panel');
    for (var j = 0; j < panels.length; j++) {
      panels[j].hidden = panels[j].id !== 'tab-' + name;
    }
    window.scrollTo(0, 0);
    if (name === 'history') loadHistory();
    if (name === 'export') updateExportCount();
    if (name === 'customers') loadCustomers();
    var s = getSession();
    if (name === 'users' && s && s.role === 'admin') loadUsers();
  }

  /* ---------------- boot ---------------- */
  function boot() {
    if (!CONFIGURED) {
      $('config-warning').hidden = false;
      show('view-login');
      return;
    }
    var s = getSession();
    if (s && s.username && s.passwordHash) {
      api('login', { username: s.username, passwordHash: s.passwordHash }).then(function (data) {
        setSession({
          username: data.user.username,
          fullName: data.user.fullName,
          role: data.user.role,
          passwordHash: s.passwordHash
        });
        enterApp();
      }).catch(function () {
        clearSession();
        checkSetup();
      });
    } else {
      checkSetup();
    }
  }

  function checkSetup() {
    api('needsSetup', {}).then(function (data) {
      show(data.needsSetup ? 'view-setup' : 'view-login');
    }).catch(function () {
      show('view-login');
    });
  }

  function enterApp() {
    var s = getSession();
    var isAdmin = !!(s && s.role === 'admin');
    $('app-username').textContent = s.fullName + ' (' + s.username + ')';
    $('users-tab-btn').hidden = !isAdmin;
    $('h-scope-wrap').hidden = !isAdmin;
    $('exp-scope-wrap').hidden = !isAdmin;
    show('view-app');
    showTab('report');
    if (!$('f-date').value) $('f-date').value = todayColombo();
    $('h-from').value = firstOfMonth();
    $('h-to').value = todayColombo();
    $('h-search').value = '';
    $('exp-month').value = todayColombo().slice(0, 7);
    $('exp-from').value = firstOfMonth();
    $('exp-to').value = todayColombo();
    resetReportForm();
    ensureCustomers(); // preload directory so name suggestions are instant
  }

  /* ---------------- login / setup / logout ---------------- */
  $('login-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var username = $('login-username').value.trim();
    var password = $('login-password').value;
    if (!username || !password) { toast('Enter your username and password.', false); return; }
    var btn = $('login-btn');
    btn.disabled = true;
    sha256Hex(password).then(function (hash) {
      return api('login', { username: username, passwordHash: hash }).then(function (data) {
        setSession({
          username: data.user.username,
          fullName: data.user.fullName,
          role: data.user.role,
          passwordHash: hash
        });
        $('login-password').value = '';
        enterApp();
        toast('Welcome, ' + data.user.fullName + '.', true);
      });
    }).catch(function (err) {
      toast(err.message, false);
    }).then(function () {
      btn.disabled = false;
    });
  });

  $('pw-toggle').addEventListener('click', function () {
    var input = $('login-password');
    var showPw = input.type === 'password';
    input.type = showPw ? 'text' : 'password';
    $('pw-toggle').classList.toggle('active', showPw);
    $('pw-toggle').setAttribute('aria-label', showPw ? 'Hide password' : 'Show password');
  });

  $('setup-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var username = $('setup-username').value.trim().toLowerCase();
    var fullName = $('setup-fullname').value.trim();
    var p1 = $('setup-password').value;
    var p2 = $('setup-password2').value;
    if (p1 !== p2) { toast('Passwords do not match.', false); return; }
    if (p1.length < 6) { toast('Password must be at least 6 characters.', false); return; }
    var holder = {};
    sha256Hex(p1).then(function (hash) {
      holder.hash = hash;
      return api('setupAdmin', { username: username, fullName: fullName, passwordHash: hash });
    }).then(function () {
      setSession({ username: username, fullName: fullName, role: 'admin', passwordHash: holder.hash });
      enterApp();
      toast('Admin account created. Welcome!', true);
    }).catch(function (err) {
      toast(err.message, false);
    });
  });

  $('logout-btn').addEventListener('click', function () {
    clearSession();
    $('login-username').value = '';
    $('login-password').value = '';
    show('view-login');
  });

  /* ---------------- tabs ---------------- */
  var tabBtns = document.querySelectorAll('.tab-btn');
  for (var ti = 0; ti < tabBtns.length; ti++) {
    (function (b) {
      b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
    })(tabBtns[ti]);
  }

  /* ---------------- new report ---------------- */
  function resetReportForm() {
    $('report-form').reset();
    $('f-date').value = todayColombo();
    $('report-form-wrap').hidden = false;
    $('report-success').hidden = true;
  }

  $('now-start').addEventListener('click', function () { $('f-start').value = nowColombo(); });
  $('now-end').addEventListener('click', function () { $('f-end').value = nowColombo(); });

  $('report-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var payload = {
      customerName: $('f-customer').value.trim(),
      contactNumber: $('f-contact').value.trim(),
      city: $('f-city').value.trim(),
      date: $('f-date').value,
      reasonToVisit: $('f-reason').value.trim(),
      remark: $('f-remark').value.trim(),
      timeStart: $('f-start').value,
      timeEnd: $('f-end').value
    };
    if (!payload.customerName || !payload.date || !payload.reasonToVisit ||
        !payload.timeStart || !payload.timeEnd) {
      toast('Please fill all required (*) fields.', false);
      return;
    }
    var btn = $('report-submit');
    btn.disabled = true;
    api('saveReport', payload).then(function () {
      $('success-sub').textContent = payload.customerName + ' · ' + payload.date +
        ' · ' + payload.timeStart + ' – ' + payload.timeEnd;
      $('report-form-wrap').hidden = true;
      $('report-success').hidden = false;
      window.scrollTo(0, 0);
    }).catch(function (err) {
      toast(err.message, false);
    }).then(function () {
      btn.disabled = false;
    });
  });

  $('success-another').addEventListener('click', function () {
    resetReportForm();
    window.scrollTo(0, 0);
    setTimeout(function () { $('f-customer').focus(); }, 100);
  });
  $('success-view').addEventListener('click', function () { showTab('history'); });

  /* ---------------- history ---------------- */
  var cachedReports = [];

  function currentScope(selectId) {
    var s = getSession();
    if (s && s.role === 'admin') return $(selectId).value;
    return 'mine';
  }

  function skeletonCards(n) {
    var html = '';
    for (var i = 0; i < n; i++) {
      html += '<div class="skeleton-card"><div class="sk sk-title"></div>' +
        '<div class="sk sk-line"></div><div class="sk sk-line short"></div></div>';
    }
    return html;
  }

  function loadHistory() {
    var from = $('h-from').value;
    var to = $('h-to').value;
    var scope = currentScope('h-scope');
    $('history-list').innerHTML = skeletonCards(3);
    $('history-empty').hidden = true;
    api('listReports', { from: from, to: to, scope: scope }).then(function (data) {
      cachedReports = data.reports || [];
      renderHistory();
    }).catch(function (err) {
      $('history-list').innerHTML = '';
      toast(err.message, false);
    });
  }

  function filteredReports() {
    var q = $('h-search').value.trim().toLowerCase();
    if (!q) return cachedReports;
    return cachedReports.filter(function (r) {
      return (r.customerName + ' ' + r.city + ' ' + r.reasonToVisit + ' ' +
              r.remark + ' ' + r.username).toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderHistory() {
    var s = getSession();
    var isAdmin = !!(s && s.role === 'admin');
    var reports = filteredReports();
    var list = $('history-list');
    $('history-empty').hidden = reports.length > 0;
    list.innerHTML = reports.map(function (r) {
      var meta = [r.city, r.contactNumber].filter(function (x) { return x; }).join(' · ');
      return '<article class="report-card">' +
        '<div class="rc-top"><h3>' + esc(r.customerName) + '</h3>' +
        '<span class="date-pill">' + esc(r.date) + '</span></div>' +
        (meta ? '<div class="rc-meta">' + esc(meta) + '</div>' : '') +
        '<div class="rc-row"><span>Reason to visit</span><p>' + esc(r.reasonToVisit) + '</p></div>' +
        (r.remark ? '<div class="rc-row"><span>Remark</span><p>' + esc(r.remark) + '</p></div>' : '') +
        '<div class="rc-foot"><span class="rc-time">' + esc(r.timeStart) + ' – ' + esc(r.timeEnd) + '</span>' +
        '<span class="rc-by">by ' + esc(r.username) + '</span>' +
        (isAdmin ? '<button class="btn danger sm" data-del="' + r.id + '" type="button">Delete</button>' : '') +
        '</div></article>';
    }).join('');
    // stats for the loaded period
    var mins = 0;
    cachedReports.forEach(function (r) { mins += minutesBetween(r.timeStart, r.timeEnd); });
    $('stat-reports').textContent = cachedReports.length;
    $('stat-hours').textContent = (Math.round(mins / 6) / 10).toString();
  }

  $('h-load').addEventListener('click', loadHistory);
  $('h-search').addEventListener('input', renderHistory);
  $('empty-add-btn').addEventListener('click', function () { showTab('report'); });

  $('history-list').addEventListener('click', function (ev) {
    var t = ev.target;
    var id = t && t.getAttribute ? t.getAttribute('data-del') : null;
    if (!id) return;
    if (!confirm('Delete this report? This cannot be undone.')) return;
    api('deleteReport', { id: Number(id) }).then(function () {
      toast('Report deleted.', true);
      loadHistory();
    }).catch(function (err) {
      toast(err.message, false);
    });
  });

  /* ---------------- export to Excel ---------------- */
  function exportRange() {
    var modeEl = document.querySelector('input[name="exp-mode"]:checked');
    var mode = modeEl ? modeEl.value : 'month';
    var from, to, label;
    if (mode === 'month') {
      var m = $('exp-month').value; // YYYY-MM
      if (!m) { toast('Pick a month first.', false); return null; }
      var y = Number(m.slice(0, 4));
      var mo = Number(m.slice(5, 7));
      var last = new Date(y, mo, 0).getDate();
      from = m + '-01';
      to = m + '-' + String(last).padStart(2, '0');
      label = m;
    } else {
      from = $('exp-from').value;
      to = $('exp-to').value;
      if (!from || !to) { toast('Pick both dates.', false); return null; }
      if (from > to) { toast('From date is after To date.', false); return null; }
      label = from + '_to_' + to;
    }
    return { from: from, to: to, label: label };
  }

  function updateExportCount() {
    var range = exportRange();
    if (!range) { $('exp-count').textContent = ''; return; }
    var scope = currentScope('exp-scope');
    $('exp-count').textContent = 'Counting…';
    api('listReports', { from: range.from, to: range.to, scope: scope }).then(function (data) {
      var n = (data.reports || []).length;
      $('exp-count').textContent = n === 0
        ? 'No reports in this period.'
        : n + (n === 1 ? ' report' : ' reports') + ' ready to download.';
    }).catch(function () {
      $('exp-count').textContent = '';
    });
  }

  ['exp-month', 'exp-from', 'exp-to', 'exp-scope'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      var map = { 'exp-month': 'month', 'exp-from': 'range', 'exp-to': 'range' };
      if (map[id]) checkExpMode(map[id]);
      updateExportCount();
    });
  });

  function checkExpMode(value) {
    var radio = document.querySelector('input[name="exp-mode"][value="' + value + '"]');
    if (radio) radio.checked = true;
  }
  $('exp-month').addEventListener('focus', function () { checkExpMode('month'); });
  $('exp-from').addEventListener('focus', function () { checkExpMode('range'); });
  $('exp-to').addEventListener('focus', function () { checkExpMode('range'); });

  $('exp-btn').addEventListener('click', function () {
    if (typeof XLSX === 'undefined') {
      toast('Excel library failed to load. Check your connection and reload.', false);
      return;
    }
    var range = exportRange();
    if (!range) return;
    var scope = currentScope('exp-scope');
    var btn = $('exp-btn');
    btn.disabled = true;
    api('listReports', { from: range.from, to: range.to, scope: scope }).then(function (data) {
      var reports = data.reports || [];
      if (!reports.length) { toast('No reports found in this period.', false); return; }
      downloadExcel(reports, 'Daily-Report_' + range.label + '.xlsx');
      toast(reports.length + ' report(s) exported.', true);
    }).catch(function (err) {
      toast(err.message, false);
    }).then(function () {
      btn.disabled = false;
    });
  });

  function downloadExcel(reports, filename) {
    var rows = reports.map(function (r, i) {
      return {
        '#': i + 1,
        'Date': r.date,
        'Customer Name': r.customerName,
        'Contact Number': r.contactNumber,
        'City': r.city,
        'Reason to Visit': r.reasonToVisit,
        'Remark': r.remark,
        'Time Start': r.timeStart,
        'Time End': r.timeEnd,
        'Submitted By': r.username,
        'Submitted At': r.timestamp
      };
    });
    var ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 4 }, { wch: 12 }, { wch: 28 }, { wch: 16 }, { wch: 16 },
      { wch: 34 }, { wch: 34 }, { wch: 11 }, { wch: 11 }, { wch: 16 }, { wch: 22 }
    ];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Daily Report');
    XLSX.writeFile(wb, filename);
  }

  /* ---------------- admin: users ---------------- */
  function loadUsers() {
    api('listUsers', {}).then(function (data) {
      renderUsers(data.users || []);
    }).catch(function (err) {
      toast(err.message, false);
    });
  }

  function renderUsers(users) {
    $('users-list').innerHTML = users.map(function (u) {
      var un = esc(u.username);
      return '<article class="user-card">' +
        '<div class="uc-top"><div><h3>' + un + '</h3><p class="muted">' + esc(u.fullName) + '</p></div>' +
        '<span class="role-pill' + (u.role === 'admin' ? ' admin' : '') + '">' + esc(u.role) + '</span></div>' +
        '<label class="uc-active"><input type="checkbox" data-active="' + un + '"' +
        (u.active ? ' checked' : '') + ' /> Active</label>' +
        '<div class="uc-pw"><input type="password" data-pw="' + un + '"' +
        ' placeholder="New password" minlength="6" aria-label="New password for ' + un + '" />' +
        '<button class="btn primary sm" data-setpw="' + un + '" type="button">Update</button></div>' +
        '</article>';
    }).join('');
  }

  $('user-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var username = $('u-username').value.trim().toLowerCase();
    var fullName = $('u-fullname').value.trim();
    var password = $('u-password').value;
    var role = $('u-role').value;
    if (password.length < 6) { toast('Password must be at least 6 characters.', false); return; }
    sha256Hex(password).then(function (hash) {
      return api('addUser', {
        username: username, fullName: fullName, passwordHash: hash, role: role
      });
    }).then(function () {
      toast('User added.', true);
      $('user-form').reset();
      loadUsers();
    }).catch(function (err) {
      toast(err.message, false);
    });
  });

  $('users-list').addEventListener('change', function (ev) {
    var t = ev.target;
    var un = t && t.getAttribute ? t.getAttribute('data-active') : null;
    if (!un) return;
    var s = getSession();
    if (s && un === s.username && !t.checked) {
      if (!confirm('Deactivating your own account will log you out. Continue?')) {
        t.checked = true;
        return;
      }
    }
    api('setActive', { username: un, active: t.checked }).then(function () {
      toast('User ' + (t.checked ? 'activated' : 'deactivated') + '.', true);
      if (s && un === s.username && !t.checked) {
        clearSession();
        show('view-login');
      }
    }).catch(function (err) {
      toast(err.message, false);
      loadUsers();
    });
  });

  $('users-list').addEventListener('click', function (ev) {
    var t = ev.target;
    var un = t && t.getAttribute ? t.getAttribute('data-setpw') : null;
    if (!un) return;
    var input = document.querySelector('input[data-pw="' + un + '"]');
    var pw = input ? input.value : '';
    if (!pw || pw.length < 6) { toast('Enter a new password (min 6 characters).', false); return; }
    if (!confirm('Change password for ' + un + '?')) return;
    sha256Hex(pw).then(function (hash) {
      return api('setPassword', { username: un, passwordHash: hash });
    }).then(function () {
      toast('Password updated.', true);
      if (input) input.value = '';
    }).catch(function (err) {
      toast(err.message, false);
    });
  });

  /* ---------------- customers (shared directory) ---------------- */
  var customerCache = [];
  var customersLoaded = false;

  function ensureCustomers() {
    if (customersLoaded) return Promise.resolve(customerCache);
    return api('listCustomers', {}).then(function (data) {
      customerCache = data.customers || [];
      customersLoaded = true;
      return customerCache;
    }).catch(function () { return customerCache; });
  }

  function loadCustomers() {
    api('listCustomers', {}).then(function (data) {
      customerCache = data.customers || [];
      customersLoaded = true;
      renderCustomers();
    }).catch(function (err) {
      toast(err.message, false);
    });
  }

  function renderCustomers() {
    var s = getSession();
    var isAdmin = !!(s && s.role === 'admin');
    var q = $('cust-search').value.trim().toLowerCase();
    var list = customerCache.filter(function (c) {
      return !q || (c.name + ' ' + c.city + ' ' + c.contactNumber).toLowerCase().indexOf(q) !== -1;
    });
    $('customers-empty').hidden = list.length > 0;
    $('customers-list').innerHTML = list.map(function (c) {
      var meta = [c.contactNumber, c.city].filter(function (x) { return x; }).join(' · ');
      return '<article class="customer-card"><div class="cc-info"><h3>' + esc(c.name) + '</h3>' +
        (meta ? '<div class="cc-meta">' + esc(meta) + '</div>' : '') + '</div>' +
        (isAdmin ? '<button class="btn danger sm" data-delcust="' + c.id + '" type="button">Delete</button>' : '') +
        '</article>';
    }).join('');
  }

  $('customer-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var payload = {
      name: $('c-name').value.trim(),
      contactNumber: $('c-contact').value.trim(),
      city: $('c-city').value.trim()
    };
    if (!payload.name) { toast('Enter a customer name.', false); return; }
    api('addCustomer', payload).then(function (data) {
      toast(data.updated ? 'Customer updated.' : 'Customer added.', true);
      $('customer-form').reset();
      customersLoaded = false;
      loadCustomers();
    }).catch(function (err) {
      toast(err.message, false);
    });
  });

  $('cust-search').addEventListener('input', renderCustomers);

  $('customers-list').addEventListener('click', function (ev) {
    var t = ev.target;
    var id = t && t.getAttribute ? t.getAttribute('data-delcust') : null;
    if (!id) return;
    if (!confirm('Delete this customer? This cannot be undone.')) return;
    api('deleteCustomer', { id: Number(id) }).then(function () {
      toast('Customer deleted.', true);
      customersLoaded = false;
      loadCustomers();
    }).catch(function (err) {
      toast(err.message, false);
    });
  });

  /* ---- autocomplete on the report form ---- */
  function hideSuggestions() {
    var el = $('cust-suggest');
    if (el) el.hidden = true;
  }

  function showSuggestions() {
    var input = $('f-customer');
    var list = $('cust-suggest');
    var q = input.value.trim().toLowerCase();
    if (!q) { list.hidden = true; return; }
    var matches = customerCache.filter(function (c) {
      return c.name.toLowerCase().indexOf(q) !== -1;
    }).slice(0, 7);
    var exact = customerCache.some(function (c) { return c.name.toLowerCase() === q; });
    list._matches = matches;
    var html = matches.map(function (c, i) {
      return '<div class="suggest-item" data-idx="' + i + '"><span class="s-name">' + esc(c.name) + '</span>' +
        (c.city ? '<span class="s-city">' + esc(c.city) + '</span>' : '') + '</div>';
    }).join('');
    if (!exact) {
      html += '<div class="suggest-item add-new" data-addnew="1"><span><span class="s-plus">+</span>Add "' +
        esc(input.value.trim()) + '" as new customer</span></div>';
    }
    if (!html) { list.hidden = true; return; }
    list.innerHTML = html;
    list.hidden = false;
  }

  function selectCustomer(c) {
    $('f-customer').value = c.name;
    $('f-contact').value = c.contactNumber || '';
    $('f-city').value = c.city || '';
    hideSuggestions();
  }

  $('f-customer').addEventListener('focus', function () {
    ensureCustomers().then(showSuggestions);
  });
  $('f-customer').addEventListener('input', function () {
    ensureCustomers().then(showSuggestions);
  });
  $('f-customer').addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') hideSuggestions();
  });
  $('f-customer').addEventListener('blur', function () {
    setTimeout(hideSuggestions, 160); // let a tap on a suggestion land first
  });
  $('cust-suggest').addEventListener('mousedown', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('.suggest-item') : null;
    if (!t) return;
    ev.preventDefault(); // keep focus so blur doesn't hide the list first
    if (t.getAttribute('data-addnew')) {
      var name = $('f-customer').value.trim();
      hideSuggestions();
      showTab('customers');
      $('c-name').value = name;
      setTimeout(function () { $('c-contact').focus(); }, 120);
      return;
    }
    var idx = Number(t.getAttribute('data-idx'));
    var c = $('cust-suggest')._matches && $('cust-suggest')._matches[idx];
    if (c) selectCustomer(c);
  });

  /* ---------------- go ---------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
