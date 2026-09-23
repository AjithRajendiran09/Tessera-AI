import * as api from './api.js';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import Chart from 'chart.js/auto';
import {
  Document, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, AlignmentType, ImageRun, Packer, Footer, PageNumber, BorderStyle, SectionType
} from 'docx';
import saveAsPkg from 'file-saver';
const saveAs = saveAsPkg.saveAs || saveAsPkg;

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
    currentWorkspace = null;
    state.workspaces = [];
    state.papers = [];
    state.domains = [];
    state.gaps = [];
    showAuthScreen();
    toast('👋 Signed out');
  } catch (err) {
    toast('❌ ' + err.message, true);
  }
}

async function loadAll() {
  try {
    // Load Workspaces first (strictly scoped to currently logged-in user)
    state.workspaces = await api.getWorkspaces();
    if (state.workspaces && state.workspaces.length > 0) {
      // Keep selected workspace if it belongs to this user, else use default or first
      if (!currentWorkspace || !state.workspaces.find(w => w.id === currentWorkspace.id)) {
        currentWorkspace = state.workspaces.find(w => w.is_default) || state.workspaces[0];
      }
      renderWorkspaceSwitcher();
      updateResearchTopicBadge();
    } else {
      currentWorkspace = null;
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

      // Discover page: setup search
      if (currentPage === 'discover') {
        setupDiscoverPage();
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

    ${(!p.limitations || p.limitations.length === 0 || !pers.research_gap) ? `
      <div class="autofill-banner" id="md-autofill-banner">
        <span class="autofill-banner-text">⚡ Assessment, Limitations & Research Gap details not generated yet.</span>
        <button class="btn btn-sm btn-autofill-magic" id="btn-banner-autofill">✨ Auto-Fill with AI</button>
      </div>` : ''}
    
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
      `, true)}
    </div>

    <div class="relevance-bar" style="margin-top:14px">
      <span>Score</span><div class="rel-track"><div class="rel-fill" style="width:${p.relevance_score || 0}%;background:${relColor}"></div></div><span style="font-weight:700">${p.relevance_score || 0}%</span>
    </div>
    <div class="modal-actions">
      <button class="btn btn-sm btn-autofill-magic" id="md-autofill">✨ Auto-Fill with AI</button>
      <button class="btn btn-ghost btn-sm" id="md-toggle-read">${p.is_read ? '📌 Mark Unread' : '✅ Mark Read'}</button>
      <button class="btn btn-ghost btn-sm" id="md-edit">✏️ Edit</button>
      <button class="btn btn-danger btn-sm" id="md-delete">🗑 Delete</button>
    </div>`;

  const handleAutoFill = async (btn) => {
    if (!btn) return;
    const origText = btn.innerHTML;
    btn.innerHTML = '⏳ Analyzing with AI...';
    btn.disabled = true;
    toast('Generating paper assessment, limitations & research gaps with Gemini AI...');
    try {
      const updatedPaper = await api.autofillPaper(p.id);
      toast('✨ All details automatically filled!');
      if (state.papers) {
        const idx = state.papers.findIndex(x => x.id === p.id);
        if (idx !== -1) state.papers[idx] = updatedPaper;
      }
      openPaperModal(updatedPaper);
      loadAll();
    } catch (err) {
      console.error('Autofill error:', err);
      toast(err.message || 'Failed to auto-fill details', true);
      btn.innerHTML = origText;
      btn.disabled = false;
    }
  };

  const bannerBtn = $('btn-banner-autofill');
  if (bannerBtn) bannerBtn.addEventListener('click', () => handleAutoFill(bannerBtn));
  const autofillBtn = $('md-autofill');
  if (autofillBtn) autofillBtn.addEventListener('click', () => handleAutoFill(autofillBtn));

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
    <div style="margin-bottom:16px;display:flex;gap:10px;flex-wrap:wrap">
      ${!isEdit ? `
        <input type="file" id="paper-pdf" accept="application/pdf" style="display:none">
        <button type="button" class="btn btn-primary" id="btn-ai-upload" style="background:linear-gradient(135deg,#a78bfa,#c084fc);flex:1;padding:12px 14px;font-size:.85rem">📄 Auto-fill via PDF Upload</button>
      ` : ''}
      <button type="button" class="btn btn-autofill-magic" id="btn-ai-autofill-form" style="flex:1;padding:12px 14px;font-size:.85rem;justify-content:center">✨ Auto-Fill All Details with AI</button>
    </div>
    <div id="parse-loader" style="display:none;margin-top:10px;text-align:center">⏳ AI is synthesizing paper and generating all fields...</div>
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

        <!-- ═══ RESEARCH CONTEXT (collapsible) ═══ -->
        ${formSection('rc', '🔍', 'Research Context', `
          <div class="form-group full"><label>Research Problem</label><textarea id="f-rc-problem" rows="2">${rc.research_problem || ''}</textarea></div>
          <div class="form-group full"><label>Research Objective</label><textarea id="f-rc-objective" rows="2">${rc.research_objective || ''}</textarea></div>
          <div class="form-group full"><label>Motivation</label><textarea id="f-rc-motivation" rows="2">${rc.motivation || ''}</textarea></div>
        `)}

        <!-- ═══ METHODOLOGY (collapsible) ═══ -->
        ${formSection('meth', '⚙️', 'Methodology', `
          <div class="form-group full"><label>Methodology</label><textarea id="f-meth-methodology" rows="2">${meth.methodology || ''}</textarea></div>
          <div class="form-group"><label>AI Technique</label><input id="f-meth-ai" value="${meth.ai_technique || ''}" /></div>
          <div class="form-group"><label>Model / LLM Used</label><input id="f-meth-llm" value="${meth.model_llm_used || ''}" /></div>
          <div class="form-group"><label>Multi-LLM</label><select id="f-meth-multi-llm"><option value="false" ${!meth.multi_llm ? 'selected' : ''}>No</option><option value="true" ${meth.multi_llm ? 'selected' : ''}>Yes</option></select></div>
          <div class="form-group"><label>Consensus Mechanism</label><input id="f-meth-consensus" value="${meth.consensus_mechanism || ''}" /></div>
          <div class="form-group"><label>Formal Method</label><input id="f-meth-formal" value="${meth.formal_method || ''}" /></div>
          <div class="form-group"><label>Formal Language</label><input id="f-meth-formal-lang" value="${meth.formal_language || ''}" /></div>
          <div class="form-group"><label>Rule Extraction Technique</label><input id="f-meth-rule-extract" value="${meth.rule_extraction_technique || ''}" /></div>
          <div class="form-group"><label>Rule Representation</label><input id="f-meth-rule-repr" value="${meth.rule_representation || ''}" /></div>
        `)}

        <!-- ═══ DATASET (collapsible) ═══ -->
        ${formSection('ds', '📊', 'Dataset', `
          <div class="form-group"><label>Dataset Name</label><input id="f-ds-name" value="${ds.dataset_name || ''}" /></div>
          <div class="form-group"><label>Dataset Source</label><input id="f-ds-source" value="${ds.dataset_source || ''}" /></div>
          <div class="form-group"><label>Dataset Type</label><input id="f-ds-type" value="${ds.dataset_type || ''}" /></div>
          <div class="form-group"><label>Dataset Size</label><input id="f-ds-size" value="${ds.dataset_size || ''}" /></div>
          <div class="form-group"><label>Domain</label><input id="f-ds-domain" value="${ds.domain || ''}" /></div>
          <div class="form-group"><label>Regulation</label><input id="f-ds-regulation" value="${ds.regulation || ''}" /></div>
        `)}

        <!-- ═══ EVALUATION (collapsible) ═══ -->
        ${formSection('ev', '📉', 'Evaluation', `
          <div class="form-group"><label>Evaluation Method</label><input id="f-ev-method" value="${ev.evaluation_method || ''}" /></div>
          <div class="form-group"><label>Baseline Method</label><input id="f-ev-baseline" value="${ev.baseline_method || ''}" /></div>
          <div class="form-group full"><label>Evaluation Metrics</label><input id="f-ev-metrics" value="${ev.evaluation_metrics || ''}" /></div>
          <div class="form-group full"><label>Results</label><textarea id="f-ev-results" rows="2">${ev.results || ''}</textarea></div>
        `)}

        <!-- ═══ OUTPUT & VERIFICATION (collapsible) ═══ -->
        ${formSection('out', '✅', 'Output & Verification', `
          <div class="form-group full"><label>Output</label><textarea id="f-out-output" rows="2">${out.output || ''}</textarea></div>
          <div class="form-group"><label>Machine Verifiable</label><select id="f-out-machine"><option value="false" ${!out.machine_verifiable ? 'selected' : ''}>No</option><option value="true" ${out.machine_verifiable ? 'selected' : ''}>Yes</option></select></div>
          <div class="form-group"><label>Compliance Verification</label><input id="f-out-compliance" value="${out.compliance_verification || ''}" /></div>
          <div class="form-group"><label>Runtime Verification</label><input id="f-out-runtime" value="${out.runtime_verification || ''}" /></div>
        `)}

        <!-- ═══ ASSESSMENT (collapsible) ═══ -->
        ${formSection('asmt', '⚖️', 'Assessment', `
          <div class="form-group full"><label>Novelty</label><textarea id="f-asmt-novelty" rows="2">${asmt.novelty || ''}</textarea></div>
          <div class="form-group full"><label>Strengths</label><textarea id="f-asmt-strengths" rows="2">${asmt.strengths || ''}</textarea></div>
          <div class="form-group full"><label>Limitations</label><textarea id="f-lim" rows="2">${(asmt.limitations || paper?.limitations || []).join('\\n')}</textarea></div>
          <div class="form-group full"><label>Future Work</label><textarea id="f-asmt-future" rows="2">${asmt.future_work || ''}</textarea></div>
        `)}

        <!-- ═══ TAGS (collapsible) ═══ -->
        ${formSection('tags', '🏷️', 'Tags', `
          <div class="tags-container" style="display:flex;flex-wrap:wrap;gap:8px;padding:8px 0;">
            ${tagToggle('privacy_policy', 'Privacy Policy', tags.privacy_policy)}
            ${tagToggle('rule_extraction', 'Rule Extraction', tags.rule_extraction)}
            ${tagToggle('policy_formalization', 'Policy Formalization', tags.policy_formalization)}
            ${tagToggle('formal_logic', 'Formal Logic', tags.formal_logic)}
            ${tagToggle('datalog', 'Datalog', tags.datalog)}
            ${tagToggle('prolog', 'Prolog', tags.prolog)}
            ${tagToggle('compliance_constraints', 'Compliance Constraints', tags.compliance_constraints)}
            ${tagToggle('llm', 'LLM', tags.llm)}
            ${tagToggle('multi_llm', 'Multi-LLM', tags.multi_llm)}
            ${tagToggle('consensus', 'Consensus', tags.consensus)}
            ${tagToggle('byzantine_fault_tolerance', 'Byzantine Fault Tolerance', tags.byzantine_fault_tolerance)}
            ${tagToggle('explainability', 'Explainability', tags.explainability)}
            ${tagToggle('gdpr', 'GDPR', tags.gdpr)}
            ${tagToggle('dpdp', 'DPDP', tags.dpdp)}
          </div>
        `)}

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

        // Custom Fields
        const pcustom = emd.custom_fields || parsed.custom_fields || {};
        if (currentWorkspace && currentWorkspace.custom_schema) {
          currentWorkspace.custom_schema.forEach(f => {
            const el = $(`f-custom-${f.id}`);
            if (el && pcustom[f.id] !== undefined && pcustom[f.id] !== null) {
              if (f.type === 'boolean') {
                el.value = pcustom[f.id] ? 'true' : 'false';
              } else {
                el.value = pcustom[f.id];
              }
            }
          });
        }

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
        ['custom','rc','meth','ds','ev','out','asmt','tags','pers'].forEach(id => {
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

  // ── Auto-Fill All Details with AI Button Handler ──
  const autofillFormBtn = $('btn-ai-autofill-form');
  if (autofillFormBtn) {
    autofillFormBtn.addEventListener('click', async () => {
      const title = $('f-title')?.value.trim();
      if (!title) {
        toast('Please enter at least the paper title to auto-fill details', true);
        $('f-title')?.focus();
        return;
      }
      const origText = autofillFormBtn.innerHTML;
      autofillFormBtn.innerHTML = '⏳ Analyzing with AI...';
      autofillFormBtn.disabled = true;
      toast('Synthesizing paper assessment, limitations & research gaps with Gemini AI...');
      try {
        const payload = {
          title,
          authors: $('f-authors')?.value.trim(),
          venue: $('f-venue')?.value.trim(),
          year: $('f-year')?.value,
          doi: $('f-doi')?.value.trim(),
          abstract: $('f-notes')?.value.trim() || null,
          workspace_id: currentWorkspace?.id
        };
        const ai = await api.previewAutofill(payload);
        if (ai) {
          if (ai.contribution) $('f-cont').value = ai.contribution;
          if (ai.category) $('f-cat').value = ai.category;
          if (ai.research_domain) $('f-research-domain').value = ai.research_domain;
          if (ai.limitations && Array.isArray(ai.limitations)) $('f-lim').value = ai.limitations.join('\n');
          if (ai.personal) {
            if (ai.personal.research_gap) $('f-pers-gap').value = ai.personal.research_gap;
            if (ai.personal.missing_component) $('f-pers-missing').value = ai.personal.missing_component;
            if (ai.personal.relevance_to_my_research) $('f-reltext').value = ai.personal.relevance_to_my_research;
            if (ai.personal.relevance_score) $('f-rel').value = ai.personal.relevance_score;
            if (ai.personal.personal_notes) $('f-notes').value = ai.personal.personal_notes;
          }
          // Open assessment, personal & custom sections
          ['asmt', 'pers', 'custom'].forEach(id => {
            const divider = $(`fsd-${id}`);
            const collapse = $(`fsc-${id}`);
            if (divider && collapse) { divider.classList.add('open'); collapse.classList.add('open'); }
          });
          toast('✨ All details automatically filled by AI!');
        }
      } catch (err) {
        console.error('Form autofill error:', err);
        toast(err.message || 'Failed to auto-fill details', true);
      } finally {
        autofillFormBtn.innerHTML = origText;
        autofillFormBtn.disabled = false;
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
      research_context: {
        research_problem: $('f-rc-problem')?.value.trim() || null,
        research_objective: $('f-rc-objective')?.value.trim() || null,
        motivation: $('f-rc-motivation')?.value.trim() || null
      },
      methodology: {
        methodology: $('f-meth-methodology')?.value.trim() || null,
        ai_technique: $('f-meth-ai')?.value.trim() || null,
        model_llm_used: $('f-meth-llm')?.value.trim() || null,
        multi_llm: $('f-meth-multi-llm')?.value === 'true',
        consensus_mechanism: $('f-meth-consensus')?.value.trim() || null,
        formal_method: $('f-meth-formal')?.value.trim() || null,
        formal_language: $('f-meth-formal-lang')?.value.trim() || null,
        rule_extraction_technique: $('f-meth-rule-extract')?.value.trim() || null,
        rule_representation: $('f-meth-rule-repr')?.value.trim() || null
      },
      dataset: {
        dataset_name: $('f-ds-name')?.value.trim() || null,
        dataset_source: $('f-ds-source')?.value.trim() || null,
        dataset_type: $('f-ds-type')?.value.trim() || null,
        dataset_size: $('f-ds-size')?.value.trim() || null,
        domain: $('f-ds-domain')?.value.trim() || null,
        regulation: $('f-ds-regulation')?.value.trim() || null
      },
      evaluation: {
        evaluation_method: $('f-ev-method')?.value.trim() || null,
        baseline_method: $('f-ev-baseline')?.value.trim() || null,
        evaluation_metrics: $('f-ev-metrics')?.value.trim() || null,
        results: $('f-ev-results')?.value.trim() || null
      },
      output: {
        output: $('f-out-output')?.value.trim() || null,
        machine_verifiable: $('f-out-machine')?.value === 'true',
        compliance_verification: $('f-out-compliance')?.value.trim() || null,
        runtime_verification: $('f-out-runtime')?.value.trim() || null
      },
      assessment: {
        novelty: $('f-asmt-novelty')?.value.trim() || null,
        strengths: $('f-asmt-strengths')?.value.trim() || null,
        limitations: limitations,
        future_work: $('f-asmt-future')?.value.trim() || null
      },
      tags: {
        privacy_policy: $('f-tag-privacy_policy')?.checked || false,
        rule_extraction: $('f-tag-rule_extraction')?.checked || false,
        policy_formalization: $('f-tag-policy_formalization')?.checked || false,
        formal_logic: $('f-tag-formal_logic')?.checked || false,
        datalog: $('f-tag-datalog')?.checked || false,
        prolog: $('f-tag-prolog')?.checked || false,
        compliance_constraints: $('f-tag-compliance_constraints')?.checked || false,
        llm: $('f-tag-llm')?.checked || false,
        multi_llm: $('f-tag-multi_llm')?.checked || false,
        consensus: $('f-tag-consensus')?.checked || false,
        byzantine_fault_tolerance: $('f-tag-byzantine_fault_tolerance')?.checked || false,
        explainability: $('f-tag-explainability')?.checked || false,
        gdpr: $('f-tag-gdpr')?.checked || false,
        dpdp: $('f-tag-dpdp')?.checked || false
      },
      custom_fields: custom_fields,
      personal: {
        research_gap: $('f-pers-gap')?.value.trim() || null,
        missing_component: $('f-pers-missing')?.value.trim() || null,
        relevance_to_my_research: $('f-reltext')?.value.trim() || null,
        relevance_score: parseInt($('f-rel')?.value) || 75,
        personal_notes: $('f-notes')?.value.trim() || null
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

    let row = {
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

    // ── Custom Fields ──
    if (currentWorkspace && currentWorkspace.custom_schema) {
      currentWorkspace.custom_schema.forEach(f => {
        const val = em.custom_fields ? em.custom_fields[f.id] : undefined;
        if (f.type === 'boolean') {
          row[`[Custom] ${f.name}`] = val ? 'Yes' : 'No';
        } else {
          row[`[Custom] ${f.name}`] = val || '—';
        }
      });
    }

    return row;
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

// ══════════════════════════════════════════════
// DISCOVER PAPERS PAGE
// ══════════════════════════════════════════════

const discoverState = {

  results: [],
  filteredResults: [],
  localFilter: '',
  selectedFacets: {
    year: new Set(),
    quartile: new Set(),
    venue: new Set(),
    doctype: new Set(),
    oa: new Set()
  },
  selectedPapers: new Set(),
  total: 0,
  page: 1,
  perPage: 25,
  totalPages: 0,
  source: '',
  query: '',
  isLoading: false,
  initialized: false
};

function setupDiscoverPage() {
  if (discoverState.initialized) return;
  discoverState.initialized = true;

  // Search button
  const searchBtn = $('btn-discover-search');
  if (searchBtn) searchBtn.addEventListener('click', () => handleDiscoverSearch());

  // Enter key on search input
  const queryInput = $('discover-query');
  if (queryInput) {
    queryInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleDiscoverSearch();
      }
    });
  }

  // Clear query button
  const clearQueryBtn = $('btn-clear-discover-query');
  if (clearQueryBtn) {
    clearQueryBtn.addEventListener('click', () => {
      queryInput.value = '';
      clearQueryBtn.style.display = 'none';
      queryInput.focus();
    });
    queryInput.addEventListener('input', () => {
      clearQueryBtn.style.display = queryInput.value ? 'block' : 'none';
    });
  }

  // In-results live search / filter input
  const localFilterInput = $('discover-local-filter');
  if (localFilterInput) {
    localFilterInput.addEventListener('input', e => {
      discoverState.localFilter = e.target.value;
      const clearBtn = $('btn-clear-local-filter');
      if (clearBtn) clearBtn.style.display = e.target.value ? 'block' : 'none';
      applyDiscoverFilter();
    });
  }

  // Clear in-results filter button
  const clearLocalBtn = $('btn-clear-local-filter');
  if (clearLocalBtn) {
    clearLocalBtn.addEventListener('click', () => {
      clearDiscoverLocalFilter();
    });
  }

  // Reset all facets
  const resetFacetsBtn = $('scopus-reset-facets');
  if (resetFacetsBtn) {
    resetFacetsBtn.addEventListener('click', () => {
      resetScopusFacets();
    });
  }

  // Sort dropdown
  const sortSelect = $('scopus-sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', e => {
      if ($('discover-sort')) $('discover-sort').value = e.target.value;
      handleDiscoverSearch(1);
    });
  }

  // Select all checkbox
  const selectAll = $('scopus-select-all');
  if (selectAll) {
    selectAll.addEventListener('change', e => {
      const isChecked = e.target.checked;
      discoverState.selectedPapers.clear();
      if (isChecked) {
        discoverState.filteredResults.forEach(p => discoverState.selectedPapers.add(p._idx));
      }
      updateScopusSelectedCount();
      renderDiscoverResults();
    });
  }

  // Batch import button
  const batchImportBtn = $('scopus-btn-batch-import');
  if (batchImportBtn) {
    batchImportBtn.addEventListener('click', async () => {
      await batchImportSelectedPapers();
    });
  }

  // Export CSV button
  const exportCsvBtn = $('scopus-btn-export-csv');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      exportDiscoverResultsToCSV();
    });
  }

  // Suggested chip handlers
  document.querySelectorAll('.scopus-suggest-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const example = chip.dataset.example;
      if (example && queryInput) {
        queryInput.value = example;
        if (clearQueryBtn) clearQueryBtn.style.display = 'block';
        handleDiscoverSearch();
      }
    });
  });

  // Focus the search input
  if (queryInput) queryInput.focus();
}

window.searchScopusExample = function(example) {
  if ($('discover-query')) {
    $('discover-query').value = example;
    handleDiscoverSearch();
  }
};

window.toggleScopusFacet = function(headerEl) {
  const accordion = headerEl.closest('.scopus-facet-accordion');
  if (accordion) {
    accordion.classList.toggle('closed');
  }
};

window.onScopusFacetToggle = function(facetType, val) {
  const facetSet = discoverState.selectedFacets[facetType];
  if (!facetSet) return;
  const strVal = String(val);
  if (facetSet.has(strVal)) {
    facetSet.delete(strVal);
  } else {
    facetSet.add(strVal);
  }
  applyDiscoverFilter();
};

function resetScopusFacets() {
  for (const key of Object.keys(discoverState.selectedFacets)) {
    discoverState.selectedFacets[key].clear();
  }
  discoverState.localFilter = '';
  if ($('discover-local-filter')) $('discover-local-filter').value = '';
  if ($('btn-clear-local-filter')) $('btn-clear-local-filter').style.display = 'none';
  computeAndRenderFacets(discoverState.results);
  applyDiscoverFilter();
}

function updateScopusSelectedCount() {
  const count = discoverState.selectedPapers.size;
  if ($('scopus-selected-count')) $('scopus-selected-count').textContent = count;
  if ($('scopus-btn-batch-import')) {
    $('scopus-btn-batch-import').disabled = count === 0;
  }
}

function computeAndRenderFacets(papers) {
  const years = {};
  const quartiles = {};
  const venues = {};
  const doctypes = {};
  let oaCount = 0;
  let subCount = 0;

  papers.forEach(p => {
    if (p.year) years[p.year] = (years[p.year] || 0) + 1;
    const q = p.scopus_status?.quartile || (p.source === 'scopus' ? 'Q1' : 'Unrated');
    quartiles[q] = (quartiles[q] || 0) + 1;
    if (p.venue) venues[p.venue] = (venues[p.venue] || 0) + 1;
    const docType = p.scopus_status?.subtype || 'Article';
    doctypes[docType] = (doctypes[docType] || 0) + 1;
    if (p.is_open_access) oaCount++;
    else subCount++;
  });

  // Render Open Access Facet
  const oaEl = $('facet-body-oa');
  if (oaEl) {
    oaEl.innerHTML = `
      <label class="scopus-facet-item">
        <span class="scopus-facet-item-left">
          <input type="checkbox" ${discoverState.selectedFacets.oa.has('oa') ? 'checked' : ''} onchange="onScopusFacetToggle('oa', 'oa')" />
          <span>Open Access</span>
        </span>
        <span class="scopus-facet-count">${oaCount}</span>
      </label>
      <label class="scopus-facet-item">
        <span class="scopus-facet-item-left">
          <input type="checkbox" ${discoverState.selectedFacets.oa.has('sub') ? 'checked' : ''} onchange="onScopusFacetToggle('oa', 'sub')" />
          <span>Subscription</span>
        </span>
        <span class="scopus-facet-count">${subCount}</span>
      </label>
    `;
  }

  // Render Year Facet
  const yearEl = $('facet-body-year');
  if (yearEl) {
    const sortedYears = Object.keys(years).sort((a, b) => b - a);
    yearEl.innerHTML = sortedYears.map(yr => `
      <label class="scopus-facet-item">
        <span class="scopus-facet-item-left">
          <input type="checkbox" ${discoverState.selectedFacets.year.has(String(yr)) ? 'checked' : ''} onchange="onScopusFacetToggle('year', '${yr}')" />
          <span>${yr}</span>
        </span>
        <span class="scopus-facet-count">${years[yr]}</span>
      </label>
    `).join('') || '<span class="text-muted" style="font-size:0.75rem">No year data</span>';
  }

  // Render Quartiles Facet
  const quartileEl = $('facet-body-quartile');
  if (quartileEl) {
    const qOrder = ['Q1', 'Q2', 'Q3', 'Q4', 'Unrated'];
    quartileEl.innerHTML = qOrder.filter(q => quartiles[q]).map(q => `
      <label class="scopus-facet-item">
        <span class="scopus-facet-item-left">
          <input type="checkbox" ${discoverState.selectedFacets.quartile.has(q) ? 'checked' : ''} onchange="onScopusFacetToggle('quartile', '${q}')" />
          <span>${q}</span>
        </span>
        <span class="scopus-facet-count">${quartiles[q]}</span>
      </label>
    `).join('') || '<span class="text-muted" style="font-size:0.75rem">No quartile data</span>';
  }

  // Render Source Title / Venue Facet (top 10)
  const venueEl = $('facet-body-venue');
  if (venueEl) {
    const sortedVenues = Object.keys(venues).sort((a, b) => venues[b] - venues[a]).slice(0, 10);
    venueEl.innerHTML = sortedVenues.map(v => `
      <label class="scopus-facet-item" title="${escapeHtml(v)}">
        <span class="scopus-facet-item-left">
          <input type="checkbox" ${discoverState.selectedFacets.venue.has(v) ? 'checked' : ''} onchange="onScopusFacetToggle('venue', ${JSON.stringify(v)})" />
          <span>${escapeHtml(v.length > 25 ? v.substring(0, 23) + '...' : v)}</span>
        </span>
        <span class="scopus-facet-count">${venues[v]}</span>
      </label>
    `).join('') || '<span class="text-muted" style="font-size:0.75rem">No source data</span>';
  }

  // Render Document Type Facet
  const dtEl = $('facet-body-doctype');
  if (dtEl) {
    const sortedDt = Object.keys(doctypes).sort((a, b) => doctypes[b] - doctypes[a]);
    dtEl.innerHTML = sortedDt.map(dt => `
      <label class="scopus-facet-item">
        <span class="scopus-facet-item-left">
          <input type="checkbox" ${discoverState.selectedFacets.doctype.has(dt) ? 'checked' : ''} onchange="onScopusFacetToggle('doctype', '${dt}')" />
          <span>${dt}</span>
        </span>
        <span class="scopus-facet-count">${doctypes[dt]}</span>
      </label>
    `).join('') || '<span class="text-muted" style="font-size:0.75rem">No type data</span>';
  }
}

function applyDiscoverFilter() {
  const searchTerm = discoverState.localFilter.toLowerCase().trim();
  const { year, quartile, venue, doctype, oa } = discoverState.selectedFacets;

  let filtered = discoverState.results;

  // Facet: Year
  if (year.size > 0) {
    filtered = filtered.filter(p => p.year && year.has(String(p.year)));
  }

  // Facet: Quartile
  if (quartile.size > 0) {
    filtered = filtered.filter(p => {
      const q = p.scopus_status?.quartile || (p.source === 'scopus' ? 'Q1' : 'Unrated');
      return quartile.has(q);
    });
  }

  // Facet: Venue
  if (venue.size > 0) {
    filtered = filtered.filter(p => p.venue && venue.has(p.venue));
  }

  // Facet: Document Type
  if (doctype.size > 0) {
    filtered = filtered.filter(p => {
      const dt = p.scopus_status?.subtype || 'Article';
      return doctype.has(dt);
    });
  }

  // Facet: Open Access
  if (oa.size > 0) {
    filtered = filtered.filter(p => {
      if (oa.has('oa') && p.is_open_access) return true;
      if (oa.has('sub') && !p.is_open_access) return true;
      return false;
    });
  }

  // In-results search string across title, authors, venue, abstract, DOI
  if (searchTerm) {
    filtered = filtered.filter(p => {
      const title = (p.title || '').toLowerCase();
      const authors = (p.authors || '').toLowerCase();
      const ven = (p.venue || '').toLowerCase();
      const abstract = (p.abstract || '').toLowerCase();
      const doi = (p.doi || '').toLowerCase();
      return title.includes(searchTerm) ||
             authors.includes(searchTerm) ||
             ven.includes(searchTerm) ||
             abstract.includes(searchTerm) ||
             doi.includes(searchTerm);
    });
  }

  discoverState.filteredResults = filtered;
  renderDiscoverResults();
}

window.clearDiscoverLocalFilter = function() {
  discoverState.localFilter = '';
  if ($('discover-local-filter')) $('discover-local-filter').value = '';
  if ($('btn-clear-local-filter')) $('btn-clear-local-filter').style.display = 'none';
  applyDiscoverFilter();
};

function highlightMatch(text, query) {
  if (!text) return '';
  const escaped = escapeHtml(text);
  if (!query || !query.trim()) return escaped;
  const cleanQ = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${cleanQ})`, 'gi');
  return escaped.replace(regex, '<mark class="discover-highlight">$1</mark>');
}

async function handleDiscoverSearch(page = 1) {
  const query = $('discover-query').value.trim();
  if (!query) {
    toast('Please enter a search keyword', true);
    $('discover-query').focus();
    return;
  }

  discoverState.isLoading = true;
  discoverState.query = query;
  discoverState.page = page;

  // Reset facets & selections on new search
  discoverState.localFilter = '';
  for (const k of Object.keys(discoverState.selectedFacets)) {
    discoverState.selectedFacets[k].clear();
  }
  discoverState.selectedPapers.clear();
  updateScopusSelectedCount();

  // Show loading, hide layout & empty states
  $('discover-loading').style.display = 'flex';
  $('scopus-results-layout').style.display = 'none';
  $('discover-empty').style.display = 'none';
  $('btn-discover-search').disabled = true;
  $('btn-discover-search').innerHTML = '<span class="scopus-search-icon">⏳</span> Searching...';

  try {
    const isScopusOnly = $('discover-index-filter') ? ($('discover-index-filter').value === 'scopus') : true;
    const options = {
      page,
      per_page: $('discover-per-page')?.value || 25,
      sort: $('scopus-sort-select')?.value || 'relevance',
      scopus_only: isScopusOnly,
      workspace_id: currentWorkspace?.id || undefined
    };

    const yearFrom = $('discover-year-from')?.value;
    const yearTo = $('discover-year-to')?.value;
    if (yearFrom) options.year_from = yearFrom;
    if (yearTo) options.year_to = yearTo;

    // Field search modifier if not default
    const fieldSelect = $('scopus-field-select')?.value;
    let finalQuery = query;
    if (fieldSelect && fieldSelect !== 'TITLE-ABS-KEY' && fieldSelect !== 'ALL') {
      finalQuery = `${fieldSelect}(${query})`;
    }

    const data = await api.discoverPapers(finalQuery, options);

    discoverState.results = (data.results || []).map((paper, idx) => ({ ...paper, _idx: idx }));
    discoverState.filteredResults = [...discoverState.results];
    discoverState.total = data.total || 0;
    discoverState.totalPages = data.total_pages || 0;
    discoverState.source = data.source || 'openalex';
    discoverState.perPage = parseInt(options.per_page);

    // Compute Scopus facet counts from candidate results
    computeAndRenderFacets(discoverState.results);

    // Update query preview
    const queryPreview = $('scopus-query-preview');
    if (queryPreview) {
      queryPreview.innerHTML = `<code>TITLE-ABS-KEY ( "${escapeHtml(query)}" ) ${yearFrom ? `AND PUBYEAR > ${yearFrom - 1}` : ''} ${yearTo ? `AND PUBYEAR < ${parseInt(yearTo) + 1}` : ''}</code>`;
    }

    // Update total count
    if ($('discover-total-count')) {
      $('discover-total-count').textContent = formatNumber(discoverState.total);
    }

    // Source badge
    const badge = $('discover-source-badge');
    if (badge) {
      badge.textContent = discoverState.source === 'scopus' 
        ? '⚡ Scopus Direct API' 
        : (isScopusOnly ? '✅ Scopus Verified' : '🌐 OpenAlex');
    }

    applyDiscoverFilter();
    renderDiscoverPagination();

    if (discoverState.results.length === 0) {
      $('scopus-results-layout').style.display = 'none';
      $('discover-empty').style.display = 'block';
      $('discover-empty').querySelector('h3').textContent = `No documents found for "${query}"`;
    } else {
      $('scopus-results-layout').style.display = 'grid';
      $('discover-empty').style.display = 'none';
    }

  } catch (err) {
    console.error('Scopus search error:', err);
    toast(`Search failed: ${err.message}`, true);
    $('discover-empty').style.display = 'block';
  } finally {
    discoverState.isLoading = false;
    $('discover-loading').style.display = 'none';
    $('btn-discover-search').disabled = false;
    $('btn-discover-search').innerHTML = '<span class="scopus-search-icon">🔍</span> Search Documents';
  }
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function formatCitations(count) {
  if (!count) return '0';
  if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
  return String(count);
}

function renderDiscoverResults() {
  const container = $('discover-results');
  if (!container) return;

  if (!discoverState.filteredResults.length) {
    if (discoverState.results.length > 0) {
      container.innerHTML = `
        <div class="discover-filter-empty" style="padding: 40px; text-align: center;">
          <p>🔍 No documents match the active refinement filters among the ${discoverState.results.length} fetched documents.</p>
          <button class="scopus-btn-primary" style="margin: 12px auto; display: inline-flex;" onclick="resetScopusFacets()">Reset Refinement Filters</button>
        </div>
      `;
    } else {
      container.innerHTML = '';
    }
    return;
  }

  container.innerHTML = discoverState.filteredResults.map((paper, i) => {
    const scopus = paper.scopus_status;
    const isScopus = scopus?.is_scopus || paper.source === 'scopus';
    const quartile = scopus?.quartile || (isScopus ? 'Q1' : null);
    const docType = scopus?.subtype || 'Article';
    const isSelected = discoverState.selectedPapers.has(paper._idx);

    // Badges
    let badges = '';
    badges += `<span class="discover-badge discover-badge-indexed">${escapeHtml(docType)}</span>`;

    if (paper.source === 'scopus') {
      badges += `<span class="discover-badge discover-badge-scopus confidence-high">⚡ Scopus Indexed</span>`;
    } else if (isScopus) {
      badges += `<span class="discover-badge discover-badge-scopus confidence-high">✅ Scopus Verified</span>`;
    }

    if (quartile) {
      badges += `<span class="discover-badge discover-badge-quartile">${escapeHtml(quartile)}</span>`;
    }

    if (paper.is_open_access) {
      badges += `<span class="discover-badge discover-badge-oa">🔓 Open Access</span>`;
    }

    // Abstract
    let abstractHtml = '';
    if (paper.abstract) {
      const abstractId = `abstract-${paper._idx}`;
      abstractHtml = `
        <div class="scopus-doc-abstract-drawer" id="${abstractId}" style="display:none">
          ${highlightMatch(paper.abstract, discoverState.localFilter)}
        </div>
      `;
    }

    // Venue details
    const venueText = paper.venue ? escapeHtml(paper.venue) : 'Academic Journal';
    const yearText = paper.year ? `${paper.year}` : '';

    // Action links
    let actionLinks = '';
    if (paper.abstract) {
      actionLinks += `<a href="javascript:void(0)" class="scopus-action-link" onclick="toggleScopusAbstract('${paper._idx}', this)">Show abstract ▾</a>`;
    }
    if (paper.url) {
      actionLinks += `<a href="${paper.url}" target="_blank" class="scopus-action-link">View at Publisher ↗</a>`;
    }
    if (paper.scopus_url) {
      actionLinks += `<a href="${paper.scopus_url}" target="_blank" class="scopus-action-link scopus-direct-link">🔬 View in Scopus ↗</a>`;
    }
    if (paper.doi) {
      actionLinks += `<a href="https://doi.org/${encodeURIComponent(paper.doi)}" target="_blank" class="scopus-action-link">DOI: ${escapeHtml(paper.doi)}</a>`;
    }

    // Import button
    const isImported = paper.already_imported;
    const importBtn = isImported
      ? `<button class="btn-import imported" disabled>✅ In Library</button>`
      : `<button class="btn-import" onclick="importPaper(${paper._idx})" id="import-btn-${paper._idx}">➕ Import</button>`;

    // Titles & Authors
    const titleHtml = highlightMatch(paper.title, discoverState.localFilter);
    const authorsHtml = highlightMatch(paper.authors, discoverState.localFilter);

    // Citations & Metrics
    const citedByHtml = paper.cited_by_count > 0 
      ? `<span class="scopus-metric-cited" title="Scopus Citation Count">Cited by ${formatCitations(paper.cited_by_count)}</span>` 
      : `<span class="text-muted" style="font-size:0.75rem">0 citations</span>`;
    
    const citeScoreHtml = scopus?.citescore ? `<span class="scopus-metric-citescore">CiteScore ${scopus.citescore}</span>` : '';
    const sjrHtml = scopus?.sjr ? `<span class="scopus-metric-sjr">SJR ${scopus.sjr}</span>` : '';

    return `
      <div class="scopus-doc-card ${isSelected ? 'selected' : ''}" id="doc-card-${paper._idx}">
        <div class="scopus-doc-header-row">
          <input type="checkbox" class="scopus-doc-checkbox" data-idx="${paper._idx}" ${isSelected ? 'checked' : ''} onchange="onScopusDocSelectToggle(${paper._idx}, this.checked)" />
          <span class="scopus-doc-index">${(discoverState.page - 1) * discoverState.perPage + i + 1}.</span>
          <div class="scopus-doc-main">
            <h4 class="scopus-doc-title">
              ${paper.url ? `<a href="${paper.url}" target="_blank">${titleHtml}</a>` : titleHtml}
            </h4>
            <div class="scopus-doc-authors">${authorsHtml}</div>
            <div class="scopus-doc-venue-line">
              <span class="scopus-doc-venue-name">${venueText}</span>${yearText ? `, ${yearText}` : ''}
            </div>
            <div class="scopus-doc-badges-row">${badges}</div>
          </div>
          <div class="scopus-doc-metrics-col">
            ${citedByHtml}
            ${citeScoreHtml}
            ${sjrHtml}
          </div>
        </div>
        ${abstractHtml}
        <div class="scopus-doc-actions-row">
          <div class="scopus-doc-links-group">${actionLinks}</div>
          <div>${importBtn}</div>
        </div>
      </div>
    `;
  }).join('');
}

window.toggleScopusAbstract = function(idx, linkEl) {
  const drawer = document.getElementById(`abstract-${idx}`);
  if (!drawer) return;
  const isHidden = drawer.style.display === 'none';
  drawer.style.display = isHidden ? 'block' : 'none';
  linkEl.textContent = isHidden ? 'Hide abstract ▲' : 'Show abstract ▾';
};

window.onScopusDocSelectToggle = function(idx, isChecked) {
  if (isChecked) discoverState.selectedPapers.add(idx);
  else discoverState.selectedPapers.delete(idx);
  const card = document.getElementById(`doc-card-${idx}`);
  if (card) card.classList.toggle('selected', isChecked);
  updateScopusSelectedCount();
};

async function batchImportSelectedPapers() {
  const indices = Array.from(discoverState.selectedPapers);
  if (indices.length === 0) return;
  
  toast(`Importing ${indices.length} papers...`);
  let importedCount = 0;
  
  for (const idx of indices) {
    const paper = discoverState.results.find(p => p._idx === idx);
    if (paper && !paper.already_imported) {
      try {
        await api.importDiscoveredPaper(paper, currentWorkspace?.id || null);
        paper.already_imported = true;
        importedCount++;
        const btn = document.getElementById(`import-btn-${idx}`);
        if (btn) {
          btn.className = 'btn-import imported';
          btn.textContent = '✅ In Library';
        }
      } catch (e) {
        console.warn('Batch import error for paper:', paper.title, e.message);
      }
    }
  }
  
  discoverState.selectedPapers.clear();
  updateScopusSelectedCount();
  toast(`✅ Successfully imported ${importedCount} papers to library!`);
  try { await loadAll(); } catch (e) {}
}

function exportDiscoverResultsToCSV() {
  const items = discoverState.filteredResults;
  if (!items || items.length === 0) {
    toast('No documents to export', true);
    return;
  }
  
  const headers = ['Title', 'Authors', 'Year', 'Venue', 'DOI', 'Cited By', 'CiteScore', 'SJR', 'Quartile', 'Scopus URL'];
  const rows = items.map(p => [
    `"${(p.title || '').replace(/"/g, '""')}"`,
    `"${(p.authors || '').replace(/"/g, '""')}"`,
    p.year || '',
    `"${(p.venue || '').replace(/"/g, '""')}"`,
    p.doi || '',
    p.cited_by_count || 0,
    p.scopus_status?.citescore || '',
    p.scopus_status?.sjr || '',
    p.scopus_status?.quartile || '',
    p.scopus_url || p.url || ''
  ]);
  
  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Scopus_Search_Results_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast('📥 Downloaded CSV results');
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Make toggle function global for inline onclick
window.toggleAbstract = function(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('expanded');
  btn.textContent = el.classList.contains('expanded') ? 'Show less ▲' : 'Show more ▼';
};

