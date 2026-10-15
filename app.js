/* Daily Report — frontend logic (static site + Google Apps Script backend) */
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

  function firstOfMonth() { return todayColombo().slice(0, 7) + '-01'; }

  var toastTimer = null;
  function toast(msg, ok) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + (ok === false ? 'error' : 'ok');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 3500);
  }

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
        throw new Error('Cannot reach the server. Check your connection and the Web App URL in config.js.');
      }
      throw err;
    });
  }

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
    $('exp-month').value = todayColombo().slice(0, 7);
    $('exp-from').value = firstOfMonth();
    $('exp-to').value = todayColombo();
    loadHistory();
    if (isAdmin) loadUsers();
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
      toast('Report saved.', true);
      $('report-form').reset();
      $('f-date').value = todayColombo();
      loadHistory();
    }).catch(function (err) {
      toast(err.message, false);
    }).then(function () {
      btn.disabled = false;
    });
  });

  /* ---------------- history ---------------- */

  function currentScope(selectId) {
    var s = getSession();
    if (s && s.role === 'admin') return $(selectId).value;
    return 'mine';
  }

  function loadHistory() {
    var from = $('h-from').value;
    var to = $('h-to').value;
    var scope = currentScope('h-scope');
    var s = getSession();
    api('listReports', { from: from, to: to, scope: scope }).then(function (data) {
      renderHistory(data.reports || [], !!(s && s.role === 'admin'));
    }).catch(function (err) {
      toast(err.message, false);
    });
  }

  function renderHistory(reports, isAdmin) {
    var list = $('history-list');
    $('history-count').textContent = reports.length + (reports.length === 1 ? ' report' : ' reports');
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
  }

  $('h-load').addEventListener('click', loadHistory);

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

  /* auto-select the matching export mode when its input is tapped */
  function checkExpMode(value) {
    var radio = document.querySelector('input[name="exp-mode"][value="' + value + '"]');
    if (radio) radio.checked = true;
  }
  $('exp-month').addEventListener('focus', function () { checkExpMode('month'); });
  $('exp-from').addEventListener('focus', function () { checkExpMode('range'); });
  $('exp-to').addEventListener('focus', function () { checkExpMode('range'); });

  /* ---------------- go ---------------- */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
