import * as api from './api.js';
import * as XLSX from 'xlsx';

// ── State ──
let state = { papers: [], domains: [], gaps: [], stats: null };
let currentPage = 'dashboard';
let searchQuery = '';
let domainFilter = '';
let sortMode = 'year-desc';

// ── DOM ──
const $ = id => document.getElementById(id);
const toast = (msg, err) => {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' error' : '');
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => t.classList.remove('show'), 2500);
};

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  setupNav();
  setupModalClose();
  $('btn-add-paper').addEventListener('click', () => openPaperForm());
  $('btn-add-domain').addEventListener('click', () => openDomainForm());
  $('btn-add-gap').addEventListener('click', () => openGapForm());
  $('btn-export').addEventListener('click', exportPapers);
  $('search-input').addEventListener('input', e => { searchQuery = e.target.value.toLowerCase(); renderPapers(); });
  $('domain-filter').addEventListener('change', e => { domainFilter = e.target.value; renderPapers(); });
  $('sort-select').addEventListener('change', e => { sortMode = e.target.value; renderPapers(); });
  await loadAll();
});

async function loadAll() {
  try {
    state.stats = await api.getDashboardStats();
    state.papers = state.stats.papers;
    state.domains = state.stats.domains;
    state.gaps = state.stats.gaps;
    $('sidebar-count').textContent = state.papers.length + ' papers';
    populateDomainFilter();
    renderDashboard();
    renderPapers();
    renderDomains();
    renderGaps();
  } catch (e) {
    console.error(e);
    toast('❌ Failed to load data. Check Supabase config.', true);
  }
}

// ── Navigation ──
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPage = btn.dataset.page;
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      $('page-' + currentPage).classList.add('active');
    });
  });
}

// ── Dashboard ──
function renderDashboard() {
  const s = state.stats;
  if (!s) return;

  // Stats cards
  $('stats-row').innerHTML = [
    { v: s.totalPapers, l: 'Total Papers', i: '📄', c: '--accent' },
    { v: s.totalDomains, l: 'Domains', i: '🗂️', c: '--accent2' },
    { v: s.openGaps, l: 'Open Gaps', i: '🔬', c: '--accent3' },
    { v: s.readCount, l: 'Papers Read', i: '✅', c: '--green' },
    { v: s.unreadCount, l: 'To Read', i: '📌', c: '--orange' },
  ].map(c => `
    <div class="stat-card"><span class="stat-icon">${c.i}</span>
      <div class="stat-value" style="background:linear-gradient(135deg,var(${c.c}),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent">${c.v}</div>
      <div class="stat-label">${c.l}</div>
    </div>`).join('');

  // Domain chart — clickable bars
  const maxP = Math.max(...s.domainStats.map(d => d.paperCount), 1);
  $('domain-chart').innerHTML = s.domainStats.map(d => `
    <div class="bar-row bar-clickable" data-domain-id="${d.id}" title="View ${d.name} papers">
      <span class="bar-label">${d.icon} ${d.name}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(d.paperCount / maxP) * 100}%;background:${d.color}"><span class="bar-count">${d.paperCount}</span></div></div>
    </div>`).join('');

  $('domain-chart').querySelectorAll('.bar-clickable').forEach(row => {
    row.addEventListener('click', () => navigateToPapers({ domainId: row.dataset.domainId }));
  });

  // Year chart — clickable bars
  const years = Object.entries(s.yearDistribution).sort((a, b) => a[0] - b[0]);
  const maxY = Math.max(...years.map(y => y[1]), 1);
  $('year-chart').innerHTML = years.map(([yr, cnt]) => `
    <div class="bar-row bar-clickable" data-year="${yr}" title="View ${yr} papers">
      <span class="bar-label">${yr}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(cnt / maxY) * 100}%;background:var(--accent2)"><span class="bar-count">${cnt}</span></div></div>
    </div>`).join('');

  $('year-chart').querySelectorAll('.bar-clickable').forEach(row => {
    row.addEventListener('click', () => navigateToPapers({ year: row.dataset.year }));
  });

  // Domain grid — clickable cards
  $('domain-grid').innerHTML = s.domainStats.map(d => `
    <div class="domain-card" data-domain-id="${d.id}">
      <div class="domain-color-bar" style="background:${d.color}"></div>
      <div class="domain-card-icon">${d.icon}</div>
      <h3>${d.name}</h3>
      <p>${d.description || ''}</p>
      <div class="domain-card-stat">
        <span>📄 ${d.paperCount} papers</span>
        <span>⭐ ${d.avgRelevance}% avg</span>
      </div>
    </div>`).join('');

  $('domain-grid').querySelectorAll('.domain-card').forEach(card => {
    card.addEventListener('click', () => navigateToPapers({ domainId: card.dataset.domainId }));
  });

  // Recent papers
  const recent = state.papers.slice(0, 5);
  $('recent-list').innerHTML = recent.map(p => `
    <div class="recent-item" data-id="${p.id}">
      <span class="ri-icon">${p.domains?.icon || '📄'}</span>
      <div class="ri-body">
        <div class="ri-title">${p.title}</div>
        <div class="ri-meta">${p.authors} · ${p.year} · ${p.venue.split('(')[0].trim()}</div>
      </div>
      <span class="ri-score">${p.relevance_score}%</span>
    </div>`).join('');

  document.querySelectorAll('.recent-item').forEach(el => {
    el.addEventListener('click', () => {
      const p = state.papers.find(pp => pp.id === el.dataset.id);
      if (p) openPaperDetail(p);
    });
  });
}