// Make import function global for inline onclick
window.importPaper = async function(index) {
  const paper = discoverState.results.find(p => p._idx === index) || discoverState.results[index];
  if (!paper) return;

  const btn = document.getElementById(`import-btn-${index}`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Importing...';
  }

  try {
    await api.importDiscoveredPaper(paper, currentWorkspace?.id || null);
    if (btn) {
      btn.className = 'btn-import imported';
      btn.textContent = '✅ In Library';
    }
    paper.already_imported = true;
    toast(`📄 Imported: "${paper.title.substring(0, 50)}..."`);

    // Reload all library state, dashboard stats, and sidebar count
    try {
      await loadAll();
    } catch (e) {
      console.warn('loadAll after import warning:', e);
    }
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '➕ Import';
    }
    if (err.message && err.message.includes('already in your library')) {
      if (btn) {
        btn.className = 'btn-import imported';
        btn.textContent = '✅ In Library';
      }
      paper.already_imported = true;
      toast('This paper is already in your library');
    } else {
      toast(`Import failed: ${err.message}`, true);
    }
  }
};

function renderDiscoverPagination() {
  const container = $('discover-pagination');
  if (!container) return;
  if (discoverState.totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const { page, totalPages } = discoverState;
  let html = '';

  // Previous button
  html += `<button class="discover-page-btn" ${page <= 1 ? 'disabled' : ''} onclick="discoverGoToPage(${page - 1})">← Prev</button>`;

  // Page numbers (show max 7 pages around current)
  const startPage = Math.max(1, page - 3);
  const endPage = Math.min(totalPages, page + 3);

  if (startPage > 1) {
    html += `<button class="discover-page-btn" onclick="discoverGoToPage(1)">1</button>`;
    if (startPage > 2) html += `<span class="discover-page-info">...</span>`;
  }

  for (let p = startPage; p <= endPage; p++) {
    html += `<button class="discover-page-btn ${p === page ? 'active' : ''}" onclick="discoverGoToPage(${p})">${p}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<span class="discover-page-info">...</span>`;
    html += `<button class="discover-page-btn" onclick="discoverGoToPage(${totalPages})">${totalPages}</button>`;
  }

  // Next button
  html += `<button class="discover-page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="discoverGoToPage(${page + 1})">Next →</button>`;

  container.innerHTML = html;
}

window.discoverGoToPage = function(page) {
  handleDiscoverSearch(page);
  // Scroll to top of results
  const container = $('discover-search-container') || $('page-discover');
  if (container) container.scrollIntoView({ behavior: 'smooth' });
};


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

// ══════════════════════════════════════════════
// PAPER DRAFT GENERATOR MODULE
// ══════════════════════════════════════════════
(function initPaperDraft() {
  let draftStep = 1;
  let draftFile = null;
  let parsedExcel = null;
  let generatedResult = null;
  let citationStyle = 'APA';
  let pageNumberFormat = 'arabic';
  let outputFormat = 'docx';
  let venueType = 'conference';
  let paperType = 'implementation';
  let targetPages = '6-8';
  let fontFamily = 'Times New Roman';
  let fontSize = '10';
  let lineSpacing = '1.0';
  let columns = 'auto';
  let chartInstances = [];

  function setupPaperDraft() {
    // Dropzone
    const dropzone = $('draft-dropzone');
    const fileInput = $('draft-file-input');
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) handleDraftFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleDraftFile(fileInput.files[0]); });

    // Remove file
    $('draft-file-remove')?.addEventListener('click', e => {
      e.stopPropagation();
      draftFile = null;
      dropzone.querySelector('.draft-dropzone-content').style.display = '';
      $('draft-file-success').style.display = 'none';
      $('draft-next-1').disabled = true;
    });

    // Template download
    $('draft-download-template')?.addEventListener('click', e => {
      e.preventDefault();
      generateAndDownloadTemplate();
    });

    // Paper type & target pages
    $('draft-paper-type')?.addEventListener('change', e => { paperType = e.target.value; });
    $('draft-target-pages')?.addEventListener('change', e => { targetPages = e.target.value; });

    // Typography selectors
    $('draft-font-family')?.addEventListener('change', e => { fontFamily = e.target.value; });
    $('draft-font-size')?.addEventListener('change', e => { fontSize = e.target.value; });
    $('draft-line-spacing')?.addEventListener('change', e => { lineSpacing = e.target.value; });
    $('draft-columns')?.addEventListener('change', e => { columns = e.target.value; });

    // Venue pills
    $('draft-venue-pills')?.querySelectorAll('.draft-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        $('draft-venue-pills').querySelectorAll('.draft-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        venueType = pill.dataset.venue;
      });
    });

    // Format pills
    $('draft-format-pills')?.querySelectorAll('.draft-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        $('draft-format-pills').querySelectorAll('.draft-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        citationStyle = pill.dataset.format;
      });
    });

    // Output format pills
    $('draft-output-pills')?.querySelectorAll('.draft-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        $('draft-output-pills').querySelectorAll('.draft-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        outputFormat = pill.dataset.format;
        updateDownloadButtonsText();
      });
    });

    // Page number pills
    $('draft-pagenumber-pills')?.querySelectorAll('.draft-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        $('draft-pagenumber-pills').querySelectorAll('.draft-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        pageNumberFormat = pill.dataset.format;
      });
    });

    // Add author
    $('draft-add-author')?.addEventListener('click', () => {
      const list = $('draft-authors-list');
      if (list.children.length >= 5) return;
      const row = document.createElement('div');
      row.className = 'draft-author-row';
      row.innerHTML = `
        <input type="text" class="draft-author-name" placeholder="Full Name" />
        <input type="text" class="draft-author-affil" placeholder="Affiliation" />
        <input type="text" class="draft-author-email" placeholder="Email" />
      `;
      list.appendChild(row);
    });

    // Navigation buttons
    $('draft-next-1')?.addEventListener('click', parseAndGoToStep2);
    $('draft-back-2')?.addEventListener('click', () => goToDraftStep(1));
    $('draft-next-2')?.addEventListener('click', generateDraft);
    $('draft-back-3')?.addEventListener('click', () => goToDraftStep(2));
    $('draft-next-3')?.addEventListener('click', handleDownloadAction);
    $('draft-download-btn')?.addEventListener('click', generateAndDownloadPDF);
    $('draft-download-docx-btn')?.addEventListener('click', generateAndDownloadDOCX);
    $('draft-restart')?.addEventListener('click', resetDraftWizard);
    updateDownloadButtonsText();
  }

  function updateDownloadButtonsText() {
    const next3Btn = $('draft-next-3');
    if (next3Btn) {
      if (outputFormat === 'docx') next3Btn.innerHTML = '📝 Download Word (.docx) →';
      else if (outputFormat === 'pdf') next3Btn.innerHTML = '📄 Download PDF →';
      else next3Btn.innerHTML = '📦 Download Word & PDF →';
    }
  }

  function handleDraftFile(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      toast('Please upload an Excel file (.xlsx, .xls)', true);
      return;
    }
    draftFile = file;
    const dropzone = $('draft-dropzone');
    dropzone.querySelector('.draft-dropzone-content').style.display = 'none';
    $('draft-file-success').style.display = '';
    $('draft-file-name').textContent = file.name;
    $('draft-next-1').disabled = false;
  }

  function goToDraftStep(step) {
    draftStep = step;
    // Update stepper
    document.querySelectorAll('.draft-step').forEach(s => {
      const sNum = parseInt(s.dataset.step);
      s.classList.remove('active', 'done');
      if (sNum === step) s.classList.add('active');
      else if (sNum < step) s.classList.add('done');
    });
    document.querySelectorAll('.draft-step-line').forEach((line, i) => {
      line.classList.toggle('done', i + 1 < step);
    });
    // Show/hide panels
    for (let i = 1; i <= 4; i++) {
      const panel = $('draft-step-' + i);
      if (panel) panel.style.display = i === step ? '' : 'none';
    }
  }

  async function parseAndGoToStep2() {
    if (!draftFile) return;
    const nextBtn = $('draft-next-1');
    nextBtn.disabled = true;
    nextBtn.textContent = 'Parsing...';

    try {
      parsedExcel = await api.parseExcelForDraft(draftFile, currentWorkspace?.id);

      // Pre-populate Step 1 fields from detected Excel metadata
      if (parsedExcel.metadata) {
        const meta = parsedExcel.metadata;
        const titleInput = $('draft-title');
        if (titleInput && !titleInput.value.trim() && meta.title) titleInput.value = meta.title;
        else if (titleInput?.value.trim()) meta.title = titleInput.value.trim();

        const areaInput = $('draft-research-area');
        if (areaInput && !areaInput.value.trim() && meta.researchArea) areaInput.value = meta.researchArea;

        const methodInput = $('draft-methodology');
        if (methodInput && !methodInput.value.trim() && meta.methodology) methodInput.value = meta.methodology;

        const objInput = $('draft-objective');
        if (objInput && !objInput.value.trim() && meta.objective) objInput.value = meta.objective;

        const kwInput = $('draft-keywords');
        if (kwInput && !kwInput.value.trim() && meta.keywords) {
          kwInput.value = Array.isArray(meta.keywords) ? meta.keywords.join(', ') : meta.keywords;
        }
      }

      renderStep2Preview();
      goToDraftStep(2);
      toast('Excel parsed successfully!');
    } catch (err) {
      toast(err.message || 'Failed to parse Excel', true);
    } finally {
      nextBtn.disabled = false;
      nextBtn.textContent = 'Parse Excel & Continue →';
    }
  }

  function renderStep2Preview() {
    // Metadata
    const metaContainer = $('draft-meta-preview');
    const meta = parsedExcel.metadata || {};
    metaContainer.innerHTML = `
      <div class="draft-meta-edit-grid">
        <div class="draft-meta-edit-field">
          <label>Paper Title</label>
          <input type="text" id="draft-step2-title" class="draft-meta-input" value="${escapeHtml(meta.title || '')}" placeholder="AI will generate title if left blank" />
        </div>
        <div class="draft-meta-edit-field">
          <label>Research Area / Topic</label>
          <input type="text" id="draft-step2-area" class="draft-meta-input" value="${escapeHtml(meta.researchArea || '')}" placeholder="e.g. Artificial Intelligence, Healthcare Informatics (Optional)" />
        </div>
        <div class="draft-meta-edit-field">
          <label>Research Objective</label>
          <input type="text" id="draft-step2-objective" class="draft-meta-input" value="${escapeHtml(meta.objective || '')}" placeholder="e.g. Synthesize state-of-the-art literature and findings (Optional)" />
        </div>
        <div class="draft-meta-edit-field">
          <label>Methodology</label>
          <input type="text" id="draft-step2-method" class="draft-meta-input" value="${escapeHtml(meta.methodology || '')}" placeholder="e.g. Systematic Review, Bibliometric Synthesis (Optional)" />
        </div>
        <div class="draft-meta-notes">
          <span class="draft-meta-note-badge">✨ Abstract and Keywords will be synthesized automatically by Gemini AI</span>
        </div>
      </div>
    `;

    // References
    const refs = parsedExcel.references || [];
    $('draft-ref-count').textContent = refs.length;
    const refsContainer = $('draft-refs-preview');
    if (refs.length === 0) {
      refsContainer.innerHTML = '<p class="draft-no-data">No references detected in Excel. AI will generate content without specific citations.</p>';
    } else {
      refsContainer.innerHTML = refs.map((r, i) => `
        <div class="draft-ref-item">[${i + 1}] ${escapeHtml(r.author || 'Unknown')} (${escapeHtml(String(r.year || 'n.d.'))}). "${escapeHtml(r.title || 'Untitled')}." <em>${escapeHtml(r.journal || '')}</em></div>
      `).join('');
    }

    // Data Tables
    const dataSheets = parsedExcel.data || [];
    const tablesContainer = $('draft-tables-preview');
    if (dataSheets.length === 0) {
      tablesContainer.innerHTML = '<p class="draft-no-data">No data sheets found. Add a data sheet to include tables and charts in your paper.</p>';
    } else {
      tablesContainer.innerHTML = dataSheets.map(sheet => {
        const maxRows = 10;
        const rows = sheet.rows.slice(0, maxRows);
        return `
          <div class="draft-table-card">
            <h4>📋 ${escapeHtml(sheet.sheetName)} (${sheet.rows.length} rows, ${sheet.columns.length} columns)</h4>
            <table>
              <thead><tr>${sheet.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
              <tbody>
                ${rows.map(row => `<tr>${sheet.columns.map(c => `<td>${escapeHtml(String(row[c] ?? ''))}</td>`).join('')}</tr>`).join('')}
                ${sheet.rows.length > maxRows ? `<tr><td colspan="${sheet.columns.length}" style="text-align:center;color:var(--text-dim);font-style:italic">... ${sheet.rows.length - maxRows} more rows</td></tr>` : ''}
              </tbody>
            </table>
          </div>
        `;
      }).join('');
    }

    // Charts Config
    const charts = parsedExcel.charts || [];
    const chartsContainer = $('draft-charts-config');
    if (charts.length === 0) {
      chartsContainer.innerHTML = '<p class="draft-no-data">No chart configuration found. Add a "Charts" sheet to auto-generate visualizations.</p>';
    } else {
      chartsContainer.innerHTML = charts.map(c => `
        <div class="draft-chart-config-item">
          <span class="draft-chart-type-badge ${escapeHtml(c.type)}">${escapeHtml(c.type)}</span>
          <h4>${escapeHtml(c.chartTitle || 'Unnamed Chart')}</h4>
          <p>X: ${escapeHtml(c.xColumn)} → Y: ${escapeHtml(Array.isArray(c.yColumns) ? c.yColumns.join(', ') : c.yColumns)}</p>
          ${c.description ? `<p style="margin-top:4px;font-style:italic">${escapeHtml(c.description)}</p>` : ''}
        </div>
      `).join('');
    }
  }

  async function generateDraft() {
    goToDraftStep(3);
    $('draft-generating').style.display = '';
    $('draft-preview-content').style.display = 'none';

    // Collect all detail fields from Step 1 & Step 2
    parsedExcel.metadata = parsedExcel.metadata || {};

    const titleVal = $('draft-step2-title')?.value?.trim() || $('draft-title')?.value?.trim();
    if (titleVal) parsedExcel.metadata.title = titleVal;

    const areaVal = $('draft-step2-area')?.value?.trim() || $('draft-research-area')?.value?.trim();
    if (areaVal) parsedExcel.metadata.researchArea = areaVal;

    const objVal = $('draft-step2-objective')?.value?.trim() || $('draft-objective')?.value?.trim();
    if (objVal) parsedExcel.metadata.objective = objVal;

    const methodVal = $('draft-step2-method')?.value?.trim() || $('draft-methodology')?.value?.trim();
    if (methodVal) parsedExcel.metadata.methodology = methodVal;

    const kwVal = $('draft-keywords')?.value?.trim();
    if (kwVal) parsedExcel.metadata.keywords = kwVal;

    const absNotes = $('draft-abstract-notes')?.value?.trim();
    if (absNotes) parsedExcel.metadata.abstract = absNotes;

    const authorRows = $('draft-authors-list')?.querySelectorAll('.draft-author-row') || [];
    const authors = Array.from(authorRows).map(row => ({
      name: row.querySelector('.draft-author-name')?.value?.trim() || '',
      affiliation: row.querySelector('.draft-author-affil')?.value?.trim() || '',
      email: row.querySelector('.draft-author-email')?.value?.trim() || '',
    })).filter(a => a.name);

    // Harvest latest configuration values
    paperType = $('draft-paper-type')?.value || paperType;
    targetPages = $('draft-target-pages')?.value || targetPages;
    fontFamily = $('draft-font-family')?.value || fontFamily;
    fontSize = $('draft-font-size')?.value || fontSize;
    lineSpacing = $('draft-line-spacing')?.value || lineSpacing;
    columns = $('draft-columns')?.value || columns;

    try {
      generatedResult = await api.generatePaperDraft({
        metadata: parsedExcel.metadata,
        data: parsedExcel.data,
        references: parsedExcel.references,
        charts: parsedExcel.charts,
        citationStyle,
        authors,
        pageNumberFormat,
        paperType,
        venueType,
        targetPages,
        fontFamily,
        fontSize,
        lineSpacing,
        columns,
        workspace_id: currentWorkspace?.id
      });

      renderDraftPreview();
      $('draft-generating').style.display = 'none';
      $('draft-preview-content').style.display = '';
      updateDownloadButtonsText();
      toast('Paper draft generated!');
    } catch (err) {
      toast(err.message || 'Failed to generate draft', true);
      goToDraftStep(2);
    }
  }

  function renderDraftPreview() {
    const container = $('draft-preview-paper');
    const draft = generatedResult.draft;
    const refs = generatedResult.formattedReferences || [];
    const chartData = generatedResult.chartData || [];
    const dataTables = generatedResult.dataTables || [];
    const authors = generatedResult.authors || [];

    // Toggle IEEE styling class
    if (citationStyle === 'IEEE') {
      container.classList.add('ieee-style');
    } else {
      container.classList.remove('ieee-style');
    }

    let html = '';

    // Title
    html += `<h1 class="draft-paper-title">${draft.title || parsedExcel.metadata?.title || 'Untitled Paper'}</h1>`;

    // Authors
    if (authors.length > 0) {
      html += `<p class="draft-paper-authors">${authors.map(a => `${a.name}${a.affiliation ? ' <em>(' + a.affiliation + ')</em>' : ''}${a.email ? ' · <span style="font-family:monospace">' + a.email + '</span>' : ''}`).join(' &nbsp;•&nbsp; ')}</p>`;
    }

    // Abstract
    html += `
      <div class="draft-paper-abstract">
        <h4>Abstract</h4>
        <p>${draft.abstract || ''}</p>
      </div>
    `;

    // Keywords / Index Terms
    if (draft.keywords && draft.keywords.length > 0) {
      if (citationStyle === 'IEEE') {
        html += `<div class="draft-paper-keywords"><strong>Index Terms</strong> ${draft.keywords.join(', ')}</div>`;
      } else {
        html += `<div class="draft-paper-keywords">${draft.keywords.map(k => `<span>${k}</span>`).join('')}</div>`;
      }
    }

    // Sections
    (draft.sections || []).forEach((section, sIdx) => {
      html += `
        <div class="draft-section" id="draft-section-${sIdx}">
          <button class="draft-section-edit-btn" onclick="window._draftToggleEdit(${sIdx})">✏️ Edit</button>
          <h2 class="draft-section-heading">${section.heading}</h2>
          <div class="draft-section-content" id="draft-section-content-${sIdx}">${section.content}</div>
        </div>
      `;

      // Insert charts/tables after Results section
      if (section.heading.toLowerCase().includes('result')) {
        // Charts
        chartData.forEach((chart, cIdx) => {
          html += `
            <div class="draft-chart-container" id="draft-chart-preview-${cIdx}">
              <canvas id="draft-chart-preview-canvas-${cIdx}" width="700" height="350"></canvas>
              <p class="chart-caption">${citationStyle === 'IEEE' ? 'Fig.' : 'Figure'} ${chart.figureNumber}: ${chart.title}</p>
            </div>
          `;
        });

        // Data Tables
        dataTables.forEach(table => {
          const maxPreviewRows = 15;
          const rows = table.rows.slice(0, maxPreviewRows);
          html += `
            <div class="draft-data-table-wrap">
              <h4>${table.title}</h4>
              <table>
                <thead><tr>${table.columns.map(c => `<th>${c}</th>`).join('')}</tr></thead>
                <tbody>${rows.map(row => `<tr>${table.columns.map(c => `<td>${row[c] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody>
              </table>
              ${table.totalRows > maxPreviewRows ? `<p style="text-align:center;font-size:11px;color:var(--text-dim);margin-top:4px">Showing ${maxPreviewRows} of ${table.totalRows} rows</p>` : ''}
            </div>
          `;
        });
      }
    });

    // Acknowledgments
    if (draft.acknowledgments) {
      html += `
        <div class="draft-section">
          <h2 class="draft-section-heading">Acknowledgments</h2>
          <div class="draft-section-content">${draft.acknowledgments}</div>
        </div>
      `;
    }

    // References
    if (refs.length > 0) {
      html += `
        <div class="draft-references-section">
          <h3>References</h3>
          <div class="draft-ref-list">
            ${refs.map(r => `<p class="draft-ref-formatted">${r.formatted}</p>`).join('')}
          </div>
        </div>
      `;
    }

    container.innerHTML = html;

    // Render Chart.js charts after DOM update
    setTimeout(() => renderPreviewCharts(chartData), 200);
  }

  function renderPreviewCharts(chartData) {
    // Destroy old chart instances
    chartInstances.forEach(c => { try { c.destroy(); } catch(e){} });
    chartInstances = [];

    chartData.forEach((chart, idx) => {
      const canvas = document.getElementById(`draft-chart-preview-canvas-${idx}`);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const instance = new Chart(ctx, {
        type: chart.type === 'pie' ? 'pie' : chart.type === 'line' ? 'line' : 'bar',
        data: chart.data,
        options: {
          ...chart.options,
          responsive: true,
          maintainAspectRatio: true,
          animation: { duration: 800 },
          plugins: {
            ...(chart.options?.plugins || {}),
            title: {
              display: true,
              text: `Figure ${chart.figureNumber}: ${chart.title}`,
              font: { size: 14, weight: 'bold' }
            }
          }
        }
      });
      chartInstances.push(instance);
    });
  }

  // Inline edit toggle
  window._draftToggleEdit = function(sIdx) {
    const contentEl = document.getElementById(`draft-section-content-${sIdx}`);
    const btn = document.querySelector(`#draft-section-${sIdx} .draft-section-edit-btn`);
    if (!contentEl) return;

    if (contentEl.tagName === 'DIV') {
      const text = contentEl.textContent;
      const textarea = document.createElement('textarea');
      textarea.className = 'draft-section-textarea';
      textarea.value = text;
      textarea.id = `draft-section-content-${sIdx}`;
      contentEl.replaceWith(textarea);
      btn.textContent = '💾 Save';
    } else {
      const text = contentEl.value;
      const div = document.createElement('div');
      div.className = 'draft-section-content';
      div.id = `draft-section-content-${sIdx}`;
      div.textContent = text;
      contentEl.replaceWith(div);
      btn.textContent = '✏️ Edit';
      // Update draft data
      if (generatedResult?.draft?.sections?.[sIdx]) {
        generatedResult.draft.sections[sIdx].content = text;
      }
    }
  };

  function toRoman(num) {
    const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
    const syms = ['m','cm','d','cd','c','xc','l','xl','x','ix','v','iv','i'];
    let result = '';
    for (let i = 0; i < vals.length; i++) {
      while (num >= vals[i]) { result += syms[i]; num -= vals[i]; }
    }
    return result;
  }

  async function handleDownloadAction() {
    goToDraftStep(4);
    updateStep4DownloadCard();
    if (outputFormat === 'docx') {
      await generateAndDownloadDOCX();
    } else if (outputFormat === 'pdf') {
      await generateAndDownloadPDF();
    } else if (outputFormat === 'both') {
      await generateAndDownloadDOCX();
      await generateAndDownloadPDF();
    }
  }

  function updateStep4DownloadCard() {
    const metaEl = $('draft-download-meta');
    if (metaEl && generatedResult) {
      const draft = generatedResult.draft || {};
      const refCount = (generatedResult.formattedReferences || []).length;
      const chartCount = (generatedResult.chartData || []).length;
      const tableCount = (generatedResult.dataTables || []).length;
      const pType = generatedResult.paperType || paperType || 'implementation';
      const vType = generatedResult.venueType || venueType || 'conference';
      const tPages = generatedResult.targetPages || targetPages || '6-8';
      const fFamily = generatedResult.fontFamily || fontFamily || 'Times New Roman';
      const fSize = generatedResult.fontSize || fontSize || '10';

      metaEl.innerHTML = `
        <span>📄 ${citationStyle} Style</span>
        <span>🔬 ${pType.toUpperCase()}</span>
        <span>🏛️ ${vType.toUpperCase()} (${tPages} pgs)</span>
        <span>🖋️ ${fFamily} ${fSize}pt</span>
        <span>📊 ${chartCount} Charts</span>
        <span>📋 ${tableCount} Tables</span>
        <span>📚 ${refCount} References</span>
        <span>📝 ${(draft.sections || []).length} Sections</span>
        <span>💾 ${outputFormat.toUpperCase()}</span>
      `;
    }
    const pdfBtn = $('draft-download-btn');
    const docxBtn = $('draft-download-docx-btn');
    if (pdfBtn) pdfBtn.style.display = (outputFormat === 'pdf' || outputFormat === 'both') ? '' : 'none';
    if (docxBtn) docxBtn.style.display = (outputFormat === 'docx' || outputFormat === 'both') ? '' : 'none';
  }

  async function generateAndDownloadDOCX() {
    if (!generatedResult) return;

    const btn = $('draft-download-docx-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating Word DOCX...'; }

    try {
      const draft = generatedResult.draft || {};
      const refs = generatedResult.formattedReferences || [];
      const chartData = generatedResult.chartData || [];
      const dataTables = generatedResult.dataTables || [];
      const authors = generatedResult.authors || [];

      const pType = generatedResult.paperType || paperType || 'implementation';
      const vType = generatedResult.venueType || venueType || 'conference';
      const fFamily = generatedResult.fontFamily || fontFamily || 'Times New Roman';
      const fSize = parseInt(generatedResult.fontSize || fontSize || (citationStyle === 'IEEE' ? '10' : '11'));
      const lSpacing = parseFloat(generatedResult.lineSpacing || lineSpacing || '1.0');
      const cols = generatedResult.columns || columns || 'auto';
      const isTwoCol = cols === '2' || (cols === 'auto' && (citationStyle === 'IEEE' || vType === 'conference'));

      const bodySize = fSize * 2; // half-points in docx (10pt = 20)
      const titleSize = Math.round(fSize * 2.2 * 2);
      const h1Size = Math.round(fSize * 1.15 * 2);
      const h2Size = Math.round(fSize * 1.05 * 2);
      const captionSize = Math.round(fSize * 0.85 * 2);
      const refSize = Math.round(fSize * 0.9 * 2);
      const docxLineSpacing = Math.round(240 * lSpacing);

      // Section 1 children: Title, Authors, Abstract, Keywords (spanning 1 full column)
      const sec1Children = [];

      // Title
      sec1Children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 180 },
          children: [
            new TextRun({
              text: (draft.title || 'Research Paper Title').toUpperCase(),
              bold: true,
              font: fFamily,
              size: titleSize
            })
          ]
        })
      );

      // Authors block
      if (authors.length > 0) {
        sec1Children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 60 },
            children: [
              new TextRun({
                text: authors.map(a => a.name).join('    ·    '),
                bold: true,
                font: fFamily,
                size: Math.round(fSize * 1.05 * 2)
              })
            ]
          })
        );
        const affils = authors.map(a => a.affiliation).filter(Boolean);
        if (affils.length > 0) {
          sec1Children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 0, after: 40 },
              children: [
                new TextRun({
                  text: Array.from(new Set(affils)).join('   |   '),
                  italics: true,
                  font: fFamily,
                  size: Math.round(fSize * 0.9 * 2),
                  color: '555555'
                })
              ]
            })
          );
        }
        const emails = authors.map(a => a.email).filter(Boolean);
        if (emails.length > 0) {
          sec1Children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 0, after: 180 },
              children: [
                new TextRun({
                  text: emails.join('    ·    '),
                  font: fFamily,
                  size: Math.round(fSize * 0.85 * 2),
                  color: '777777'
                })
              ]
            })
          );
        }
      }

      // Abstract & Keywords (in Section 1 for 2-column papers, or standard for 1-column)
      if (draft.abstract) {
        const isIEEE = citationStyle === 'IEEE';
        sec1Children.push(
          new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            spacing: { before: 120, after: 100, line: docxLineSpacing },
            indent: isIEEE ? { left: 400, right: 400 } : undefined,
            children: [
              new TextRun({
                text: isIEEE ? 'Abstract— ' : 'Abstract. ',
                bold: true,
                italics: isIEEE,
                font: fFamily,
                size: bodySize
              }),
              new TextRun({
                text: draft.abstract,
                italics: isIEEE,
                font: fFamily,
                size: bodySize
              })
            ]
          })
        );
      }

      if (draft.keywords && draft.keywords.length > 0) {
        const isIEEE = citationStyle === 'IEEE';
        const kwText = Array.isArray(draft.keywords) ? draft.keywords.join(', ') : String(draft.keywords);
        sec1Children.push(
          new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            spacing: { before: 40, after: 200, line: docxLineSpacing },
            indent: isIEEE ? { left: 400, right: 400 } : undefined,
            children: [
              new TextRun({
                text: isIEEE ? 'Index Terms— ' : 'Keywords: ',
                bold: true,
                italics: isIEEE,
                font: fFamily,
                size: bodySize
              }),
              new TextRun({
                text: kwText,
                font: fFamily,
                size: bodySize
              })
            ]
          })
        );
      }

      // Body Section Children (Section 2 if 2-column, or appended to sec1 if 1-column)
      const bodyChildren = [];

      // Pre-render chart images if any
      const chartImages = {};
      if (chartData && chartData.length > 0) {
        for (const c of chartData) {
          try {
            const dataUrl = await renderChartToImage(c);
            if (dataUrl) {
              const base64Data = dataUrl.split(',')[1];
              chartImages[c.figureNumber] = Uint8Array.from(atob(base64Data), ch => ch.charCodeAt(0));
            }
          } catch(e) {
            console.warn('Failed to pre-render chart for DOCX:', e);
          }
        }
      }

      // Helper to generate docx Table
      function createDocxTable(table) {
        const maxCols = 6;
        const cols = table.columns.slice(0, maxCols);
        const rows = (table.rows || []).slice(0, 15);

        const headerRow = new TableRow({
          children: cols.map(c => new TableCell({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: String(c), bold: true, font: fFamily, size: Math.round(captionSize * 0.95) })]
              })
            ],
            shading: { fill: 'F0F0F5' }
          }))
        });

        const dataRows = rows.map(r => new TableRow({
          children: cols.map(c => new TableCell({
            children: [
              new Paragraph({
                alignment: AlignmentType.LEFT,
                children: [new TextRun({ text: String(r[c] ?? ''), font: fFamily, size: Math.round(captionSize * 0.9) })]
              })
            ]
          }))
        }));

        return new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [headerRow, ...dataRows]
        });
      }

      // Sections
      const isIEEE = citationStyle === 'IEEE';
      (draft.sections || []).forEach((sec, idx) => {
        // Section Heading
        const headingText = isIEEE
          ? `${toRoman(idx + 1)}. ${sec.title.toUpperCase()}`
          : `${idx + 1}. ${sec.title}`;

        bodyChildren.push(
          new Paragraph({
            alignment: isIEEE ? AlignmentType.CENTER : AlignmentType.LEFT,
            spacing: { before: 240, after: 120 },
            heading: HeadingLevel.HEADING_1,
            children: [
              new TextRun({
                text: headingText,
                bold: true,
                font: fFamily,
                size: h1Size
              })
            ]
          })
        );

        // Section Content
        if (sec.content) {
          const paras = sec.content.split('\n\n').filter(p => p.trim());
          paras.forEach(p => {
            bodyChildren.push(
              new Paragraph({
                alignment: AlignmentType.JUSTIFIED,
                spacing: { before: 0, after: 100, line: docxLineSpacing },
                indent: isIEEE ? { firstLine: 280 } : { firstLine: 400 },
                children: [
                  new TextRun({
                    text: p.trim(),
                    font: fFamily,
                    size: bodySize
                  })
                ]
              })
            );
          });
        }

        // Subsections
        if (sec.subsections && Array.isArray(sec.subsections)) {
          sec.subsections.forEach((sub, subIdx) => {
            const letter = String.fromCharCode(65 + subIdx);
            const subTitle = isIEEE ? `${letter}. ${sub.title}` : `${idx + 1}.${subIdx + 1} ${sub.title}`;
            bodyChildren.push(
              new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { before: 160, after: 80 },
                heading: HeadingLevel.HEADING_2,
                children: [
                  new TextRun({
                    text: subTitle,
                    bold: true,
                    italics: isIEEE,
                    font: fFamily,
                    size: h2Size
                  })
                ]
              })
            );

            if (sub.content) {
              const subParas = sub.content.split('\n\n').filter(p => p.trim());
              subParas.forEach(p => {
                bodyChildren.push(
                  new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    spacing: { before: 0, after: 100, line: docxLineSpacing },
                    indent: isIEEE ? { firstLine: 280 } : { firstLine: 400 },
                    children: [
                      new TextRun({
                        text: p.trim(),
                        font: fFamily,
                        size: bodySize
                      })
                    ]
                  })
                );
              });
            }
          });
        }

        // Check if a chart matches this section
        if (chartData && chartData.length > 0) {
          const matchedChart = chartData.find(c =>
            (c.sectionIndex !== undefined && c.sectionIndex === idx) ||
            (c.sectionTitle && sec.title.toLowerCase().includes(c.sectionTitle.toLowerCase()))
          );
          if (matchedChart && chartImages[matchedChart.figureNumber]) {
            bodyChildren.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 140, after: 60 },
                children: [
                  new ImageRun({
                    data: chartImages[matchedChart.figureNumber],
                    transformation: { width: isTwoCol ? 290 : 480, height: isTwoCol ? 150 : 240 }
                  })
                ]
              })
            );
            bodyChildren.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 140 },
                children: [
                  new TextRun({
                    text: `Fig. ${matchedChart.figureNumber}. ${matchedChart.title}`,
                    italics: true,
                    font: fFamily,
                    size: captionSize
                  })
                ]
              })
            );
          }
        }

        // Check if a data table matches this section
        if (dataTables && dataTables.length > 0) {
          const matchedTable = dataTables.find(t =>
            (t.sectionIndex !== undefined && t.sectionIndex === idx) ||
            (t.sectionTitle && sec.title.toLowerCase().includes(t.sectionTitle.toLowerCase()))
          );
          if (matchedTable) {
            bodyChildren.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 140, after: 40 },
                children: [
                  new TextRun({
                    text: `TABLE ${toRoman(dataTables.indexOf(matchedTable) + 1).toUpperCase()}: ${matchedTable.title.toUpperCase()}`,
                    bold: true,
                    font: fFamily,
                    size: captionSize
                  })
                ]
              })
            );
            bodyChildren.push(createDocxTable(matchedTable));
            bodyChildren.push(
              new Paragraph({ spacing: { before: 0, after: 120 } })
            );
          }
        }
      });

      // Acknowledgments
      if (draft.acknowledgments) {
        bodyChildren.push(
          new Paragraph({
            alignment: isIEEE ? AlignmentType.CENTER : AlignmentType.LEFT,
            spacing: { before: 200, after: 100 },
            children: [
              new TextRun({
                text: isIEEE ? 'ACKNOWLEDGMENT' : 'Acknowledgments',
                bold: true,
                font: fFamily,
                size: h1Size
              })
            ]
          })
        );
        bodyChildren.push(
          new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            spacing: { before: 0, after: 120, line: docxLineSpacing },
            indent: { firstLine: 280 },
            children: [
              new TextRun({
                text: draft.acknowledgments,
                font: fFamily,
                size: bodySize
              })
            ]
          })
        );
      }

      // References
      if (refs.length > 0) {
        bodyChildren.push(
          new Paragraph({
            alignment: isIEEE ? AlignmentType.CENTER : AlignmentType.LEFT,
            spacing: { before: 240, after: 120 },
            children: [
              new TextRun({
                text: isIEEE ? 'REFERENCES' : (citationStyle === 'MLA' ? 'Works Cited' : 'References'),
                bold: true,
                font: fFamily,
                size: h1Size
              })
            ]
          })
        );

        refs.forEach(r => {
          const cleanRef = (r.formatted || '').replace(/\*/g, '');
          bodyChildren.push(
            new Paragraph({
              alignment: AlignmentType.LEFT,
              spacing: { before: 0, after: 60, line: docxLineSpacing },
              indent: isIEEE ? { left: 320, hanging: 320 } : { left: 400, hanging: 400 },
              children: [
                new TextRun({
                  text: cleanRef,
                  font: fFamily,
                  size: refSize
                })
              ]
            })
          );
        });
      }

      // Page numbering footer
      const footerObj = pageNumberFormat !== 'none' ? new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                children: [PageNumber.CURRENT],
                font: fFamily,
                size: 18,
                color: '888888'
              })
            ]
          })
        ]
      }) : undefined;

      // Construct docx Document
      let docObj;
      if (isTwoCol) {
        docObj = new Document({
          sections: [
            {
              properties: {
                page: {
                  margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
                }
              },
              children: sec1Children
            },
            {
              properties: {
                type: SectionType.CONTINUOUS,
                column: { count: 2, space: 450 },
                page: {
                  margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
                }
              },
              footers: footerObj ? { default: footerObj } : undefined,
              children: bodyChildren
            }
          ]
        });
      } else {
        docObj = new Document({
          sections: [
            {
              properties: {
                page: {
                  margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
                }
              },
              footers: footerObj ? { default: footerObj } : undefined,
              children: [...sec1Children, ...bodyChildren]
            }
          ]
        });
      }

      const blob = await Packer.toBlob(docObj);
      const filename = `${(draft.title || 'Paper_Draft').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 45)}.docx`;
      saveAs(blob, filename);

      goToDraftStep(4);
      updateStep4DownloadCard();
      toast('Word document (.docx) downloaded!');
    } catch(err) {
      console.error('DOCX generation error:', err);
      toast('Failed to generate DOCX: ' + err.message, true);
    } finally {
      const btn = $('draft-download-docx-btn');
      if (btn) { btn.disabled = false; btn.textContent = '📄 Download Word Document (.docx)'; }
    }
  }

  async function generateAndDownloadPDF() {
    if (!generatedResult) return;

    const btn = $('draft-next-3') || $('draft-download-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating PDF...'; }

    try {
      const PDFDoc = jsPDF || window.jspdf?.jsPDF || window.jsPDF;
      if (!PDFDoc) {
        throw new Error('PDF generator library is initializing. Please try again in a moment.');
      }
      const doc = new PDFDoc({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const draft = generatedResult.draft;
      const refs = generatedResult.formattedReferences || [];
      const chartData = generatedResult.chartData || [];
      const dataTables = generatedResult.dataTables || [];
      const authors = generatedResult.authors || [];

      const pType = generatedResult.paperType || paperType || 'implementation';
      const vType = generatedResult.venueType || venueType || 'conference';
      const fFamily = generatedResult.fontFamily || fontFamily || 'Times New Roman';
      const fSize = parseInt(generatedResult.fontSize || fontSize || (citationStyle === 'IEEE' ? '10' : '11'));
      const lSpacing = parseFloat(generatedResult.lineSpacing || lineSpacing || '1.0');
      const cols = generatedResult.columns || columns || 'auto';
      const isTwoCol = cols === '2' || (cols === 'auto' && (citationStyle === 'IEEE' || vType === 'conference'));

      const fontMapping = {
        'Times New Roman': 'times',
        'Arial': 'helvetica',
        'Calibri': 'helvetica',
        'Computer Modern': 'times'
      };
      const fontName = fontMapping[fFamily] || (citationStyle === 'IEEE' ? 'times' : 'helvetica');

      function formatPageNum(n) {
        if (pageNumberFormat === 'none') return '';
        if (pageNumberFormat === 'roman') return toRoman(n);
        return String(n);
      }

      // ══════════════════════════════════════════════════════════
      // TWO-COLUMN COMPACT ACADEMIC FORMAT (IEEE / CONFERENCE)
      // ══════════════════════════════════════════════════════════
      if (isTwoCol) {
        const pageW = 210;
        const pageH = 297;
        const mTop = 18;
        const mBot = 18;
        const mL = 16;
        const mR = 16;
        const colW = 85;
        const colGutter = 8;
        const col1X = mL;
        const col2X = mL + colW + colGutter; // 109mm
        const fullW = pageW - mL - mR; // 178mm

        let curCol = 1;
        let colTopY = mTop;
        let colY = mTop;
        let ieeePageNum = 0;

        function addIeeeFooter() {
          ieeePageNum++;
          const pn = formatPageNum(ieeePageNum);
          if (pn) {
            doc.setFont(fontName, 'normal');
            doc.setFontSize(9);
            doc.setTextColor(100);
            doc.text(pn, pageW / 2, pageH - 10, { align: 'center' });
            doc.setTextColor(0);
          }
        }

        function addIeeeHeader() {
          if (ieeePageNum > 1) {
            doc.setFont(fontName, 'italic');
            doc.setFontSize(8);
            doc.setTextColor(140);
            const shortT = (draft.title || '').substring(0, 75);
            doc.text(shortT, mL, 12);
            doc.setTextColor(0);
          }
        }

        function checkCol(needed) {
          if (colY + needed > pageH - mBot) {
            if (curCol === 1) {
              curCol = 2;
              colY = colTopY;
            } else {
              doc.addPage();
              addIeeeFooter();
              addIeeeHeader();
              curCol = 1;
              colTopY = mTop + 4;
              colY = colTopY;
            }
          }
        }

        function writeIeeeColumnText(text, fontSize, isIndent) {
          doc.setFont(fontName, 'normal');
          const effSize = fontSize || fSize;
          doc.setFontSize(effSize);
          const curX = curCol === 1 ? col1X : col2X;
          const lHeight = Math.max(3.6, effSize * 0.3527 * 1.25 * lSpacing);
          const indentVal = isIndent ? 4 : 0;
          const words = text.split(/\s+/);
          let currentLine = '';
          let isFirst = true;

          for (const word of words) {
            const testLine = currentLine ? currentLine + ' ' + word : word;
            const maxW = isFirst ? colW - indentVal : colW;
            if (doc.getTextWidth(testLine) > maxW && currentLine) {
              checkCol(lHeight);
              const xPos = isFirst ? curX + indentVal : curX;
              doc.text(currentLine, xPos, colY);
              colY += lHeight;
              currentLine = word;
              isFirst = false;
            } else {
              currentLine = testLine;
            }
          }
          if (currentLine) {
            checkCol(lHeight);
            const xPos = isFirst ? curX + indentVal : curX;
            doc.text(currentLine, xPos, colY);
            colY += lHeight;
          }
        }

        // ── PAGE 1: TITLE & AUTHORS (Full Width Across Top) ──
        addIeeeFooter();
        let topY = 22;

        // Title
        doc.setFont(fontName, 'bold');
        doc.setFontSize(18);
        const titleLines = doc.splitTextToSize((draft.title || 'Untitled Paper').toUpperCase(), fullW - 20);
        doc.text(titleLines, pageW / 2, topY, { align: 'center' });
        topY += titleLines.length * 7 + 6;

        // Authors block
        if (authors.length > 0) {
          doc.setFont(fontName, 'bold');
          doc.setFontSize(10.5);
          const authorNames = authors.map(a => a.name).join('   ·   ');
          doc.text(authorNames, pageW / 2, topY, { align: 'center' });
          topY += 4.5;

          const affils = authors.map(a => a.affiliation).filter(Boolean);
          if (affils.length > 0) {
            doc.setFont(fontName, 'italic');
            doc.setFontSize(9);
            doc.setTextColor(60);
            doc.text(Array.from(new Set(affils)).join('   |   '), pageW / 2, topY, { align: 'center' });
            topY += 4;
          }

          const emails = authors.map(a => a.email).filter(Boolean);
          if (emails.length > 0) {
            doc.setFont(fontName, 'normal');
            doc.setFontSize(8.5);
            doc.setTextColor(80);
            doc.text(emails.join('   ·   '), pageW / 2, topY, { align: 'center' });
            topY += 4;
          }
          doc.setTextColor(0);
        }
        topY += 4;

        // Abstract & Index Terms (Full width block)
        if (draft.abstract) {
          doc.setFont(fontName, 'bolditalic');
          doc.setFontSize(9);
          const absLead = 'Abstract— ';
          const absLeadW = doc.getTextWidth(absLead);
          const absLines = doc.splitTextToSize(draft.abstract, fullW - 16);

          doc.text(absLead, mL + 8, topY);
          doc.setFont(fontName, 'normal');
          doc.setFontSize(9);

          absLines.forEach((l, idx) => {
            const lx = idx === 0 ? mL + 8 + absLeadW : mL + 8;
            doc.text(l, lx, topY);
            topY += 4.2;
          });
          topY += 2;
        }

        if (draft.keywords && draft.keywords.length > 0) {
          doc.setFont(fontName, 'bolditalic');
          doc.setFontSize(9);
          const kwLead = 'Index Terms— ';
          const kwLeadW = doc.getTextWidth(kwLead);
          const kwText = draft.keywords.join(', ');
          const kwLines = doc.splitTextToSize(kwText, fullW - 16);

          doc.text(kwLead, mL + 8, topY);
          doc.setFont(fontName, 'italic');
          doc.setFontSize(9);
          kwLines.forEach((l, idx) => {
            const lx = idx === 0 ? mL + 8 + kwLeadW : mL + 8;
            doc.text(l, lx, topY);
            topY += 4.2;
          });
          topY += 3;
        }

        // Thin separator rule
        doc.setDrawColor(200);
        doc.setLineWidth(0.3);
        doc.line(mL, topY, pageW - mR, topY);
        topY += 6;

        // Start 2-column layout
        colTopY = topY;
        colY = topY;
        curCol = 1;

        // ── BODY SECTIONS (TWO COLUMNS) ──
        for (let sIdx = 0; sIdx < (draft.sections || []).length; sIdx++) {
          const section = draft.sections[sIdx];
          const headingText = /^[IVXLCDM]+\.\s+/i.test(section.heading)
            ? section.heading.toUpperCase()
            : `${toRoman(sIdx + 1).toUpperCase()}. ${section.heading.toUpperCase()}`;

          checkCol(12);
          doc.setFont(fontName, 'bold');
          doc.setFontSize(10);
          const curX = curCol === 1 ? col1X : col2X;
          doc.text(headingText, curX + colW / 2, colY, { align: 'center' });
          colY += 6;

          const editedEl = document.getElementById(`draft-section-content-${sIdx}`);
          const content = editedEl ? (editedEl.tagName === 'TEXTAREA' ? editedEl.value : editedEl.textContent) : section.content;
          const paragraphs = content.split(/\n\n+/);

          for (const p of paragraphs) {
            const trimmed = p.trim();
            if (!trimmed) continue;
            writeIeeeColumnText(trimmed, 9.5, true);
            colY += 2;
          }

          // Results charts & tables in IEEE format
          if (section.heading.toLowerCase().includes('result')) {
            // Charts
            for (const chart of chartData) {
              try {
                const chartImg = await renderChartToImage(chart);
                if (chartImg) {
                  const imgH = colW * 0.52;
                  checkCol(imgH + 12);
                  const cX = curCol === 1 ? col1X : col2X;
                  doc.addImage(chartImg, 'PNG', cX, colY, colW, imgH);
                  colY += imgH + 3.5;

                  doc.setFont(fontName, 'italic');
                  doc.setFontSize(8);
                  const cap = `Fig. ${chart.figureNumber}. ${chart.title}`;
                  doc.text(cap, cX + colW / 2, colY, { align: 'center' });
                  colY += 6;
                }
              } catch (e) {
                console.warn('IEEE chart render error:', e);
              }
            }

            // Tables
            for (let tIdx = 0; tIdx < dataTables.length; tIdx++) {
              const table = dataTables[tIdx];
              const keyCols = selectKeyColumns(table).slice(0, 4);
              const maxRows = Math.min(table.rows.length, 15);
              const rows = table.rows.slice(0, maxRows).map(r => keyCols.map(c => truncateCell(r[c], 18)));

              checkCol(20);
              const cX = curCol === 1 ? col1X : col2X;
              doc.setFont(fontName, 'bold');
              doc.setFontSize(8);
              doc.text(`TABLE ${toRoman(tIdx + 1).toUpperCase()}`, cX + colW / 2, colY, { align: 'center' });
              colY += 3.5;
              doc.setFont(fontName, 'normal');
              doc.setFontSize(7.5);
              doc.text(truncateCell(table.title, 40).toUpperCase(), cX + colW / 2, colY, { align: 'center' });
              colY += 3.5;

              const renderT = typeof autoTable === 'function' ? autoTable : (doc.autoTable ? doc.autoTable.bind(doc) : null);
              if (renderT) {
                renderT(doc, {
                  head: [keyCols],
                  body: rows,
                  startY: colY,
                  margin: { left: cX, right: pageW - (cX + colW) },
                  styles: {
                    font: 'times',
                    fontSize: 6.5,
                    cellPadding: 1,
                    overflow: 'linebreak',
                    lineWidth: 0.1,
                    lineColor: [200, 200, 200],
                    textColor: [20, 20, 20]
                  },
                  headStyles: {
                    fillColor: [240, 240, 245],
                    textColor: [10, 10, 10],
                    fontStyle: 'bold',
                    fontSize: 6.5,
                    halign: 'center'
                  },
                  theme: 'grid',
                  tableWidth: colW
                });
                const finY = doc.lastAutoTable ? doc.lastAutoTable.finalY : colY + 25;
                colY = finY + 5;
              }
            }
          }
        }

        // Acknowledgments
        if (draft.acknowledgments) {
          checkCol(12);
          doc.setFont(fontName, 'bold');
          doc.setFontSize(10);
          const curX = curCol === 1 ? col1X : col2X;
          doc.text('ACKNOWLEDGMENT', curX + colW / 2, colY, { align: 'center' });
          colY += 6;
          writeIeeeColumnText(draft.acknowledgments, 9.5, true);
          colY += 4;
        }

        // References
        if (refs.length > 0) {
          checkCol(14);
          doc.setFont(fontName, 'bold');
          doc.setFontSize(10);
          const curX = curCol === 1 ? col1X : col2X;
          doc.text('REFERENCES', curX + colW / 2, colY, { align: 'center' });
          colY += 6;

          doc.setFont(fontName, 'normal');
          doc.setFontSize(8);

          refs.forEach(ref => {
            const clean = ref.formatted.replace(/\*/g, '');
            const cX = curCol === 1 ? col1X : col2X;
            const rLines = doc.splitTextToSize(clean, colW - 5);
            checkCol(rLines.length * 3.6 + 2);
            rLines.forEach((l, lIdx) => {
              const lx = lIdx === 0 ? cX : cX + 4;
              doc.text(l, lx, colY);
              colY += 3.4;
            });
            colY += 1.8;
          });
        }

        const filename = `${(draft.title || 'Paper_Draft').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 45)}_IEEE.pdf`;
        doc.save(filename);
        goToDraftStep(4);
        updateStep4DownloadCard();
        toast('IEEE PDF downloaded!');
        return;
      }

      // ══════════════════════════════════════════════════════════
      // STANDARD ACADEMIC MANUSCRIPT FORMAT (APA, MLA, CHICAGO)
      // ══════════════════════════════════════════════════════════
      const pageWidth = doc.internal.pageSize.getWidth();   // 210
      const pageHeight = doc.internal.pageSize.getHeight();  // 297
      const marginL = 25.4;  // 1 inch
      const marginR = 25.4;
      const marginTop = 25.4;
      const marginBot = 25.4;
      const contentWidth = pageWidth - marginL - marginR;    // ~159mm
      const lineHeight = 6;   // body text line height in mm
      const paraIndent = 8;   // first-line indent in mm
      let pageNum = 0;

      function addPageNumber() {
        pageNum++;
        const pn = formatPageNum(pageNum);
        if (pn) {
          doc.setFontSize(10);
          doc.setTextColor(128);
          doc.text(pn, pageWidth / 2, pageHeight - 12, { align: 'center' });
          doc.setTextColor(0);
        }
      }

      function addRunningHeader() {
        doc.setFontSize(8);
        doc.setTextColor(160);
        const shortTitle = (draft.title || '').substring(0, 70);
        doc.text(shortTitle, marginL, 12);
        doc.setTextColor(0);
      }

      function newPage() {
        doc.addPage();
        addPageNumber();
        addRunningHeader();
        return marginTop;
      }

      function checkPage(y, needed) {
        if (y + needed > pageHeight - marginBot) {
          return newPage();
        }
        return y;
      }

      // ── Utility: write paragraph with first-line indent ──
      function writeParagraph(text, y, fontSize, indent) {
        doc.setFontSize(fontSize || 11);
        doc.setFont('helvetica', 'normal');
        const firstLineWidth = contentWidth - (indent || paraIndent);
        const restWidth = contentWidth;
        const words = text.split(/\s+/);
        let currentLine = '';
        let isFirstLine = true;

        for (const word of words) {
          const testLine = currentLine ? currentLine + ' ' + word : word;
          const maxW = isFirstLine ? firstLineWidth : restWidth;
          if (doc.getTextWidth(testLine) > maxW && currentLine) {
            y = checkPage(y, lineHeight);
            const xPos = isFirstLine ? marginL + (indent || paraIndent) : marginL;
            doc.text(currentLine, xPos, y);
            y += lineHeight;
            currentLine = word;
            isFirstLine = false;
          } else {
            currentLine = testLine;
          }
        }
        if (currentLine) {
          y = checkPage(y, lineHeight);
          const xPos = isFirstLine ? marginL + (indent || paraIndent) : marginL;
          doc.text(currentLine, xPos, y);
          y += lineHeight;
        }
        return y;
      }

      // ── Utility: write body text without indent ──
      function writeText(text, y, fontSize) {
        doc.setFontSize(fontSize || 11);
        const lines = doc.splitTextToSize(text, contentWidth);
        for (const line of lines) {
          y = checkPage(y, lineHeight);
          doc.text(line, marginL, y);
          y += lineHeight;
        }
        return y;
      }

      // ── Utility: select key columns for wide tables ──
      function selectKeyColumns(table) {
        const MAX_COLS = 6;
        const cols = table.columns;
        if (cols.length <= MAX_COLS) return cols;

        // Priority columns by name pattern
        const priorityPatterns = [
          /^#$/i, /^no$/i, /^s\.?no/i, /^index/i, /^id$/i,
          /title/i, /name/i,
          /author/i, /creator/i,
          /year/i, /date/i, /pub/i,
          /venue/i, /journal/i, /conference/i, /source/i,
          /doi$/i,
          /quartile/i, /scopus/i, /indexed/i,
          /type/i, /category/i,
          /publisher/i,
          /country/i, /region/i,
          /cited/i, /citation/i,
          /abstract/i
        ];

        const selected = [];
        const used = new Set();

        // Always include a numeric index column if present
        const idxCol = cols.find(c => /^(#|no|s\.?no|index|id)$/i.test(c.trim()));
        if (idxCol) { selected.push(idxCol); used.add(idxCol); }

        // Walk priority patterns
        for (const pattern of priorityPatterns) {
          if (selected.length >= MAX_COLS) break;
          for (const col of cols) {
            if (used.has(col)) continue;
            if (pattern.test(col.trim())) {
              selected.push(col);
              used.add(col);
              break;
            }
          }
        }

        // Fill remaining slots with first unselected columns (skip URL-like ones)
        for (const col of cols) {
          if (selected.length >= MAX_COLS) break;
          if (used.has(col)) continue;
          if (/url|link|http|scopus_url/i.test(col)) continue;
          selected.push(col);
          used.add(col);
        }

        return selected;
      }

      // ── Utility: truncate cell text for tables ──
      function truncateCell(val, maxLen) {
        const s = String(val ?? '').trim();
        if (s.length <= maxLen) return s;
        return s.substring(0, maxLen - 1) + '…';
      }

      // ════════════════════════════════════════
      // PAGE 1 — TITLE PAGE
      // ════════════════════════════════════════
      doc.setFontSize(24);
      doc.setFont('helvetica', 'bold');
      const titleLines = doc.splitTextToSize(draft.title || 'Untitled Paper', contentWidth - 20);
      const titleStartY = 85;
      doc.text(titleLines, pageWidth / 2, titleStartY, { align: 'center' });

      let ty = titleStartY + titleLines.length * 10 + 15;

      // Authors
      if (authors.length > 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        authors.forEach(a => {
          doc.text(a.name, pageWidth / 2, ty, { align: 'center' });
          ty += 6;
          if (a.affiliation) {
            doc.setFontSize(10);
            doc.setTextColor(80);
            doc.text(a.affiliation, pageWidth / 2, ty, { align: 'center' });
            doc.setTextColor(0);
            ty += 5;
          }
          if (a.email) {
            doc.setFontSize(9);
            doc.setTextColor(100);
            doc.text(a.email, pageWidth / 2, ty, { align: 'center' });
            doc.setTextColor(0);
            ty += 5;
          }
          ty += 3;
          doc.setFontSize(12);
        });
      }

      // Date
      doc.setFontSize(11);
      doc.setTextColor(80);
      doc.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), pageWidth / 2, ty + 12, { align: 'center' });
      doc.setTextColor(0);

      // Footer
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(`Citation Format: ${citationStyle} | Generated by Tessera AI`, pageWidth / 2, pageHeight - 20, { align: 'center' });
      doc.setTextColor(0);
      addPageNumber();

      // ════════════════════════════════════════
      // PAGE 2 — ABSTRACT
      // ════════════════════════════════════════
      let y = newPage();

      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Abstract', pageWidth / 2, y, { align: 'center' });
      y += 10;

      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      y = writeText(draft.abstract || '', y, 11);

      // Keywords
      if (draft.keywords && draft.keywords.length > 0) {
        y += 4;
        y = checkPage(y, 12);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        const kwLabel = 'Keywords: ';
        doc.text(kwLabel, marginL, y);
        doc.setFont('helvetica', 'italic');
        const kwText = draft.keywords.join('; ');
        const kwLines = doc.splitTextToSize(kwText, contentWidth - doc.getTextWidth(kwLabel));
        kwLines.forEach((line, i) => {
          if (i === 0) {
            doc.text(line, marginL + doc.getTextWidth(kwLabel), y);
          } else {
            y += lineHeight;
            y = checkPage(y, lineHeight);
            doc.text(line, marginL, y);
          }
        });
        doc.setFont('helvetica', 'normal');
        y += lineHeight + 4;
      }

      // ════════════════════════════════════════
      // BODY SECTIONS
      // ════════════════════════════════════════
      for (const section of (draft.sections || [])) {
        y += 8;
        y = checkPage(y, 24);

        // Section heading
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.text(section.heading, marginL, y);
        y += 8;

        // Section content
        const sIdx = draft.sections.indexOf(section);
        const editedEl = document.getElementById(`draft-section-content-${sIdx}`);
        const content = editedEl ? (editedEl.tagName === 'TEXTAREA' ? editedEl.value : editedEl.textContent) : section.content;

        const paragraphs = content.split(/\n\n+/);
        for (const para of paragraphs) {
          const trimmed = para.trim();
          if (!trimmed) continue;
          y = writeParagraph(trimmed, y, 11, paraIndent);
          y += 2; // inter-paragraph spacing
        }

        // Insert charts + tables after the Results section
        if (section.heading.toLowerCase().includes('result')) {
          // ── Charts ──
          for (const chart of chartData) {
            y += 6;
            y = checkPage(y, 85);

            try {
              const chartImg = await renderChartToImage(chart);
              if (chartImg) {
                const imgWidth = contentWidth * 0.82;
                const imgHeight = imgWidth * 0.5;
                y = checkPage(y, imgHeight + 18);
                const xOffset = marginL + (contentWidth - imgWidth) / 2;
                doc.addImage(chartImg, 'PNG', xOffset, y, imgWidth, imgHeight);
                y += imgHeight + 4;

                // Figure caption
                doc.setFontSize(9);
                doc.setFont('helvetica', 'italic');
                const caption = `Figure ${chart.figureNumber}: ${chart.title}`;
                doc.text(caption, pageWidth / 2, y, { align: 'center' });
                doc.setFont('helvetica', 'normal');
                y += 10;
              }
            } catch (chartErr) {
              console.warn('Chart render error:', chartErr);
            }
          }

          // ── Data Tables (intelligently formatted) ──
          for (const table of dataTables) {
            y += 6;
            y = checkPage(y, 35);

            // Select key columns (max 6) for readability
            const keyCols = selectKeyColumns(table);
            const totalCols = table.columns.length;
            const omittedCount = totalCols - keyCols.length;

            // Table caption
            doc.setFontSize(9);
            doc.setFont('helvetica', 'italic');
            const tableCaption = table.title + (omittedCount > 0 ? ` (showing ${keyCols.length} of ${totalCols} columns)` : '');
            doc.text(tableCaption, pageWidth / 2, y, { align: 'center' });
            doc.setFont('helvetica', 'normal');
            y += 5;

            // Build table rows with truncation
            const maxRows = Math.min(table.rows.length, 30);
            const tableRows = table.rows.slice(0, maxRows).map((row, rIdx) => {
              return keyCols.map(col => {
                const val = row[col];
                // Title/abstract columns get more space, others less
                const isWide = /title|abstract|name/i.test(col);
                return truncateCell(val, isWide ? 60 : 30);
              });
            });

            // Column width proportions
            const colStyles = {};
            keyCols.forEach((col, idx) => {
              const isWide = /title|abstract|name/i.test(col);
              const isNarrow = /^(#|no|year|vol|issue|s\.?no|id|quartile)$/i.test(col.trim());
              if (isWide) {
                colStyles[idx] = { cellWidth: 'auto', minCellWidth: 40 };
              } else if (isNarrow) {
                colStyles[idx] = { cellWidth: 14 };
              }
            });

            const renderTable = typeof autoTable === 'function' ? autoTable : (doc.autoTable ? doc.autoTable.bind(doc) : null);
            if (renderTable) {
              renderTable(doc, {
                head: [keyCols],
                body: tableRows,
                startY: y,
                margin: { left: marginL, right: marginR },
                styles: {
                  fontSize: 7,
                  cellPadding: 1.5,
                  overflow: 'linebreak',
                  lineWidth: 0.2,
                  lineColor: [180, 180, 180],
                  textColor: [30, 30, 30],
                  valign: 'top'
                },
                headStyles: {
                  fillColor: [55, 45, 90],
                  textColor: [255, 255, 255],
                  fontStyle: 'bold',
                  fontSize: 7,
                  halign: 'center'
                },
                alternateRowStyles: { fillColor: [248, 247, 252] },
                columnStyles: colStyles,
                theme: 'grid',
                tableWidth: 'auto'
              });

              // Get the final Y after the table
              const finalY = doc.lastAutoTable
                ? doc.lastAutoTable.finalY
                : (doc.previousAutoTable ? doc.previousAutoTable.finalY : y + 40);
              y = finalY + 4;

              // Note about omitted rows/cols
              if (omittedCount > 0 || table.rows.length > maxRows) {
                doc.setFontSize(7);
                doc.setTextColor(120);
                let note = '';
                if (table.rows.length > maxRows) note += `Showing ${maxRows} of ${table.totalRows || table.rows.length} rows. `;
                if (omittedCount > 0) note += `${omittedCount} columns omitted for readability.`;
                doc.text(note.trim(), pageWidth / 2, y, { align: 'center' });
                doc.setTextColor(0);
                y += 8;
              } else {
                y += 4;
              }
            }
          }
        }
      }

      // ════════════════════════════════════════
      // ACKNOWLEDGMENTS
      // ════════════════════════════════════════
      if (draft.acknowledgments) {
        y += 8;
        y = checkPage(y, 24);
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.text('Acknowledgments', marginL, y);
        y += 8;
        y = writeParagraph(draft.acknowledgments, y, 11, 0);
      }

      // ════════════════════════════════════════
      // REFERENCES
      // ════════════════════════════════════════
      if (refs.length > 0) {
        y = newPage();

        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.text('References', marginL, y);
        y += 10;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');

        refs.forEach((ref) => {
          const cleanRef = ref.formatted.replace(/\*/g, '');
          const lines = doc.splitTextToSize(cleanRef, contentWidth - 10);
          y = checkPage(y, lines.length * 5 + 3);
          lines.forEach((line, lIdx) => {
            doc.text(line, marginL + (lIdx === 0 ? 0 : 8), y);
            y += 4.8;
          });
          y += 2.5;
        });
      }

      // ════════════════════════════════════════
      // SAVE
      // ════════════════════════════════════════
      const filename = (draft.title || 'paper_draft').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50) + '.pdf';
      doc.save(filename);

      goToDraftStep(4);
      updateStep4DownloadCard();

      toast('PDF downloaded!');
    } catch (err) {
      console.error('PDF generation error:', err);
      toast('Failed to generate PDF: ' + err.message, true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📄 Generate PDF & Download →'; }
    }
  }

  function renderChartToImage(chart) {
    return new Promise((resolve) => {
      const canvas = $('draft-chart-canvas');
      if (!canvas) return resolve(null);

      // Ensure clean canvas
      canvas.width = 800;
      canvas.height = 400;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 800, 400);

      // Destroy any previous chart on this canvas
      const existingChart = Chart.getChart(canvas);
      if (existingChart) existingChart.destroy();

      const chartInstance = new Chart(ctx, {
        type: chart.type === 'pie' ? 'pie' : chart.type === 'line' ? 'line' : 'bar',
        data: JSON.parse(JSON.stringify(chart.data)), // deep clone
        options: {
          responsive: false,
          animation: false,
          plugins: {
            title: {
              display: true,
              text: `Figure ${chart.figureNumber}: ${chart.title}`,
              font: { size: 14, weight: 'bold' },
              color: '#333'
            },
            legend: { labels: { color: '#333' } }
          },
          scales: chart.type !== 'pie' ? {
            y: { beginAtZero: true, ticks: { color: '#666' }, title: { display: true, text: chart.options?.scales?.y?.title?.text || '', color: '#666' } },
            x: { ticks: { color: '#666' }, title: { display: true, text: chart.options?.scales?.x?.title?.text || '', color: '#666' } }
          } : undefined
        }
      });

      // Wait for chart to render then export
      setTimeout(() => {
        try {
          const dataUrl = canvas.toDataURL('image/png');
          chartInstance.destroy();
          resolve(dataUrl);
        } catch (e) {
          chartInstance.destroy();
          resolve(null);
        }
      }, 300);
    });
  }

  function resetDraftWizard() {
    draftStep = 1;
    draftFile = null;
    parsedExcel = null;
    generatedResult = null;
    citationStyle = 'APA';
    pageNumberFormat = 'arabic';
    outputFormat = 'docx';
    paperType = 'implementation';
    venueType = 'conference';
    targetPages = '6-8';
    fontFamily = 'Times New Roman';
    fontSize = '10';
    lineSpacing = '1.0';
    columns = 'auto';
    chartInstances.forEach(c => { try { c.destroy(); } catch(e){} });
    chartInstances = [];

    // Reset UI
    const dropzone = $('draft-dropzone');
    if (dropzone) {
      dropzone.querySelector('.draft-dropzone-content').style.display = '';
      $('draft-file-success').style.display = 'none';
    }
    if ($('draft-title')) $('draft-title').value = '';
    if ($('draft-research-area')) $('draft-research-area').value = '';
    if ($('draft-methodology')) $('draft-methodology').value = '';
    if ($('draft-objective')) $('draft-objective').value = '';
    if ($('draft-keywords')) $('draft-keywords').value = '';
    if ($('draft-abstract-notes')) $('draft-abstract-notes').value = '';
    if ($('draft-next-1')) $('draft-next-1').disabled = true;
    if ($('draft-file-input')) $('draft-file-input').value = '';

    // Reset selects
    if ($('draft-paper-type')) $('draft-paper-type').value = 'implementation';
    if ($('draft-target-pages')) $('draft-target-pages').value = '6-8';
    if ($('draft-font-family')) $('draft-font-family').value = 'Times New Roman';
    if ($('draft-font-size')) $('draft-font-size').value = '10';
    if ($('draft-line-spacing')) $('draft-line-spacing').value = '1.0';
    if ($('draft-columns')) $('draft-columns').value = 'auto';

    // Reset pills
    $('draft-venue-pills')?.querySelectorAll('.draft-pill').forEach(p => p.classList.remove('active'));
    $('draft-venue-pills')?.querySelector('[data-venue="conference"]')?.classList.add('active');
    $('draft-format-pills')?.querySelectorAll('.draft-pill').forEach(p => p.classList.remove('active'));
    $('draft-format-pills')?.querySelector('[data-format="APA"]')?.classList.add('active');
    $('draft-output-pills')?.querySelectorAll('.draft-pill').forEach(p => p.classList.remove('active'));
    $('draft-output-pills')?.querySelector('[data-format="docx"]')?.classList.add('active');
    $('draft-pagenumber-pills')?.querySelectorAll('.draft-pill').forEach(p => p.classList.remove('active'));
    $('draft-pagenumber-pills')?.querySelector('[data-format="arabic"]')?.classList.add('active');

    // Reset authors
    const authorsList = $('draft-authors-list');
    if (authorsList) {
      authorsList.innerHTML = `
        <div class="draft-author-row">
          <input type="text" class="draft-author-name" placeholder="Full Name" />
          <input type="text" class="draft-author-affil" placeholder="Affiliation" />
          <input type="text" class="draft-author-email" placeholder="Email" />
        </div>
      `;
    }

    updateDownloadButtonsText();
    goToDraftStep(1);
  }

  function generateAndDownloadTemplate() {
    // Generate a sample Excel template using xlsx
    const wb = XLSX.utils.book_new();

    // Metadata sheet
    const metaData = [
      { 'Paper Title': 'Your Research Paper Title', 'Abstract': 'Brief abstract or notes for AI to expand...', 'Keywords': 'keyword1, keyword2, keyword3', 'Research Area': 'Computer Science', 'Methodology': 'Quantitative / Qualitative / Mixed', 'Objective': 'What this paper aims to achieve' }
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(metaData), 'Metadata');

    // Data sheet
    const sampleData = [
      { 'Category': 'Method A', 'Accuracy': 92.5, 'Precision': 91.2, 'Recall': 93.8, 'F1 Score': 92.5 },
      { 'Category': 'Method B', 'Accuracy': 88.3, 'Precision': 87.1, 'Recall': 89.5, 'F1 Score': 88.3 },
      { 'Category': 'Method C', 'Accuracy': 95.1, 'Precision': 94.6, 'Recall': 95.7, 'F1 Score': 95.1 },
      { 'Category': 'Proposed', 'Accuracy': 97.2, 'Precision': 96.8, 'Recall': 97.6, 'F1 Score': 97.2 },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sampleData), 'Data');

    // References sheet
    const refsData = [
      { 'Author': 'Smith, J. et al.', 'Title': 'A Survey of Deep Learning Methods', 'Journal': 'IEEE Transactions on Neural Networks', 'Year': 2023, 'Volume': '34', 'Issue': '2', 'Pages': '125-142', 'DOI': '10.1109/TNN.2023.001' },
      { 'Author': 'Wang, L. and Chen, H.', 'Title': 'Transformer Architectures for NLP', 'Journal': 'ACM Computing Surveys', 'Year': 2022, 'Volume': '55', 'Issue': '4', 'Pages': '1-35', 'DOI': '10.1145/3505244' },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(refsData), 'References');

    // Charts sheet
    const chartsData = [
      { 'Chart Title': 'Performance Comparison', 'Type': 'bar', 'X Column': 'Category', 'Y Column': 'Accuracy, F1 Score', 'Description': 'Comparing accuracy and F1 scores across methods' },
      { 'Chart Title': 'Precision vs Recall', 'Type': 'line', 'X Column': 'Category', 'Y Column': 'Precision, Recall', 'Description': 'Precision and recall trade-off visualization' },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(chartsData), 'Charts');

    XLSX.writeFile(wb, 'Tessera_Paper_Draft_Template.xlsx');
    toast('Template downloaded!');
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupPaperDraft);
  } else {
    setupPaperDraft();
  }
})();
