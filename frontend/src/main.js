import * as api from './api.js';
import * as XLSX from 'xlsx';

// ── State ──
let state = { workspaces: [], papers: [], domains: [], gaps: [], stats: null };
let currentWorkspace = null;
let currentPage = 'dashboard';
let searchQuery = '';
let domainFilter = '';
let sortMode = 'year-desc';
let currentUser = null;
let currentProfile = null;

// ── DOM ──
const $ = id => document.getElementById(id);
const toast = (msg, err) => {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' error' : '');
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => t.classList.remove('show'), 2500);
};

// ══════════════════════════════════════════════
// AUTH FLOW
// ══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  setupAuthUI();
  setupModalClose();

  // Check for existing session
  try {
    const session = await api.getSession();
    if (session?.user) {
      currentUser = session.user;
      await handleAuthSuccess();
    } else {
      showAuthScreen();
    }
  } catch (e) {
    showAuthScreen();
  }

  // Listen for auth state changes (e.g., token refresh)
  api.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      currentUser = null;
      currentProfile = null;
      showAuthScreen();
    }
  });
});

function showAuthScreen() {
  $('auth-screen').style.display = 'flex';
  $('app-shell').style.display = 'none';
  $('onboarding-overlay').style.display = 'none';
}

function showApp() {
  $('auth-screen').style.display = 'none';
  $('app-shell').style.display = 'block';
  $('onboarding-overlay').style.display = 'none';
}

function showOnboarding() {
  $('auth-screen').style.display = 'none';
  $('app-shell').style.display = 'none';
  $('onboarding-overlay').style.display = 'flex';
}

function setupAuthUI() {
  // Toggle between login and register
  $('show-register').addEventListener('click', e => {
    e.preventDefault();
    $('auth-login').style.display = 'none';
    $('auth-register').style.display = 'block';
  });
  $('show-login').addEventListener('click', e => {
    e.preventDefault();
    $('auth-register').style.display = 'none';
    $('auth-login').style.display = 'block';
  });

  // Login form
  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('login-btn');
    const errEl = $('login-error');
    errEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
      const { user } = await api.signIn(
        $('login-email').value.trim(),
        $('login-password').value
      );
      currentUser = user;
      await handleAuthSuccess();
    } catch (err) {
      errEl.textContent = err.message || 'Sign in failed';
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });

  // Register form
  $('register-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('register-btn');
    const errEl = $('register-error');
    const successEl = $('register-success');
    errEl.style.display = 'none';
    successEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Creating account...';

    try {
      const result = await api.signUp(
        $('register-email').value.trim(),
        $('register-password').value,
        $('register-name').value.trim()
      );

      // Check if email confirmation is required
      if (result.user && !result.session) {
        successEl.textContent = '✅ Account created! Check your email for a confirmation link, then sign in.';
        successEl.style.display = 'block';
      } else if (result.user && result.session) {
        // Auto-confirmed, proceed
        currentUser = result.user;
        await handleAuthSuccess();
      }
    } catch (err) {
      errEl.textContent = err.message || 'Registration failed';
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Account';
    }
  });

  // Onboarding form
  $('onboarding-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('onboarding-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Saving...';

    try {
      const topic = $('onboarding-topic').value.trim();
      currentProfile = await api.updateProfile({ research_topic: topic });
      
      // Create first workspace
      const newWs = await api.createWorkspace({
        name: 'Default Workspace',
        description: 'Auto-created during onboarding',
        research_topic: topic,
        icon: '📁',
        is_default: true
      });
      currentWorkspace = newWs;
      
      showApp();
      await initApp();
      toast('🎉 Welcome to Tessera AI! Start uploading papers.');
    } catch (err) {
      toast('❌ ' + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = '🚀 Start Researching';
    }
  });
}

async function handleAuthSuccess() {
  try {
    // Fetch profile
    currentProfile = await api.getProfile();

    // Check if onboarding is needed (no research topic set)
    if (!currentProfile.research_topic) {
      showOnboarding();
      return;
    }

    // Show the main app
    showApp();
    await initApp();
  } catch (err) {
    console.error('Auth success handler error:', err);
    // Profile fetch might fail if the trigger hasn't created it yet, retry once
    await new Promise(r => setTimeout(r, 1500));
    try {
      currentProfile = await api.getProfile();
      if (!currentProfile.research_topic) {
        showOnboarding();
        return;
      }
      showApp();
      await initApp();
    } catch (err2) {
      toast('❌ Failed to load profile. Please try again.', true);
      showAuthScreen();
    }
  }
}

// ══════════════════════════════════════════════
// MAIN APP INIT
// ══════════════════════════════════════════════
async function initApp() {
  setupNav();
  setupSidebarUser();
  $('btn-add-paper').addEventListener('click', () => openPaperForm());
  $('btn-add-domain').addEventListener('click', () => openDomainForm());
  $('btn-add-gap').addEventListener('click', () => openGapForm());
  $('btn-export').addEventListener('click', exportPapers);
  $('search-input').addEventListener('input', e => { searchQuery = e.target.value.toLowerCase(); renderPapers(); });
  $('domain-filter').addEventListener('change', e => { domainFilter = e.target.value; renderPapers(); });
  $('sort-select').addEventListener('change', e => { sortMode = e.target.value; renderPapers(); });
  $('btn-logout').addEventListener('click', handleLogout);
  
  // Workspace Switcher
  $('workspace-switcher').addEventListener('click', (e) => {
    e.stopPropagation();
    $('workspace-dropdown').classList.toggle('active');
    $('workspace-switcher').classList.toggle('active');
  });
  document.addEventListener('click', () => {
    $('workspace-dropdown').classList.remove('active');
    $('workspace-switcher').classList.remove('active');
  });
  $('btn-add-workspace').addEventListener('click', () => {
    openWorkspaceForm();
  });

  // Research topic badge
  updateResearchTopicBadge();
  $('rtb-edit').addEventListener('click', openEditTopicModal);

  await loadAll();
}

function setupSidebarUser() {
  if (currentProfile) {
    const name = currentProfile.full_name || currentProfile.email || 'User';
    $('sidebar-user-name').textContent = name;
    $('sidebar-user-role').textContent = currentProfile.role === 'admin' ? '⭐ Admin' : '🔬 Researcher';
    $('sidebar-avatar').textContent = name.charAt(0).toUpperCase();
  }
  // Show admin nav if admin
  if (currentProfile?.role === 'admin') {
    $('nav-admin').style.display = 'flex';
  } else {
    $('nav-admin').style.display = 'none';
  }
}

function updateResearchTopicBadge() {
  const text = currentWorkspace?.research_topic || currentProfile?.research_topic || 'Set your research topic';
  $('rtb-text').textContent = text.length > 60 ? text.substring(0, 57) + '...' : text;
  $('research-topic-badge').title = currentWorkspace?.research_topic || currentProfile?.research_topic || 'Click to set';
}