// Navigate to Papers page with filter
function navigateToPapers({ domainId, year } = {}) {
  // Switch to papers page
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-page=papers]').classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $('page-papers').classList.add('active');
  currentPage = 'papers';

  if (domainId) {
    domainFilter = domainId;
    $('domain-filter').value = domainId;
    searchQuery = '';
    $('search-input').value = '';
  } else if (year) {
    domainFilter = '';
    $('domain-filter').value = '';
    searchQuery = year;
    $('search-input').value = year;
  }
  renderPapers();
}

// ── Papers ──
function populateDomainFilter() {
  const sel = $('domain-filter');
  sel.innerHTML = '<option value="">All Domains</option>' +
    state.domains.map(d => `<option value="${d.id}">${d.icon} ${d.name}</option>`).join('');
}

function renderPapers() {
  let filtered = state.papers.filter(p => {
    const matchDomain = !domainFilter || p.domain_id === domainFilter;
    const matchSearch = !searchQuery || p.title.toLowerCase().includes(searchQuery) ||
      p.authors.toLowerCase().includes(searchQuery) || (p.contribution || '').toLowerCase().includes(searchQuery) ||
      String(p.year).includes(searchQuery);
    return matchDomain && matchSearch;
  });
  filtered.sort((a, b) => {
    if (sortMode === 'year-desc') return b.year - a.year;
    if (sortMode === 'year-asc') return a.year - b.year;
    if (sortMode === 'relevance') return (b.relevance_score || 0) - (a.relevance_score || 0);
    return a.title.localeCompare(b.title);
  });

  const grid = $('papers-grid');
  $('papers-empty').style.display = filtered.length ? 'none' : 'block';

  grid.innerHTML = filtered.map((p, i) => {
    const d = state.domains.find(dd => dd.id === p.domain_id);
    const relColor = (p.relevance_score || 0) >= 90 ? 'var(--green)' : (p.relevance_score || 0) >= 75 ? 'var(--accent2)' : 'var(--orange)';
    return `
    <div class="paper-card" data-id="${p.id}" style="animation:fadeIn .3s ease ${i * 0.03}s both">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${d?.color || 'var(--accent)'}"></div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px">
        <span class="paper-badge" style="background:${d ? d.color + '22' : 'var(--surface2)'};color:${d?.color || 'var(--text2)'}">${d?.icon || '📄'} ${d?.name || p.category}</span>
        <span class="read-badge ${p.is_read ? 'read' : 'unread'}">${p.is_read ? '✓ Read' : 'Unread'}</span>
      </div>
      <h3>${p.title}</h3>
      <p class="authors">${p.authors}</p>
      <div class="meta"><span>📅 ${p.year}</span><span>📄 ${p.venue.split('(')[0].trim()}</span></div>
      <p class="contribution">${p.contribution || ''}</p>
      <div class="paper-card-footer">
        <div class="relevance-bar"><span>Rel</span><div class="rel-track"><div class="rel-fill" style="width:${p.relevance_score || 0}%;background:${relColor}"></div></div><span>${p.relevance_score || 0}%</span></div>
        ${p.url ? `<a href="${p.url}" target="_blank" class="paper-link" onclick="event.stopPropagation()">🔗 Paper</a>` : ''}
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.paper-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.paper-link')) return;
      const p = state.papers.find(pp => pp.id === card.dataset.id);
      if (p) openPaperDetail(p);
    });
  });
}

// ── Paper Detail Modal ──
function openPaperDetail(p) {
  const d = state.domains.find(dd => dd.id === p.domain_id);
  const relColor = (p.relevance_score || 0) >= 90 ? 'var(--green)' : (p.relevance_score || 0) >= 75 ? 'var(--accent2)' : 'var(--orange)';
  $('modal-body').innerHTML = `
    <h2>${p.title}</h2>
    <div class="meta-row">
      <span class="meta-tag" style="background:${d ? d.color + '22' : ''};color:${d?.color || ''}">${d?.icon || ''} ${d?.name || p.category}</span>
      <span class="meta-tag">📅 ${p.year}</span>
      <span class="meta-tag">📄 ${p.venue}</span>
      ${p.doi ? `<span class="meta-tag">🔗 ${p.doi}</span>` : ''}
      <span class="meta-tag read-badge ${p.is_read ? 'read' : 'unread'}">${p.is_read ? '✓ Read' : '📌 Unread'}</span>
    </div>
    ${p.url ? `<a href="${p.url}" target="_blank" class="modal-paper-link">📄 Read Paper →</a>` : ''}
    <h3>Authors</h3><p>${p.authors}</p>
    <h3>Key Contribution</h3><p>${p.contribution || '—'}</p>
    <h3>Limitations</h3>
    <ul>${(p.limitations || []).map(l => `<li>${l}</li>`).join('') || '<li>—</li>'}</ul>
    <h3>Relevance to Research</h3><p>${p.relevance || '—'}</p>
    ${p.notes ? `<h3>Personal Notes</h3><p>${p.notes}</p>` : ''}
    <div class="relevance-bar" style="margin-top:14px">
      <span>Score</span><div class="rel-track"><div class="rel-fill" style="width:${p.relevance_score || 0}%;background:${relColor}"></div></div><span style="font-weight:700">${p.relevance_score || 0}%</span>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" id="md-toggle-read">${p.is_read ? '📌 Mark Unread' : '✅ Mark Read'}</button>
      <button class="btn btn-ghost btn-sm" id="md-edit">✏️ Edit</button>
      <button class="btn btn-danger btn-sm" id="md-delete">🗑 Delete</button>
    </div>`;
  $('md-toggle-read').addEventListener('click', async () => {
    await api.updatePaper(p.id, { is_read: !p.is_read });
    closeModal(); await loadAll(); toast(p.is_read ? '📌 Marked unread' : '✅ Marked as read');
  });
  $('md-edit').addEventListener('click', () => { closeModal(); openPaperForm(p); });
  $('md-delete').addEventListener('click', async () => {
    if (!confirm('Delete this paper?')) return;
    await api.deletePaper(p.id); closeModal(); await loadAll(); toast('🗑 Paper deleted');
  });
  openModal();
}

// ── Paper Form ──
function openPaperForm(paper) {
  const isEdit = !!paper;
  $('modal-body').innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h2 style="margin: 0;">${isEdit ? 'Edit Paper' : 'Add New Paper'}</h2>
      ${!isEdit ? `
        <div>
          <input type="file" id="pdf-upload" accept="application/pdf" style="display:none">
          <button class="btn btn-primary btn-sm" id="btn-ai-upload" style="background: linear-gradient(135deg, #a78bfa, #c084fc);">✨ Auto-fill with AI (PDF)</button>
        </div>
      ` : ''}
    </div>
    <form id="paper-form">
      <div class="form-grid">
        <div class="form-group full"><label>Title *</label><input id="f-title" required value="${paper?.title || ''}" /></div>
        <div class="form-group full"><label>Authors *</label><input id="f-authors" required value="${paper?.authors || ''}" /></div>
        <div class="form-group"><label>Year *</label><input type="number" id="f-year" required min="1990" max="2030" value="${paper?.year || 2024}" /></div>
        <div class="form-group"><label>Venue *</label><input id="f-venue" required value="${paper?.venue || ''}" /></div>
        <div class="form-group"><label>Domain</label><select id="f-domain"><option value="">— None —</option>${state.domains.map(d => `<option value="${d.id}" ${paper?.domain_id === d.id ? 'selected' : ''}>${d.icon} ${d.name}</option>`).join('')}</select></div>
        <div class="form-group"><label>Relevance (0–100)</label><input type="number" id="f-rel" min="0" max="100" value="${paper?.relevance_score || 75}" /></div>
        <div class="form-group full"><label>Paper URL</label><input type="url" id="f-url" value="${paper?.url || ''}" /></div>
        <div class="form-group full"><label>DOI</label><input id="f-doi" value="${paper?.doi || ''}" /></div>
        <div class="form-group full"><label>Key Contribution *</label><textarea id="f-cont" rows="3" required>${paper?.contribution || ''}</textarea></div>
        <div class="form-group full"><label>Limitations (one per line)</label><textarea id="f-lim" rows="3">${(paper?.limitations || []).join('\n')}</textarea></div>
        <div class="form-group full"><label>Relevance to Research</label><textarea id="f-reltext" rows="2">${paper?.relevance || ''}</textarea></div>
        <div class="form-group full"><label>Personal Notes</label><textarea id="f-notes" rows="2">${paper?.notes || ''}</textarea></div>
        <div class="form-group"><label>Read?</label><select id="f-read"><option value="false" ${!paper?.is_read ? 'selected' : ''}>Not yet</option><option value="true" ${paper?.is_read ? 'selected' : ''}>Yes, read</option></select></div>
        <div class="form-group"><label>Category</label><input id="f-cat" value="${paper?.category || 'Foundation'}" /></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="document.getElementById('modal-overlay').classList.remove('active');document.body.style.overflow=''">Cancel</button>
        <button type="submit" class="btn btn-primary">💾 ${isEdit ? 'Update' : 'Save'}</button>
      </div>
    </form>`;

  if (!isEdit) {
    $('btn-ai-upload').addEventListener('click', () => $('pdf-upload').click());
    $('pdf-upload').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const btn = $('btn-ai-upload');
      const originalText = btn.innerHTML;
      btn.innerHTML = '⏳ Reading PDF...';
      btn.disabled = true;
      toast('Sending to Gemini AI for parsing...');
      
      try {
        const parsed = await api.uploadPdf(file);
        
        // Auto-fill fields
        if (parsed.title) $('f-title').value = parsed.title;
        if (parsed.authors) $('f-authors').value = parsed.authors;
        if (parsed.year) $('f-year').value = parsed.year;
        if (parsed.venue) $('f-venue').value = parsed.venue;
        if (parsed.url) $('f-url').value = parsed.url;
        if (parsed.doi) $('f-doi').value = parsed.doi;
        if (parsed.contribution) $('f-cont').value = parsed.contribution;
        if (parsed.limitations && Array.isArray(parsed.limitations)) {
          $('f-lim').value = parsed.limitations.join('\n');
        }
        if (parsed.relevance_score) $('f-rel').value = parsed.relevance_score;
        if (parsed.category) $('f-cat').value = parsed.category;
        if (parsed.relevance) $('f-reltext').value = parsed.relevance;
        
        // Auto-select domain dropdown (refresh if new domain was created)
        if (parsed.domain_id) {
          if (parsed.domain_created) {
            // Refresh domains so the new one appears in the dropdown
            const freshDomains = await api.getDomains();
            state.domains = freshDomains;
            const domSelect = $('f-domain');
            domSelect.innerHTML = '<option value="">— None —</option>' +
              state.domains.map(d => `<option value="${d.id}">${d.icon || '📄'} ${d.name}</option>`).join('');
          }
          $('f-domain').value = parsed.domain_id;
        }
        
        let toastMsg = '✨ Successfully auto-filled all fields!';
        if (parsed.domain_created) toastMsg += ` New domain "${parsed.domain}" created!`;
        if (parsed.gaps_created) toastMsg += ` ${parsed.gaps_created} research gap${parsed.gaps_created > 1 ? 's' : ''} detected & added!`;
        toast(toastMsg);
      } catch (err) {
        toast('❌ AI Parsing failed: ' + err.message, true);
      } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
        e.target.value = ''; // Reset input
      }
    });
  }

  $('paper-form').addEventListener('submit', async e => {
    e.preventDefault();
    const limText = $('f-lim').value.trim();
    const data = {
      title: $('f-title').value.trim(),
      authors: $('f-authors').value.trim(),
      year: parseInt($('f-year').value),
      venue: $('f-venue').value.trim(),
      domain_id: $('f-domain').value || null,
      relevance_score: parseInt($('f-rel').value) || 75,
      url: $('f-url').value.trim() || null,
      doi: $('f-doi').value.trim() || null,
      contribution: $('f-cont').value.trim(),
      limitations: limText ? limText.split('\n').map(s => s.trim()).filter(Boolean) : [],
      relevance: $('f-reltext').value.trim() || null,
      notes: $('f-notes').value.trim() || null,
      is_read: $('f-read').value === 'true',
      category: $('f-cat').value.trim() || 'Foundation'
    };
    try {
      if (isEdit) { await api.updatePaper(paper.id, data); toast('✅ Paper updated'); }
      else { await api.createPaper(data); toast('✅ Paper added'); }
      closeModal(); await loadAll();
    } catch (err) { toast('❌ ' + err.message, true); }
  });
  openModal();
}

