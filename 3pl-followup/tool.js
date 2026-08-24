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
  var LATE_LS_PREFIX = 'tpl_lateactive_'; // marks a rider as "currently in a late episode" so repeated polls don't over-count
  function isLateActive(id) { return localStorage.getItem(LATE_LS_PREFIX + id) === '1'; }
  function setLateActive(id, v) { if (v) localStorage.setItem(LATE_LS_PREFIX + id, '1'); else localStorage.removeItem(LATE_LS_PREFIX + id); }

  // ---------- per-rider Daily Flow (break time / break count / orders today) ----------
  // GET .../api/dispatcher-dashboard/courier/flow?courier_id=<id>&date=YYYY-MM-DD
  var FLOW_API_BASE = 'https://eg.me.logisticsbackoffice.com/api/dispatcher-dashboard/courier/flow?courier_id=';
  var FLOW_CONCURRENCY = 6; // parallel requests at a time — keep modest, this can be called on 100+ riders
  var flowCache = {}; // courier id -> { breakMin, breakCount, orders, shifts, workingMin, fetchedAt } | { error: true }

  // ---------- EDIT ME: starting_point_id -> Zone name ----------
  // Fill this in with your real IDs (check the Network tab URL, e.g.
  // ?starting_point_id=10228, while switching zones in the sidebar).
  // Any starting_point_id not listed here falls back to "Zone " + id.
  var ZONE_MAP = {
    '10174': 'Maadi',    // Hybrid fleet maadi
    '10228': 'Maadi',    // Hybrid fleet maadi laselky
    '10215': 'Maadi',    // Hybrid fleet maadi meraag
    '10232': 'Maadi',    // Hybrid fleet maadi old
    '10130': 'Maadi',    // Maadi nesting sp
    '10002': 'Maadi',    // New maadi
    '10003': 'Maadi',    // Old maadi
    '10009': 'Maadi',    // Zahraa maadi and meraag
    '10161': 'Maadi',    // Zahraa maadi nesting
    '10231': 'Mokattam', // Hybrid fleet mokattam easy sports
    '10217': 'Mokattam', // Hybrid fleet mokattam mafarik
    '10227': 'Mokattam', // Hybrid fleet mokattam nafora
    '10001': 'Mokattam', // Mokattam sp
    '10064': 'Mokattam', // Mokkatam asmarat sp
    '10020': 'Helwan',   // Helwan SP
    '10241': 'Helwan',
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
            <button id="tpl-dailyReportBtn" class="tpl-btn secondary">Export Daily Report</button>
            <button id="tpl-flowBtn" class="tpl-btn secondary">Fetch Daily Flow (all / filtered)</button>
            <button id="tpl-flowExportBtn" class="tpl-btn secondary">Export Daily Flow (per 3PL)</button>
            <button id="tpl-lowPerfFlowBtn" class="tpl-btn secondary">Export Low Performers Flow (3h+, \u22645 orders)</button>
            <button id="tpl-weeklyLateFetchBtn" class="tpl-btn secondary">Fetch Historical Late (7 days)</button>
            <button id="tpl-weeklyLateBtn" class="tpl-btn secondary">Weekly Late Summary (7 days)</button>
            <button id="tpl-weeklyLateExportBtn" class="tpl-btn secondary">Export Late 2+ Days (past week)</button>
            <button id="tpl-resetBtn" class="tpl-btn secondary">Reset idle timers</button>
            <button id="tpl-resetFiltersBtn" class="tpl-btn secondary">Reset filters</button>
            <span id="tpl-status"></span>
          </div>
        </div>
        <div id="tpl-statsRow" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;"></div>
        <div id="tpl-zoneRow" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px;"></div>
        <div style="font-size:11px;color:#7d8590;margin-bottom:6px;">Hybrid fleet / starting points:</div>
        <div id="tpl-spRow" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;"></div>
        <div style="margin-bottom:16px;">
          <button id="tpl-debugZonesBtn" class="tpl-btn secondary" style="padding:4px 10px;font-size:11px;">Show raw starting-point IDs (for zone mapping)</button>
          <div id="tpl-debugZones" style="display:none;flex-wrap:wrap;gap:8px;margin-top:10px;"></div>
        </div>
        <div id="tpl-weeklyLateResults"></div>
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

  // ---------- daily report storage (persists in localStorage per calendar day) ----------
  // ---------- EDIT ME: "low orders for the shift" thresholds ----------
  var LOW_ORDER_SHIFT_HOURS_THRESHOLD_MS = 3 * 60 * 60 * 1000; // only flag riders whose shift is at least this long (default 3h)
  var LOW_ORDER_MAX_ORDERS = 5; // flag if their approx. order count for the shift is below this (default 5)
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function loadDailyRegistry() {
    try { var raw = localStorage.getItem('tpl_daily_' + todayKey()); return raw ? JSON.parse(raw) : {}; }
    catch (e) { return {}; }
  }
  function saveDailyRegistry(reg) {
    try { localStorage.setItem('tpl_daily_' + todayKey(), JSON.stringify(reg)); } catch (e) { /* storage full or blocked — skip */ }
  }
  // drop old-day registries so localStorage doesn't grow forever (keep last 14 days)
  (function cleanupOldDailyRegistries() {
    var cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    var currentKey = 'tpl_daily_' + todayKey();
    Object.keys(localStorage).forEach(function (k) {
      if (k.indexOf('tpl_daily_') !== 0 || k === currentKey) return;
      var m = k.match(/^tpl_daily_(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return;
      var t = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
      if (t < cutoff) localStorage.removeItem(k);
    });
  })();

  // ---------- weekly late summary (built from the last 7 days of daily registries already saved in this browser) ----------
  function loadRegistryForDate(dateKey) {
    if (dateKey === todayKey()) return dailyRegistry; // today's in-memory copy is the freshest source
    try { var raw = localStorage.getItem('tpl_daily_' + dateKey); return raw ? JSON.parse(raw) : {}; }
    catch (e) { return {}; }
  }
  function last7DateKeys() {
    var keys = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      keys.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
    }
    return keys; // today first, oldest last
  }
  // For each rider: how many of the last 7 days had at least one late count
  // (daysLate), the total late count across those days (totalLateEpisodes),
  // and a per-day breakdown. Prefers REAL data fetched from the Flow API
  // (weeklyFlowCache, via "Fetch Historical Late") when available for that
  // rider+day; otherwise falls back to the live-tracked estimate this tool
  // recorded itself while running (dailyRegistry.timesLate). Riders with 0
  // late days this week are excluded entirely.
  function computeWeeklyLateSummary() {
    var dateKeys = last7DateKeys();
    var summary = {};
    var identity = {};
    lastAllRows.forEach(function (r) { identity[r.id] = { name: r.name, phone: r.phone, zone: r.zone, contract: r.contract }; });

    dateKeys.forEach(function (dk) {
      var reg = loadRegistryForDate(dk);
      var idsToday = {};
      Object.keys(reg).forEach(function (id) { idsToday[id] = true; });
      Object.keys(weeklyFlowCache).forEach(function (id) { if (weeklyFlowCache[id][dk]) idsToday[id] = true; });

      Object.keys(idsToday).forEach(function (id) {
        var regRec = reg[id];
        var fetched = weeklyFlowCache[id] && weeklyFlowCache[id][dk];
        var lateCount = null, source = null;
        if (fetched && !fetched.error && fetched.lateCount != null) { lateCount = fetched.lateCount; source = 'flow'; }
        else if (regRec && regRec.timesLate) { lateCount = regRec.timesLate; source = 'tracked'; }
        if (!lateCount || lateCount <= 0) return;

        if (!summary[id]) {
          var idn = identity[id] || {};
          summary[id] = {
            id: id,
            name: (regRec && regRec.name) || idn.name || '',
            phone: (regRec && regRec.phone) || idn.phone || '',
            zone: (regRec && regRec.zone) || idn.zone || '',
            contract: (regRec && regRec.contract) || idn.contract || 'Unknown 3PL',
            daysLateCount: 0, totalLateEpisodes: 0, perDay: {}, perDaySource: {}, perDayTimes: {}
          };
        }
        var s = summary[id];
        s.daysLateCount += 1;
        s.totalLateEpisodes += lateCount;
        s.perDay[dk] = lateCount;
        s.perDaySource[dk] = source;
        s.perDayTimes[dk] = (fetched && fetched.lateTimes) ? fetched.lateTimes : [];
      });
    });
    return summary;
  }

  function fmtMins(ms) {
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60), r = m % 60;
    return h > 0 ? (h + 'h ' + r + 'm') : (m + 'm');
  }
  var fmtHrs = fmtMins; // same h/m formatting works for longer shift durations too

  // Same "Xh Ym" format as the on-screen table (see cellMin in rowHtml), but
  // for minute-value fields (flow working/break minutes) instead of ms -
  // used everywhere we export those fields to Excel so exports match the UI.
  function fmtFlowMin(v) {
    if (v == null) return '';
    var totalMin = Math.round(v);
    if (totalMin >= 60) { var h = Math.floor(totalMin / 60), m = totalMin % 60; return h + 'h ' + m + 'm'; }
    return totalMin + 'm';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  var lastFlagged = { late: [], idle: [] };

  var lastAllRows = []; // every rider, normalized, for status-click filtering
  var currentRegistryDate = todayKey();
  var dailyRegistry = loadDailyRegistry(); // riderId -> accumulated stats for today

  function process(couriers) {
    var now = Date.now();
    var td = todayKey();
    if (td !== currentRegistryDate) { currentRegistryDate = td; dailyRegistry = loadDailyRegistry(); } // new calendar day — fresh registry
    var late = [], idleAll = [], allRows = [];
    var statusCounts = {};

    couriers.forEach(function (entry) {
      var c = entry.courier || {};
      if (c.id == null) return;
      var st = c.status || 'unknown';
      statusCounts[st] = (statusCounts[st] || 0) + 1;
      if (st !== 'late' && isLateActive(c.id)) setLateActive(c.id, false); // episode ended

      var activeCount = entry.active_delivery_count != null ? entry.active_delivery_count : 0;
      var zone = zoneNameFor(entry.__spId);
      var base = { id: c.id, name: c.name || '', phone: c.phone_number || '', contract: c.contract_name || 'Unknown 3PL', status: c.status || '', activeOrders: activeCount, zone: zone, spId: entry.__spId };

      // ---- daily registry bookkeeping (survives refreshes/reloads via localStorage) ----
      var rec = dailyRegistry[c.id] || { totalIdleMs: 0, timesIdle: 0, longestIdleMs: 0, everHadOrder: false, approxOrderCount: 0, prevActiveOrders: 0, timesLate: 0 };
      rec.name = base.name; rec.phone = base.phone; rec.zone = base.zone; rec.contract = base.contract;
      rec.lastStatus = base.status; rec.lastActiveOrders = activeCount; rec.lastSeen = now;
      if (activeCount > 0) rec.everHadOrder = true; // tracks whether they EVER had an order today, across all snapshots
      // approximate total orders for the shift: the API only exposes CURRENT active
      // order count, not a running daily total, so we infer new pickups from
      // increases between consecutive snapshots (a rise from 1->2 = +1 order, a
      // drop just means an order was completed/dropped, not a new one).
      var prevActive = rec.prevActiveOrders || 0;
      if (activeCount > prevActive) rec.approxOrderCount = (rec.approxOrderCount || 0) + (activeCount - prevActive);
      rec.prevActiveOrders = activeCount;
      if (entry.active_shift_started_at) rec.shiftStartedAt = entry.active_shift_started_at;
      rec.shiftHoursSoFar = rec.shiftStartedAt ? Math.max(0, now - Date.parse(rec.shiftStartedAt)) : null;
      dailyRegistry[c.id] = rec;


      function finalizeIdleStreak() {
        var start = getIdleStart(c.id);
        if (start != null) {
          var elapsed = now - start;
          rec.totalIdleMs += elapsed;
          rec.timesIdle += 1;
          if (elapsed > rec.longestIdleMs) rec.longestIdleMs = elapsed;
        }
        clearIdleStart(c.id);
      }

      var row = Object.assign({}, base, { reason: STATUS_LABELS[st] || st });

      if (c.status === 'late') {
        if (!isLateActive(c.id)) { rec.timesLate = (rec.timesLate || 0) + 1; setLateActive(c.id, true); } // new episode -> count it once
        row = Object.assign({}, base, { reason: 'Late' });
        late.push(row);
        finalizeIdleStreak();
        allRows.push(row);
        return;
      }
      if (activeCount === 0) {
        // idle tracking now applies to ANY status (working, break, ending,
        // starting, temp_not_working, unknown) — not just "working" — as
        // long as the rider has 0 active orders.
        var start = getIdleStart(c.id);
        if (start == null) { start = now; setIdleStart(c.id, start); }
        var elapsed = now - start;
        var flagged = elapsed >= IDLE_THRESHOLD_MS;
        var statusPrefix = (st === 'working') ? '' : ((STATUS_LABELS[st] || st) + ' \u2022 ');
        row = Object.assign({}, base, {
          reason: statusPrefix + 'Idle ' + fmtMins(elapsed),
          idleSince: new Date(start).toLocaleTimeString(),
          elapsedMs: elapsed,
          flagged: flagged
        });
        idleAll.push(row);
        allRows.push(row);
        return;
      }
      finalizeIdleStreak();
      allRows.push(row);
    });

    saveDailyRegistry(dailyRegistry);

    // sort idle list longest-idle first so the worst cases are on top
    idleAll.sort(function (a, b) { return b.elapsedMs - a.elapsedMs; });
    var idleFlagged = idleAll.filter(function (r) { return r.flagged; });
    lastFlagged = { late: late, idle: idleFlagged, lateAll: late, idleAllView: idleAll };
    lastAllRows = allRows;
    renderAll(); // preserves activeFilter/activeZone/sort across refreshes
  }

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

  function groupBy3PL(list) {
    var groups = {};
    list.forEach(function (r) { (groups[r.contract] = groups[r.contract] || []).push(r); });
    return groups;
  }

  function rowHtml(r, kind) {
    var na = '\u2014';
    var cell = function (v) { return v != null ? v : na; };
    // minute-based flow fields render as "Xh Ym" once they pass 60, and get
    // rounded to whole minutes to avoid floating-point noise (401.58000000000004 -> 6h 42m)
    var cellMin = function (v) {
      if (v == null) return na;
      var totalMin = Math.round(v);
      if (totalMin >= 60) { var h = Math.floor(totalMin / 60), m = totalMin % 60; return h + 'h ' + m + 'm'; }
      return totalMin + 'm';
    };
    return '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.phone) + '</td><td>' + esc(r.zone) + '</td><td>' + esc(r.status) +
      '</td><td>' + r.activeOrders + '</td>' +
      '<td>' + cell(r.flowShiftCount) + '</td>' +
      '<td>' + cellMin(r.flowWorkingMin) + '</td>' +
      '<td>' + cellMin(r.flowBreakMin) + '</td>' +
      '<td>' + cell(r.flowBreakCount) + '</td>' +
      '<td>' + cellMin(r.flowAutoBreakMin) + '</td>' +
      '<td>' + cellMin(r.flowCourierBreakMin) + '</td>' +
      '<td>' + cellMin(r.flowManualBreakMin) + '</td>' +
      '<td>' + cell(r.flowNotified) + '</td>' +
      '<td>' + cell(r.flowAccepted) + '</td>' +
      '<td>' + cell(r.flowCompleted) + '</td>' +
      '<td>' + cell(r.flowUnDispatched) + '</td>' +
      '<td><span class="tpl-tag ' + kind + '">' + esc(r.reason) + '</span></td></tr>';
  }

  function kindForRow(r) {
    if (r.status === 'late') return 'late';
    if (r.flagged) return 'idle';
    if (r.elapsedMs != null) return 'idle-mild';
    return 'idle-mild';
  }

  var STATUS_LABELS = { working: 'Working', break: 'Break', late: 'Late', ending: 'Ending', starting: 'Starting', temp_not_working: 'Temp not working', unknown: 'Unknown' };
  var ZONE_ORDER = ['Maadi', 'Mokattam', 'Helwan'];
  var SP_NAMES = {
    '10174': 'Hybrid fleet maadi',
    '10228': 'Hybrid fleet maadi laselky',
    '10215': 'Hybrid fleet maadi meraag',
    '10232': 'Hybrid fleet maadi old',
    '10130': 'Maadi nesting sp',
    '10002': 'New maadi',
    '10003': 'Old maadi',
    '10009': 'Zahraa maadi and meraag',
    '10161': 'Zahraa maadi nesting',
    '10231': 'Hybrid fleet mokattam easy sports',
    '10217': 'Hybrid fleet mokattam mafarik',
    '10227': 'Hybrid fleet mokattam nafora',
    '10001': 'Mokattam sp',
    '10064': 'Mokkatam asmarat sp',
    '10020': 'Helwan SP'
    // 10241 / 10135 have no confirmed name yet — they'll show as "SP 10241" / "SP 10135".
  };
  function spNameFor(spId) {
    if (spId == null) return 'Unknown SP';
    return SP_NAMES[String(spId)] || ('SP ' + spId);
  }
  var SORT_COLS = [['Name', 'name'], ['Phone', 'phone'], ['Zone', 'zone'], ['Status', 'status'], ['Live Orders', 'activeOrders'],
    ['Shifts', 'flowShiftCount'], ['Working', 'flowWorkingMin'],
    ['Break Total', 'flowBreakMin'], ['Break Count', 'flowBreakCount'],
    ['Auto Break', 'flowAutoBreakMin'], ['Courier Break', 'flowCourierBreakMin'], ['Manual Break', 'flowManualBreakMin'],
    ['Notified', 'flowNotified'], ['Accepted', 'flowAccepted'], ['Completed', 'flowCompleted'], ['Undispatched', 'flowUnDispatched'],
    ['Reason', 'reason']];
  var FLOW_NUMERIC_KEYS = ['flowShiftCount', 'flowWorkingMin', 'flowBreakMin', 'flowBreakCount', 'flowAutoBreakMin',
    'flowCourierBreakMin', 'flowManualBreakMin', 'flowNotified', 'flowAccepted', 'flowCompleted', 'flowUnDispatched']; // unfetched (null) sorts as -1, i.e. always last in desc / first in asc
  var activeFilter = null; // status key currently filtered on, or null for the default Late&Idle view
  var activeZone = null;   // zone name currently filtered on, or null for all zones
  var activeSP = null;     // starting_point_id currently filtered on, or null for all SPs
  var sortKey = null, sortDir = 'asc';

  function zoneFilteredRows(rows) {
    if (activeSP !== null) rows = rows.filter(function (r) { return String(r.spId) === String(activeSP); });
    else if (activeZone !== null) rows = rows.filter(function (r) { return r.zone === activeZone; });
    return rows;
  }

  // Mirrors the branching in renderResults(), so the Zone / SP boxes count
  // the same set of rows that the table below is currently showing.
  function statusFilteredRows(rows) {
    if (activeFilter === null) {
      return rows.filter(function (r) { return r.status === 'late' || r.elapsedMs != null; });
    } else if (activeFilter === '__idle30__') {
      return rows.filter(function (r) { return r.flagged; });
    } else if (activeFilter === '__all__') {
      return rows;
    } else {
      return rows.filter(function (r) { return r.status === activeFilter; });
    }
  }

  function sortRows(rows) {
    if (!sortKey) return rows;
    var copy = rows.slice();
    copy.sort(function (a, b) {
      var av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'activeOrders') { av = Number(av) || 0; bv = Number(bv) || 0; }
      else if (FLOW_NUMERIC_KEYS.indexOf(sortKey) !== -1) { av = av == null ? -1 : Number(av); bv = bv == null ? -1 : Number(bv); }
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
    var scopeBit = activeSP !== null ? (' in <strong>' + esc(spNameFor(activeSP)) + '</strong>') : (activeZone ? (' in <strong>' + esc(activeZone) + '</strong>') : '');
    var clearZoneBtn = (activeZone || activeSP !== null) ? ' <button id="tpl-clearZone" class="tpl-btn secondary" style="padding:3px 10px;font-size:11px;">Clear zone/SP</button>' : '';

    if (activeFilter === null) {
      // default view: Late & Idle (any status)
      var rows = zoneFilteredRows((lastFlagged.lateAll || []).concat(lastFlagged.idleAllView || []));
      results.innerHTML =
        '<div class="tpl-filter-bar">Showing: <strong>Late &amp; Idle</strong>' + scopeBit + clearZoneBtn +
        ' <span class="tpl-badge">click a stat above to filter by status, or a zone to filter by zone</span></div>' +
        renderTableGroups(decorateWithFlow(rows), kindForRow);
      exportBtn.disabled = rows.length === 0;
    } else if (activeFilter === '__idle30__') {
      // idle 30m+ across ANY status
      var idleRows = zoneFilteredRows((lastFlagged.idleAllView || []).filter(function (r) { return r.flagged; }));
      results.innerHTML =
        '<div class="tpl-filter-bar">Showing: <strong>Idle 30m+ (any status)</strong>' + scopeBit + ' (' + idleRows.length + ') ' +
        '<button id="tpl-clearFilter" class="tpl-btn secondary" style="padding:3px 10px;font-size:11px;">Back to Late &amp; Idle</button>' + clearZoneBtn + '</div>' +
        renderTableGroups(decorateWithFlow(idleRows), kindForRow);
      exportBtn.disabled = idleRows.length === 0;
    } else if (activeFilter === '__all__') {
      // every rider, any status
      var allRows = zoneFilteredRows(lastAllRows);
      results.innerHTML =
        '<div class="tpl-filter-bar">Showing: <strong>All riders</strong>' + scopeBit + ' (' + allRows.length + ') ' +
        '<button id="tpl-clearFilter" class="tpl-btn secondary" style="padding:3px 10px;font-size:11px;">Back to Late &amp; Idle</button>' + clearZoneBtn + '</div>' +
        renderTableGroups(decorateWithFlow(allRows), kindForRow);
      exportBtn.disabled = allRows.length === 0;
    } else {
      var filtered = zoneFilteredRows(lastAllRows.filter(function (r) { return r.status === activeFilter; }));
      var label = STATUS_LABELS[activeFilter] || activeFilter;
      results.innerHTML =
        '<div class="tpl-filter-bar">Showing: <strong>' + esc(label) + '</strong>' + scopeBit + ' (' + filtered.length + ') ' +
        '<button id="tpl-clearFilter" class="tpl-btn secondary" style="padding:3px 10px;font-size:11px;">Back to Late &amp; Idle</button>' + clearZoneBtn + '</div>' +
        renderTableGroups(decorateWithFlow(filtered), kindForRow);
      exportBtn.disabled = filtered.length === 0;
    }

    var clearBtn = document.getElementById('tpl-clearFilter');
    if (clearBtn) clearBtn.addEventListener('click', function () { activeFilter = null; renderResults(); });
    var clearZone = document.getElementById('tpl-clearZone');
    if (clearZone) clearZone.addEventListener('click', function () { activeZone = null; activeSP = null; renderAll(); });
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
      '<div class="tpl-stat tpl-clickable' + (activeFilter === '__all__' ? ' tpl-active' : '') + '" data-status="__all__"><div class="n">' + rows.length + '</div><div class="l">Total riders</div></div>' +
      statusStatsHtml +
      '<div class="tpl-stat idle tpl-clickable' + (activeFilter === '__idle30__' ? ' tpl-active' : '') + '" data-status="__idle30__"><div class="n">' + idleFlaggedCount + '</div><div class="l">Idle 30m+ (any status)</div></div>';

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
    lastAllRows.forEach(function (r) { counts[r.zone] = 0; }); // seed every real zone at 0 so it doesn't disappear when a status filter has 0 matches there
    statusFilteredRows(lastAllRows).forEach(function (r) { counts[r.zone] = (counts[r.zone] || 0) + 1; });
    var zones = Object.keys(counts).sort(function (a, b) {
      var ai = ZONE_ORDER.indexOf(a), bi = ZONE_ORDER.indexOf(b);
      if (ai === -1) ai = 100;
      if (bi === -1) bi = 100;
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    });

    zoneRow.innerHTML = zones.map(function (z) {
      var active = (activeSP === null && activeZone === z) ? ' tpl-active' : '';
      return '<div class="tpl-stat tpl-clickable' + active + '" data-zone="' + esc(z) + '"><div class="n">' + counts[z] + '</div><div class="l">' + esc(z) + '</div></div>';
    }).join('');

    Array.prototype.forEach.call(zoneRow.querySelectorAll('.tpl-clickable'), function (el) {
      el.addEventListener('click', function () {
        var z = el.getAttribute('data-zone');
        activeZone = (activeSP === null && activeZone === z) ? null : z; // click again to clear
        activeSP = null; // zone and SP filters are mutually exclusive
        renderAll();
      });
    });
  }

  function renderSPStats() {
    var spRow = document.getElementById('tpl-spRow');
    if (!spRow) return;
    var counts = {};
    lastAllRows.forEach(function (r) { var id = r.spId == null ? 'unknown' : String(r.spId); counts[id] = 0; }); // seed every real SP at 0
    statusFilteredRows(lastAllRows).forEach(function (r) { var id = r.spId == null ? 'unknown' : String(r.spId); counts[id] = (counts[id] || 0) + 1; });
    var ids = Object.keys(counts).sort(function (a, b) {
      var za = ZONE_MAP[a] || '', zb = ZONE_MAP[b] || '';
      var ai = ZONE_ORDER.indexOf(za), bi = ZONE_ORDER.indexOf(zb);
      if (ai === -1) ai = 100;
      if (bi === -1) bi = 100;
      if (ai !== bi) return ai - bi;
      return spNameFor(a).localeCompare(spNameFor(b));
    });

    spRow.innerHTML = ids.map(function (id) {
      var active = activeSP === id ? ' tpl-active' : '';
      return '<div class="tpl-stat tpl-clickable' + active + '" style="min-width:110px;" data-sp="' + esc(id) + '"><div class="n">' + counts[id] + '</div><div class="l">' + esc(spNameFor(id)) + '</div></div>';
    }).join('');

    Array.prototype.forEach.call(spRow.querySelectorAll('.tpl-clickable'), function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-sp');
        activeSP = (activeSP === id) ? null : id; // click again to clear
        activeZone = null; // zone and SP filters are mutually exclusive
        renderAll();
      });
    });
  }

  function renderDebugZones() {
    var panel = document.getElementById('tpl-debugZones');
    var counts = {};
    lastAllRows.forEach(function (r) { var id = r.spId == null ? 'unknown' : r.spId; counts[id] = (counts[id] || 0) + 1; });
    var ids = Object.keys(counts).sort(function (a, b) { return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0); });
    panel.innerHTML = ids.map(function (id) {
      var mapped = ZONE_MAP[id] ? (' \u2192 ' + esc(ZONE_MAP[id])) : ' \u2192 unmapped';
      return '<div class="tpl-stat" style="min-width:auto;padding:6px 10px;"><div class="n" style="font-size:14px;">' + counts[id] + '</div><div class="l">SP ' + esc(id) + mapped + '</div></div>';
    }).join('');
  }

  var debugZonesVisible = false;
  document.getElementById('tpl-debugZonesBtn').addEventListener('click', function () {
    debugZonesVisible = !debugZonesVisible;
    var panel = document.getElementById('tpl-debugZones');
    panel.style.display = debugZonesVisible ? 'flex' : 'none';
    if (debugZonesVisible) renderDebugZones();
  });

  function renderAll() {
    renderStatsRow();
    renderZoneStats();
    renderSPStats();
    renderResults();
    if (debugZonesVisible) renderDebugZones();
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

  document.getElementById('tpl-resetFiltersBtn').addEventListener('click', function () {
    activeFilter = null;
    activeZone = null;
    activeSP = null;
    sortKey = null;
    sortDir = 'asc';
    renderAll();
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

  var weeklyFlowCache = {}; // courier id -> { 'YYYY-MM-DD': flowResult } - real per-day data fetched from the Flow API (past days)
  function fetchFlowForIdDate(id, dateKey) {
    var url = FLOW_API_BASE + id + '&date=' + dateKey;
    var authToken = localStorage.getItem('token');
    var opts = {
      credentials: 'include',
      headers: { 'Accept': 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' }
    };
    if (authToken) opts.headers['Authorization'] = 'Bearer ' + authToken;
    return fetch(url, opts)
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function (data) {
        var perf = data.performance || {};
        var ov = data.overview || {};
        // CONFIRMED source for "late" (2026-08-25): the Flow API has no
        // late_count field in performance/overview - instead transitions_events
        // is a chronological log of courier status changes, and each time the
        // courier enters the "late" status it appears as one entry with
        // transition_type: "courier", event_title: "late". Count those.
        var events = Array.isArray(data.transitions_events) ? data.transitions_events : [];
        var lateTimes = [];
        events.forEach(function (ev) {
          if (ev && ev.transition_type === 'courier' && ev.event_title === 'late') lateTimes.push(ev.time);
        });
        var lateCount = lateTimes.length;
        return {
          shiftCount: perf.shift_count != null ? perf.shift_count : null,
          breakCount: perf.break_count != null ? perf.break_count : null,
          unDispatched: perf.un_dispatched_count != null ? perf.un_dispatched_count : null,
          notified: perf.notified_count != null ? perf.notified_count : null,
          accepted: perf.accepted_count != null ? perf.accepted_count : null,
          completed: perf.completed_count != null ? perf.completed_count : null,
          workingMin: ov.total_working_duration_in_min != null ? ov.total_working_duration_in_min : null,
          breakMin: ov.total_break_duration_in_min != null ? ov.total_break_duration_in_min : null,
          autoBreakMin: ov.total_automatic_break_duration_in_min != null ? ov.total_automatic_break_duration_in_min : null,
          courierBreakMin: ov.total_courier_break_duration_in_min != null ? ov.total_courier_break_duration_in_min : null,
          manualBreakMin: ov.total_manual_break_duration_in_min != null ? ov.total_manual_break_duration_in_min : null,
          lateCount: lateCount,
          lateTimes: lateTimes,
          fetchedAt: Date.now()
        };
      })
      .catch(function (e) { console.warn('3PL tool: flow fetch failed for courier', id, 'date', dateKey, e); return { error: true }; });
  }
  function fetchFlowForId(id) { return fetchFlowForIdDate(id, todayKey()); }

  // Runs fetchFlowForId across `ids` with at most FLOW_CONCURRENCY in flight at once.
  function fetchFlowForIds(ids, onProgress) {
    var queue = ids.slice();
    var total = queue.length;
    var done = 0;
    function worker() {
      var id = queue.shift();
      if (id === undefined) return Promise.resolve();
      return fetchFlowForId(id).then(function (res) {
        flowCache[id] = res;
        done++;
        if (onProgress) onProgress(done, total);
        return worker();
      });
    }
    var workers = [];
    for (var i = 0; i < Math.min(FLOW_CONCURRENCY, total || 1); i++) workers.push(worker());
    return Promise.all(workers);
  }

  // Fetches courier/flow for each rider x each of the last 7 days (real
  // historical data from the API, not the localStorage estimate).
  // Results land in weeklyFlowCache[id][dateKey].
  function fetchHistoricalLateForIds(ids, onProgress) {
    var dateKeys = last7DateKeys();
    var tasks = [];
    ids.forEach(function (id) { dateKeys.forEach(function (dk) { tasks.push({ id: id, date: dk }); }); });
    var queue = tasks.slice();
    var total = queue.length;
    var done = 0;
    function worker() {
      var t = queue.shift();
      if (!t) return Promise.resolve();
      return fetchFlowForIdDate(t.id, t.date).then(function (res) {
        weeklyFlowCache[t.id] = weeklyFlowCache[t.id] || {};
        weeklyFlowCache[t.id][t.date] = res;
        done++;
        if (onProgress) onProgress(done, total);
        return worker();
      });
    }
    var workers = [];
    for (var i = 0; i < Math.min(FLOW_CONCURRENCY, total || 1); i++) workers.push(worker());
    return Promise.all(workers);
  }

  // Same branching as renderResults() — the set of rows currently on screen
  // (after zone/SP + status filters), before decoration with flow data.
  function currentVisibleRows() {
    if (activeFilter === null) {
      return zoneFilteredRows((lastFlagged.lateAll || []).concat(lastFlagged.idleAllView || []));
    } else if (activeFilter === '__idle30__') {
      return zoneFilteredRows((lastFlagged.idleAllView || []).filter(function (r) { return r.flagged; }));
    } else if (activeFilter === '__all__') {
      return zoneFilteredRows(lastAllRows);
    } else {
      return zoneFilteredRows(lastAllRows.filter(function (r) { return r.status === activeFilter; }));
    }
  }

  // Attaches today's flow data (if fetched) onto row copies so it can be
  // displayed, sorted, and exported like any other column.
  function decorateWithFlow(rows) {
    return rows.map(function (r) {
      var f = flowCache[r.id];
      var ok = f && !f.error;
      return Object.assign({}, r, {
        flowShiftCount: ok ? f.shiftCount : null,
        flowBreakCount: ok ? f.breakCount : null,
        flowUnDispatched: ok ? f.unDispatched : null,
        flowNotified: ok ? f.notified : null,
        flowAccepted: ok ? f.accepted : null,
        flowCompleted: ok ? f.completed : null,
        flowWorkingMin: ok ? f.workingMin : null,
        flowBreakMin: ok ? f.breakMin : null,
        flowAutoBreakMin: ok ? f.autoBreakMin : null,
        flowCourierBreakMin: ok ? f.courierBreakMin : null,
        flowManualBreakMin: ok ? f.manualBreakMin : null
      });
    });
  }

  document.getElementById('tpl-flowBtn').addEventListener('click', function () {
    var statusLine = document.getElementById('tpl-status');
    // If a zone, SP, or status filter is active, only fetch for the riders
    // that filter is currently showing. Otherwise (no filter at all) fetch
    // Daily Flow for every loaded rider.
    var filterActive = activeZone !== null || activeSP !== null || activeFilter !== null;
    var scopeRows = filterActive ? currentVisibleRows() : lastAllRows;
    var scopeLabel = filterActive ? 'current filter' : 'all riders';
    var ids = [];
    scopeRows.forEach(function (r) { if (ids.indexOf(r.id) === -1) ids.push(r.id); });
    if (ids.length === 0) { statusLine.textContent = 'No riders in the current view to fetch.'; return; }
    if (ids.length > 150 && !window.confirm('This will fetch Daily Flow for ' + ids.length + ' riders (' + scopeLabel + ', ' + FLOW_CONCURRENCY + ' at a time) — that can take a few minutes. Continue?')) {
      statusLine.textContent = 'Daily flow fetch cancelled.';
      return;
    }
    statusLine.textContent = 'Fetching daily flow (' + scopeLabel + ') for ' + ids.length + ' riders (0/' + ids.length + ')...';
    fetchFlowForIds(ids, function (done, total) {
      statusLine.textContent = 'Fetching daily flow (' + done + '/' + total + ')...';
    }).then(function () {
      statusLine.textContent = 'Daily flow fetched for ' + ids.length + ' riders (' + scopeLabel + ') at ' + new Date().toLocaleTimeString();
      renderResults();
    });

  });

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
      var exportRows;
      if (activeFilter === null) {
        exportRows = (lastFlagged.lateAll || []).concat(lastFlagged.idleAllView || []);
      } else if (activeFilter === '__idle30__') {
        exportRows = (lastFlagged.idleAllView || []).filter(function (r) { return r.flagged; });
      } else if (activeFilter === '__all__') {
        exportRows = lastAllRows;
      } else {
        exportRows = lastAllRows.filter(function (r) { return r.status === activeFilter; });
      }
      exportRows = decorateWithFlow(zoneFilteredRows(exportRows));
      var groups = groupBy3PL(sortRows(exportRows));
      Object.keys(groups).sort().forEach(function (pl) {
        var rows = groups[pl].map(function (r) {
          return {
            Name: r.name, Phone: r.phone, Zone: r.zone, Status: r.status, 'Active Orders': r.activeOrders,
            Shifts: r.flowShiftCount != null ? r.flowShiftCount : '', Working: fmtFlowMin(r.flowWorkingMin),
            'Break Total': fmtFlowMin(r.flowBreakMin), 'Break Count': r.flowBreakCount != null ? r.flowBreakCount : '',
            'Auto Break': fmtFlowMin(r.flowAutoBreakMin), 'Courier Break': fmtFlowMin(r.flowCourierBreakMin),
            'Manual Break': fmtFlowMin(r.flowManualBreakMin),
            Notified: r.flowNotified != null ? r.flowNotified : '', Accepted: r.flowAccepted != null ? r.flowAccepted : '',
            Completed: r.flowCompleted != null ? r.flowCompleted : '', Undispatched: r.flowUnDispatched != null ? r.flowUnDispatched : '',
            Reason: r.reason
          };
        });
        var ws = XLSX.utils.json_to_sheet(rows);
        var sheetName = pl.substring(0, 31).replace(/[\\/*?:\[\]]/g, '');
        XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Sheet');
      });
      var scopeSuffix = activeSP !== null ? ('_' + spNameFor(activeSP).replace(/\s+/g, '_')) : (activeZone ? ('_' + activeZone) : '');
      var suffix = (activeFilter === null ? 'late_idle' : activeFilter) + scopeSuffix;
      XLSX.writeFile(wb, '3PL_followup_' + suffix + '_' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.xlsx');
    }).catch(function () {
      document.getElementById('tpl-status').textContent = 'Could not load Excel export library.';
    });
  });

  // Exports every rider that currently has Daily Flow data fetched (from
  // flowCache), grouped into one sheet per 3PL — independent of whatever
  // Late/Idle/status filter is active right now.
  document.getElementById('tpl-flowExportBtn').addEventListener('click', function () {
    var statusLine = document.getElementById('tpl-status');
    var fetchedIds = Object.keys(flowCache).filter(function (id) { return flowCache[id] && !flowCache[id].error; });
    if (fetchedIds.length === 0) {
      statusLine.textContent = 'No Daily Flow data fetched yet — click "Fetch Daily Flow" first.';
      return;
    }
    var fetchedIdSet = {};
    fetchedIds.forEach(function (id) { fetchedIdSet[id] = true; });
    var rows = decorateWithFlow(lastAllRows.filter(function (r) { return fetchedIdSet[r.id]; }));
    xlsxReady.then(function () {
      var wb = XLSX.utils.book_new();
      var groups = groupBy3PL(rows.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }));
      Object.keys(groups).sort().forEach(function (pl) {
        var plRows = groups[pl].map(function (r) {
          return {
            Name: r.name, Phone: r.phone, Zone: r.zone, Status: r.status,
            Shifts: r.flowShiftCount != null ? r.flowShiftCount : '', Working: fmtFlowMin(r.flowWorkingMin),
            'Break Total': fmtFlowMin(r.flowBreakMin), 'Break Count': r.flowBreakCount != null ? r.flowBreakCount : '',
            'Auto Break': fmtFlowMin(r.flowAutoBreakMin), 'Courier Break': fmtFlowMin(r.flowCourierBreakMin),
            'Manual Break': fmtFlowMin(r.flowManualBreakMin),
            Notified: r.flowNotified != null ? r.flowNotified : '', Accepted: r.flowAccepted != null ? r.flowAccepted : '',
            Completed: r.flowCompleted != null ? r.flowCompleted : '', Undispatched: r.flowUnDispatched != null ? r.flowUnDispatched : ''
          };
        });
        var ws = XLSX.utils.json_to_sheet(plRows);
        var sheetName = pl.substring(0, 31).replace(/[\\/*?:\[\]]/g, '');
        XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Sheet');
      });
      XLSX.writeFile(wb, '3PL_daily_flow_' + todayKey() + '_' + new Date().toISOString().slice(11, 16).replace(':', '-') + '.xlsx');
      statusLine.textContent = 'Daily Flow exported for ' + rows.length + ' riders across ' + Object.keys(groups).length + ' 3PLs.';
    }).catch(function () {
      statusLine.textContent = 'Could not load Excel export library.';
    });
  });
  // Low performers: shift >= 3h (LOW_ORDER_SHIFT_HOURS_THRESHOLD_MS) AND
  // 0-5 orders all day (LOW_ORDER_MAX_ORDERS) - same thresholds as the
  // "Long Shift, Low Orders" sheet in the Daily Report, but this button
  // auto-fetches full Daily Flow for exactly those riders (no need to
  // click "Fetch Daily Flow" first) and exports every flow field, one
  // sheet per 3PL, worst performers (fewest orders, then longest shift) first.
  document.getElementById('tpl-lowPerfFlowBtn').addEventListener('click', function () {
    var statusLine = document.getElementById('tpl-status');
    var records = Object.keys(dailyRegistry).map(function (id) {
      var r = dailyRegistry[id];
      return {
        id: id, name: r.name, phone: r.phone, zone: r.zone, contract: r.contract || 'Unknown 3PL',
        lastStatus: r.lastStatus, shiftHoursSoFar: r.shiftHoursSoFar, approxOrderCount: r.approxOrderCount || 0
      };
    }).filter(function (r) {
      return r.shiftHoursSoFar != null && r.shiftHoursSoFar >= LOW_ORDER_SHIFT_HOURS_THRESHOLD_MS &&
        r.approxOrderCount >= 0 && r.approxOrderCount <= LOW_ORDER_MAX_ORDERS;
    });

    if (records.length === 0) {
      statusLine.textContent = 'No riders today match 3h+ shift with 0-' + LOW_ORDER_MAX_ORDERS + ' orders.';
      return;
    }

    var ids = records.map(function (r) { return r.id; });
    statusLine.textContent = 'Fetching daily flow for ' + ids.length + ' low-performing riders (0/' + ids.length + ')...';
    fetchFlowForIds(ids, function (done, total) {
      statusLine.textContent = 'Fetching daily flow for low performers (' + done + '/' + total + ')...';
    }).then(function () {
      xlsxReady.then(function () {
        var wb = XLSX.utils.book_new();
        // worst performance first: fewest orders, then longest shift
        records.sort(function (a, b) {
          if (a.approxOrderCount !== b.approxOrderCount) return a.approxOrderCount - b.approxOrderCount;
          return b.shiftHoursSoFar - a.shiftHoursSoFar;
        });
        var groups = {};
        records.forEach(function (r) { (groups[r.contract] = groups[r.contract] || []).push(r); });
        Object.keys(groups).sort().forEach(function (pl) {
          var plRows = groups[pl].map(function (r) {
            var f = flowCache[r.id];
            var ok = f && !f.error;
            return {
              Name: r.name, Phone: r.phone, Zone: r.zone, 'Current Status': r.lastStatus,
              'Shift Time So Far': fmtHrs(r.shiftHoursSoFar),
              'Orders Today (approx.)': r.approxOrderCount,
              Shifts: ok && f.shiftCount != null ? f.shiftCount : '',
              Working: fmtFlowMin(ok ? f.workingMin : null),
              'Break Total': fmtFlowMin(ok ? f.breakMin : null),
              'Break Count': ok && f.breakCount != null ? f.breakCount : '',
              'Auto Break': fmtFlowMin(ok ? f.autoBreakMin : null),
              'Courier Break': fmtFlowMin(ok ? f.courierBreakMin : null),
              'Manual Break': fmtFlowMin(ok ? f.manualBreakMin : null),
              Notified: ok && f.notified != null ? f.notified : '',
              Accepted: ok && f.accepted != null ? f.accepted : '',
              Completed: ok && f.completed != null ? f.completed : '',
              Undispatched: ok && f.unDispatched != null ? f.unDispatched : '',
              'Flow Fetch Status': ok ? 'OK' : 'Failed'
            };
          });
          var ws = XLSX.utils.json_to_sheet(plRows);
          var sheetName = pl.substring(0, 31).replace(/[\\/*?:\[\]]/g, '');
          XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Sheet');
        });
        XLSX.writeFile(wb, '3PL_low_performers_flow_' + todayKey() + '_' + new Date().toISOString().slice(11, 16).replace(':', '-') + '.xlsx');
        statusLine.textContent = 'Exported ' + records.length + ' low performers (3h+, \u2264' + LOW_ORDER_MAX_ORDERS + ' orders) across ' + Object.keys(groups).length + ' 3PLs.';
      }).catch(function () {
        statusLine.textContent = 'Could not load Excel export library.';
      });
    });
  });

  // ---------- weekly late summary UI + export (built purely from local daily registries, no fetch needed) ----------
  function weeklyLateRows(minDays) {
    var summary = computeWeeklyLateSummary();
    var rows = Object.keys(summary).map(function (id) { return summary[id]; });
    if (minDays) rows = rows.filter(function (r) { return r.daysLateCount >= minDays; });
    rows.sort(function (a, b) {
      if (b.daysLateCount !== a.daysLateCount) return b.daysLateCount - a.daysLateCount;
      return b.totalLateEpisodes - a.totalLateEpisodes;
    });
    return rows;
  }

  function renderWeeklyLateResults(minDays) {
    var container = document.getElementById('tpl-weeklyLateResults');
    var rows = weeklyLateRows(minDays);
    var titleBit = minDays > 1 ? ('Late on ' + minDays + '+ days this week') : 'Late this week (any day)';
    if (rows.length === 0) {
      container.innerHTML = '<div class="tpl-panelbox"><div class="tpl-filter-bar">' + esc(titleBit) +
        ' <button id="tpl-weeklyLateClose" class="tpl-btn secondary" style="padding:3px 10px;font-size:11px;">Close</button></div>' +
        '<div class="tpl-empty">No riders match. \ud83c\udf89</div></div>';
    } else {
      var groups = groupBy3PL(rows);
      var html = '<div class="tpl-filter-bar"><strong>' + esc(titleBit) + '</strong> \u2014 last 7 calendar days (today included) ' +
        '<span class="tpl-badge">' + rows.length + ' riders</span> ' +
        '<button id="tpl-weeklyLateClose" class="tpl-btn secondary" style="padding:3px 10px;font-size:11px;">Close</button></div>';
      html += Object.keys(groups).sort().map(function (pl) {
        var plRows = groups[pl];
        var body = plRows.map(function (r) {
          var sources = Object.keys(r.perDaySource || {}).map(function (k) { return r.perDaySource[k]; });
          var hasFlow = sources.indexOf('flow') !== -1, hasTracked = sources.indexOf('tracked') !== -1;
          var srcLabel = hasFlow && hasTracked ? 'Mixed' : hasFlow ? 'Flow API' : 'Live-tracked (est.)';
          return '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.phone) + '</td><td>' + esc(r.zone) + '</td>' +
            '<td>' + r.daysLateCount + '</td><td>' + r.totalLateEpisodes + '</td><td>' + esc(srcLabel) + '</td></tr>';
        }).join('');
        return '<div class="tpl-panelbox tpl-group"><h2>' + esc(pl) + ' <span class="tpl-badge">' + plRows.length + ' riders</span></h2>' +
          '<table><thead><tr><th>Name</th><th>Phone</th><th>Zone</th><th>Days Late This Week</th><th>Total Late Episodes</th><th>Source</th></tr></thead>' +
          '<tbody>' + body + '</tbody></table></div>';
      }).join('');
      container.innerHTML = html;
    }
    var closeBtn = document.getElementById('tpl-weeklyLateClose');
    if (closeBtn) closeBtn.addEventListener('click', function () { container.innerHTML = ''; });
  }

  // Pulls REAL late data from the Flow API for every rider currently
  // loaded, across each of the last 7 days (not the localStorage estimate).
  document.getElementById('tpl-weeklyLateFetchBtn').addEventListener('click', function () {
    var statusLine = document.getElementById('tpl-status');
    var ids = [];
    lastAllRows.forEach(function (r) { if (ids.indexOf(r.id) === -1) ids.push(r.id); });
    if (ids.length === 0) { statusLine.textContent = 'No riders loaded yet \u2014 fetch or paste live data first.'; return; }
    var totalCalls = ids.length * 7;
    if (totalCalls > 200 && !window.confirm('This will make ' + totalCalls + ' requests (' + ids.length + ' riders \u00d7 7 days, ' + FLOW_CONCURRENCY + ' at a time) \u2014 that can take a while. Continue?')) {
      statusLine.textContent = 'Historical late fetch cancelled.';
      return;
    }
    statusLine.textContent = 'Fetching historical late data (0/' + totalCalls + ')...';
    fetchHistoricalLateForIds(ids, function (done, total) {
      statusLine.textContent = 'Fetching historical late data (' + done + '/' + total + ')...';
    }).then(function () {
      statusLine.textContent = 'Historical late data fetched for ' + ids.length + ' riders (past 7 days) at ' + new Date().toLocaleTimeString() + '. Check console for any days where the "late" field couldn\u2019t be found.';
      renderWeeklyLateResults(1);
    });
  });

  document.getElementById('tpl-weeklyLateBtn').addEventListener('click', function () {
    renderWeeklyLateResults(1); // any rider late at least once this week
  });

  // Separate filter+export: riders LATE on MORE THAN 1 DAY in the past week (repeat offenders)
  document.getElementById('tpl-weeklyLateExportBtn').addEventListener('click', function () {
    var statusLine = document.getElementById('tpl-status');
    var rows = weeklyLateRows(2); // more than 1 day = 2 or more distinct days
    renderWeeklyLateResults(2);
    if (rows.length === 0) { statusLine.textContent = 'No riders were late on more than 1 day in the past week. If you haven\u2019t already, try "Fetch Historical Late" first.'; return; }
    xlsxReady.then(function () {
      var wb = XLSX.utils.book_new();
      var dateKeysOldFirst = last7DateKeys().slice().reverse();
      var groups = groupBy3PL(rows);
      Object.keys(groups).sort().forEach(function (pl) {
        var plRows = groups[pl].map(function (r) {
          var row = { Name: r.name, Phone: r.phone, Zone: r.zone, 'Days Late This Week': r.daysLateCount, 'Total Late Episodes This Week': r.totalLateEpisodes };
          dateKeysOldFirst.forEach(function (dk) {
            row[dk + ' (count)'] = r.perDay[dk] || 0;
            var times = r.perDayTimes[dk] || [];
            row[dk + ' (times)'] = times.map(function (t) { return new Date(t).toLocaleTimeString(); }).join(', ');
          });
          return row;
        });
        var ws = XLSX.utils.json_to_sheet(plRows);
        var sheetName = pl.substring(0, 31).replace(/[\\/*?:\[\]]/g, '');
        XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Sheet');
      });
      XLSX.writeFile(wb, '3PL_late_2plus_days_week_' + todayKey() + '.xlsx');
      statusLine.textContent = 'Exported ' + rows.length + ' riders late on 2+ days this past week across ' + Object.keys(groups).length + ' 3PLs.';
    }).catch(function () {
      statusLine.textContent = 'Could not load Excel export library.';
    });
  });

  document.getElementById('tpl-dailyReportBtn').addEventListener('click', function () {
    xlsxReady.then(function () {
      var now = Date.now();
      var records = Object.keys(dailyRegistry).map(function (id) {
        var r = dailyRegistry[id];
        var stillIdleMs = getIdleStart(id) != null ? (now - getIdleStart(id)) : 0;
        return {
          id: id, name: r.name, phone: r.phone, zone: r.zone, contract: r.contract,
          lastStatus: r.lastStatus, lastActiveOrders: r.lastActiveOrders,
          totalIdleMs: (r.totalIdleMs || 0) + stillIdleMs,
          timesIdle: r.timesIdle || 0,
          longestIdleMs: Math.max(r.longestIdleMs || 0, stillIdleMs),
          shiftHoursSoFar: r.shiftHoursSoFar,
          everHadOrder: !!r.everHadOrder,
          approxOrderCount: r.approxOrderCount || 0
        };
      });

      // Sheet 1: every rider who was idle at all today, longest total idle time first
      var idleRecords = records.filter(function (r) { return r.totalIdleMs > 0; })
        .sort(function (a, b) { return b.totalIdleMs - a.totalIdleMs; });
      var idleSheetRows = idleRecords.map(function (r) {
        return {
          Name: r.name, Phone: r.phone, Zone: r.zone, '3PL': r.contract,
          'Total Idle Today': fmtMins(r.totalIdleMs),
          'Times Idle': r.timesIdle,
          'Longest Idle Streak': fmtMins(r.longestIdleMs),
          'Current Status': r.lastStatus
        };
      });

      // Sheet 2: riders whose shift is long (default 8h+) but who got few or no
      // orders during that whole shift (default under 5) — worst (fewest orders,
      // longest shift) first
      var lowOrderRecords = records.filter(function (r) {
        return r.shiftHoursSoFar != null && r.shiftHoursSoFar >= LOW_ORDER_SHIFT_HOURS_THRESHOLD_MS && r.approxOrderCount < LOW_ORDER_MAX_ORDERS;
      }).sort(function (a, b) {
        if (a.approxOrderCount !== b.approxOrderCount) return a.approxOrderCount - b.approxOrderCount;
        return b.shiftHoursSoFar - a.shiftHoursSoFar;
      });
      var lowOrderSheetRows = lowOrderRecords.map(function (r) {
        return {
          Name: r.name, Phone: r.phone, Zone: r.zone, '3PL': r.contract,
          'Shift Time So Far': fmtHrs(r.shiftHoursSoFar),
          'Orders Today (approx.)': r.approxOrderCount,
          'Current Status': r.lastStatus
        };
      });

      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(idleSheetRows.length ? idleSheetRows : [{ Note: 'No idle riders recorded today yet' }]), 'Idle Time Today');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lowOrderSheetRows.length ? lowOrderSheetRows : [{ Note: 'No riders with a long shift and low order count today' }]), 'Long Shift, Low Orders');
      XLSX.writeFile(wb, '3PL_daily_report_' + todayKey() + '.xlsx');
      document.getElementById('tpl-status').textContent = 'Daily report exported (' + idleSheetRows.length + ' idle riders, ' + lowOrderSheetRows.length + ' long-shift/low-orders).';
    }).catch(function () {
      document.getElementById('tpl-status').textContent = 'Could not load Excel export library.';
    });
  });
})();