function openEditTopicModal() {
  $('modal-body').innerHTML = `
    <h2>✏️ Edit Workspace Research Topic</h2>
    <p style="color:var(--text2);font-size:.88rem;margin-bottom:16px;">This is used by Gemini AI to verify paper relevance and score uploads. Be specific about your research focus.</p>
    <form id="edit-topic-form">
      <div class="form-group full">
        <label>Research Topic / Focus Area</label>
        <textarea id="edit-topic-input" rows="3" required>${currentWorkspace?.research_topic || currentProfile?.research_topic || ''}</textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="document.getElementById('modal-overlay').classList.remove('active');document.body.style.overflow=''">Cancel</button>
        <button type="submit" class="btn btn-primary">💾 Save</button>
      </div>
    </form>`;
  $('edit-topic-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      if (currentWorkspace) {
        currentWorkspace = await api.updateWorkspace(currentWorkspace.id, { research_topic: $('edit-topic-input').value.trim() });
      } else {
        currentProfile = await api.updateProfile({ research_topic: $('edit-topic-input').value.trim() });
      }
      updateResearchTopicBadge();
      closeModal();
      toast('✅ Research topic updated');
    } catch (err) {
      toast('❌ ' + err.message, true);
    }
  });
  openModal();
}

async function handleLogout() {
  try {
    await api.signOut();
    currentUser = null;
    currentProfile = null;
    showAuthScreen();
    toast('👋 Signed out');
  } catch (err) {
    toast('❌ ' + err.message, true);
  }
}

async function loadAll() {
  try {
    // Load Workspaces first
    state.workspaces = await api.getWorkspaces();
    if (state.workspaces.length > 0) {
      // Keep selected workspace if it still exists, else use the first one
      if (!currentWorkspace || !state.workspaces.find(w => w.id === currentWorkspace.id)) {
        currentWorkspace = state.workspaces.find(w => w.is_default) || state.workspaces[0];
      }
      renderWorkspaceSwitcher();
      updateResearchTopicBadge();
    }
    
    const wsId = currentWorkspace ? currentWorkspace.id : null;
    state.stats = await api.getDashboardStats(wsId);
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

// ══════════════════════════════════════════════
// WORKSPACES
// ══════════════════════════════════════════════
function renderWorkspaceSwitcher() {
  if (!currentWorkspace) return;
  
  $('ws-icon').textContent = currentWorkspace.icon || '📁';
  $('ws-name').textContent = currentWorkspace.name;
  
  const list = $('workspace-list');
  list.innerHTML = '';
  
  state.workspaces.forEach(ws => {
    const div = document.createElement('div');
    div.className = 'workspace-item' + (ws.id === currentWorkspace.id ? ' active' : '');
    div.innerHTML = `
      <span class="workspace-item-icon">${ws.icon || '📁'}</span>
      <span class="workspace-item-name">${ws.name}</span>
      <button class="workspace-item-settings" title="Edit Workspace" onclick="event.stopPropagation(); openWorkspaceForm('${ws.id}')">⚙️</button>
    `;
    div.addEventListener('click', () => {
      currentWorkspace = ws;
      $('workspace-dropdown').classList.remove('active');
      $('workspace-switcher').classList.remove('active');
      loadAll(); // Reload everything for new workspace
    });
    list.appendChild(div);
  });
}

function openWorkspaceForm(id = null) {
  const ws = id ? state.workspaces.find(w => w.id === id) : null;
  const isEdit = !!ws;
  
  $('modal-body').innerHTML = `
    <h2>${isEdit ? '✏️ Edit Workspace' : '➕ New Workspace'}</h2>
    <form id="workspace-form">
      <div class="form-group full">
        <label>Workspace Name</label>
        <input type="text" id="ws-name-input" required value="${ws ? ws.name : ''}" placeholder="e.g. PhD Thesis, Literature Review" />
      </div>
      <div class="form-group full">
        <label>Research Topic / Focus Area (for AI relevance scoring)</label>
        <textarea id="ws-topic-input" rows="3">${ws ? (ws.research_topic || '') : (currentProfile?.research_topic || '')}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Icon</label>
          <input type="text" id="ws-icon-input" value="${ws ? (ws.icon || '📁') : '📁'}" style="width:80px; text-align:center" />
        </div>
      </div>
      <div class="form-group full">
        <label>Custom Extraction Fields (For AI PDF Parsing)</label>
        <p style="font-size: 0.8rem; color: var(--text2); margin-top: 0;">Define specific fields you want the AI to extract from papers in this workspace.</p>
        <div id="schema-builder-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;"></div>
        <button type="button" class="btn btn-ghost" onclick="addSchemaField()" style="align-self:flex-start;font-size:0.8rem;">➕ Add Field</button>
      </div>

      <div class="form-actions" style="margin-top:24px;">
        ${isEdit && !ws.is_default ? `<button type="button" class="btn btn-ghost" style="color:var(--danger)" onclick="deleteWorkspace('${ws.id}')">🗑️ Delete</button>` : '<div></div>'}
        <div style="display:flex;gap:12px;">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="btn-save-ws">${isEdit ? '💾 Save Changes' : '➕ Create Workspace'}</button>
        </div>
      </div>
    </form>
  `;
  
  window.currentSchemaFields = ws && ws.custom_schema ? [...ws.custom_schema] : [];
  
  window.renderSchemaBuilder = () => {
    const list = $('schema-builder-list');
    list.innerHTML = '';
    window.currentSchemaFields.forEach((field, index) => {
      list.innerHTML += `
        <div style="display:flex;gap:8px;align-items:flex-start;background:var(--bg);padding:10px;border-radius:8px;border:1px solid var(--border);">
          <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;gap:8px;">
              <input type="text" placeholder="Field Name (e.g. AI Models)" value="${field.name}" onchange="updateSchemaField(${index}, 'name', this.value)" style="flex:1;" required />
              <select onchange="updateSchemaField(${index}, 'type', this.value)" style="width:120px;">
                <option value="text" ${field.type === 'text' ? 'selected' : ''}>Text</option>
                <option value="boolean" ${field.type === 'boolean' ? 'selected' : ''}>Yes/No</option>
              </select>
            </div>
            <input type="text" placeholder="Prompt instruction (e.g. Extract the names of models used)" value="${field.description || ''}" onchange="updateSchemaField(${index}, 'description', this.value)" style="width:100%;" />
          </div>
          <button type="button" class="btn btn-ghost" onclick="removeSchemaField(${index})" style="color:var(--danger);padding:8px;">🗑️</button>
        </div>
      `;
    });
  };

  window.addSchemaField = () => {
    window.currentSchemaFields.push({ id: 'f_' + Date.now(), name: '', type: 'text', description: '' });
    renderSchemaBuilder();
  };

  window.updateSchemaField = (index, key, value) => {
    window.currentSchemaFields[index][key] = value;
  };

  window.removeSchemaField = (index) => {
    window.currentSchemaFields.splice(index, 1);
    renderSchemaBuilder();
  };

  renderSchemaBuilder();

  $('workspace-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('btn-save-ws');
    btn.disabled = true;
    btn.textContent = '⏳ Saving...';
    
    try {
      // Validate schema fields have names
      const validSchema = window.currentSchemaFields.filter(f => f.name.trim() !== '');

      const payload = {
        name: $('ws-name-input').value.trim(),
        research_topic: $('ws-topic-input').value.trim(),
        icon: $('ws-icon-input').value.trim() || '📁',
        custom_schema: validSchema
      };
      
      if (isEdit) {
        await api.updateWorkspace(ws.id, payload);
        toast('✅ Workspace updated');
      } else {
        const newWs = await api.createWorkspace(payload);
        currentWorkspace = newWs;
        toast('✅ Workspace created');
      }
      closeModal();
      await loadAll();
    } catch (err) {
      toast('❌ ' + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = isEdit ? '💾 Save Changes' : '➕ Create Workspace';
    }
  });
  
  openModal();
}

window.deleteWorkspace = async (id) => {
  if (!confirm('Are you sure you want to delete this workspace? All papers, domains, and research gaps inside it will be PERMANENTLY deleted!')) return;
  try {
    await api.deleteWorkspace(id);
    if (currentWorkspace?.id === id) {
      currentWorkspace = null; // Will fallback to default in loadAll
    }
    closeModal();
    toast('🗑️ Workspace deleted');
    await loadAll();
  } catch (err) {
    toast('❌ ' + err.message, true);
  }
};

// ── Navigation ──
function setupNav() {
  // Mobile menu toggle
  const sidebar = $('sidebar');
  const menuBtn = $('mobile-menu-btn');
  
  // Create overlay element for mobile
  let overlay = $('sidebar-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.id = 'sidebar-overlay';
    document.body.appendChild(overlay);
  }

  menuBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
    menuBtn.textContent = sidebar.classList.contains('open') ? '✕' : '☰';
  });

  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
    menuBtn.textContent = '☰';
  });

  // Nav item clicks
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPage = btn.dataset.page;
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      $('page-' + currentPage).classList.add('active');
      
      if (currentPage === 'graph') {
        document.body.style.overflow = 'hidden'; // Prevent mobile scroll from misaligning canvas touch coordinates
        setTimeout(() => {
          renderGraph();
          if (networkInstance) {
            networkInstance.fit(); // ensure it scales correctly after rendering
          }
        }, 350); // wait for 300ms fadeIn animation to complete
      } else {
        document.body.style.overflow = ''; // Restore scrolling for other pages
      }

      // Admin page: load users
      if (currentPage === 'admin') {
        loadAdminUsers();
      }
      
      // Close sidebar on mobile after nav click
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
      menuBtn.textContent = '☰';
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

  // Update export button label
  const exportBtn = $('btn-export');
  if (domainFilter || searchQuery) {
    exportBtn.textContent = `📥 Export (${filtered.length})`;
  } else {
    exportBtn.textContent = '📥 Export';
  }
}