// ── Domain Form ──
function openDomainForm() {
  $('modal-body').innerHTML = `
    <h2>Add Domain</h2>
    <form id="domain-form">
      <div class="form-grid">
        <div class="form-group full"><label>Name *</label><input id="fd-name" required placeholder="e.g. Runtime AI Governance" /></div>
        <div class="form-group"><label>Icon (emoji)</label><input id="fd-icon" value="📄" /></div>
        <div class="form-group"><label>Color</label><input type="color" id="fd-color" value="#7c5cff" /></div>
        <div class="form-group full"><label>Description</label><textarea id="fd-desc" rows="2"></textarea></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="document.getElementById('modal-overlay').classList.remove('active');document.body.style.overflow=''">Cancel</button>
        <button type="submit" class="btn btn-primary">💾 Save</button>
      </div>
    </form>`;
  $('domain-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api.createDomain({ name: $('fd-name').value.trim(), icon: $('fd-icon').value, color: $('fd-color').value, description: $('fd-desc').value.trim() || null });
      toast('✅ Domain created'); closeModal(); await loadAll();
    } catch (err) { toast('❌ ' + err.message, true); }
  });
  openModal();
}

// ── Gap Form ──
function openGapForm() {
  $('modal-body').innerHTML = `
    <h2>Add Research Gap</h2>
    <form id="gap-form">
      <div class="form-grid">
        <div class="form-group full"><label>Title *</label><input id="fg-title" required /></div>
        <div class="form-group"><label>Domain</label><select id="fg-domain"><option value="">— None —</option>${state.domains.map(d => `<option value="${d.id}">${d.icon} ${d.name}</option>`).join('')}</select></div>
        <div class="form-group"><label>Severity</label><select id="fg-sev"><option value="critical">🔴 Critical</option><option value="high" selected>🟡 High</option><option value="medium">🔵 Medium</option><option value="low">🟢 Low</option></select></div>
        <div class="form-group full"><label>Description *</label><textarea id="fg-desc" rows="3" required></textarea></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="document.getElementById('modal-overlay').classList.remove('active');document.body.style.overflow=''">Cancel</button>
        <button type="submit" class="btn btn-primary">💾 Save</button>
      </div>
    </form>`;
  $('gap-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api.createGap({ title: $('fg-title').value.trim(), description: $('fg-desc').value.trim(), domain_id: $('fg-domain').value || null, severity: $('fg-sev').value });
      toast('✅ Research gap added'); closeModal(); await loadAll();
    } catch (err) { toast('❌ ' + err.message, true); }
  });
  openModal();
}

