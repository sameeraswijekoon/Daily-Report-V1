/**
 * Daily Report — Google Apps Script backend.
 *
 * SETUP (full guide in README.md):
 *  1. Create a new Google Sheet (this will be the database).
 *  2. In the sheet: Extensions > Apps Script, delete the default code,
 *     paste this entire file, save.
 *  3. Deploy > New deployment > type "Web app":
 *       Execute as: Me
 *       Who has access: Anyone
 *     Copy the Web app URL into config.js in the web app.
 *  4. Open the web app once — the "Users" and "Reports" sheets are
 *     created automatically — then create the first admin account.
 *
 * SECURITY NOTES:
 *  - Passwords are hashed (SHA-256) in the browser; the sheet only ever
 *    stores hashes, never plain-text passwords.
 *  - The Web app URL is effectively a key: anyone with the link can call
 *    the API, but every action still requires a valid login, and admin
 *    actions require an admin login.
 *  - After editing this script you MUST publish a new version:
 *    Deploy > Manage deployments > Edit > New version.
 */

var SHEET_USERS = 'Users';
var SHEET_REPORTS = 'Reports';
var SHEET_CUSTOMERS = 'Customers';

var USER_HEADERS = ['Username', 'PasswordHash', 'FullName', 'Role', 'Active', 'CreatedAt'];
var REPORT_HEADERS = ['Timestamp', 'Username', 'Date', 'CustomerName', 'ContactNumber',
                      'City', 'ReasonToVisit', 'Remark', 'TimeStart', 'TimeEnd'];
var CUSTOMER_HEADERS = ['Name', 'ContactNumber', 'City', 'CreatedBy', 'CreatedAt'];

/* ---------------- helpers ---------------- */

function getSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
}

// All data rows as objects keyed by header name; each carries _row (sheet row number).
function rows_(name, headers) {
  var sh = getSheet_(name, headers);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  return values.map(function (r, i) {
    var o = { _row: i + 2 };
    headers.forEach(function (h, j) { o[h] = r[j]; });
    return o;
  });
}

function iso_(v) {
  if (v instanceof Date) return v.toISOString();
  return String(v == null ? '' : v);
}

function pad_(n) { return (n < 10 ? '0' : '') + n; }

// Sheets auto-converts date-like strings ("2026-10-13") into real Date values
// on write; normalize back to YYYY-MM-DD so filtering and display work.
function dateStr_(v) {
  if (v instanceof Date) {
    return v.getFullYear() + '-' + pad_(v.getMonth() + 1) + '-' + pad_(v.getDate());
  }
  var s = String(v == null ? '' : v).trim();
  var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

// Same for time cells: Sheets stores "22:10" as a Date; normalize back to HH:MM.
function timeStr_(v) {
  if (v instanceof Date) {
    return pad_(v.getHours()) + ':' + pad_(v.getMinutes());
  }
  var s = String(v == null ? '' : v).trim();
  var m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return pad_(Number(m[1])) + ':' + m[2];
  return s;
}

function isActive_(u) {
  return u.Active === true || String(u.Active).toUpperCase() === 'TRUE';
}

function findUser_(username) {
  var key = String(username || '').trim().toLowerCase();
  if (!key) return null;
  var users = rows_(SHEET_USERS, USER_HEADERS);
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].Username || '').toLowerCase() === key) return users[i];
  }
  return null;
}

function countUsers_() {
  return rows_(SHEET_USERS, USER_HEADERS).length;
}

/* ---------------- auth gate ---------------- */

function authed_(body, needAdmin, fn) {
  var auth = body._auth || {};
  var user = findUser_(auth.username);
  if (!user || !isActive_(user)) return out_({ ok: false, error: 'Not authenticated' });
  if (String(user.PasswordHash || '') !== String(auth.passwordHash || '')) {
    return out_({ ok: false, error: 'Not authenticated' });
  }
  if (needAdmin && user.Role !== 'admin') return out_({ ok: false, error: 'Admin only' });
  return fn(body, user);
}

/* ---------------- entry points ---------------- */