// ── Paper Detail Modal ──
function openPaperDetail(p) {
  const d = state.domains.find(dd => dd.id === p.domain_id);
  const relColor = (p.relevance_score || 0) >= 90 ? 'var(--green)' : (p.relevance_score || 0) >= 75 ? 'var(--accent2)' : 'var(--orange)';
  const em = p.extended_metadata || {};
  const rc = em.research_context || {};
  const meth = em.methodology || {};
  const ds = em.dataset || {};
  const ev = em.evaluation || {};
  const out = em.output || {};
  const asmt = em.assessment || {};
  const tags = em.tags || {};
  const pers = em.personal || {};

  // Helper to render a field row
  const field = (label, value) => {
    if (value === null || value === undefined || value === '') {
      return `<div class="meta-field"><span class="meta-field-label">${label}</span><span class="meta-field-value empty">—</span></div>`;
    }
    if (typeof value === 'boolean') {
      return `<div class="meta-field"><span class="meta-field-label">${label}</span><span class="meta-field-value">${value ? '✅ Yes' : '❌ No'}</span></div>`;
    }
    if (Array.isArray(value)) {
      return `<div class="meta-field"><span class="meta-field-label">${label}</span><span class="meta-field-value">${value.join('; ') || '—'}</span></div>`;
    }
    return `<div class="meta-field"><span class="meta-field-label">${label}</span><span class="meta-field-value">${value}</span></div>`;
  };

  // Helper to render a collapsible section
  const section = (icon, title, content, openByDefault = false) => `
    <div class="meta-section${openByDefault ? ' open' : ''}">
      <div class="meta-section-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="meta-section-icon">${icon}</span>
        <span class="meta-section-title">${title}</span>
        <span class="meta-section-chevron">▶</span>
      </div>
      <div class="meta-section-body">${content}</div>
    </div>`;

  // Build tag chips
  const tagLabels = {
    privacy_policy: 'Privacy Policy', rule_extraction: 'Rule Extraction', policy_formalization: 'Policy Formalization',
    formal_logic: 'Formal Logic', datalog: 'Datalog', prolog: 'Prolog', compliance_constraints: 'Compliance Constraints',
    llm: 'LLM', multi_llm: 'Multi-LLM', consensus: 'Consensus', byzantine_fault_tolerance: 'Byzantine Fault Tolerance',
    explainability: 'Explainability', gdpr: 'GDPR', dpdp: 'DPDP'
  };
  const tagChips = Object.entries(tagLabels).map(([key, label]) => {
    const active = tags[key] === true;
    return `<span class="tag-chip ${active ? 'active' : 'inactive'}"><span class="tag-chip-dot"></span>${label}</span>`;
  }).join('');

  $('modal-body').innerHTML = `
    <h2>${p.title}</h2>
    <div class="meta-row">
      <span class="meta-tag" style="background:${d ? d.color + '22' : ''};color:${d?.color || ''}">${d?.icon || ''} ${d?.name || p.category}</span>
      <span class="meta-tag">📅 ${p.year}</span>
      <span class="meta-tag">📄 ${p.venue}</span>
      ${p.publisher ? `<span class="meta-tag">🏢 ${p.publisher}</span>` : ''}
      ${p.doi ? `<span class="meta-tag">🔗 ${p.doi}</span>` : ''}
      ${p.quartile ? `<span class="meta-tag">🏅 ${p.quartile}</span>` : ''}
      ${p.scopus_indexed ? `<span class="meta-tag" style="background:rgba(76,218,140,.12);color:var(--green)">✓ Scopus</span>` : ''}
      <span class="meta-tag read-badge ${p.is_read ? 'read' : 'unread'}">${p.is_read ? '✓ Read' : '📌 Unread'}</span>
    </div>
    ${p.url ? `<a href="${p.url}" target="_blank" class="modal-paper-link">📄 Read Paper →</a>` : ''}
    
    <div class="meta-accordion">
      ${section('📋', 'Bibliographic Info', `
        ${field('Authors', p.authors)}
        ${field('Year', p.year)}
        ${field('Venue', p.venue)}
        ${field('Publisher', p.publisher)}
        ${field('DOI', p.doi)}
        ${field('Scopus Indexed', p.scopus_indexed)}
        ${field('Quartile', p.quartile)}
        ${field('Research Domain', p.research_domain)}
        ${field('Category', p.category)}
      `, true)}

      <!-- ═══ CUSTOM EXTRACTION FIELDS (collapsible) ═══ -->
      ${(currentWorkspace?.custom_schema || []).length > 0 ? section('✨', 'Custom Fields',
        (currentWorkspace.custom_schema).map(f => {
          const val = (em.custom_fields && em.custom_fields[f.id] !== undefined) ? em.custom_fields[f.id] : null;
          return field(f.name, val);
        }).join('')
      ) : ''}

      ${section('⭐', 'Assessment', `
        ${field('Key Contribution', p.contribution)}
        ${field('Limitations', p.limitations)}
      `, true)}

      ${section('🧑‍🔬', 'Personal Assessment', `
        ${field('Research Gap', pers.research_gap)}
        ${field('Missing Component', pers.missing_component)}
        ${field('Relevance to Research', pers.relevance_to_my_research || p.relevance)}
        ${field('Personal Notes', pers.personal_notes || p.notes)}
      `)}
    </div>

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
  const em = paper?.extended_metadata || {};
  const rc = em.research_context || {};
  const meth = em.methodology || {};
  const ds = em.dataset || {};
  const ev = em.evaluation || {};
  const out = em.output || {};
  const asmt = em.assessment || {};
  const tags = em.tags || {};
  const pers = em.personal || {};

  // Helper for collapsible form sections
  const formSection = (id, icon, label, fieldsHtml) => `
    <div class="form-section-divider" id="fsd-${id}" onclick="this.classList.toggle('open');document.getElementById('fsc-${id}').classList.toggle('open')">
      <span class="section-line"></span>
      <span class="section-label">${icon} ${label} <span class="section-chevron">▶</span></span>
      <span class="section-line"></span>
    </div>
    <div class="form-section-collapse" id="fsc-${id}">
      ${fieldsHtml}
    </div>`;

  // Helper for tag toggles
  const tagToggle = (id, label, checked) => `
    <label class="form-toggle ${checked ? 'active' : ''}" id="ft-${id}" onclick="this.classList.toggle('active');this.querySelector('input').checked=!this.querySelector('input').checked">
      <input type="checkbox" id="f-tag-${id}" ${checked ? 'checked' : ''}>${label}
    </label>`;

  $('modal-body').innerHTML = `
    <h2 style="margin-bottom:12px">${isEdit ? 'Edit Paper' : 'Add New Paper'}</h2>
    ${!isEdit ? `
      <div style="margin-bottom:16px">
        <input type="file" id="paper-pdf" accept="application/pdf" style="display:none">
        <button class="btn btn-primary" id="btn-ai-upload" style="background:linear-gradient(135deg,#a78bfa,#c084fc);width:100%;padding:12px 16px;font-size:.9rem">✨ Auto-fill with AI (Upload PDF)</button>
        <div id="parse-loader" style="display:none;margin-top:10px;text-align:center">⏳ AI is parsing your PDF...</div>
      </div>
    ` : ''}
    <form id="paper-form">
      <div class="form-grid">
        <!-- ═══ CORE BIBLIOGRAPHIC (always visible) ═══ -->
        <div class="form-group full"><label>Title *</label><input id="f-title" required value="${paper?.title || ''}" /></div>
        <div class="form-group full"><label>Authors *</label><input id="f-authors" required value="${paper?.authors || ''}" /></div>
        <div class="form-group"><label>Year *</label><input type="number" id="f-year" required min="1990" max="2030" value="${paper?.year || 2024}" /></div>
        <div class="form-group"><label>Venue *</label><input id="f-venue" required value="${paper?.venue || ''}" /></div>
        <div class="form-group"><label>Publisher</label><input id="f-publisher" value="${paper?.publisher || ''}" /></div>
        <div class="form-group"><label>DOI</label><input id="f-doi" value="${paper?.doi || ''}" /></div>
        <div class="form-group full"><label>Paper URL</label><input type="url" id="f-url" value="${paper?.url || ''}" /></div>
        <div class="form-group"><label>Domain</label><select id="f-domain"><option value="">— None —</option>${state.domains.map(d => `<option value="${d.id}" ${paper?.domain_id === d.id ? 'selected' : ''}>${d.icon} ${d.name}</option>`).join('')}</select></div>
        <div class="form-group"><label>Category</label><input id="f-cat" value="${paper?.category || 'Foundation'}" /></div>
        <div class="form-group"><label>Quartile</label><select id="f-quartile"><option value="">—</option>${['Q1','Q2','Q3','Q4'].map(q => `<option value="${q}" ${paper?.quartile === q ? 'selected' : ''}>${q}</option>`).join('')}</select></div>
        <div class="form-group"><label>Scopus Indexed</label><select id="f-scopus"><option value="false" ${!paper?.scopus_indexed ? 'selected' : ''}>No</option><option value="true" ${paper?.scopus_indexed ? 'selected' : ''}>Yes</option></select></div>
        <div class="form-group"><label>Research Domain</label><input id="f-research-domain" value="${paper?.research_domain || ''}" /></div>
        <div class="form-group"><label>Relevance (0–100)</label><input type="number" id="f-rel" min="0" max="100" value="${paper?.relevance_score || 75}" /></div>
        <div class="form-group"><label>Read?</label><select id="f-read"><option value="false" ${!paper?.is_read ? 'selected' : ''}>Not yet</option><option value="true" ${paper?.is_read ? 'selected' : ''}>Yes, read</option></select></div>
        <div class="form-group full"><label>Key Contribution *</label><textarea id="f-cont" rows="3" required>${paper?.contribution || ''}</textarea></div>

        <!-- ═══ CUSTOM EXTRACTION FIELDS (collapsible) ═══ -->
        ${(currentWorkspace?.custom_schema || []).length > 0 ? formSection('custom', '✨', 'Custom Fields', 
          (currentWorkspace.custom_schema).map(f => {
            const val = (em.custom_fields && em.custom_fields[f.id] !== undefined) ? em.custom_fields[f.id] : '';
            if (f.type === 'boolean') {
              return `<div class="form-group"><label>${f.name}</label><select id="f-custom-${f.id}"><option value="false" ${!val ? 'selected' : ''}>No</option><option value="true" ${val ? 'selected' : ''}>Yes</option></select></div>`;
            } else {
              return `<div class="form-group full"><label>${f.name}</label><textarea id="f-custom-${f.id}" rows="2">${val}</textarea></div>`;
            }
          }).join('')
        ) : ''}

        <!-- ═══ PERSONAL ASSESSMENT (collapsible) ═══ -->
        ${formSection('pers', '🧑‍🔬', 'Personal Assessment', `
          <div class="form-group full"><label>Research Gap</label><textarea id="f-pers-gap" rows="2">${pers.research_gap || ''}</textarea></div>
          <div class="form-group full"><label>Missing Component</label><input id="f-pers-missing" value="${pers.missing_component || ''}" /></div>
          <div class="form-group full"><label>Relevance to Research</label><textarea id="f-reltext" rows="2">${pers.relevance_to_my_research || paper?.relevance || ''}</textarea></div>
          <div class="form-group full"><label>Personal Notes</label><textarea id="f-notes" rows="2">${pers.personal_notes || paper?.notes || ''}</textarea></div>
        `)}
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="document.getElementById('modal-overlay').classList.remove('active');document.body.style.overflow=''">Cancel</button>
        <button type="submit" class="btn btn-primary">💾 ${isEdit ? 'Update' : 'Save'}</button>
      </div>
    </form>`;

  if (!isEdit) {
    $('btn-ai-upload').addEventListener('click', () => $('paper-pdf').click());
    $('paper-pdf').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const btn = $('btn-ai-upload');
      const originalText = btn.innerHTML;
      btn.innerHTML = '⏳ Reading PDF...';
      btn.disabled = true;
      toast('Sending to Gemini AI for parsing...');
      
      try {
        const parsed = await api.uploadPdf(file, currentWorkspace?.id);
        
        // ── Auto-fill Core Bibliographic Fields ──
        if (parsed.title) $('f-title').value = parsed.title;
        if (parsed.authors) $('f-authors').value = parsed.authors;
        if (parsed.year) $('f-year').value = parsed.year;
        if (parsed.venue) $('f-venue').value = parsed.venue;
        if (parsed.publisher) $('f-publisher').value = parsed.publisher;
        if (parsed.url) $('f-url').value = parsed.url;
        if (parsed.doi) $('f-doi').value = parsed.doi;
        if (parsed.contribution) $('f-cont').value = parsed.contribution;
        if (parsed.relevance_score) $('f-rel').value = parsed.relevance_score;
        if (parsed.category) $('f-cat').value = parsed.category;
        if (parsed.quartile) $('f-quartile').value = parsed.quartile;
        if (parsed.scopus_indexed) $('f-scopus').value = 'true';
        if (parsed.research_domain) $('f-research-domain').value = parsed.research_domain;

        // ── Auto-fill Extended Metadata ──
        const emd = parsed.extended_metadata || {};

        // Research Context
        const prc = emd.research_context || parsed.research_context || {};
        if (prc.research_problem) $('f-rc-problem').value = prc.research_problem;
        if (prc.research_objective) $('f-rc-objective').value = prc.research_objective;
        if (prc.motivation) $('f-rc-motivation').value = prc.motivation;

        // Methodology
        const pmeth = emd.methodology || parsed.methodology || {};
        if (pmeth.methodology) $('f-meth-methodology').value = pmeth.methodology;
        if (pmeth.ai_technique) $('f-meth-ai').value = pmeth.ai_technique;
        if (pmeth.model_llm_used) $('f-meth-llm').value = pmeth.model_llm_used;
        if (pmeth.multi_llm) $('f-meth-multi-llm').value = 'true';
        if (pmeth.consensus_mechanism) $('f-meth-consensus').value = pmeth.consensus_mechanism;
        if (pmeth.formal_method) $('f-meth-formal').value = pmeth.formal_method;
        if (pmeth.formal_language) $('f-meth-formal-lang').value = pmeth.formal_language;
        if (pmeth.rule_extraction_technique) $('f-meth-rule-extract').value = pmeth.rule_extraction_technique;
        if (pmeth.rule_representation) $('f-meth-rule-repr').value = pmeth.rule_representation;

        // Dataset
        const pds = emd.dataset || parsed.dataset || {};
        if (pds.dataset_name) $('f-ds-name').value = pds.dataset_name;
        if (pds.dataset_source) $('f-ds-source').value = pds.dataset_source;
        if (pds.dataset_type) $('f-ds-type').value = pds.dataset_type;
        if (pds.dataset_size) $('f-ds-size').value = pds.dataset_size;
        if (pds.domain) $('f-ds-domain').value = pds.domain;
        if (pds.regulation) $('f-ds-regulation').value = pds.regulation;

        // Evaluation
        const pev = emd.evaluation || parsed.evaluation || {};
        if (pev.evaluation_method) $('f-ev-method').value = pev.evaluation_method;
        if (pev.baseline_method) $('f-ev-baseline').value = pev.baseline_method;
        if (pev.evaluation_metrics) $('f-ev-metrics').value = pev.evaluation_metrics;
        if (pev.results) $('f-ev-results').value = pev.results;

        // Output & Verification
        const pout = emd.output || parsed.output || {};
        if (pout.output) $('f-out-output').value = pout.output;
        if (pout.machine_verifiable) $('f-out-machine').value = 'true';
        if (pout.compliance_verification) $('f-out-compliance').value = pout.compliance_verification;
        if (pout.runtime_verification) $('f-out-runtime').value = pout.runtime_verification;

        // Assessment
        const pasmt = emd.assessment || parsed.assessment || {};
        if (pasmt.novelty) $('f-asmt-novelty').value = pasmt.novelty;
        if (pasmt.strengths) $('f-asmt-strengths').value = pasmt.strengths;
        if (pasmt.limitations && Array.isArray(pasmt.limitations)) {
          $('f-lim').value = pasmt.limitations.join('\n');
        } else if (parsed.limitations && Array.isArray(parsed.limitations)) {
          $('f-lim').value = parsed.limitations.join('\n');
        }
        if (pasmt.future_work) $('f-asmt-future').value = pasmt.future_work;

        // Tags
        const ptags = emd.tags || parsed.tags || {};
        const tagKeys = ['privacy_policy','rule_extraction','policy_formalization','formal_logic','datalog','prolog',
          'compliance_constraints','llm','multi_llm','consensus','byzantine_fault_tolerance','explainability','gdpr','dpdp'];
        tagKeys.forEach(key => {
          if (ptags[key]) {
            const checkbox = $(`f-tag-${key}`);
            if (checkbox) { checkbox.checked = true; checkbox.parentElement.classList.add('active'); }
          }
        });

        // Personal Assessment
        const ppers = emd.personal || parsed.personal || {};
        if (ppers.research_gap) $('f-pers-gap').value = ppers.research_gap;
        if (ppers.missing_component) $('f-pers-missing').value = ppers.missing_component;
        if (ppers.relevance_to_my_research || parsed.relevance) $('f-reltext').value = ppers.relevance_to_my_research || parsed.relevance;
        if (ppers.personal_notes) $('f-notes').value = ppers.personal_notes;
        
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
        
        // Open filled sections so user can see the AI-extracted data
        ['rc','meth','ds','ev','out','asmt','tags','pers'].forEach(id => {
          const divider = $(`fsd-${id}`);
          const collapse = $(`fsc-${id}`);
          if (divider && collapse) { divider.classList.add('open'); collapse.classList.add('open'); }
        });

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
    const limitations = limText ? limText.split('\n').map(s => s.trim()).filter(Boolean) : [];

    // Collect custom field values
    const custom_fields = {};
    if (currentWorkspace && currentWorkspace.custom_schema) {
      currentWorkspace.custom_schema.forEach(f => {
        const el = $(`f-custom-${f.id}`);
        if (el) {
          custom_fields[f.id] = f.type === 'boolean' ? el.value === 'true' : (el.value.trim() || null);
        }
      });
    }

    // Build extended_metadata JSONB
    const extended_metadata = {
      custom_fields: custom_fields,
      personal: {
        research_gap: $('f-pers-gap').value.trim() || null,
        missing_component: $('f-pers-missing').value.trim() || null,
        relevance_to_my_research: $('f-reltext').value.trim() || null,
        relevance_score: parseInt($('f-rel').value) || 75,
        personal_notes: $('f-notes').value.trim() || null
      }
    };

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
      limitations: limitations,
      relevance: $('f-reltext').value.trim() || null,
      notes: $('f-notes').value.trim() || null,
      is_read: $('f-read').value === 'true',
      category: $('f-cat').value.trim() || 'Foundation',
      publisher: $('f-publisher').value.trim() || null,
      scopus_indexed: $('f-scopus').value === 'true',
      quartile: $('f-quartile').value || null,
      research_domain: $('f-research-domain').value.trim() || null,
      extended_metadata,
      workspace_id: currentWorkspace?.id || null
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
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div style="font-size:2rem;margin-bottom:4px">${d.icon}</div>
        <button class="btn btn-ghost btn-sm btn-delete-domain" data-id="${d.id}" style="padding: 4px 8px; font-size: 0.75rem; color: var(--accent3); border-color: rgba(255,108,140,0.3);">🗑</button>
      </div>
      <h3>${d.name}</h3>
      <p>${d.description || 'No description'}</p>
      <div class="domain-papers"><strong>${d.paperCount}</strong> papers · <strong>${d.avgRelevance}%</strong> avg relevance</div>
      ${d.paperCount > 0 ? `
        <div style="display:flex; gap:8px; margin-top:10px;">
          <button class="btn btn-ghost btn-sm domain-export-btn" data-domain-id="${d.id}" data-domain-name="${d.name}" style="flex:1;">📥 Export</button>
          <button class="btn btn-primary btn-sm domain-lit-btn" data-domain-id="${d.id}" data-domain-name="${d.name}" style="flex:1; background:linear-gradient(135deg,#a78bfa,#c084fc);">✨ Lit Review</button>
        </div>
      ` : ''}
    </div>`).join('') || '<div class="empty-state"><p>No domains yet.</p></div>';

  // Attach export handlers to each domain card
  document.querySelectorAll('.domain-export-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const domainId = btn.dataset.domainId;
      const domainName = btn.dataset.domainName;
      exportDomainPapers(domainId, domainName);
    });
  });

  // Attach lit review handlers to each domain card
  document.querySelectorAll('.domain-lit-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const domainId = btn.dataset.domainId;
      const domainName = btn.dataset.domainName;
      
      const originalText = btn.innerHTML;
      btn.innerHTML = '⏳ Generating...';
      btn.disabled = true;
      toast(`✨ AI is writing a literature review for ${domainName}. This takes ~15 seconds...`);
      
      try {
        const result = await api.generateLitReview(domainId);
        openLitReviewModal(domainName, result.review);
      } catch (err) {
        toast('❌ ' + err.message, true);
      } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    });
  });

  // Attach delete handlers to each domain card
  document.querySelectorAll('.btn-delete-domain').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!confirm('Delete this domain? Papers linked to it will lose their domain assignment.')) return;
      try {
        await api.deleteDomain(id);
        toast('🗑 Domain deleted');
        await loadAll();
      } catch (err) {
        toast('❌ ' + err.message, true);
      }
    });
  });
}