// ── Domains Page ──
function renderDomains() {
  const ds = state.stats?.domainStats || [];
  $('domain-detail-grid').innerHTML = ds.map(d => `
    <div class="domain-detail-card">
      <div class="domain-color-bar" style="background:${d.color}"></div>
      <div style="font-size:2rem;margin-bottom:4px">${d.icon}</div>
      <h3>${d.name}</h3>
      <p>${d.description || 'No description'}</p>
      <div class="domain-papers"><strong>${d.paperCount}</strong> papers · <strong>${d.avgRelevance}%</strong> avg relevance</div>
      ${d.paperCount > 0 ? `<button class="btn btn-ghost btn-sm domain-export-btn" data-domain-id="${d.id}" data-domain-name="${d.name}" style="margin-top:10px;width:100%">📥 Export to Excel</button>` : ''}
    </div>`).join('') || '<div class="empty-state"><p>No domains yet.</p></div>';

  // Attach export handlers to each domain card
  document.querySelectorAll('.domain-export-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const domainId = btn.dataset.domainId;
      const domainName = btn.dataset.domainName;
      exportToExcel(domainId, domainName);
    });
  });
}

// ── Gaps Page ──
function renderGaps() {
  $('gaps-grid').innerHTML = state.gaps.map(g => {
    const d = g.domains;
    return `
    <div class="gap-card">
      <span class="gap-severity severity-${g.severity}">${g.severity}</span>
      <span class="gap-status">${g.status}</span>
      <h3>${g.title}</h3>
      <p>${g.description || ''}</p>
      ${d ? `<div class="gap-domain">${d.icon} ${d.name}</div>` : ''}
    </div>`;
  }).join('') || '<div class="empty-state"><p>No research gaps defined.</p></div>';
}

