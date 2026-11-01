/* 시안 공통: 아이콘 스프라이트 주입 + 상태 전환 + 서랍/시트 열기. 외부 의존성 없음. */
(function () {
  var P = {
    select: '<path d="M5 3l12 8-6 1.5L8 19z"/>',
    room: '<rect x="4" y="4" width="16" height="16"/><path d="M4 12h7v8"/>',
    split: '<rect x="4" y="4" width="16" height="16"/><path d="M12 4v16" stroke-dasharray="2 2"/>',
    merge: '<rect x="4" y="6" width="7" height="12"/><rect x="13" y="6" width="7" height="12"/><path d="M9 12h6"/>',
    door: '<path d="M5 20V5h3"/><path d="M8 5a15 15 0 0 1 11 15"/><path d="M3 20h18"/>',
    window: '<rect x="3" y="9" width="18" height="6"/><path d="M3 12h18"/>',
    measure: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
    dim: '<path d="M4 8v8M20 8v8M4 12h16"/><path d="M7 10l-3 2 3 2M17 10l3 2-3 2"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    leader: '<path d="M4 20l8-8h8"/><circle cx="4" cy="20" r="1.5"/>',
    cloud: '<path d="M7 18a3 3 0 0 1 0-6 4 4 0 0 1 7-3 4 4 0 0 1 5 5 2 2 0 0 1-1 4z"/>',
    pan: '<path d="M12 3v18M3 12h18M12 3l-2 2M12 3l2 2M12 21l-2-2M12 21l2-2M3 12l2-2M3 12l2 2M21 12l-2-2M21 12l-2 2"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    judge: '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    props: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
    fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    chev: '<path d="M9 6l6 6-6 6"/>', chevl: '<path d="M15 6l-6 6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
    check: '<path d="M5 12l5 5 9-10"/>', undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    snap: '<circle cx="12" cy="12" r="2"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
    sheet: '<rect x="3" y="5" width="18" height="14"/><path d="M14 15h7M14 15v4"/>',
    anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M5 14a7 7 0 0 0 14 0M8 11h8"/>'
  };
  var s = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">';
  for (var k in P) s += '<symbol id="i-' + k + '" viewBox="0 0 24 24">' + P[k] + '</symbol>';
  document.body.insertAdjacentHTML('afterbegin', s + '</svg>');

  // 주소 끝 #sheet 이면 도면 상태로 연다(캡처용)
  if (location.hash === '#sheet') setTimeout(function () { var b = document.querySelector('[data-go="sheet"]'); if (b) b.click(); });
  // 상태 전환: [data-go="plan|sheet"]
  document.addEventListener('click', function (e) {
    var go = e.target.closest('[data-go]');
    if (go) {
      document.body.dataset.state = go.dataset.go; closeAll();
      document.querySelectorAll('[data-go]').forEach(function (b) {
        if (b.dataset.go === go.dataset.go) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      });
    }
    var op = e.target.closest('[data-open]');
    if (op) {
      toggle(op.dataset.open, true);
      if (op.dataset.sec) { var sec = document.getElementById(op.dataset.sec); if (sec) { if (sec.tagName === 'DETAILS') sec.open = true; sec.scrollIntoView({ block: 'start' }); } }
      if (op.dataset.tabsel) { var t = document.querySelector('[data-tab="' + op.dataset.tabsel + '"]'); if (t) t.click(); }
    }
    var cl = e.target.closest('[data-close]');
    if (cl || e.target.classList.contains('scrim')) closeAll();
    var tab = e.target.closest('[data-tab]');
    if (tab) {
      var grp = tab.closest('[role="tablist"]');
      grp.querySelectorAll('[data-tab]').forEach(function (t) {
        var on = t === tab; t.setAttribute('aria-selected', on);
        var p = document.getElementById(t.dataset.tab); if (p) p.hidden = !on;
      });
    }
  });
  function toggle(id, on) {
    var el = document.getElementById(id); if (!el) return;
    closeAll(); el.classList.add('open');
    var sc = document.querySelector('.scrim'); if (sc) sc.classList.add('open');
  }
  function closeAll() { document.querySelectorAll('.open').forEach(function (el) { el.classList.remove('open'); }); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });
})();