function doGet() {
  getSheet_(SHEET_USERS, USER_HEADERS);
  getSheet_(SHEET_REPORTS, REPORT_HEADERS);
  return out_({ ok: true, service: 'DailyReport API', time: new Date().toISOString() });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    if (!e || !e.postData || !e.postData.contents) {
      return out_({ ok: false, error: 'Empty request' });
    }
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    if (action === 'needsSetup') return out_({ ok: true, needsSetup: countUsers_() === 0 });
    if (action === 'setupAdmin') return setupAdmin_(body);
    if (action === 'login') return login_(body);

    if (action === 'saveReport') return authed_(body, false, saveReport_);
    if (action === 'listReports') return authed_(body, false, listReports_);
    if (action === 'listUsers') return authed_(body, true, listUsers_);
    if (action === 'addUser') return authed_(body, true, addUser_);
    if (action === 'setPassword') return authed_(body, true, setPassword_);
    if (action === 'setActive') return authed_(body, true, setActive_);
    if (action === 'deleteReport') return authed_(body, true, deleteReport_);
    if (action === 'listCustomers') return authed_(body, false, listCustomers_);
    if (action === 'addCustomer') return authed_(body, false, addCustomer_);
    if (action === 'deleteCustomer') return authed_(body, true, deleteCustomer_);

    return out_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- public actions ---------------- */

function setupAdmin_(body) {
  if (countUsers_() > 0) return out_({ ok: false, error: 'Setup already complete' });
  var username = String(body.username || '').trim().toLowerCase();
  var fullName = String(body.fullName || '').trim();
  var passwordHash = String(body.passwordHash || '');
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    return out_({ ok: false, error: 'Invalid username (3-30 chars: a-z 0-9 . _ -)' });
  }
  if (!fullName) return out_({ ok: false, error: 'Full name required' });
  if (!/^[0-9a-f]{64}$/i.test(passwordHash)) return out_({ ok: false, error: 'Invalid password data' });
  getSheet_(SHEET_USERS, USER_HEADERS)
      .appendRow([username, passwordHash, fullName, 'admin', true, new Date().toISOString()]);
  return out_({ ok: true });
}

function login_(body) {
  var user = findUser_(body.username);
  if (!user || !isActive_(user) ||
      String(user.PasswordHash || '') !== String(body.passwordHash || '')) {
    return out_({ ok: false, error: 'Invalid username or password' });
  }
  return out_({ ok: true, user: {
    username: user.Username, fullName: user.FullName, role: user.Role
  } });
}

/* ---------------- report actions ---------------- */

