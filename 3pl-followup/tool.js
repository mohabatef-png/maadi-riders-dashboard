/* 3PL Follow-up — Late & Idle Riders (bookmarklet version)
   Injects a full-screen overlay into the current page (must be run on
   logisticsbackoffice.com so the live fetch has session cookies).
   Host this file yourself (e.g. next to your other GitHub Pages tools)
   and point the bookmarklet at its raw URL. */
(function () {
  'use strict';

  // If already injected, just bring it to front instead of duplicating.
  var existing = document.getElementById('tpl-root');
  if (existing) { existing.style.display = 'block'; return; }

  var API_BASE = 'https://eg.me.logisticsbackoffice.com/api/dispatcher-dashboard/couriers?starting_point_id=';
  var STARTING_POINT_IDS = ['10228','10174','10215','10232','10231','10217','10227','10241','10001','10064','10002','10003','10130','10009','10161','10020','10135'];
  var IDLE_THRESHOLD_MS = 30 * 60 * 1000;
  var LS_PREFIX = 'tpl_idle_';

  // ---------- EDIT ME: starting_point_id -> Zone name ----------
  // Fill this in with your real IDs (check the Network tab URL, e.g.
  // ?starting_point_id=10228, while switching zones in the sidebar).
  // Any starting_point_id not listed here falls back to "Zone " + id.
  var ZONE_MAP = {
    '10228': 'Maadi',
    '10174': 'Maadi',
    '10215': 'Maadi',
    '10232': 'Maadi',
    '10231': 'Maadi',
    '10217': 'Mokattam',
    '10227': 'Mokattam',
    '10241': 'Mokattam',
    '10001': 'Mokattam',
    '10064': 'Helwan',
    '10002': 'Helwan',
    '10003': 'Helwan',
    '10130': 'Helwan',
    '10009': 'Helwan',
    '10161': 'Helwan',
    '10020': 'Helwan',
    '10135': 'Helwan'
  };
  function zoneNameFor(spId) {
    if (spId == null) return 'Unknown zone';
    return ZONE_MAP[String(spId)] || ('Zone ' + spId);
  }

  // ---------- styles (namespaced under #tpl-root) ----------
  var style = document.createElement('style');
  style.textContent = `
    #tpl-root{position:fixed;inset:0;z-index:2147483647;background:rgba(6,7,10,.55);
      font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;}
    #tpl-panel{position:absolute;top:20px;left:50%;transform:translateX(-50%);width:min(1180px,94vw);
      max-height:92vh;overflow:auto;background:#0f1115;color:#e8eaed;border:1px solid #2a2f3a;
      border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.5);}
    #tpl-panel *{box-sizing:border-box;}
    #tpl-header{padding:16px 20px;border-bottom:1px solid #2a2f3a;display:flex;justify-content:space-between;align-items:flex-start;}
    #tpl-header h1{margin:0 0 4px;font-size:18px;}
    #tpl-header p{margin:0;color:#9aa1ac;font-size:12px;}
    #tpl-close{background:#1e222b;color:#e8eaed;border:1px solid #2a2f3a;border-radius:8px;
      width:32px;height:32px;cursor:pointer;font-size:16px;line-height:1;flex:none;}
    #tpl-body{padding:16px 20px 30px;}
    .tpl-panelbox{background:#171a21;border:1px solid #2a2f3a;border-radius:10px;padding:16px;margin-bottom:16px;}
    #tpl-input{width:100%;min-height:110px;background:#1e222b;color:#e8eaed;border:1px solid #2a2f3a;
      border-radius:8px;padding:10px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;resize:vertical;}
    .tpl-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px;}
    .tpl-btn{background:#ff5a1f;color:#fff;border:none;border-radius:8px;padding:9px 14px;
      font-size:13px;font-weight:600;cursor:pointer;}
    .tpl-btn.secondary{background:#1e222b;color:#e8eaed;border:1px solid #2a2f3a;}
    .tpl-btn:disabled{opacity:.5;cursor:not-allowed;}
    #tpl-status{font-size:12px;color:#9aa1ac;}
    #tpl-stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;}
    .tpl-stat{background:#171a21;border:1px solid #2a2f3a;border-radius:10px;padding:10px 14px;min-width:110px;}
    .tpl-stat .n{font-size:20px;font-weight:700;}
    .tpl-stat .l{font-size:10px;color:#9aa1ac;text-transform:uppercase;letter-spacing:.04em;}
    .tpl-stat.late .n{color:#e34747;} .tpl-stat.idle .n{color:#e0a72c;}
    .tpl-stat.tpl-clickable{cursor:pointer;transition:border-color .15s,transform .1s;}
    .tpl-stat.tpl-clickable:hover{border-color:#ff5a1f;transform:translateY(-1px);}
    .tpl-stat.tpl-active{border-color:#ff5a1f;box-shadow:0 0 0 1px #ff5a1f inset;}
    .tpl-filter-bar{font-size:12px;color:#9aa1ac;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
    .tpl-filter-bar strong{color:#e8eaed;}
    #tpl-body th.tpl-sortable{cursor:pointer;user-select:none;}
    #tpl-body th.tpl-sortable:hover{color:#e8eaed;}
    .tpl-group h2{font-size:14px;margin:0 0 10px;display:flex;align-items:center;gap:8px;}
    .tpl-badge{font-size:11px;padding:2px 8px;border-radius:999px;background:#1e222b;color:#9aa1ac;}
    #tpl-body table{width:100%;border-collapse:collapse;font-size:12.5px;}
    #tpl-body th,#tpl-body td{text-align:left;padding:7px 9px;border-bottom:1px solid #2a2f3a;}
    #tpl-body th{color:#9aa1ac;font-weight:600;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;}
    .tpl-tag{font-size:11px;padding:2px 8px;border-radius:6px;font-weight:600;}
    .tpl-tag.late{background:rgba(227,71,71,.15);color:#e34747;}
    .tpl-tag.idle{background:rgba(224,167,44,.15);color:#e0a72c;}
    .tpl-tag.idle-mild{background:rgba(154,161,172,.15);color:#9aa1ac;}
    .tpl-empty{color:#9aa1ac;font-size:13px;padding:20px;text-align:center;}
  `;
  document.head.appendChild(style);

  // ---------- markup ----------
  var root = document.createElement('div');
  root.id = 'tpl-root';
  root.innerHTML = `
    <div id="tpl-panel">
      <div id="tpl-header">
        <div>
          <h1>3PL Follow-up — Late &amp; Idle Riders</h1>
          <p>Fetch or paste Hurrier active-couriers data. Idle timers persist between refreshes in this browser.</p>
        </div>
        <button id="tpl-close" title="Close">✕</button>
      </div>
      <div id="tpl-body">
        <div class="tpl-panelbox">
          <textarea id="tpl-input" placeholder="Paste Hurrier couriers JSON here (or use Fetch Live Data)..."></textarea>
          <div class="tpl-row">
            <button id="tpl-parseBtn" class="tpl-btn">Parse &amp; Refresh</button>
            <button id="tpl-fetchBtn" class="tpl-btn">Fetch Live Data (all zones)</button>
            <label style="font-size:12px;color:#9aa1ac;display:flex;align-items:center;gap:6px;">
              <input type="checkbox" id="tpl-autoRefresh"> Auto-refresh every
              <select id="tpl-refreshMins" style="background:#1e222b;color:#e8eaed;border:1px solid #2a2f3a;border-radius:6px;padding:2px 6px;">
                <option value="2">2m</option><option value="3" selected>3m</option><option value="5">5m</option><option value="10">10m</option>
              </select>
            </label>
            <button id="tpl-exportBtn" class="tpl-btn secondary" disabled>Export Excel (per 3PL)</button>
            <button id="tpl-resetBtn" class="tpl-btn secondary">Reset idle timers</button>
            <span id="tpl-status"></span>
          </div>
        </div>
        <div id="tpl-statsRow" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;"></div>
        <div id="tpl-zoneRow" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;"></div>
        <div id="tpl-results"></div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  document.getElementById('tpl-close').addEventListener('click', function () {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    root.remove();
    style.remove();
  });

  // ---------- xlsx loader ----------
  var xlsxReady = new Promise(function (resolve, reject) {
    if (window.XLSX) return resolve();
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });

  // ---------- idle timer storage ----------
  function getIdleStart(id) { var v = localStorage.getItem(LS_PREFIX + id); return v ? parseInt(v, 10) : null; }
  function setIdleStart(id, ts) { localStorage.setItem(LS_PREFIX + id, String(ts)); }
  function clearIdleStart(id) { localStorage.removeItem(LS_PREFIX + id); }

  function extractCouriers(raw) {
    try {
      var obj = JSON.parse(raw);
      if (Array.isArray(obj.couriers)) return obj.couriers;
      if (Array.isArray(obj)) return obj;
    } catch (e) { /* fall through */ }
    var couriers = [], depth = 0, start = -1;
    for (var i = 0; i < raw.length; i++) {
      var ch = raw[i];
      if (ch === '{') { if (depth === 0) start = i; depth++; }
      else if (ch === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          var chunk = raw.slice(start, i + 1);
          try { var o = JSON.parse(chunk); if (Array.isArray(o.couriers)) couriers.push.apply(couriers, o.couriers); } catch (e) {}
          start = -1;
        }
      }
    }
    return couriers;
  }

  function fmtMins(ms) {
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60), r = m % 60;
    return h > 0 ? (h + 'h ' + r + 'm') : (m + 'm');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  var lastFlagged = { late: [], idle: [] };

  var lastAllRows = []; // every rider, normalized, for status-click filtering

  function process(couriers) {
    var now = Date.now();
    var late = [], idleAll = [], allRows = [];
    var statusCounts = {};

    couriers.forEach(function (entry) {
      var c = entry.courier || {};
      if (c.id == null) return;
      var st = c.status || 'unknown';
      statusCounts[st] = (statusCounts[st] || 0) + 1;

      var activeCount = entry.active_delivery_count != null ? entry.active_delivery_count : 0;
      var zone = zoneNameFor(entry.__spId);
      var base = { id: c.id, name: c.name || '', phone: c.phone_number || '', contract: c.contract_name || 'Unknown 3PL', status: c.status || '', activeOrders: activeCount, zone: zone };

      var row = Object.assign({}, base, { reason: STATUS_LABELS[st] || st });

      if (c.status === 'late') {
        row = Object.assign({}, base, { reason: 'Late' });
        late.push(row);
        clearIdleStart(c.id);
        allRows.push(row);
        return;
      }
      if (c.status === 'working' && activeCount === 0) {
        var start = getIdleStart(c.id);
        if (start == null) { start = now; setIdleStart(c.id, start); }
        var elapsed = now - start;
        var flagged = elapsed >= IDLE_THRESHOLD_MS;
        row = Object.assign({}, base, {
          reason: 'Idle ' + fmtMins(elapsed),
          idleSince: new Date(start).toLocaleTimeString(),
          elapsedMs: elapsed,
          flagged: flagged
        });
        idleAll.push(row);
        allRows.push(row);
        return;
      }
      clearIdleStart(c.id);
      allRows.push(row);
    });

    // sort idle list longest-idle first so the worst cases are on top
    idleAll.sort(function (a, b) { return b.elapsedMs - a.elapsedMs; });
    var idleFlagged = idleAll.filter(function (r) { return r.flagged; });
    lastFlagged = { late: late, idle: idleFlagged, lateAll: late, idleAllView: idleAll };
    lastAllRows = allRows;
    renderAll(); // preserves activeFilter/activeZone/sort across refreshes
  }

  function groupBy3PL(list) {
    var groups = {};
    list.forEach(function (r) { (groups[r.contract] = groups[r.contract] || []).push(r); });
    return groups;
  }

  function rowHtml(r, kind) {
    return '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.phone) + '</td><td>' + esc(r.zone) + '</td><td>' + esc(r.status) +
      '</td><td>' + r.activeOrders + '</td><td><span class="tpl-tag ' + kind + '">' + esc(r.reason) + '</span></td></tr>';
  }

  function kindForStatus(status) {
    if (status === 'late') return 'late';
    return 'idle-mild';
  }

  var STATUS_LABELS = { working: 'Working', break: 'Break', late: 'Late', ending: 'Ending', starting: 'Starting', temp_not_working: 'Temp not working', unknown: 'Unknown' };
  var ZONE_ORDER = ['Maadi', 'Mokattam', 'Helwan'];
  var SORT_COLS = [['Name', 'name'], ['Phone', 'phone'], ['Zone', 'zone'], ['Status', 'status'], ['Orders', 'activeOrders'], ['Reason', 'reason']];
  var activeFilter = null; // status key currently filtered on, or null for the default Late&Idle view
  var activeZone = null;   // zone name currently filtered on, or null for all zones
  var sortKey = null, sortDir = 'asc';

  function zoneFilteredRows(rows) {
    if (activeZone === null) return rows;
    return rows.filter(function (r) { return r.zone === activeZone; });
  }

  function sortRows(rows) {
    if (!sortKey) return rows;
    var copy = rows.slice();
    copy.sort(function (a, b) {
      var av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'activeOrders') { av = Number(av) || 0; bv = Number(bv) || 0; }
      else { av = String(av == null ? '' : av).toLowerCase(); bv = String(bv == null ? '' : bv).toLowerCase(); }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }

  function theadHtml() {
    return '<thead><tr>' + SORT_COLS.map(function (c) {
      var arrow = sortKey === c[1] ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';
      return '<th class="tpl-sortable" data-sort="' + c[1] + '">' + c[0] + arrow + '</th>';
    }).join('') + '</tr></thead>';
  }

  function renderTableGroups(rows, kindFn) {
    var sorted = sortRows(rows);
    var groups = groupBy3PL(sorted);
    var all3PLs = Object.keys(groups).sort();
    if (all3PLs.length === 0) {
      return '<div class="tpl-panelbox"><div class="tpl-empty">No riders in this view. 🎉</div></div>';
    }
    return all3PLs.map(function (pl) {
      var rowsHtml = groups[pl].map(function (r) { return rowHtml(r, kindFn(r)); }).join('');
      return '<div class="tpl-panelbox tpl-group"><h2>' + esc(pl) + ' <span class="tpl-badge">' + groups[pl].length + ' total</span></h2>' +
        '<table>' + theadHtml() + '<tbody>' + rowsHtml + '</tbody></table></div>';
    }).join('');
  }

  function renderResults() {
    var results = document.getElementById('tpl-results');
    var exportBtn = document.getElementById('tpl-exportBtn');
    var zoneBit = activeZone ? (' in <strong>' + esc(activeZone) + '</strong>') : '';
    var clearZoneBtn = activeZone ? ' <button id="tpl-clearZone" class="tpl-btn secondary" style="padding:3px 10px;font-size:11px;">Clear zone</button>' : '';

    if (activeFilter === null) {
      // default view: Late & Idle
      var rows = zoneFilteredRows((lastFlagged.lateAll || []).concat(lastFlagged.idleAllView || []));
      results.innerHTML =
        '<div class="tpl-filter-bar">Showing: <strong>Late &amp; Idle</strong>' + zoneBit + clearZoneBtn +
        ' <span class="tpl-badge">click a stat above to filter by status, or a zone to filter by zone</span></div>' +
        renderTableGroups(rows, function (r) { return r.status === 'late' ? 'late' : (r.flagged ? 'idle' : 'idle-mild'); });
      exportBtn.disabled = rows.length === 0;
    } else {
      var filtered = zoneFilteredRows(lastAllRows.filter(function (r) { return r.status === activeFilter; }));
      var label = STATUS_LABELS[activeFilter] || activeFilter;
      results.innerHTML =
        '<div class="tpl-filter-bar">Showing: <strong>' + esc(label) + '</strong>' + zoneBit + ' (' + filtered.length + ') ' +
        '<button id="tpl-clearFilter" class="tpl-btn secondary" style="padding:3px 10px;font-size:11px;">Back to Late &amp; Idle</button>' + clearZoneBtn + '</div>' +
        renderTableGroups(filtered, function (r) { return kindForStatus(r.status); });
      exportBtn.disabled = filtered.length === 0;
    }

    var clearBtn = document.getElementById('tpl-clearFilter');
    if (clearBtn) clearBtn.addEventListener('click', function () { activeFilter = null; renderResults(); });
    var clearZone = document.getElementById('tpl-clearZone');
    if (clearZone) clearZone.addEventListener('click', function () { activeZone = null; renderAll(); });
  }

  function renderStatsRow() {
    var statsRow = document.getElementById('tpl-statsRow');
    var rows = zoneFilteredRows(lastAllRows);
    var statusCounts = {};
    rows.forEach(function (r) { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; });
    var idleFlaggedCount = rows.filter(function (r) { return r.flagged; }).length;

    var statusStatsHtml = Object.keys(statusCounts).sort().map(function (st) {
      var active = activeFilter === st ? ' tpl-active' : '';
      return '<div class="tpl-stat tpl-clickable' + active + '" data-status="' + esc(st) + '"><div class="n">' + statusCounts[st] + '</div><div class="l">' + esc(STATUS_LABELS[st] || st) + '</div></div>';
    }).join('');

    statsRow.innerHTML =
      '<div class="tpl-stat"><div class="n">' + rows.length + '</div><div class="l">Total riders</div></div>' +
      statusStatsHtml +
      '<div class="tpl-stat idle"><div class="n">' + idleFlaggedCount + '</div><div class="l">Idle 30m+ (flagged)</div></div>';

    Array.prototype.forEach.call(statsRow.querySelectorAll('.tpl-clickable'), function (el) {
      el.addEventListener('click', function () {
        var st = el.getAttribute('data-status');
        activeFilter = (activeFilter === st) ? null : st; // click again to clear
        renderAll();
      });
    });
  }

  function renderZoneStats() {
    var zoneRow = document.getElementById('tpl-zoneRow');
    var counts = {};
    lastAllRows.forEach(function (r) { counts[r.zone] = (counts[r.zone] || 0) + 1; });
    var zones = Object.keys(counts).sort(function (a, b) {
      var ai = ZONE_ORDER.indexOf(a), bi = ZONE_ORDER.indexOf(b);
      if (ai === -1) ai = 100;
      if (bi === -1) bi = 100;
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    });

    zoneRow.innerHTML = zones.map(function (z) {
      var active = activeZone === z ? ' tpl-active' : '';
      return '<div class="tpl-stat tpl-clickable' + active + '" data-zone="' + esc(z) + '"><div class="n">' + counts[z] + '</div><div class="l">' + esc(z) + '</div></div>';
    }).join('');

    Array.prototype.forEach.call(zoneRow.querySelectorAll('.tpl-clickable'), function (el) {
      el.addEventListener('click', function () {
        var z = el.getAttribute('data-zone');
        activeZone = (activeZone === z) ? null : z; // click again to clear
        renderAll();
      });
    });
  }

  function renderAll() {
    renderStatsRow();
    renderZoneStats();
    renderResults();
  }

  // column-header sort clicks (event delegation so it survives re-renders)
  document.getElementById('tpl-results').addEventListener('click', function (e) {
    var th = e.target.closest ? e.target.closest('th[data-sort]') : null;
    if (!th) return;
    var key = th.getAttribute('data-sort');
    if (sortKey === key) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
    else { sortKey = key; sortDir = 'asc'; }
    renderResults();
  });

  document.getElementById('tpl-parseBtn').addEventListener('click', function () {
    var raw = document.getElementById('tpl-input').value.trim();
    var statusLine = document.getElementById('tpl-status');
    if (!raw) { statusLine.textContent = 'Paste JSON first.'; return; }
    try {
      var couriers = extractCouriers(raw);
      if (couriers.length === 0) { statusLine.textContent = 'No couriers found in pasted data.'; return; }
      process(couriers);
      statusLine.textContent = 'Parsed ' + couriers.length + ' riders at ' + new Date().toLocaleTimeString();
    } catch (e) {
      statusLine.textContent = 'Could not parse JSON: ' + e.message;
    }
  });

  document.getElementById('tpl-resetBtn').addEventListener('click', function () {
    Object.keys(localStorage).filter(function (k) { return k.indexOf(LS_PREFIX) === 0; }).forEach(function (k) { localStorage.removeItem(k); });
    document.getElementById('tpl-status').textContent = 'Idle timers reset.';
  });

  function fetchLive() {
    var statusLine = document.getElementById('tpl-status');
    statusLine.textContent = 'Fetching live data (' + STARTING_POINT_IDS.length + ' starting points)...';
    var authToken = localStorage.getItem('token');
    var fetchOpts = {
      credentials: 'include',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest'
      }
    };
    if (authToken) fetchOpts.headers['Authorization'] = 'Bearer ' + authToken;
    Promise.all(STARTING_POINT_IDS.map(function (spId) {
      return fetch(API_BASE + spId, fetchOpts)
        .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status + ' for SP ' + spId); return res.json(); })
        .then(function (data) {
          var list = Array.isArray(data.couriers) ? data.couriers : [];
          list.forEach(function (entry) { entry.__spId = spId; });
          return list;
        })
        .catch(function (e) { console.warn('3PL tool: failed to fetch SP', spId, e); return []; });
    })).then(function (results) {
      var couriers = [].concat.apply([], results);
      if (couriers.length === 0) { statusLine.textContent = 'Fetched but got 0 couriers total \u2014 check console for per-SP errors.'; return; }
      document.getElementById('tpl-input').value = JSON.stringify({ couriers: couriers });
      process(couriers);
      statusLine.textContent = 'Fetched ' + couriers.length + ' riders live at ' + new Date().toLocaleTimeString();
    });
  }

  var autoRefreshTimer = null;
  document.getElementById('tpl-autoRefresh').addEventListener('change', function (e) {
    if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
    if (e.target.checked) {
      var mins = parseInt(document.getElementById('tpl-refreshMins').value, 10);
      autoRefreshTimer = setInterval(fetchLive, mins * 60 * 1000);
      fetchLive();
    }
  });
  document.getElementById('tpl-refreshMins').addEventListener('change', function () {
    if (document.getElementById('tpl-autoRefresh').checked) {
      document.getElementById('tpl-autoRefresh').dispatchEvent(new Event('change'));
    }
  });
  document.getElementById('tpl-fetchBtn').addEventListener('click', fetchLive);

  document.getElementById('tpl-exportBtn').addEventListener('click', function () {
    xlsxReady.then(function () {
      var wb = XLSX.utils.book_new();
      // export whatever is currently on screen: the active status filter,
      // or the default Late & Idle view when no filter is active
      var exportRows = zoneFilteredRows(activeFilter === null
        ? (lastFlagged.lateAll || []).concat(lastFlagged.idleAllView || [])
        : lastAllRows.filter(function (r) { return r.status === activeFilter; }));
      var groups = groupBy3PL(sortRows(exportRows));
      Object.keys(groups).sort().forEach(function (pl) {
        var rows = groups[pl].map(function (r) {
          return { Name: r.name, Phone: r.phone, Zone: r.zone, Status: r.status, 'Active Orders': r.activeOrders, Reason: r.reason };
        });
        var ws = XLSX.utils.json_to_sheet(rows);
        var sheetName = pl.substring(0, 31).replace(/[\\/*?:\[\]]/g, '');
        XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Sheet');
      });
      var suffix = (activeFilter === null ? 'late_idle' : activeFilter) + (activeZone ? ('_' + activeZone) : '');
      XLSX.writeFile(wb, '3PL_followup_' + suffix + '_' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.xlsx');
    }).catch(function () {
      document.getElementById('tpl-status').textContent = 'Could not load Excel export library.';
    });
  });
})();