function openLitReviewModal(domainName, markdownText) {
  // Simple markdown parser for headings, bold, and lists
  let htmlText = markdownText
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/^- (.*$)/gim, '<li>$1</li>')
    .replace(/\n\n/g, '<br><br>');
  
  htmlText = htmlText.replace(/<li>.*<\/li>/s, match => `<ul>${match}</ul>`);

  $('modal-body').innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <h2 style="margin:0;">✨ ${domainName} - Literature Review</h2>
    </div>
    <div id="lit-review-content" style="line-height:1.6; font-size:0.95rem; color:var(--text1); max-height: 60vh; overflow-y: auto; padding-right: 8px;">
      ${htmlText}
    </div>
    <div class="modal-actions" style="margin-top:20px; display:flex; gap:10px;">
      <button class="btn btn-ghost" style="flex:1;" onclick="downloadLitReviewWord('${domainName.replace(/'/g, "\\'")}')">📄 Download Word</button>
      <button class="btn btn-primary" style="flex:1;" onclick="document.getElementById('modal-overlay').classList.remove('active');document.body.style.overflow=''">Done</button>
    </div>
  `;
  openModal();
}

window.downloadLitReviewWord = function(domainName) {
  const content = document.getElementById('lit-review-content').innerHTML;
  const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Literature Review</title></head><body>";
  const footer = "</body></html>";
  const docHtml = header + "<h1>Tessera AI</h1><h2>Literature Review: " + domainName + "</h2><hr>" + content + footer;
  
  const blob = new Blob(['\ufeff', docHtml], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Tessera_AI_Lit_Review_${domainName.replace(/\\s+/g, '_')}.doc`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ── Gaps Page ──