// ── Export ──
function exportPapers() {
  exportToExcel(null, 'All_Papers');
}

function exportToExcel(domainId, sheetLabel) {
  let papers = state.papers;
  if (domainId) {
    papers = papers.filter(p => p.domain_id === domainId);
  }
  if (papers.length === 0) {
    toast('⚠️ No papers to export', true);
    return;
  }

  // Build clean rows for Excel
  const rows = papers.map((p, i) => {
    const d = state.domains.find(dd => dd.id === p.domain_id);
    return {
      '#': i + 1,
      'Title': p.title,
      'Authors': p.authors,
      'Year': p.year,
      'Venue': p.venue,
      'Domain': d?.name || p.category || '—',
      'DOI': p.doi || '—',
      'URL': p.url || '—',
      'Key Contribution': p.contribution || '—',
      'Limitations': (p.limitations || []).join('; '),
      'Relevance': p.relevance || '—',
      'Score': p.relevance_score || 0,
      'Category': p.category || '—',
      'Read': p.is_read ? 'Yes' : 'No'
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-size columns
  const colWidths = Object.keys(rows[0]).map(key => {
    const maxLen = Math.max(
      key.length,
      ...rows.map(r => String(r[key] || '').length)
    );
    return { wch: Math.min(maxLen + 2, 60) };
  });
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  const safeName = (sheetLabel || 'Papers').replace(/[\[\]\*\?\/\\:]/g, '_').substring(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, safeName);

  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `ComplianceLit_${safeName}_${dateStr}.xlsx`;
  XLSX.writeFile(wb, fileName);
  toast(`📥 Exported ${papers.length} papers to ${fileName}`);
}

// ── Modal Helpers ──
function openModal() { $('modal-overlay').classList.add('active'); document.body.style.overflow = 'hidden'; }
function closeModal() { $('modal-overlay').classList.remove('active'); document.body.style.overflow = ''; }
function setupModalClose() {
  $('modal-close').addEventListener('click', closeModal);
  $('modal-overlay').addEventListener('click', e => { if (e.target === $('modal-overlay')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}