function saveReport_(body, user) {
  var r = {
    date: String(body.date || '').trim(),
    customerName: String(body.customerName || '').trim(),
    contactNumber: String(body.contactNumber || '').trim(),
    city: String(body.city || '').trim(),
    reasonToVisit: String(body.reasonToVisit || '').trim(),
    remark: String(body.remark || '').trim(),
    timeStart: String(body.timeStart || '').trim(),
    timeEnd: String(body.timeEnd || '').trim()
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return out_({ ok: false, error: 'Invalid date' });
  if (!r.customerName) return out_({ ok: false, error: 'Customer name required' });
  if (!r.reasonToVisit) return out_({ ok: false, error: 'Reason to visit required' });
  if (!/^\d{2}:\d{2}$/.test(r.timeStart) || !/^\d{2}:\d{2}$/.test(r.timeEnd)) {
    return out_({ ok: false, error: 'Start and end time required' });
  }
  getSheet_(SHEET_REPORTS, REPORT_HEADERS).appendRow([
    new Date().toISOString(), user.Username, r.date, r.customerName,
    // Leading apostrophe forces text storage so contact numbers keep leading zeros (e.g. 077...).
    r.contactNumber ? "'" + r.contactNumber : '',
    r.city, r.reasonToVisit, r.remark, r.timeStart, r.timeEnd
  ]);
  return out_({ ok: true });
}

function listReports_(body, user) {
  var scope = String(body.scope || 'mine');
  var from = String(body.from || '');
  var to = String(body.to || '');
  var all = rows_(SHEET_REPORTS, REPORT_HEADERS);
  var me = String(user.Username).toLowerCase();
  var out = [];
  for (var i = 0; i < all.length; i++) {
    var r = all[i];
    var uname = String(r.Username || '');
    // Non-admins can only ever see their own reports, regardless of scope.
    if (scope !== 'all' || user.Role !== 'admin') {
      if (uname.toLowerCase() !== me) continue;
    }
    var d = dateStr_(r.Date);
    if (from && d < from) continue;
    if (to && d > to) continue;
    out.push({
      id: r._row,
      timestamp: iso_(r.Timestamp),
      username: uname,
      date: d,
      customerName: String(r.CustomerName || ''),
      contactNumber: String(r.ContactNumber || ''),
      city: String(r.City || ''),
      reasonToVisit: String(r.ReasonToVisit || ''),
      remark: String(r.Remark || ''),
      timeStart: timeStr_(r.TimeStart),
      timeEnd: timeStr_(r.TimeEnd)
    });
  }
  out.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  return out_({ ok: true, reports: out });
}

function deleteReport_(body, admin) {
  var id = Number(body.id);
  if (!id || id < 2) return out_({ ok: false, error: 'Invalid report id' });
  var sh = getSheet_(SHEET_REPORTS, REPORT_HEADERS);
  if (id > sh.getLastRow()) return out_({ ok: false, error: 'Report not found' });
  sh.deleteRow(id);
  return out_({ ok: true });
}

/* ---------------- customers: shared directory ---------------- */

function findCustomer_(name) {
  var key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  var all = rows_(SHEET_CUSTOMERS, CUSTOMER_HEADERS);
  for (var i = 0; i < all.length; i++) {
    if (String(all[i].Name || '').trim().toLowerCase() === key) return all[i];
  }
  return null;
}

function listCustomers_(body, user) {
  var all = rows_(SHEET_CUSTOMERS, CUSTOMER_HEADERS);
  var out = [];
  for (var i = 0; i < all.length; i++) {
    var c = all[i];
    var name = String(c.Name || '').trim();
    if (!name) continue;
    out.push({
      id: c._row,
      name: name,
      contactNumber: String(c.ContactNumber || ''),
      city: String(c.City || ''),
      createdBy: String(c.CreatedBy || '')
    });
  }
  out.sort(function (a, b) {
    var x = a.name.toLowerCase(), y = b.name.toLowerCase();
    return x < y ? -1 : (x > y ? 1 : 0);
  });
  return out_({ ok: true, customers: out });
}

function addCustomer_(body, user) {
  var name = String(body.name || '').trim();
  var contactNumber = String(body.contactNumber || '').trim();
  var city = String(body.city || '').trim();
  if (!name) return out_({ ok: false, error: 'Customer name required' });
  var sh = getSheet_(SHEET_CUSTOMERS, CUSTOMER_HEADERS);
  var existing = findCustomer_(name);
  var contactVal = contactNumber ? "'" + contactNumber : ''; // keep leading zeros
  if (existing) {
    sh.getRange(existing._row, 2).setValue(contactVal);
    sh.getRange(existing._row, 3).setValue(city);
    return out_({ ok: true, updated: true });
  }
  sh.appendRow([name, contactVal, city, user.Username, new Date().toISOString()]);
  return out_({ ok: true, created: true });
}

function deleteCustomer_(body, admin) {
  var id = Number(body.id);
  if (!id || id < 2) return out_({ ok: false, error: 'Invalid customer id' });
  var sh = getSheet_(SHEET_CUSTOMERS, CUSTOMER_HEADERS);
  if (id > sh.getLastRow()) return out_({ ok: false, error: 'Customer not found' });
  sh.deleteRow(id);
  return out_({ ok: true });
}

/* ---------------- admin: user management ---------------- */

function listUsers_(body, admin) {
  var users = rows_(SHEET_USERS, USER_HEADERS).map(function (u) {
    return {
      username: u.Username,
      fullName: u.FullName,
      role: u.Role,
      active: isActive_(u),
      createdAt: iso_(u.CreatedAt)
    };
  });
  return out_({ ok: true, users: users });
}

function addUser_(body, admin) {
  var username = String(body.username || '').trim().toLowerCase();
  var fullName = String(body.fullName || '').trim();
  var passwordHash = String(body.passwordHash || '');
  var role = String(body.role || 'user');
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    return out_({ ok: false, error: 'Invalid username (3-30 chars: a-z 0-9 . _ -)' });
  }
  if (!fullName) return out_({ ok: false, error: 'Full name required' });
  if (!/^[0-9a-f]{64}$/i.test(passwordHash)) return out_({ ok: false, error: 'Invalid password data' });
  if (role !== 'admin' && role !== 'user') role = 'user';
  if (findUser_(username)) return out_({ ok: false, error: 'Username already exists' });
  getSheet_(SHEET_USERS, USER_HEADERS)
      .appendRow([username, passwordHash, fullName, role, true, new Date().toISOString()]);
  return out_({ ok: true });
}

function setPassword_(body, admin) {
  var user = findUser_(body.username);
  var passwordHash = String(body.passwordHash || '');
  if (!user) return out_({ ok: false, error: 'User not found' });
  if (!/^[0-9a-f]{64}$/i.test(passwordHash)) return out_({ ok: false, error: 'Invalid password data' });
  getSheet_(SHEET_USERS, USER_HEADERS).getRange(user._row, 2).setValue(passwordHash);
  return out_({ ok: true });
}

function setActive_(body, admin) {
  var user = findUser_(body.username);
  if (!user) return out_({ ok: false, error: 'User not found' });
  getSheet_(SHEET_USERS, USER_HEADERS).getRange(user._row, 5).setValue(!!body.active);
  return out_({ ok: true });
}