function renderGaps() {
  $('gaps-grid').innerHTML = state.gaps.map(g => {
    const d = g.domains;
    return `
    <div class="gap-card" style="position:relative; cursor:pointer;" onclick="const cb = this.querySelector('.gap-checkbox'); cb.checked = !cb.checked; cb.dispatchEvent(new Event('change'));">
      <input type="checkbox" class="gap-checkbox" data-id="${g.id}" style="position:absolute; top:15px; left:15px; transform: scale(1.3); cursor:pointer;" onclick="event.stopPropagation();">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; padding-left: 25px;">
        <span class="gap-severity severity-${g.severity}">${g.severity}</span>
        <div style="display: flex; gap: 8px; align-items: center;">
          <span class="gap-status" style="position: static;">${g.status}</span>
          <button class="btn btn-ghost btn-sm btn-delete-gap" data-id="${g.id}" style="padding: 2px 6px; font-size: 0.75rem; color: var(--accent3); border-color: rgba(255,108,140,0.3);">🗑</button>
        </div>
      </div>
      <h3>${g.title}</h3>
      <p>${g.description || ''}</p>
      ${d ? `<div class="gap-domain">${d.icon} ${d.name}</div>` : ''}
    </div>`;
  }).join('') || '<div class="empty-state"><p>No research gaps defined.</p></div>';

  // Attach delete handlers to each gap card
  document.querySelectorAll('.btn-delete-gap').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!confirm('Delete this research gap?')) return;
      try {
        await api.deleteGap(id);
        toast('🗑 Research gap deleted');
        await loadAll();
      } catch (err) {
        toast('❌ ' + err.message, true);
      }
    });
  });

  // Handle Gap Checkboxes
  const pitchBtn = $('btn-generate-pitch');
  if (pitchBtn) {
    document.querySelectorAll('.gap-checkbox').forEach(cb => {
      cb.addEventListener('change', e => {
        const checked = document.querySelectorAll('.gap-checkbox:checked').length;
        if (checked > 0) {
          pitchBtn.disabled = false;
          pitchBtn.innerHTML = `✍️ Generate Pitch (${checked} selected)`;
        } else {
          pitchBtn.disabled = true;
          pitchBtn.innerHTML = `✍️ Generate Pitch (0 selected)`;
        }
      });
    });

    pitchBtn.onclick = async () => {
      const selectedGaps = Array.from(document.querySelectorAll('.gap-checkbox:checked')).map(cb => cb.dataset.id);
      if (selectedGaps.length === 0) return;
      
      const pitchIdea = prompt("Optional: Briefly describe your proposed idea or solution (or leave blank and AI will figure it out):");
      if (pitchIdea === null) return; // Cancelled

      pitchBtn.disabled = true;
      pitchBtn.innerHTML = "⏳ Generating Pitch...";
      toast(`✨ AI is writing your Elevator Pitch. This takes ~15 seconds...`);

      try {
        const result = await api.generatePitch({ gapIds: selectedGaps, idea: pitchIdea });
        openLitReviewModal('My Thesis Pitch', result.pitch);
      } catch (err) {
        toast('❌ ' + err.message, true);
      } finally {
        // Reset state
        document.querySelectorAll('.gap-checkbox:checked').forEach(cb => cb.checked = false);
        pitchBtn.disabled = true;
        pitchBtn.innerHTML = `✍️ Generate Pitch (0 selected)`;
      }
    };
  }
}

// ── Knowledge Graph ──
let networkInstance = null;
function renderGraph() {
  const container = $('kg-network');
  if (!container || currentPage !== 'graph') return;
  
  if (!window.vis) {
    container.innerHTML = '<p style="padding:20px">Loading graph library...</p>';
    setTimeout(renderGraph, 500);
    return;
  }

  const nodes = [];
  const edges = [];

  // Add Domains
  state.domains.forEach(d => {
    nodes.push({
      id: 'd_' + d.id,
      label: d.name,
      group: 'domain',
      title: d.description || d.name,
      font: { color: '#ffffff', size: 16 },
      color: { background: d.color, border: d.color },
      shape: 'box',
      margin: 10
    });
  });

  // Add Gaps
  state.gaps.forEach(g => {
    nodes.push({
      id: 'g_' + g.id,
      label: g.title,
      group: 'gap',
      title: g.description,
      font: { color: '#ffffff', size: 12 },
      color: { background: '#222233', border: '#444455' },
      shape: 'ellipse'
    });
    // Link gap to domain
    if (g.domain_id) {
      edges.push({ from: 'g_' + g.id, to: 'd_' + g.domain_id, dashes: true, color: { color: '#444455' } });
    }
  });

  // Add Papers
  state.papers.forEach(p => {
    const d = state.domains.find(dd => dd.id === p.domain_id);
    nodes.push({
      id: 'p_' + p.id,
      label: p.title.substring(0, 25) + (p.title.length > 25 ? '...' : ''),
      group: 'paper',
      title: p.title + '\n' + p.authors,
      font: { color: '#aaaaaa', size: 10 },
      color: { background: d ? d.color + '44' : '#111111', border: d ? d.color : '#333333' },
      shape: 'dot',
      size: 10
    });
    
    // Link paper to domain
    if (p.domain_id) {
      edges.push({ from: 'p_' + p.id, to: 'd_' + p.domain_id, color: { color: d ? d.color + '44' : '#333333' } });
    }
  });

  const data = { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };
  const options = {
    width: '100%',
    height: '100%',
    autoResize: true,
    nodes: { borderWidth: 2 },
    edges: { smooth: { type: 'continuous' } },
    physics: {
      solver: 'forceAtlas2Based',
      forceAtlas2Based: {
        gravitationalConstant: -200,
        centralGravity: 0.01,
        springLength: 300,
        springConstant: 0.05,
        damping: 0.4,
        avoidOverlap: 1
      },
      stabilization: { iterations: 150 }
    },
    interaction: { hover: true, tooltipDelay: 200 }
  };

  if (networkInstance) {
    networkInstance.destroy();
  }
  networkInstance = new vis.Network(container, data, options);
}

// ══════════════════════════════════════════════
// ADMIN MODULE
// ══════════════════════════════════════════════
async function loadAdminUsers() {
  try {
    const users = await api.getAdminUsers();
    renderAdminUsers(users);
  } catch (err) {
    toast('❌ ' + err.message, true);
  }
}

function renderAdminUsers(users) {
  if (!users || users.length === 0) {
    $('admin-empty').style.display = 'block';
    $('admin-table').style.display = 'none';
    return;
  }
  $('admin-empty').style.display = 'none';
  $('admin-table').style.display = 'table';

  // Stats
  $('admin-stats').innerHTML = `
    <div class="stats-row" style="margin-bottom:24px">
      <div class="stat-card">
        <span class="stat-icon">👥</span>
        <div class="stat-value" style="background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent">${users.length}</div>
        <div class="stat-label">Total Users</div>
      </div>
      <div class="stat-card">
        <span class="stat-icon">⭐</span>
        <div class="stat-value" style="background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent">${users.filter(u => u.role === 'admin').length}</div>
        <div class="stat-label">Admins</div>
      </div>
      <div class="stat-card">
        <span class="stat-icon">📄</span>
        <div class="stat-value" style="background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent">${users.reduce((s, u) => s + u.paper_count, 0)}</div>
        <div class="stat-label">Total Papers (All Users)</div>
      </div>
    </div>
  `;

  $('admin-table-body').innerHTML = users.map(u => `
    <tr>
      <td>
        <div class="admin-user-cell">
          <div class="admin-user-avatar">${(u.full_name || u.email || '?').charAt(0).toUpperCase()}</div>
          <div>
            <div class="admin-user-name">${u.full_name || '—'}</div>
            <div class="admin-user-email">${u.email || '—'}</div>
          </div>
        </div>
      </td>
      <td><span class="admin-topic">${u.research_topic ? (u.research_topic.length > 40 ? u.research_topic.substring(0, 37) + '...' : u.research_topic) : '<em style="color:var(--text2)">Not set</em>'}</span></td>
      <td>
        <select class="admin-role-select" data-user-id="${u.id}" ${u.id === currentUser.id ? 'disabled' : ''}>
          <option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </td>
      <td><span class="admin-count">${u.paper_count}</span></td>
      <td><span class="admin-count">${u.domain_count}</span></td>
      <td><span class="admin-count">${u.gap_count}</span></td>
      <td><span class="admin-date">${new Date(u.created_at).toLocaleDateString()}</span></td>
      <td>
        ${u.id !== currentUser.id ? `<button class="btn btn-danger btn-sm admin-delete-btn" data-user-id="${u.id}">🗑</button>` : '<span class="admin-you-badge">You</span>'}
      </td>
    </tr>
  `).join('');

  // Role change handlers
  document.querySelectorAll('.admin-role-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      try {
        await api.updateUserRole(sel.dataset.userId, sel.value);
        toast('✅ Role updated');
      } catch (err) {
        toast('❌ ' + err.message, true);
        await loadAdminUsers(); // revert
      }
    });
  });

  // Delete handlers
  document.querySelectorAll('.admin-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this user and ALL their data? This cannot be undone.')) return;
      try {
        await api.deleteUser(btn.dataset.userId);
        toast('🗑 User deleted');
        await loadAdminUsers();
      } catch (err) {
        toast('❌ ' + err.message, true);
      }
    });
  });
}

// ── Export ──
function exportPapers() {
  console.log('Export clicked. domainFilter:', domainFilter, 'searchQuery:', searchQuery);
  // Export exactly what's visible on screen (respects domain filter + search)
  let filtered = state.papers.filter(p => {
    const matchDomain = !domainFilter || p.domain_id === domainFilter;
    const matchSearch = !searchQuery || p.title.toLowerCase().includes(searchQuery) ||
      p.authors.toLowerCase().includes(searchQuery) || (p.contribution || '').toLowerCase().includes(searchQuery) ||
      String(p.year).includes(searchQuery);
    return matchDomain && matchSearch;
  });
  console.log('Filtered papers count:', filtered.length, 'of', state.papers.length);

  let label = 'All_Papers';
  if (domainFilter) {
    const d = state.domains.find(dd => dd.id === domainFilter);
    label = d?.name || 'Filtered';
  }
  if (searchQuery) label += `_${searchQuery}`;

  exportToExcel(filtered, label);
}

function exportDomainPapers(domainId, domainName) {
  const filtered = state.papers.filter(p => p.domain_id === domainId);
  exportToExcel(filtered, domainName || 'Domain');
}

function exportToExcel(papers, sheetLabel) {
  if (!papers || papers.length === 0) {
    toast('⚠️ No papers to export', true);
    return;
  }

  // Build comprehensive rows for Excel with all metadata fields
  const rows = papers.map((p, i) => {
    const d = state.domains.find(dd => dd.id === p.domain_id);
    const em = p.extended_metadata || {};
    const rc = em.research_context || {};
    const meth = em.methodology || {};
    const ds = em.dataset || {};
    const ev = em.evaluation || {};
    const out = em.output || {};
    const asmt = em.assessment || {};
    const tags = em.tags || {};
    const pers = em.personal || {};

    return {
      // ── Bibliographic ──
      '#': i + 1,
      'Title': p.title,
      'Authors': p.authors,
      'Year': p.year,
      'Venue': p.venue,
      'Publisher': p.publisher || '—',
      'Scopus Indexed': p.scopus_indexed ? 'Yes' : 'No',
      'Quartile': p.quartile || '—',
      'DOI': p.doi || '—',
      'URL': p.url || '—',
      'Research Domain': p.research_domain || '—',
      'Domain': d?.name || p.category || '—',
      'Category': p.category || '—',

      // ── Research Context ──
      'Research Problem': rc.research_problem || '—',
      'Research Objective': rc.research_objective || '—',
      'Motivation': rc.motivation || '—',

      // ── Methodology ──
      'Methodology': meth.methodology || '—',
      'AI Technique': meth.ai_technique || '—',
      'Model / LLM Used': meth.model_llm_used || '—',
      'Multi-LLM': meth.multi_llm ? 'Yes' : 'No',
      'Consensus Mechanism': meth.consensus_mechanism || '—',
      'Formal Method': meth.formal_method || '—',
      'Formal Language': meth.formal_language || '—',
      'Rule Extraction Technique': meth.rule_extraction_technique || '—',
      'Rule Representation': meth.rule_representation || '—',

      // ── Dataset ──
      'Dataset Name': ds.dataset_name || '—',
      'Dataset Source': ds.dataset_source || '—',
      'Dataset Type': ds.dataset_type || '—',
      'Dataset Size': ds.dataset_size || '—',
      'Dataset Domain': ds.domain || '—',
      'Regulation': ds.regulation || '—',

      // ── Evaluation ──
      'Evaluation Method': ev.evaluation_method || '—',
      'Baseline Method': ev.baseline_method || '—',
      'Evaluation Metrics': ev.evaluation_metrics || '—',
      'Results': ev.results || '—',

      // ── Output & Verification ──
      'Output': out.output || '—',
      'Machine Verifiable': out.machine_verifiable ? 'Yes' : 'No',
      'Compliance Verification': out.compliance_verification || '—',
      'Runtime Verification': out.runtime_verification || '—',

      // ── Assessment ──
      'Key Contribution': asmt.key_contribution || p.contribution || '—',
      'Novelty': asmt.novelty || '—',
      'Strengths': asmt.strengths || '—',
      'Limitations': (asmt.limitations || p.limitations || []).join('; ') || '—',
      'Future Work': asmt.future_work || '—',

      // ── Tags ──
      'Tag: Privacy Policy': tags.privacy_policy ? '✓' : '',
      'Tag: Rule Extraction': tags.rule_extraction ? '✓' : '',
      'Tag: Policy Formalization': tags.policy_formalization ? '✓' : '',
      'Tag: Formal Logic': tags.formal_logic ? '✓' : '',
      'Tag: Datalog': tags.datalog ? '✓' : '',
      'Tag: Prolog': tags.prolog ? '✓' : '',
      'Tag: Compliance Constraints': tags.compliance_constraints ? '✓' : '',
      'Tag: LLM': tags.llm ? '✓' : '',
      'Tag: Multi-LLM': tags.multi_llm ? '✓' : '',
      'Tag: Consensus': tags.consensus ? '✓' : '',
      'Tag: Byzantine Fault Tolerance': tags.byzantine_fault_tolerance ? '✓' : '',
      'Tag: Explainability': tags.explainability ? '✓' : '',
      'Tag: GDPR': tags.gdpr ? '✓' : '',
      'Tag: DPDP': tags.dpdp ? '✓' : '',

      // ── Personal ──
      'Research Gap': pers.research_gap || '—',
      'Missing Component': pers.missing_component || '—',
      'Relevance to Research': pers.relevance_to_my_research || p.relevance || '—',
      'Relevance Score': p.relevance_score || 0,
      'Personal Notes': pers.personal_notes || p.notes || '—',
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
  const fileName = `TesseraAI_${safeName}_${dateStr}.xlsx`;
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
window.openWorkspaceForm = openWorkspaceForm;
window.closeModal = closeModal;
