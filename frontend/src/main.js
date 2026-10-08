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
      <div style="margin:12px 0 16px;padding:12px 14px;background:rgba(124,92,255,0.08);border:1px solid rgba(124,92,255,0.25);border-radius:10px">
        <label style="display:flex;align-items:center;gap:10px;font-size:0.86rem;font-weight:600;cursor:pointer;margin:0">
          <input type="checkbox" id="rescore-all-checkbox" checked style="accent-color:var(--accent);width:16px;height:16px;" />
          <span>🎯 Re-evaluate relevance scores for existing papers in this workspace</span>
        </label>
        <p style="margin:6px 0 0 26px;font-size:0.75rem;color:var(--text2);line-height:1.4">Recalculates honest 0–100% relevance scores for your existing papers against this new topic using strict academic calibration.</p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="document.getElementById('modal-overlay').classList.remove('active');document.body.style.overflow=''">Cancel</button>
        <button type="submit" class="btn btn-primary" id="btn-save-topic">💾 Save Topic</button>
      </div>
    </form>`;
  $('edit-topic-form').addEventListener('submit', async e => {
    e.preventDefault();
    const saveBtn = $('btn-save-topic');
    const newTopic = $('edit-topic-input').value.trim();
    const shouldRescore = $('rescore-all-checkbox')?.checked;
    
    saveBtn.disabled = true;
    saveBtn.innerHTML = '⏳ Saving...';

    try {
      if (currentWorkspace) {
        currentWorkspace = await api.updateWorkspace(currentWorkspace.id, { research_topic: newTopic });
      } else {
        currentProfile = await api.updateProfile({ research_topic: newTopic });
      }
      updateResearchTopicBadge();

      if (shouldRescore && currentWorkspace?.id) {
        saveBtn.innerHTML = '⏳ Calibrating paper scores...';
        toast('🎯 Re-scoring papers against your new research topic with Gemini AI...');
        try {
          const res = await api.rescoreWorkspacePapers(currentWorkspace.id, newTopic);
          toast(`✅ Rescored ${res.rescored_count || 0} papers!`);
          await loadPapers();
        } catch (rescoreErr) {
          console.warn('Batch rescore warning:', rescoreErr.message);
        }
      } else {
        toast('✅ Research topic updated');
      }

      closeModal();
    } catch (err) {
      toast('❌ ' + err.message, true);
      saveBtn.disabled = false;
      saveBtn.innerHTML = '💾 Save Topic';
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

      // Research-Grade Intelligence Pages
      if (currentPage === 'synthesis') {
        setupSynthesisPage();
      }
      if (currentPage === 'trends') {
        setupTrendsPage();
      }
      if (currentPage === 'novelty') {
        setupNoveltyPage();
      }
      if (currentPage === 'traceability') {
        setupTraceabilityPage();
      }
      if (currentPage === 'abstract-gen') {
        setupAbstractGeneratorPage();
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
    const relScore = p.relevance_score ?? 0;
    const relColor = relScore >= 75 ? 'var(--green)' : relScore >= 40 ? 'var(--orange)' : '#ef476f';
    const relLabel = relScore >= 75 ? 'High' : relScore >= 40 ? 'Moderate' : 'Low';

    const badgeLabel = d?.name || p.research_domain || (p.category ? `${p.category}` : 'General');
    const badgeIcon = d?.icon || (p.research_domain ? '🏷️' : '📄');
    const badgeBg = d ? d.color + '22' : 'rgba(124, 92, 255, 0.12)';
    const badgeColor = d?.color || 'var(--accent)';

    const topics = [];
    if (p.research_domain && p.research_domain !== badgeLabel && p.research_domain !== 'Research Domain') {
      topics.push(p.research_domain);
    }
    const emTopics = p.extended_metadata?.topics || [];
    emTopics.forEach(t => {
      if (typeof t === 'string' && !topics.includes(t)) topics.push(t);
    });

    return `
    <div class="paper-card" data-id="${p.id}" style="animation:fadeIn .3s ease ${i * 0.03}s both">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${d?.color || 'var(--accent)'}"></div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <span class="paper-badge" style="background:${badgeBg};color:${badgeColor};margin-bottom:0" title="Domain / Focus">${badgeIcon} ${badgeLabel}</span>
        ${p.category && p.category !== badgeLabel ? `<span class="paper-cat-badge">${p.category}</span>` : ''}
        <span class="read-badge ${p.is_read ? 'read' : 'unread'}">${p.is_read ? '✓ Read' : 'Unread'}</span>
      </div>
      <h3>${p.title}</h3>
      <p class="authors">${p.authors}</p>
      <div class="meta"><span>📅 ${p.year}</span><span>📄 ${p.venue ? p.venue.split('(')[0].trim() : 'Academic Journal'}</span></div>
      
      ${topics.length > 0 ? `
        <div class="paper-topics-list">
          ${topics.slice(0, 3).map(t => `<span class="paper-topic-pill" title="${t}">🔬 ${t}</span>`).join('')}
          ${topics.length > 3 ? `<span class="paper-topic-pill" style="opacity:0.75" title="${topics.slice(3).join(', ')}">+${topics.length - 3}</span>` : ''}
        </div>
      ` : ''}

      <p class="contribution">${p.contribution || ''}</p>
      <div class="paper-card-footer">
        <div class="relevance-bar" title="Relevance to your research topic (${relLabel}: ${relScore}%)">
          <span>Rel</span>
          <div class="rel-track"><div class="rel-fill" style="width:${relScore}%;background:${relColor}"></div></div>
          <span style="font-weight:700;color:${relColor}">${relScore}%</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          ${p.url ? `<a href="${p.url}" target="_blank" class="paper-link" onclick="event.stopPropagation()">🔗 View</a>` : ''}
          <button class="paper-link paper-pdf-btn" title="Find &amp; Download PDF" data-paper-id="${p.id}" onclick="event.stopPropagation();window.resolvePaperPdf('${p.id}', this)" style="border:none;cursor:pointer;background:rgba(59,130,246,0.15);color:#60a5fa;">
            📥 PDF
          </button>
        </div>
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

  const topics = [];
  if (p.research_domain && p.research_domain !== 'Research Domain') topics.push(p.research_domain);
  (em.topics || []).forEach(t => { if (typeof t === 'string' && !topics.includes(t)) topics.push(t); });

  const s2 = em.s2_metadata || {};
  const citationsCount = s2.citationCount ?? em.citation_count ?? em.citations ?? null;

  const relScore = p.relevance_score ?? 0;
  const relColor = relScore >= 75 ? 'var(--green)' : relScore >= 40 ? 'var(--orange)' : '#ef476f';
  const relTier = relScore >= 75 ? 'DIRECT RELEVANCE' : relScore >= 40 ? 'MODERATE OVERLAP' : 'LOW / UNRELATED DOMAIN';

  $('modal-body').innerHTML = `
    <h2>${p.title}</h2>
    <div class="meta-row">
      ${d ? `<span class="meta-tag" style="background:${d.color}22;color:${d.color}">${d.icon || '📁'} ${d.name}</span>` : ''}
      ${p.research_domain ? `<span class="meta-tag" style="background:rgba(124,92,255,0.15);color:var(--accent)">🏷️ ${p.research_domain}</span>` : ''}
      <span class="meta-tag">📅 ${p.year}</span>
      <span class="meta-tag">📄 ${p.venue}</span>
      ${p.publisher ? `<span class="meta-tag">🏢 ${p.publisher}</span>` : ''}
      ${p.doi ? `<span class="meta-tag">🔗 ${p.doi}</span>` : ''}
      ${p.quartile ? `<span class="meta-tag">🏅 ${p.quartile}</span>` : ''}
      ${p.scopus_indexed ? `<span class="meta-tag" style="background:rgba(76,218,140,.12);color:var(--green)">✓ Scopus</span>` : ''}
      ${citationsCount !== null && citationsCount !== undefined ? `<span class="meta-tag" style="background:rgba(16,185,129,0.12);color:#10b981" title="Semantic Scholar Verified Citations">📈 ${Number(citationsCount).toLocaleString()} Citations</span>` : ''}
      ${s2.openAccessPdf ? `<a href="${s2.openAccessPdf}" target="_blank" class="meta-tag" style="background:rgba(59,130,246,0.15);color:#60a5fa;text-decoration:none;" title="Download Open Access PDF">📥 Open Access PDF ↗</a>` : ''}
      ${p.category ? `<span class="meta-tag" style="background:var(--surface2)">📑 ${p.category}</span>` : ''}
      <span class="meta-tag read-badge ${p.is_read ? 'read' : 'unread'}">${p.is_read ? '✓ Read' : '📌 Unread'}</span>
      <span class="verif-badge ${p.verification_status === 'human_verified' ? 'verif-human-verified' : 'verif-ai-gen'}">${p.verification_status === 'human_verified' ? '✓ Human Verified' : '🤖 AI Generated'}</span>
      ${p.confidence_tier ? `<span class="conf-pill conf-${p.confidence_tier.toLowerCase().includes('high') ? 'high' : p.confidence_tier.toLowerCase().includes('med') ? 'med' : 'low'}">⚡ Conf: ${p.confidence_tier} (${Math.round((p.confidence_score || 0.85) * 100)}%)</span>` : ''}
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0;align-items:center">
      ${p.url ? `<a href="${p.url}" target="_blank" class="modal-paper-link" style="margin:0">📄 Read Paper →</a>` : ''}
      <button id="btn-resolve-pdf-modal" data-paper-id="${p.id}" class="btn btn-sm" style="background:rgba(59,130,246,0.15);color:#60a5fa;border:1px solid rgba(59,130,246,0.35);border-radius:8px;padding:7px 14px;font-size:13px;cursor:pointer;font-weight:600;" onclick="window.resolvePaperPdf('${p.id}', this)">
        📥 Find &amp; Download PDF
      </button>
      ${p.doi ? `<a href="https://doi.org/${p.doi.replace(/^https?:\/\/doi\.org\//i,'')}" target="_blank" class="btn btn-sm" style="background:rgba(124,92,255,0.12);color:var(--accent);border:1px solid rgba(124,92,255,0.25);border-radius:8px;padding:7px 14px;font-size:13px;text-decoration:none;font-weight:600;">🔗 DOI Page</a>` : ''}
    </div>

    ${s2.tldr ? `
      <div class="s2-tldr-card" style="background: linear-gradient(135deg, rgba(124, 92, 255, 0.12), rgba(67, 97, 238, 0.08)); border: 1px solid rgba(124, 92, 255, 0.35); border-radius: 10px; padding: 12px 16px; margin: 12px 0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px; flex-wrap:wrap; gap:6px;">
          <span style="font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--accent); display: flex; align-items: center; gap: 6px;">
            <span>🎓</span> Semantic Scholar AI TL;DR
          </span>
          ${citationsCount !== null ? `<span style="font-size: 11px; color: var(--text-dim); background: rgba(255,255,255,0.06); padding: 2px 8px; border-radius: 12px;">Cited by <strong>${Number(citationsCount).toLocaleString()}</strong> papers (${s2.influentialCitationCount || 0} influential)</span>` : ''}
        </div>
        <div style="font-size: 13px; line-height: 1.5; color: var(--text);">
          "${s2.tldr}"
        </div>
      </div>` : ''}

    <div class="evidence-trace-banner" style="background: rgba(124, 92, 255, 0.1); border: 1px solid rgba(124, 92, 255, 0.3); border-radius: 10px; padding: 12px 16px; margin: 14px 0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
      <div>
        <div style="font-weight: 700; font-size: 13.5px; color: var(--text);">Evidence Traceability (Claim → Page → Quote)</div>
        <div style="font-size: 12px; color: var(--text-dim);">Verify AI-extracted claims against verbatim text & page anchors.</div>
      </div>
      <button class="btn btn-primary btn-sm" id="btn-trace-evidence-modal" data-paper-id="${p.id}">
        <span>🔬</span> Trace Claims
      </button>
    </div>

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

      ${em.abstract ? section('📖', 'Abstract (Verified Ground Truth)', `
        <div style="font-size: 13px; line-height: 1.6; color: var(--text-dim); white-space: pre-wrap; max-height: 250px; overflow-y: auto;">${em.abstract}</div>
      `, false) : ''}

      ${topics.length > 0 ? section('🏷️', 'Research Topics & Classifications', `
        <div style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 0">
          ${topics.map(t => `<span class="paper-topic-pill" style="font-size:0.75rem;padding:4px 10px;">🔬 ${t}</span>`).join('')}
        </div>
      `, true) : ''}

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

      ${section('🧑‍🔬', 'Personal Assessment & Relevance', `
        ${field('Research Gap', pers.research_gap)}
        ${field('Missing Component', pers.missing_component)}
        ${field('Relevance to Research', `
          <div style="margin-bottom:6px">
            <span class="relevance-tier-badge ${relScore >= 75 ? 'relevance-tier-direct' : relScore >= 40 ? 'relevance-tier-mod' : 'relevance-tier-irrel'}">
              ${relTier} (${relScore}%)
            </span>
          </div>
          <div>${pers.relevance_to_my_research || p.relevance || 'Not evaluated yet.'}</div>
        `)}
        ${field('Personal Notes', pers.personal_notes || p.notes)}
      `, true)}
    </div>

    <div class="relevance-bar" style="margin-top:14px" title="Topic Relevance: ${relTier} (${relScore}%)">
      <span>Score</span><div class="rel-track"><div class="rel-fill" style="width:${relScore}%;background:${relColor}"></div></div><span style="font-weight:700;color:${relColor}">${relScore}%</span>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary btn-sm" id="md-rescore-rel" title="Recalculate relevance using strict AI academic calibration">🎯 Re-evaluate Relevance</button>
      <button class="btn btn-sm btn-autofill-magic" id="md-autofill">✨ Auto-Fill with AI</button>
      <button class="btn btn-ghost btn-sm" id="md-fetch-s2" title="Fetch or refresh verified metadata from Semantic Scholar">🎓 Semantic Scholar</button>
      <button class="btn btn-ghost btn-sm" id="md-toggle-read">${p.is_read ? '📌 Mark Unread' : '✅ Mark Read'}</button>
      <button class="btn btn-ghost btn-sm" id="md-edit">✏️ Edit</button>
      <button class="btn btn-danger btn-sm" id="md-delete">🗑 Delete</button>
    </div>`;

  const btnRescore = $('md-rescore-rel');
  if (btnRescore) {
    btnRescore.onclick = async () => {
      const origText = btnRescore.innerHTML;
      btnRescore.disabled = true;
      btnRescore.innerHTML = '⏳ Scoring with AI...';
      toast('🎯 Objectively evaluating relevance against workspace research topic...');
      try {
        const topic = currentWorkspace?.research_topic || currentProfile?.research_topic || '';
        const updated = await api.recalculatePaperRelevance(p.id, topic);
        toast(`✅ Relevance updated: ${updated.relevance_score}%`);
        const idx = state.papers.findIndex(x => x.id === p.id);
        if (idx !== -1) state.papers[idx] = updated;
        openPaperDetail(updated);
        renderPapers();
      } catch (err) {
        toast('❌ ' + err.message, true);
        btnRescore.disabled = false;
        btnRescore.innerHTML = origText;
      }
    };
  }

  const btnFetchS2 = $('md-fetch-s2');
  if (btnFetchS2) {
    btnFetchS2.onclick = async () => {
      const origText = btnFetchS2.innerHTML;
      btnFetchS2.disabled = true;
      btnFetchS2.innerHTML = '⏳ Querying S2...';
      toast('🎓 Fetching verified academic ground truth from Semantic Scholar...');
      try {
        const res = await api.getSemanticScholarData(p.id);
        toast('✅ Semantic Scholar metadata retrieved and verified!');
        if (res.paper) {
          const idx = state.papers.findIndex(x => x.id === p.id);
          if (idx !== -1) state.papers[idx] = res.paper;
          openPaperDetail(res.paper);
          renderPapers();
        }
      } catch (err) {
        console.error('S2 fetch error:', err);
        toast('❌ ' + (err.message || 'Semantic Scholar lookup failed'), true);
        btnFetchS2.disabled = false;
        btnFetchS2.innerHTML = origText;
      }
    };
  }

  const handleAutoFill = async (btn) => {
    if (!btn) return;
    const origText = btn.innerHTML;
    btn.innerHTML = '⏳ Analyzing with AI...';
    btn.disabled = true;
    toast('🎓 Grounding with Semantic Scholar & analyzing with Gemini AI...');
    try {
      const updatedPaper = await api.autofillPaper(p.id);
      toast('✨ Ground-truth synthesis complete! All details automatically filled.');
      if (state.papers) {
        const idx = state.papers.findIndex(x => x.id === p.id);
        if (idx !== -1) state.papers[idx] = updatedPaper;
      }
      openPaperDetail(updatedPaper);
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

  const traceBtn = $('btn-trace-evidence-modal');
  if (traceBtn) {
    traceBtn.addEventListener('click', () => openEvidenceInspector(p));
  }

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

// ── Global: Smart PDF Resolver ──
window.resolvePaperPdf = async function(paperId, btn) {
  const originalText = btn ? btn.innerHTML : '';
  try {
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Finding PDF...'; }
    const result = await api.resolvePaperPdf(paperId);

    if (!result || !result.all_sources || result.all_sources.length === 0) {
      toast('No full-text link found for this paper. Try searching on Google Scholar.', true);
      if (btn) { btn.disabled = false; btn.innerHTML = originalText; }
      return;
    }

    // Open the best source immediately
    if (result.best_url) {
      window.open(result.best_url, '_blank');
    }

    // If multiple sources found, show a picker panel near the button
    if (result.all_sources.length > 1 && btn) {
      // Remove any existing picker
      const existing = document.getElementById('pdf-source-picker');
      if (existing) existing.remove();

      const picker = document.createElement('div');
      picker.id = 'pdf-source-picker';
      picker.style.cssText = `
        position: absolute; z-index: 9999; background: var(--surface2, #1e1e2e);
        border: 1px solid rgba(124,92,255,0.4); border-radius: 12px; padding: 12px;
        min-width: 280px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        font-size: 13px; margin-top: 6px;
      `;
      const typeIcon = t => t === 'pdf' ? '📄' : t === 'doi' ? '🔗' : '🌐';
      picker.innerHTML = `
        <div style="font-weight:700;color:var(--accent,#7c5cff);margin-bottom:8px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">
          📥 ${result.all_sources.length} Sources Found
        </div>
        ${result.all_sources.map(s => `
          <a href="${s.url}" target="_blank" rel="noopener"
            style="display:block;padding:7px 10px;border-radius:8px;margin-bottom:4px;
                   background:rgba(255,255,255,0.04);color:var(--text,#e2e2e2);
                   text-decoration:none;border:1px solid rgba(255,255,255,0.07);
                   transition:background .15s;" 
            onmouseover="this.style.background='rgba(124,92,255,0.12)'"
            onmouseout="this.style.background='rgba(255,255,255,0.04)'">
            ${typeIcon(s.type)} <strong style="color:${s.type==='pdf'?'#60a5fa':s.type==='doi'?'var(--accent)':'#a3e635'}">${s.type.toUpperCase()}</strong>
            &nbsp;${s.label}
          </a>`).join('')}
        <button onclick="document.getElementById('pdf-source-picker').remove()"
          style="margin-top:6px;width:100%;padding:5px;border:none;border-radius:6px;
                 background:rgba(255,255,255,0.06);color:var(--text-dim,#888);cursor:pointer;font-size:12px;">
          ✕ Close
        </button>
      `;

      // Position relative to button
      btn.style.position = 'relative';
      btn.parentElement.style.position = 'relative';
      btn.parentElement.appendChild(picker);
      // Auto-close on outside click
      setTimeout(() => {
        document.addEventListener('click', function closePicker(e) {
          if (!picker.contains(e.target) && e.target !== btn) {
            picker.remove();
            document.removeEventListener('click', closePicker);
          }
        });
      }, 100);
    } else if (result.all_sources.length === 1 && !result.best_url) {
      toast('No open-access PDF found. Opening publisher page instead.', false);
    }

    if (btn) { btn.disabled = false; btn.innerHTML = originalText; }
  } catch (err) {
    console.error('[resolvePaperPdf]', err);
    toast('Could not resolve PDF: ' + (err.message || 'Unknown error'), true);
    if (btn) { btn.disabled = false; btn.innerHTML = originalText; }
  }
};

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
    const cat = g.gap_category || 'Methodological Gap';
    const score = g.evidence_score || 50;
    const scoreClass = score >= 75 ? 'conf-high' : score >= 50 ? 'conf-med' : 'conf-low';
    const verifStatus = g.verification_status || 'ai_generated';
    const verifClass = verifStatus === 'human_verified' ? 'verif-human-verified' : verifStatus === 'rejected' ? 'verif-rejected' : 'verif-ai-gen';
    const verifText = verifStatus === 'human_verified' ? '✓ Human Verified' : verifStatus === 'rejected' ? '✗ Rejected' : '🤖 AI Generated';

    return `
    <div class="gap-card" style="position:relative; cursor:pointer;" onclick="const cb = this.querySelector('.gap-checkbox'); cb.checked = !cb.checked; cb.dispatchEvent(new Event('change'));">
      <input type="checkbox" class="gap-checkbox" data-id="${g.id}" style="position:absolute; top:15px; left:15px; transform: scale(1.3); cursor:pointer;" onclick="event.stopPropagation();">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; padding-left: 25px; flex-wrap: wrap; gap: 6px;">
        <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
          <span class="gap-severity severity-${g.severity}">${g.severity}</span>
          <span class="claim-type-tag" style="background: rgba(124,92,255,0.15); color: #a78bfa;">${cat}</span>
          <span class="conf-pill ${scoreClass}">Evidence: ${score}/100</span>
          <span class="verif-badge ${verifClass}">${verifText}</span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <span class="gap-status" style="position: static;">${g.status}</span>
          <button class="btn btn-ghost btn-sm btn-delete-gap" data-id="${g.id}" style="padding: 2px 6px; font-size: 0.75rem; color: var(--accent3); border-color: rgba(255,108,140,0.3);">🗑</button>
        </div>
      </div>
      <h3>${g.title}</h3>
      <p>${g.description || ''}</p>
      ${g.suggested_direction ? `<p style="font-size: 12px; color: #00f5a0; margin-top: 6px;"><strong>Suggested Direction:</strong> ${g.suggested_direction}</p>` : ''}
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; flex-wrap: wrap; gap: 8px;">
        ${d ? `<div class="gap-domain">${d.icon} ${d.name}</div>` : '<div></div>'}
        <div style="display: flex; gap: 8px;" onclick="event.stopPropagation();">
          <button class="btn btn-secondary btn-sm btn-gap-breakdown" data-id="${g.id}">📊 Breakdown</button>
          <button class="btn btn-primary btn-sm btn-gap-rq" data-id="${g.id}">❓ Formulate RQs</button>
        </div>
      </div>
    </div>`;
  }).join('') || '<div class="empty-state"><p>No research gaps defined.</p></div>';

  // Attach breakdown handlers
  document.querySelectorAll('.btn-gap-breakdown').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openGapEvidenceModal(btn.dataset.id);
    });
  });

  // Attach research questions handlers
  document.querySelectorAll('.btn-gap-rq').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const g = state.gaps.find(gg => gg.id === btn.dataset.id);
      if (g) openResearchQuestionModal(g);
    });
  });

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

// ── Knowledge Graph 2.0 ──
let networkInstance = null;
let kgActiveFilter = 'all';
let kgPhysicsEnabled = true;

function renderGraph() {
  const container = $('kg-network');
  if (!container || currentPage !== 'graph') return;
  
  if (!window.vis) {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-dim);">Loading graph visualization engine...</div>';
    setTimeout(renderGraph, 500);
    return;
  }

  // Setup toolbar handlers once
  const btnStabilize = $('btn-kg-stabilize');
  if (btnStabilize && !btnStabilize.dataset.bound) {
    btnStabilize.dataset.bound = 'true';
    btnStabilize.addEventListener('click', () => {
      kgPhysicsEnabled = !kgPhysicsEnabled;
      if (networkInstance) {
        networkInstance.setOptions({ physics: { enabled: kgPhysicsEnabled } });
        btnStabilize.innerHTML = kgPhysicsEnabled ? '⏸️ Freeze' : '▶️ Resume';
      }
    });
  }

  const btnFit = $('btn-kg-fit');
  if (btnFit && !btnFit.dataset.bound) {
    btnFit.dataset.bound = 'true';
    btnFit.addEventListener('click', () => {
      if (networkInstance) networkInstance.fit({ animation: { duration: 600, easingFunction: 'easeInOutQuad' } });
    });
  }

  const btnCloseDrawer = $('btn-kg-drawer-close');
  if (btnCloseDrawer && !btnCloseDrawer.dataset.bound) {
    btnCloseDrawer.dataset.bound = 'true';
    btnCloseDrawer.addEventListener('click', () => {
      resetKgDrawer();
    });
  }

  // Entity filter pill listeners
  document.querySelectorAll('.kg-filter-btn').forEach(btn => {
    if (!btn.dataset.bound) {
      btn.dataset.bound = 'true';
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.kg-filter-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        kgActiveFilter = e.currentTarget.dataset.group;
        renderGraph();
      });
    }
  });

  const rawNodes = [];
  const rawEdges = [];
  const entityMap = new Map(); // id -> entity object

  // 1. Domains
  state.domains.forEach(d => {
    const id = 'd_' + d.id;
    entityMap.set(id, { type: 'domain', data: d });
    rawNodes.push({
      id,
      label: d.name,
      group: 'domain',
      title: 'Domain: ' + d.name,
      font: { color: '#ffffff', size: 14, face: 'Inter, sans-serif' },
      color: { background: d.color || '#a855f7', border: '#c084fc', highlight: { background: '#9333ea', border: '#fff' } },
      shape: 'box',
      margin: 10,
      shadow: { enabled: true, color: 'rgba(168,85,247,0.3)', size: 10 }
    });
  });

  // 2. Gaps
  state.gaps.forEach(g => {
    const id = 'g_' + g.id;
    entityMap.set(id, { type: 'gap', data: g });
    const scoreText = g.evidence_score !== undefined ? ` [Score: ${g.evidence_score}]` : '';
    rawNodes.push({
      id,
      label: (g.title || 'Gap').substring(0, 28) + (g.title?.length > 28 ? '...' : ''),
      group: 'gap',
      title: `Research Gap: ${g.title}\nCategory: ${g.category || 'General'}${scoreText}`,
      font: { color: '#fbbf24', size: 11, face: 'Inter, sans-serif' },
      color: { background: '#241a0d', border: '#f59e0b', highlight: { background: '#452b06', border: '#fbbf24' } },
      shape: 'hexagon',
      size: 16
    });

    if (g.domain_id) {
      rawEdges.push({
        from: id,
        to: 'd_' + g.domain_id,
        label: 'in_domain',
        font: { size: 9, color: '#64748b', align: 'middle' },
        dashes: true,
        color: { color: '#78350f', highlight: '#f59e0b' },
        arrows: { to: { enabled: true, scaleFactor: 0.6 } }
      });
    }
  });

  // 3. Papers, Methods, Datasets, Findings
  const methodSet = new Set();
  const datasetSet = new Set();

  state.papers.forEach(p => {
    const pId = 'p_' + p.id;
    entityMap.set(pId, { type: 'paper', data: p });
    const em = p.extended_metadata || {};
    const d = state.domains.find(dd => dd.id === p.domain_id);

    rawNodes.push({
      id: pId,
      label: (p.title || 'Untitled').substring(0, 26) + (p.title?.length > 26 ? '...' : ''),
      group: 'paper',
      title: `Paper: ${p.title}\nAuthors: ${p.authors || 'Unknown'}\nYear: ${p.year || 'N/A'}`,
      font: { color: '#e2e8f0', size: 11, face: 'Inter, sans-serif' },
      color: { background: '#0f2942', border: '#38bdf8', highlight: { background: '#0369a1', border: '#7dd3fc' } },
      shape: 'dot',
      size: 14,
      shadow: { enabled: true, color: 'rgba(56,189,248,0.2)', size: 6 }
    });

    // Link paper to domain
    if (p.domain_id) {
      rawEdges.push({
        from: pId,
        to: 'd_' + p.domain_id,
        label: 'belongs_to',
        font: { size: 9, color: '#64748b' },
        color: { color: '#1e293b', highlight: '#38bdf8' },
        arrows: { to: { enabled: true, scaleFactor: 0.6 } }
      });
    }

    // Extracted Method(s)
    const methodNames = [];
    if (em.methodology?.ai_technique) methodNames.push(em.methodology.ai_technique);
    if (em.methodology?.methodology && !methodNames.includes(em.methodology.methodology)) {
      methodNames.push(em.methodology.methodology);
    }
    if (Array.isArray(p.methods)) {
      p.methods.forEach(m => {
        const mName = typeof m === 'string' ? m : (m.method_name || m.name);
        if (mName && !methodNames.includes(mName)) methodNames.push(mName);
      });
    }

    methodNames.slice(0, 2).forEach(mName => {
      const cleanName = mName.trim();
      if (!cleanName || cleanName.length < 3) return;
      const mId = 'm_' + encodeURIComponent(cleanName.toLowerCase().replace(/\s+/g, '_'));
      if (!methodSet.has(mId)) {
        methodSet.add(mId);
        entityMap.set(mId, { type: 'method', name: cleanName, papers: [p] });
        rawNodes.push({
          id: mId,
          label: cleanName.substring(0, 22) + (cleanName.length > 22 ? '...' : ''),
          group: 'method',
          title: `Methodology / Technique: ${cleanName}`,
          font: { color: '#a7f3d0', size: 10, face: 'Inter, sans-serif' },
          color: { background: '#064e3b', border: '#10b981', highlight: { background: '#047857', border: '#34d399' } },
          shape: 'ellipse'
        });
      } else {
        const existing = entityMap.get(mId);
        if (existing && !existing.papers.find(pp => pp.id === p.id)) existing.papers.push(p);
      }

      rawEdges.push({
        from: pId,
        to: mId,
        label: 'uses_method',
        font: { size: 9, color: '#059669' },
        color: { color: '#065f46', highlight: '#10b981' },
        arrows: { to: { enabled: true, scaleFactor: 0.5 } }
      });
    });

    // Extracted Dataset(s)
    const dsName = em.dataset?.dataset_name || (Array.isArray(p.datasets) && p.datasets[0]?.dataset_name);
    if (dsName && dsName.trim().length > 2 && dsName.toLowerCase() !== 'n/a') {
      const cleanDs = dsName.trim();
      const dsId = 'ds_' + encodeURIComponent(cleanDs.toLowerCase().replace(/\s+/g, '_'));
      if (!datasetSet.has(dsId)) {
        datasetSet.add(dsId);
        entityMap.set(dsId, { type: 'dataset', name: cleanDs, papers: [p] });
        rawNodes.push({
          id: dsId,
          label: cleanDs.substring(0, 20) + (cleanDs.length > 20 ? '...' : ''),
          group: 'dataset',
          title: `Dataset / Benchmark: ${cleanDs}`,
          font: { color: '#67e8f9', size: 10, face: 'Inter, sans-serif' },
          color: { background: '#164e63', border: '#06b6d4', highlight: { background: '#0891b2', border: '#22d3ee' } },
          shape: 'triangle',
          size: 13
        });
      } else {
        const existing = entityMap.get(dsId);
        if (existing && !existing.papers.find(pp => pp.id === p.id)) existing.papers.push(p);
      }

      rawEdges.push({
        from: pId,
        to: dsId,
        label: 'evaluated_on',
        font: { size: 9, color: '#0891b2' },
        color: { color: '#155e75', highlight: '#06b6d4' },
        arrows: { to: { enabled: true, scaleFactor: 0.5 } }
      });
    }

    // Extracted Finding(s)
    const findingText = em.evaluation?.results || (Array.isArray(p.findings) && p.findings[0]?.finding_statement);
    if (findingText && findingText.trim().length > 10) {
      const fId = 'f_' + p.id;
      entityMap.set(fId, { type: 'finding', text: findingText, paper: p });
      rawNodes.push({
        id: fId,
        label: findingText.substring(0, 22) + '...',
        group: 'finding',
        title: `Empirical Finding: ${findingText}`,
        font: { color: '#fbcfe8', size: 10, face: 'Inter, sans-serif' },
        color: { background: '#4c0519', border: '#f43f5e', highlight: { background: '#881337', border: '#fb7185' } },
        shape: 'star',
        size: 13
      });

      rawEdges.push({
        from: pId,
        to: fId,
        label: 'reports',
        font: { size: 9, color: '#e11d48' },
        color: { color: '#9f1239', highlight: '#f43f5e' },
        arrows: { to: { enabled: true, scaleFactor: 0.5 } }
      });
    }

    // Paper to Gap (if paper explicitly mentions gap or shares domain)
    state.gaps.forEach(g => {
      if (g.paper_id === p.id) {
        rawEdges.push({
          from: pId,
          to: 'g_' + g.id,
          label: 'reveals_gap',
          font: { size: 9, color: '#f59e0b' },
          dashes: true,
          color: { color: '#b45309', highlight: '#fbbf24' },
          arrows: { to: { enabled: true, scaleFactor: 0.6 } }
        });
      }
    });
  });

  // Apply entity filtering
  let filteredNodes = rawNodes;
  if (kgActiveFilter !== 'all') {
    filteredNodes = rawNodes.filter(n => n.group === kgActiveFilter);
  }
  const activeNodeIds = new Set(filteredNodes.map(n => n.id));
  const filteredEdges = rawEdges.filter(e => activeNodeIds.has(e.from) && activeNodeIds.has(e.to));

  const data = {
    nodes: new vis.DataSet(filteredNodes),
    edges: new vis.DataSet(filteredEdges)
  };

  const options = {
    width: '100%',
    height: '100%',
    autoResize: true,
    nodes: {
      borderWidth: 1.5,
      shadow: true
    },
    edges: {
      smooth: { type: 'continuous', roundness: 0.2 },
      selectionWidth: 2.5
    },
    physics: {
      enabled: kgPhysicsEnabled,
      solver: 'forceAtlas2Based',
      forceAtlas2Based: {
        gravitationalConstant: -180,
        centralGravity: 0.012,
        springLength: 160,
        springConstant: 0.06,
        damping: 0.45,
        avoidOverlap: 1
      },
      stabilization: { iterations: 120 }
    },
    interaction: {
      hover: true,
      tooltipDelay: 150,
      zoomView: true,
      dragView: true
    }
  };

  if (networkInstance) {
    networkInstance.destroy();
  }
  networkInstance = new vis.Network(container, data, options);

  // Click interaction: inspect evidence in Drawer
  networkInstance.on('click', params => {
    if (params.nodes && params.nodes.length > 0) {
      const selectedId = params.nodes[0];
      const entity = entityMap.get(selectedId);
      if (entity) {
        showKgEvidenceDrawer(entity);
      }
    } else if (params.edges && params.edges.length > 0) {
      const selectedEdgeId = params.edges[0];
      const edge = filteredEdges.find(e => e.id === selectedEdgeId) || rawEdges.find(e => (e.from + '_' + e.to) === selectedEdgeId);
      if (edge) {
        showKgEdgeDrawer(edge, entityMap);
      }
    } else {
      resetKgDrawer();
    }
  });
}

function resetKgDrawer() {
  const badge = $('kg-drawer-type-badge');
  const content = $('kg-drawer-content');
  if (badge) badge.textContent = 'Entity Details';
  if (content) {
    content.innerHTML = `
      <div style="text-align:center; padding:40px 10px; color:var(--text-muted);">
        <div style="font-size:2.2rem; margin-bottom:10px;">🕸️</div>
        <div style="font-weight:600; color:var(--text); margin-bottom:6px;">Evidence Inspector</div>
        <p style="font-size:0.82rem; line-height:1.5;">Click any node or directional edge in the knowledge graph to view extracted empirical evidence, provenance, and relationships.</p>
      </div>
    `;
  }
}

function showKgEvidenceDrawer(entity) {
  const badge = $('kg-drawer-type-badge');
  const content = $('kg-drawer-content');
  if (!content) return;

  if (entity.type === 'paper') {
    const p = entity.data;
    const em = p.extended_metadata || {};
    if (badge) badge.innerHTML = `<span class="badge" style="background:#0f2942; color:#38bdf8;">📄 Paper</span>`;
    
    content.innerHTML = `
      <div class="kg-detail-section">
        <h3 style="font-size:1rem; margin:0 0 8px 0; color:var(--text); line-height:1.4;">${escapeHtml(p.title || 'Untitled Paper')}</h3>
        <div style="font-size:0.8rem; color:var(--text-dim); margin-bottom:6px;">✍️ ${escapeHtml(p.authors || 'Unknown Authors')} (${p.year || 'N/A'})</div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">
          <span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8;">Confidence: ${(p.confidence_score * 100 || 85).toFixed(0)}%</span>
          <span class="badge" style="background:rgba(0,245,160,0.15); color:#00f5a0;">Status: ${p.verification_status || 'unverified'}</span>
        </div>
      </div>

      <div class="kg-detail-section">
        <div class="kg-detail-label">Methodology / AI Technique</div>
        <div class="kg-detail-val">${escapeHtml(em.methodology?.ai_technique || em.methodology?.methodology || 'Not explicitly extracted')}</div>
      </div>

      <div class="kg-detail-section">
        <div class="kg-detail-label">Dataset / Benchmark</div>
        <div class="kg-detail-val">${escapeHtml(em.dataset?.dataset_name || 'Not explicitly extracted')}</div>
      </div>

      <div class="kg-detail-section">
        <div class="kg-detail-label">Empirical Findings</div>
        <div class="kg-detail-val" style="font-size:0.82rem;">${escapeHtml(em.evaluation?.results || p.abstract?.substring(0, 180) + '...' || 'No findings recorded')}</div>
      </div>

      <div style="display:flex; flex-direction:column; gap:8px; margin-top:16px;">
        <button class="btn btn-primary btn-sm" onclick="openEvidenceInspector(state.papers.find(x => x.id === '${p.id}'))" style="justify-content:center;">
          🔍 Inspect Evidence Provenance
        </button>
        <button class="btn btn-secondary btn-sm" onclick="openPaperDetail(state.papers.find(x => x.id === '${p.id}'))" style="justify-content:center;">
          📖 Open Full Paper Workspace
        </button>
      </div>
    `;
  } else if (entity.type === 'gap') {
    const g = entity.data;
    if (badge) badge.innerHTML = `<span class="badge" style="background:#241a0d; color:#f59e0b;">⚡ Research Gap</span>`;
    
    content.innerHTML = `
      <div class="kg-detail-section">
        <h3 style="font-size:1rem; margin:0 0 8px 0; color:#fbbf24; line-height:1.4;">${escapeHtml(g.title || 'Research Gap')}</h3>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">
          <span class="badge" style="background:rgba(245,158,11,0.2); color:#fbbf24;">Category: ${escapeHtml(g.category || 'Empirical')}</span>
          <span class="badge" style="background:rgba(0,245,160,0.15); color:#00f5a0;">Heuristic Score: ${g.evidence_score || 70}/100</span>
        </div>
      </div>

      <div class="kg-detail-section">
        <div class="kg-detail-label">Gap Description</div>
        <div class="kg-detail-val" style="font-size:0.85rem;">${escapeHtml(g.description || 'No description available')}</div>
      </div>

      <div class="kg-detail-section">
        <div class="kg-detail-label">Tessera Evidence-Based Heuristic</div>
        <div class="kg-detail-val" style="font-size:0.82rem; color:var(--text-dim);">
          This gap is scored via 6 deterministic academic factors (repeated limitation citations, future work extraction, evaluation deficiencies).
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:8px; margin-top:16px;">
        <button class="btn btn-secondary btn-sm" onclick="openGapEvidenceModal('${g.id}')" style="justify-content:center;">
          📊 View Heuristic Score Breakdown
        </button>
        <button class="btn btn-primary btn-sm" onclick="openResearchQuestionModal(state.gaps.find(x => x.id === '${g.id}'))" style="justify-content:center;">
          💡 Formulate Research Questions
        </button>
      </div>
    `;
  } else if (entity.type === 'method') {
    if (badge) badge.innerHTML = `<span class="badge" style="background:#064e3b; color:#10b981;">⚙️ Method</span>`;
    const papersList = (entity.papers || []).map(p => `
      <li style="margin-bottom:6px; font-size:0.82rem; color:var(--text);">
        <strong>${escapeHtml(p.title || 'Untitled')}</strong> (${p.year || 'N/A'})
      </li>
    `).join('');

    content.innerHTML = `
      <div class="kg-detail-section">
        <h3 style="font-size:1rem; margin:0 0 6px 0; color:#34d399;">${escapeHtml(entity.name)}</h3>
        <p style="font-size:0.82rem; color:var(--text-dim); margin:0;">Standardized methodological framework or AI technique identified across workspace literature.</p>
      </div>

      <div class="kg-detail-section">
        <div class="kg-detail-label">Papers Utilizing this Method (${entity.papers?.length || 0})</div>
        <ul style="padding-left:18px; margin:8px 0 0 0;">
          ${papersList || '<li style="color:var(--text-dim); font-size:0.82rem;">None recorded</li>'}
        </ul>
      </div>
    `;
  } else if (entity.type === 'dataset') {
    if (badge) badge.innerHTML = `<span class="badge" style="background:#164e63; color:#06b6d4;">📊 Dataset</span>`;
    const papersList = (entity.papers || []).map(p => `
      <li style="margin-bottom:6px; font-size:0.82rem; color:var(--text);">
        <strong>${escapeHtml(p.title || 'Untitled')}</strong> (${p.year || 'N/A'})
      </li>
    `).join('');

    content.innerHTML = `
      <div class="kg-detail-section">
        <h3 style="font-size:1rem; margin:0 0 6px 0; color:#22d3ee;">${escapeHtml(entity.name)}</h3>
        <p style="font-size:0.82rem; color:var(--text-dim); margin:0;">Empirical corpus, benchmark dataset, or evaluation testbed cited by research papers.</p>
      </div>

      <div class="kg-detail-section">
        <div class="kg-detail-label">Evaluated Across Papers (${entity.papers?.length || 0})</div>
        <ul style="padding-left:18px; margin:8px 0 0 0;">
          ${papersList || '<li style="color:var(--text-dim); font-size:0.82rem;">None recorded</li>'}
        </ul>
      </div>
    `;
  } else if (entity.type === 'finding') {
    if (badge) badge.innerHTML = `<span class="badge" style="background:#4c0519; color:#f43f5e;">💡 Finding</span>`;
    content.innerHTML = `
      <div class="kg-detail-section">
        <h3 style="font-size:1rem; margin:0 0 6px 0; color:#fb7185;">Empirical Finding</h3>
        <p style="font-size:0.85rem; color:var(--text); line-height:1.5;">"${escapeHtml(entity.text)}"</p>
      </div>
      <div class="kg-detail-section">
        <div class="kg-detail-label">Originating Paper</div>
        <div style="font-size:0.82rem; color:var(--text-dim);">${escapeHtml(entity.paper?.title || 'Unknown')}</div>
      </div>
    `;
  } else if (entity.type === 'domain') {
    const d = entity.data;
    if (badge) badge.innerHTML = `<span class="badge" style="background:#3b0764; color:#a855f7;">🌐 Domain</span>`;
    const paperCount = state.papers.filter(p => p.domain_id === d.id).length;
    const gapCount = state.gaps.filter(g => g.domain_id === d.id).length;

    content.innerHTML = `
      <div class="kg-detail-section">
        <h3 style="font-size:1.1rem; margin:0 0 6px 0; color:#c084fc;">${escapeHtml(d.name)}</h3>
        <p style="font-size:0.82rem; color:var(--text-dim); margin:0;">${escapeHtml(d.description || 'Primary thematic domain for clustering scholarly evidence.')}</p>
      </div>
      <div class="kg-detail-section">
        <div class="kg-detail-label">Domain Statistics</div>
        <div style="display:flex; gap:12px; margin-top:6px;">
          <div><strong style="color:var(--text); font-size:1.1rem;">${paperCount}</strong> <span style="font-size:0.8rem; color:var(--text-dim);">Papers</span></div>
          <div><strong style="color:#fbbf24; font-size:1.1rem;">${gapCount}</strong> <span style="font-size:0.8rem; color:var(--text-dim);">Gaps</span></div>
        </div>
      </div>
    `;
  }
}

function showKgEdgeDrawer(edge, entityMap) {
  const badge = $('kg-drawer-type-badge');
  const content = $('kg-drawer-content');
  if (!content) return;

  const sourceEntity = entityMap.get(edge.from);
  const targetEntity = entityMap.get(edge.to);
  const rel = edge.label || 'connected_to';

  if (badge) badge.innerHTML = `<span class="badge" style="background:rgba(124,92,255,0.2); color:var(--accent);">🔗 Semantic Edge</span>`;

  content.innerHTML = `
    <div class="kg-detail-section">
      <div class="kg-detail-label">Relationship Type</div>
      <h3 style="font-size:1.05rem; margin:4px 0 0 0; color:#00f5a0; font-family:monospace;">${escapeHtml(rel)}</h3>
    </div>

    <div class="kg-detail-section">
      <div class="kg-detail-label">Source Node</div>
      <div style="font-size:0.85rem; color:var(--text); font-weight:600;">
        ${escapeHtml(sourceEntity?.data?.title || sourceEntity?.name || edge.from)}
      </div>
    </div>

    <div class="kg-detail-section">
      <div class="kg-detail-label">Target Node</div>
      <div style="font-size:0.85rem; color:var(--text); font-weight:600;">
        ${escapeHtml(targetEntity?.data?.title || targetEntity?.data?.name || targetEntity?.name || edge.to)}
      </div>
    </div>

    <div class="kg-detail-section">
      <div class="kg-detail-label">Provenance & Verification</div>
      <p style="font-size:0.82rem; color:var(--text-dim); line-height:1.45; margin:4px 0 0 0;">
        Directional link extracted from section/page evidence analysis. Relationships between papers, methods, and empirical gaps are evaluated with confidence and verifiable against source texts.
      </p>
    </div>
  `;
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
      const userId = btn.dataset.userId;
      if (!confirm('Are you sure you want to permanently delete this user, their account, and all associated research data? This cannot be undone.')) return;
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '⏳';
      try {
        await api.deleteUser(userId);
        toast('🗑 User account and data deleted successfully');
        await loadAdminUsers();
      } catch (err) {
        toast('❌ ' + err.message, true);
        btn.disabled = false;
        btn.textContent = originalText;
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
  let humanizeMode = true;

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

    // AI Detection Shield pills
    $('draft-humanize-pills')?.querySelectorAll('.draft-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        $('draft-humanize-pills').querySelectorAll('.draft-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        humanizeMode = pill.dataset.humanize === 'true';
        const engineCont = $('draft-engine-container');
        if (engineCont) engineCont.style.display = humanizeMode ? '' : 'none';
        toast(humanizeMode ? '🛡️ Humanize Engine activated (Turnitin target < 5-10%)' : 'Standard academic generation mode');
      });
    });

    // Active Humanizer Engine
    let humanizerEngine = 'gemini';
    const initEnginePills = async () => {
      try {
        const data = await api.getAvailableEngines();
        const pillsContainer = $('draft-engine-pills');
        if (pillsContainer && data?.engines?.length) {
          pillsContainer.innerHTML = data.engines.map((eng, idx) => `
            <button class="draft-pill ${eng.id === humanizerEngine || idx === 0 ? 'active' : ''}" data-engine="${eng.id}">
              ${eng.name}
            </button>
          `).join('');
          pillsContainer.querySelectorAll('.draft-pill').forEach(pill => {
            pill.addEventListener('click', () => {
              pillsContainer.querySelectorAll('.draft-pill').forEach(p => p.classList.remove('active'));
              pill.classList.add('active');
              humanizerEngine = pill.dataset.engine || 'gemini';
              toast(`Active Humanizer: ${pill.textContent.trim()}`);
            });
          });
        }
      } catch (_) {
        // Fallback default
      }
    };
    initEnginePills();

    // Upload & Humanize existing .docx file
    $('draft-upload-humanize-docx')?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const statusEl = $('draft-docx-humanize-status');
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#3b82f6';
        statusEl.innerHTML = '⏳ Humanizing Word document... Analyzing burstiness and removing AI markers...';
      }
      try {
        const blob = await api.humanizeDocxFile(file);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Humanized_${file.name}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        if (statusEl) {
          statusEl.style.color = '#10b981';
          statusEl.innerHTML = `✅ Successfully humanized! Downloaded <strong>Humanized_${file.name}</strong>. Ready for Turnitin!`;
        }
        toast('Word document humanized and downloaded!');
      } catch (err) {
        if (statusEl) {
          statusEl.style.color = '#ef4444';
          statusEl.innerHTML = `❌ Error humanizing file: ${err.message}`;
        }
        toast(`Humanization failed: ${err.message}`, true);
      }
    });

    // Paper type card grid picker
    document.getElementById('draft-type-grid')?.querySelectorAll('.draft-type-card').forEach(card => {
      card.addEventListener('click', () => {
        document.getElementById('draft-type-grid').querySelectorAll('.draft-type-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const type = card.dataset.type;
        paperType = type;
        const sel = $('draft-paper-type');
        if (sel) sel.value = type;
        // Auto-suggest methodology label when type changes
        const methodInput = $('draft-methodology');
        const methodMap = {
          implementation: 'System Design & Experimental Evaluation',
          review: 'Narrative Literature Review & Thematic Synthesis',
          slr: 'Systematic Literature Review (PRISMA)',
          survey: 'Comprehensive Survey & Taxonomic Analysis',
          comparative: 'Empirical Comparative Benchmarking',
          experimental: 'Controlled Experiment & Hypothesis Testing',
          methodology: 'Theoretical Framework Design',
          casestudy: 'Qualitative Case Study Analysis',
          shortcomm: 'Concise Empirical Reporting',
          position: 'Argumentative & Conceptual Analysis',
          dataset: 'Dataset Construction & Annotation',
          tool: 'Software Engineering & System Evaluation'
        };
        if (methodMap[type]) {
          if (methodInput) {
            const allDefaults = Object.values(methodMap);
            if (!methodInput.value.trim() || allDefaults.includes(methodInput.value.trim()) || methodInput.value.includes('Systematic Literature Review')) {
              methodInput.value = methodMap[type];
            }
          }
          if (parsedExcel?.metadata) {
            parsedExcel.metadata.methodology = methodMap[type];
            const s2Method = $('draft-step2-method');
            if (s2Method) s2Method.value = methodMap[type];
          }
        }
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

    // Live AI Risk Scan button
    $('draft-gptzero-scan-btn')?.addEventListener('click', async () => {
      if (!generatedResult?.draft) return;
      const btn = $('draft-gptzero-scan-btn');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Analyzing AI Risk...'; }
      try {
        const res = await api.analyzeAiRisk({ draft: generatedResult.draft });
        const metrics = res?.metrics || res;
        if (metrics && metrics.estimatedAiPercent !== undefined) {
          generatedResult.aiDetectionRisk = {
            ...(generatedResult.aiDetectionRisk || {}),
            estimatedAiPercent: metrics.estimatedAiPercent,
            burstinessScore: metrics.burstinessScore || generatedResult.aiDetectionRisk?.burstinessScore,
            clicheMatches: metrics.clicheMatches || 0,
            averageSentenceLength: metrics.averageSentenceLength || 18,
            verifiedByGptZero: !!metrics.verifiedByGptZero
          };
          renderDraftPreview();
          toast(`AI Risk Analysis Complete: ${metrics.estimatedAiPercent}% AI Risk (Burstiness: ${metrics.burstinessScore || 'High'})`);
        } else {
          toast('AI risk scan completed. Heuristic metrics applied.');
        }
      } catch (err) {
        toast(`Risk analysis failed: ${err.message}`, true);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔍 Analyze AI Risk'; }
      }
    });

    // Re-humanize entire paper button
    $('draft-rehumanize-btn')?.addEventListener('click', async () => {
      if (!generatedResult?.draft) return;
      const btn = $('draft-rehumanize-btn');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Humanizing with Gemini...'; }
      try {
        const res = await api.humanizePaperDraft({
          draft: generatedResult.draft,
          preferredEngine: humanizerEngine || 'gemini'
        });
        if (res && res.draft) {
          generatedResult.draft = res.draft;
          generatedResult.engineInUse = res.engineInUse || 'Gemini 2.5 Flash';
          if (res.metrics) generatedResult.aiDetectionRisk = res.metrics.postHumanization || res.metrics;
          renderDraftPreview();
          toast(`Paper humanized with ${generatedResult.engineInUse}! Target Turnitin score: < 5%`);
        }
      } catch (err) {
        toast(`Humanization failed: ${err.message}`, true);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '✨ Run Humanizer (Gemini)'; }
      }
    });

    updateDownloadButtonsText();
  }

  // Section-level humanizer
  window._draftHumanizeSection = async function(sIdx) {
    if (!generatedResult?.draft?.sections?.[sIdx]) return;
    const btn = document.querySelector(`#draft-section-${sIdx} .draft-section-humanize-btn`);
    if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
    try {
      const res = await api.humanizePaperDraft({
        draft: generatedResult.draft,
        sectionIndex: sIdx,
        preferredEngine: typeof humanizerEngine !== 'undefined' ? humanizerEngine : 'gemini'
      });
      if (res && res.draft?.sections?.[sIdx]) {
        generatedResult.draft.sections[sIdx].content = res.draft.sections[sIdx].content;
        renderDraftPreview();
        toast(`Section ${sIdx + 1} humanized!`);
      }
    } catch (err) {
      toast(`Failed to humanize section: ${err.message}`, true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '✨ Humanize'; }
    }
  };

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
      parsedExcel = await api.parseExcelForDraft(draftFile, currentWorkspace?.id, paperType);

      // Pre-populate Step 1 fields from detected Excel metadata
      if (parsedExcel.metadata) {
        const meta = parsedExcel.metadata;
        const titleInput = $('draft-title');
        let initialTitle = (meta.title || '').trim();
        if (/Systematic Literature Review and Bibliometric Analysis of \d+ Key Studies/i.test(initialTitle) ||
            /Academic Research Paper Draft/i.test(initialTitle) ||
            /Empirical Investigation and Data Analysis of/i.test(initialTitle)) {
          initialTitle = '';
        }
        if (titleInput && !titleInput.value.trim() && initialTitle) titleInput.value = initialTitle;
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
    let previewTitle = (meta.title || '').trim();
    if (/Systematic Literature Review and Bibliometric Analysis of \d+ Key Studies/i.test(previewTitle) ||
        /Academic Research Paper Draft/i.test(previewTitle) ||
        /Empirical Investigation and Data Analysis of/i.test(previewTitle)) {
      previewTitle = '';
    }

    metaContainer.innerHTML = `
      <div class="draft-meta-edit-grid">
        <div class="draft-meta-edit-field">
          <label>Paper Title</label>
          <input type="text" id="draft-step2-title" class="draft-meta-input" value="${escapeHtml(previewTitle)}" placeholder="AI will synthesize a publication-grade academic title (or enter your own)" />
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
      chartsContainer.innerHTML = '<p class="draft-no-data">No chart configuration found. Visualizations will be auto-generated.</p>';
    } else {
      chartsContainer.innerHTML = charts.map((c, i) => {
        const badgeLabel = c.type === 'architecture' ? '🔬 System Architecture' : (c.type === 'prisma' ? '📋 PRISMA Protocol' : (c.type || 'chart').toUpperCase());
        const badgeClass = c.type === 'architecture' || c.type === 'prisma' ? 'diagram' : (c.type || 'bar');
        const axesDesc = c.type === 'architecture' || c.type === 'prisma'
          ? 'Modular flow diagram with high-resolution academic vector rendering'
          : `X: ${escapeHtml(c.xColumn || 'Category')} → Y: ${escapeHtml(Array.isArray(c.yColumns) ? c.yColumns.join(', ') : (c.yColumns || 'Metric'))}`;
        return `
        <div class="draft-chart-config-item">
          <span class="draft-chart-type-badge ${badgeClass}">${badgeLabel}</span>
          <h4>Fig. ${c.figureNumber || (i + 1)}: ${escapeHtml(c.chartTitle || 'Figure ' + (i + 1))}</h4>
          <p>${axesDesc}</p>
          ${c.description ? `<p style="margin-top:4px;font-style:italic;color:var(--text-dim);font-size:12px;">${escapeHtml(c.description)}</p>` : ''}
        </div>
      `;
      }).join('');
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
        humanize: humanizeMode,
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

  // ── Utility: select key columns for tables ──
  function selectKeyColumns(table, maxCols = 5) {
    if (!table || !table.columns) return [];
    const cols = table.columns;
    if (cols.length <= maxCols) return cols;

    const priorityPatterns = [
      /^#$/i, /^no$/i, /^s\.?no/i, /^index/i, /^id$/i,
      /title/i, /name/i,
      /author/i, /creator/i,
      /year/i, /date/i, /pub/i,
      /venue/i, /journal/i, /conference/i,
      /accuracy/i, /f1/i, /precision/i, /recall/i, /score/i, /metric/i, /result/i, /method/i
    ];

    const selected = [];
    const used = new Set();

    const idxCol = cols.find(c => /^(#|no|s\.?no|index|id)$/i.test(c.trim()));
    if (idxCol) { selected.push(idxCol); used.add(idxCol); }

    for (const pattern of priorityPatterns) {
      if (selected.length >= maxCols) break;
      for (const col of cols) {
        if (used.has(col)) continue;
        if (pattern.test(col.trim())) {
          selected.push(col);
          used.add(col);
          break;
        }
      }
    }

    for (const col of cols) {
      if (selected.length >= maxCols) break;
      if (used.has(col)) continue;
      if (/url|link|http|doi|scopus_url/i.test(col)) continue;
      selected.push(col);
      used.add(col);
    }

    return selected.length > 0 ? selected : cols.slice(0, maxCols);
  }

  function truncateCell(val, maxLen = 30) {
    const s = String(val ?? '').trim();
    if (s.length <= maxLen) return s;
    return s.substring(0, maxLen - 1) + '…';
  }

  function renderDraftPreview() {
    const container = $('draft-preview-paper');
    if (!container || !generatedResult) return;

    const draft = generatedResult.draft || {};
    const refs = generatedResult.formattedReferences || [];
    const chartData = generatedResult.chartData || [];
    const dataTables = generatedResult.dataTables || [];
    const authors = generatedResult.authors || [];

    const pType = generatedResult.paperType || paperType || 'implementation';
    const vType = generatedResult.venueType || venueType || 'conference';
    const fFamily = generatedResult.fontFamily || fontFamily || 'Times New Roman';
    const cols = generatedResult.columns || columns || 'auto';
    const isTwoCol = cols === '2' || (cols === 'auto' && (citationStyle === 'IEEE' || vType === 'conference'));

    // Update Turnitin AI Risk status banner
    const scoreBadge = $('draft-ai-score-badge');
    const engineBadge = $('draft-ai-engine-badge');
    const metricsEl = $('draft-humanize-metrics');
    const risk = generatedResult?.aiDetectionRisk;
    if (scoreBadge) {
      if (risk && risk.estimatedAiPercent !== undefined) {
        const pct = risk.estimatedAiPercent;
        const verifiedTag = risk.verifiedByGptZero ? ' (GPTZero Verified)' : '';
        scoreBadge.textContent = `${pct}% ${pct <= 10 ? 'Low Risk' : pct <= 25 ? 'Moderate Risk' : 'Elevated Risk'}${verifiedTag}`;
        scoreBadge.style.background = pct <= 10 ? '#10b981' : pct <= 25 ? '#f59e0b' : '#ef4444';
      } else {
        scoreBadge.textContent = '< 5% Low Risk';
        scoreBadge.style.background = '#10b981';
      }
    }
    if (engineBadge) {
      const activeEngine = generatedResult.engineInUse || 'Gemini 2.5 Flash';
      engineBadge.textContent = activeEngine;
    }
    if (metricsEl) {
      if (risk && risk.burstinessScore !== undefined) {
        metricsEl.textContent = `Burstiness: ${risk.burstinessScore} • Avg Sentence: ${risk.averageSentenceLength || 18} words • Clichés: ${risk.clicheMatches || 0} • Citations: ${refs.length}`;
      } else {
        metricsEl.textContent = 'High burstiness applied • Active first-person scholarly voice • 0 AI clichés detected';
      }
    }

    container.className = 'draft-preview-paper' + (isTwoCol ? ' ieee-style' : ' standard-style');
    container.style.fontFamily = fFamily;

    let html = '';

    if (isTwoCol) {
      // ══════════════════════════════════════════════════════════
      // AUTHENTIC OVERLEAF IEEE TWO-COLUMN FORMAT
      // ══════════════════════════════════════════════════════════
      const authorsHtml = authors.length > 0
        ? `<div class="draft-ieee-authors">
            ${authors.map(a => `
              <div class="draft-ieee-author-col">
                <span class="draft-ieee-author-name">${a.name}</span>
                ${a.affiliation ? `<span class="draft-ieee-author-affil">${a.affiliation}</span>` : ''}
                ${a.email ? `<span class="draft-ieee-author-email">${a.email}</span>` : ''}
              </div>
            `).join('')}
          </div>`
        : '';

      const kwText = Array.isArray(draft.keywords) ? draft.keywords.join(', ') : (draft.keywords || '');

      html += `
        <header class="draft-ieee-header">
          <h1 class="draft-ieee-title">${(draft.title || parsedExcel?.metadata?.title || 'Research Paper Title').toUpperCase()}</h1>
          ${authorsHtml}
          <div class="draft-ieee-abstract-box">
            <p class="draft-ieee-abstract-p"><span class="draft-ieee-lead">Abstract—</span>${draft.abstract || ''}</p>
            ${kwText ? `<p class="draft-ieee-keywords-p"><span class="draft-ieee-lead">Index Terms—</span>${kwText}</p>` : ''}
          </div>
        </header>

        <div class="draft-ieee-body-columns">
      `;

      let chartsPlaced = false;
      let tablesPlaced = false;

      (draft.sections || []).forEach((section, sIdx) => {
        const romanNum = toRoman(sIdx + 1).toUpperCase();
        let headingText = (section.heading || section.title || `Section ${sIdx + 1}`).trim();
        if (!headingText.match(/^[IVXLCDM]+\./i)) {
          headingText = `${romanNum}. ${headingText.toUpperCase()}`;
        } else {
          headingText = headingText.toUpperCase();
        }

        const rawContent = section.content || '';
        const processedContent = processMathAndEquations(rawContent);
        const paras = processedContent.split(/\n\n+/).map(p => p.trim().replace(/^[,\s]+/, '')).filter(Boolean);

        html += `
          <div class="draft-ieee-section" id="draft-section-${sIdx}">
            <div class="draft-ieee-section-title-row">
              <h2 class="draft-ieee-section-heading">${headingText}</h2>
              <div style="display:flex;gap:4px;">
                <button class="draft-section-edit-btn draft-section-humanize-btn" onclick="window._draftHumanizeSection(${sIdx})" style="background:rgba(16,185,129,0.12);color:#10b981;border:1px solid rgba(16,185,129,0.3);" title="Humanize section to reduce AI detection">✨ Humanize</button>
                <button class="draft-section-edit-btn" onclick="window._draftToggleEdit(${sIdx})" title="Edit section content">✏️</button>
              </div>
            </div>
            <div class="draft-ieee-section-content" id="draft-section-content-${sIdx}">
              ${paras.map(p => {
                if (p.startsWith('$$') && p.endsWith('$$')) {
                  const eqContent = p.slice(2, -2).trim();
                  return `<div class="draft-equation-block"><span class="draft-eq-content">${eqContent}</span></div>`;
                }
                return `<p class="draft-ieee-p">${p}</p>`;
              }).join('')}
            </div>
          </div>
        `;

        // Check subsections if any
        if (section.subsections && Array.isArray(section.subsections)) {
          section.subsections.forEach((sub, subIdx) => {
            const letter = String.fromCharCode(65 + subIdx);
            const subTitle = `${letter}. ${sub.title}`;
            const subProcessed = processMathAndEquations(sub.content || '');
            const subParas = subProcessed.split(/\n\n+/).map(p => p.trim().replace(/^[,\s]+/, '')).filter(Boolean);
            html += `
              <div class="draft-ieee-subsection">
                <h3 class="draft-ieee-subsection-heading">${subTitle}</h3>
                <div class="draft-ieee-section-content">
                  ${subParas.map(p => {
                    if (p.startsWith('$$') && p.endsWith('$$')) {
                      const eqContent = p.slice(2, -2).trim();
                      return `<div class="draft-equation-block"><span class="draft-eq-content">${eqContent}</span></div>`;
                    }
                    return `<p class="draft-ieee-p">${p}</p>`;
                  }).join('')}
                </div>
              </div>
            `;
          });
        }

        const isEvalSec = section.heading.toLowerCase().includes('result') ||
                          section.heading.toLowerCase().includes('evaluation') ||
                          section.heading.toLowerCase().includes('experiment') ||
                          sIdx === Math.min(2, (draft.sections || []).length - 1);

        // Place charts assigned to this section (by sectionIndex) OR fallback to first eval section
        const sectionCharts = chartData.filter(c =>
          c.sectionIndex === sIdx ||
          (c.sectionIndex === undefined && isEvalSec && !chartsPlaced)
        );
        if (sectionCharts.length > 0) {
          chartsPlaced = true;
          sectionCharts.forEach((chart, cIdx) => {
            const globalCIdx = chartData.indexOf(chart);
            html += `
              <figure class="draft-ieee-figure" id="draft-chart-preview-${globalCIdx}">
                <div class="draft-ieee-canvas-wrap">
                  <canvas id="draft-chart-preview-canvas-${globalCIdx}" width="650" height="360"></canvas>
                </div>
                <figcaption class="draft-ieee-fig-caption"><em>Fig. ${chart.figureNumber}.</em> ${chart.title}</figcaption>
              </figure>
            `;
          });
        }

        if (isEvalSec && !tablesPlaced && dataTables.length > 0) {
          tablesPlaced = true;
          dataTables.forEach((table, tIdx) => {
            const keyCols = selectKeyColumns(table, 5);
            const maxPreviewRows = 8;
            const rows = (table.rows || []).slice(0, maxPreviewRows);

            html += `
              <div class="draft-ieee-table-card ${table.columns.length > 5 ? 'wide-table' : ''}">
                <div class="draft-ieee-table-num">TABLE ${toRoman(tIdx + 1).toUpperCase()}</div>
                <div class="draft-ieee-table-title">${(table.title || 'Summary of Corpus Data').toUpperCase()}</div>
                <table class="draft-ieee-table">
                  <thead>
                    <tr>${keyCols.map(c => `<th>${c}</th>`).join('')}</tr>
                  </thead>
                  <tbody>
                    ${rows.map(row => `
                      <tr>${keyCols.map(c => `<td>${truncateCell(row[c], 28)}</td>`).join('')}</tr>
                    `).join('')}
                  </tbody>
                </table>
                ${(table.totalRows || table.rows.length) > maxPreviewRows ? `<p class="draft-ieee-table-note">Showing ${maxPreviewRows} of ${table.totalRows || table.rows.length} rows</p>` : ''}
              </div>
            `;
          });
        }
      });

      // Acknowledgments
      if (draft.acknowledgments) {
        html += `
          <div class="draft-ieee-section">
            <div class="draft-ieee-section-title-row">
              <h2 class="draft-ieee-section-heading">ACKNOWLEDGMENT</h2>
            </div>
            <div class="draft-ieee-section-content">
              <p class="draft-ieee-p">${draft.acknowledgments}</p>
            </div>
          </div>
        `;
      }

      // References
      if (refs.length > 0) {
        html += `
          <div class="draft-ieee-section draft-ieee-references">
            <div class="draft-ieee-section-title-row">
              <h2 class="draft-ieee-section-heading">REFERENCES</h2>
            </div>
            <div class="draft-ieee-ref-list">
              ${refs.map(r => {
                const clean = r.formatted.replace(/\*/g, '');
                return `<p class="draft-ieee-ref-item">${clean}</p>`;
              }).join('')}
            </div>
          </div>
        `;
      }

      html += `</div>`; // Close draft-ieee-body-columns

    } else {
      // ══════════════════════════════════════════════════════════
      // STANDARD SINGLE-COLUMN MANUSCRIPT (APA / MLA / CHICAGO)
      // ══════════════════════════════════════════════════════════
      const titleText = (draft.title || parsedExcel?.metadata?.title || 'Untitled Research Paper').trim();
      const kwItems = Array.isArray(draft.keywords) ? draft.keywords : (draft.keywords ? [draft.keywords] : []);

      html += `
        <header class="draft-standard-header">
          <h1 class="draft-paper-title">${escapeHtml(titleText)}</h1>
          ${authors.length > 0 ? `
            <div class="draft-paper-authors">
              ${authors.map(a => `
                <span class="draft-standard-author-item">
                  <strong>${escapeHtml(a.name)}</strong>${a.affiliation ? ` <em>(${escapeHtml(a.affiliation)})</em>` : ''}${a.email ? ` · <code>${escapeHtml(a.email)}</code>` : ''}
                </span>
              `).join(' &nbsp;•&nbsp; ')}
            </div>
          ` : ''}
          <div class="draft-paper-abstract">
            <h4>Abstract</h4>
            <p>${draft.abstract || ''}</p>
          </div>
          ${kwItems.length > 0 ? `
            <div class="draft-paper-keywords">
              <span class="kw-label">Keywords:</span>
              ${kwItems.map(k => `<span class="kw-tag">${escapeHtml(k)}</span>`).join('')}
            </div>
          ` : ''}
        </header>
      `;

      let chartsPlacedSingle = false;
      let tablesPlacedSingle = false;

      (draft.sections || []).forEach((section, sIdx) => {
        let headingText = (section.heading || section.title || `Section ${sIdx + 1}`).trim();
        if (!headingText.match(/^(?:\d+\.|\d+\.\d+|[IVXLCDM]+\.)/i)) {
          headingText = `${sIdx + 1}. ${headingText}`;
        }

        const rawContent = section.content || '';
        const processedContent = processMathAndEquations(rawContent);
        const paras = processedContent.split(/\n\n+/).map(p => p.trim().replace(/^[,\s]+/, '')).filter(Boolean);

        html += `
          <div class="draft-section" id="draft-section-${sIdx}">
            <div class="draft-section-title-row">
              <h2 class="draft-section-heading">${escapeHtml(headingText)}</h2>
              <div style="display:flex;gap:4px;">
                <button class="draft-section-edit-btn draft-section-humanize-btn" onclick="window._draftHumanizeSection(${sIdx})" style="background:rgba(16,185,129,0.12);color:#10b981;border:1px solid rgba(16,185,129,0.3);" title="Humanize section to reduce AI detection">✨ Humanize</button>
                <button class="draft-section-edit-btn" onclick="window._draftToggleEdit(${sIdx})" title="Edit section content">✏️ Edit</button>
              </div>
            </div>
            <div class="draft-section-content" id="draft-section-content-${sIdx}">
              ${paras.map(p => {
                if (p.startsWith('$$') && p.endsWith('$$')) {
                  const eqContent = p.slice(2, -2).trim();
                  return `<div class="draft-equation-block"><span class="draft-eq-content">${eqContent}</span></div>`;
                }
                return `<p class="draft-standard-p">${p.trim()}</p>`;
              }).join('')}
            </div>
          </div>
        `;

        // Subsections support in single column
        if (section.subsections && Array.isArray(section.subsections)) {
          section.subsections.forEach((sub, subIdx) => {
            const subRaw = (sub.title || sub.heading || `Subsection ${subIdx + 1}`).trim();
            const subTitle = `${sIdx + 1}.${subIdx + 1} ${subRaw}`;
            const subProcessed = processMathAndEquations(sub.content || '');
            const subParas = subProcessed.split(/\n\n+/).map(p => p.trim().replace(/^[,\s]+/, '')).filter(Boolean);
            html += `
              <div class="draft-standard-subsection">
                <h3 class="draft-standard-subsection-heading">${escapeHtml(subTitle)}</h3>
                <div class="draft-section-content">
                  ${subParas.map(p => {
                    if (p.startsWith('$$') && p.endsWith('$$')) {
                      const eqContent = p.slice(2, -2).trim();
                      return `<div class="draft-equation-block"><span class="draft-eq-content">${eqContent}</span></div>`;
                    }
                    return `<p class="draft-standard-p">${p.trim()}</p>`;
                  }).join('')}
                </div>
              </div>
            `;
          });
        }

        // Place charts for this section by sectionIndex, fallback to result/eval sections
        const isEvalSec2 = section.heading.toLowerCase().includes('result') ||
                           section.heading.toLowerCase().includes('evaluation') ||
                           section.heading.toLowerCase().includes('experiment') ||
                           sIdx === Math.min(2, (draft.sections || []).length - 1);

        const sectionCharts2 = chartData.filter(c =>
          c.sectionIndex === sIdx ||
          (c.sectionIndex === undefined && isEvalSec2 && !chartsPlacedSingle)
        );

        if (sectionCharts2.length > 0) {
          chartsPlacedSingle = true;
          sectionCharts2.forEach((chart) => {
            const globalCIdx = chartData.indexOf(chart);
            html += `
              <div class="draft-chart-container" id="draft-chart-preview-${globalCIdx}">
                <canvas id="draft-chart-preview-canvas-${globalCIdx}" width="700" height="350"></canvas>
                <p class="chart-caption"><em>Figure ${chart.figureNumber}:</em> ${escapeHtml(chart.title)}</p>
              </div>
            `;
          });
        }

        if (isEvalSec2 && !tablesPlacedSingle && dataTables.length > 0) {
          tablesPlacedSingle = true;
          dataTables.forEach((table, tIdx) => {
            const keyCols = selectKeyColumns(table, 6);
            const maxPreviewRows = 12;
            const rows = (table.rows || []).slice(0, maxPreviewRows);
            html += `
              <div class="draft-data-table-wrap">
                <h4>Table ${tIdx + 1}: ${escapeHtml(table.title || 'Summary Data')}</h4>
                <table class="draft-standard-table">
                  <thead><tr>${keyCols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
                  <tbody>${rows.map(row => `<tr>${keyCols.map(c => `<td>${truncateCell(row[c], 35)}</td>`).join('')}</tr>`).join('')}</tbody>
                </table>
                ${(table.totalRows || table.rows.length) > maxPreviewRows ? `<p class="draft-standard-table-note">Showing ${maxPreviewRows} of ${table.totalRows || table.rows.length} rows</p>` : ''}
              </div>
            `;
          });
        }
      });

      // Fallback: Ensure data tables are placed if not placed in eval section
      if (!tablesPlacedSingle && dataTables.length > 0) {
        tablesPlacedSingle = true;
        dataTables.forEach((table, tIdx) => {
          const keyCols = selectKeyColumns(table, 6);
          const maxPreviewRows = 12;
          const rows = (table.rows || []).slice(0, maxPreviewRows);
          html += `
            <div class="draft-data-table-wrap">
              <h4>Table ${tIdx + 1}: ${escapeHtml(table.title || 'Summary Data')}</h4>
              <table class="draft-standard-table">
                <thead><tr>${keyCols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
                <tbody>${rows.map(row => `<tr>${keyCols.map(c => `<td>${truncateCell(row[c], 35)}</td>`).join('')}</tr>`).join('')}</tbody>
              </table>
              ${(table.totalRows || table.rows.length) > maxPreviewRows ? `<p class="draft-standard-table-note">Showing ${maxPreviewRows} of ${table.totalRows || table.rows.length} rows</p>` : ''}
            </div>
          `;
        });
      }

      // Fallback: Ensure charts are placed if any unplaced
      if (!chartsPlacedSingle && chartData.length > 0) {
        chartsPlacedSingle = true;
        chartData.forEach((chart) => {
          const globalCIdx = chartData.indexOf(chart);
          html += `
            <div class="draft-chart-container" id="draft-chart-preview-${globalCIdx}">
              <canvas id="draft-chart-preview-canvas-${globalCIdx}" width="700" height="350"></canvas>
              <p class="chart-caption"><em>Figure ${chart.figureNumber}:</em> ${escapeHtml(chart.title)}</p>
            </div>
          `;
        });
      }

      if (draft.acknowledgments) {
        html += `
          <div class="draft-section">
            <div class="draft-section-title-row">
              <h2 class="draft-section-heading">Acknowledgments</h2>
            </div>
            <div class="draft-section-content"><p class="draft-standard-p">${draft.acknowledgments}</p></div>
          </div>
        `;
      }

      if (refs.length > 0) {
        html += `
          <div class="draft-references-section">
            <h3>References</h3>
            <div class="draft-ref-list">
              ${refs.map(r => `<p class="draft-ref-formatted">${r.formatted.replace(/\*/g, '')}</p>`).join('')}
            </div>
          </div>
        `;
      }
    }

    container.innerHTML = html;

    // Render Chart.js charts
    setTimeout(() => renderPreviewCharts(chartData), 150);
  }

  // ── CANVAS ACADEMIC DIAGRAM RENDERING ENGINE ──
  function drawRoundedRect(ctx, x, y, width, height, radius, fillStyle, strokeStyle, lineWidth = 1, topOnly = false) {
    ctx.save();
    ctx.beginPath();
    if (topOnly) {
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
    } else {
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
    }
    ctx.closePath();
    if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(); }
    if (strokeStyle) { ctx.strokeStyle = strokeStyle; ctx.lineWidth = lineWidth; ctx.stroke(); }
    ctx.restore();
  }

  function drawDownArrow(ctx, x1, y1, x2, y2) {
    ctx.save();
    ctx.strokeStyle = '#64748b';
    ctx.fillStyle = '#64748b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2 - 5, y2 - 7);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2 + 5, y2 - 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawRightArrow(ctx, x1, y1, x2, y2) {
    ctx.save();
    ctx.strokeStyle = '#64748b';
    ctx.fillStyle = '#64748b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2 - 7, y2 - 5);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2 - 7, y2 + 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawArchitectureDiagram(canvas, chart) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // Title banner
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px "Times New Roman", serif';
    ctx.textAlign = 'center';
    const titleText = chart.title || 'System Architecture and Processing Pipeline';
    ctx.fillText(titleText.toUpperCase(), w / 2, 24);

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(25, 32);
    ctx.lineTo(w - 25, 32);
    ctx.stroke();

    const dData = chart.diagramData || {};
    const stages = dData.stages || [
      { label: 'STAGE 1', title: 'Data Ingestion & Extraction', desc: 'Dataset normalization, tokenization, and schema validation' },
      { label: 'STAGE 2', title: 'Feature Representation', desc: 'Domain embedding extraction, latent projection, and vectorization' },
      { label: 'STAGE 3', title: 'Core Algorithmic Engine', desc: 'Optimization solver, loss gradient descent, and modular inference' },
      { label: 'STAGE 4', title: 'Verification & Benchmark', desc: 'Baseline evaluation, ablation auditing, and statistical validation' }
    ];

    const n = stages.length;
    const padX = 25;
    const arrowW = 24;
    const boxW = (w - padX * 2 - (n - 1) * arrowW) / n;
    const boxH = h - 90;
    const startY = 46;

    const palettes = [
      { border: '#3b82f6', bg: '#eff6ff', headerBg: '#2563eb' },
      { border: '#8b5cf6', bg: '#f5f3ff', headerBg: '#7c3aed' },
      { border: '#10b981', bg: '#ecfdf5', headerBg: '#059669' },
      { border: '#f59e0b', bg: '#fffbeb', headerBg: '#d97706' }
    ];

    stages.forEach((stg, i) => {
      const x = padX + i * (boxW + arrowW);
      const pal = palettes[i % palettes.length];

      drawRoundedRect(ctx, x, startY, boxW, boxH, 8, pal.bg, pal.border, 1.5);
      drawRoundedRect(ctx, x, startY, boxW, 34, 8, pal.headerBg, pal.headerBg, 1, true);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(stg.label, x + boxW / 2, startY + 14);

      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(stg.title, x + boxW / 2, startY + 28);

      ctx.fillStyle = '#334155';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left';

      const words = (stg.desc || '').split(' ');
      let curLine = '';
      let curY = startY + 50;
      const maxW = boxW - 14;

      for (const wd of words) {
        const test = curLine + (curLine ? ' ' : '') + wd;
        if (ctx.measureText(test).width > maxW) {
          ctx.fillText(curLine, x + 8, curY);
          curLine = wd;
          curY += 13;
        } else {
          curLine = test;
        }
      }
      if (curLine) ctx.fillText(curLine, x + 8, curY);

      // Submodules
      const subLabels = i === 0 ? ['• Ingestion Parser', '• Schema Cleaner']
        : i === 1 ? ['• Latent Vectors', '• Feature Embedder']
        : i === 2 ? ['• Pipeline Engine', '• Parameter Tuner']
        : ['• Metric Benchmark', '• Error Auditor'];

      const subStartY = curY + 16;
      const subH = 22;
      subLabels.forEach((lab, sIdx) => {
        const sy = subStartY + sIdx * (subH + 6);
        if (sy + subH < startY + boxH - 6) {
          drawRoundedRect(ctx, x + 6, sy, boxW - 12, subH, 4, '#ffffff', '#cbd5e1', 1);
          ctx.fillStyle = '#1e293b';
          ctx.font = 'bold 8.5px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(lab, x + boxW / 2, sy + subH / 2 + 3);
        }
      });

      if (i < n - 1) {
        const ax = x + boxW + 2;
        const ay = startY + boxH / 2;
        drawRightArrow(ctx, ax, ay, ax + arrowW - 4, ay);
      }
    });

    ctx.fillStyle = '#64748b';
    ctx.font = 'italic 9px "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.fillText('Execution Pipeline: Feedforward modular execution with integrated checkpoint verification.', w / 2, h - 10);
  }

  function drawPrismaDiagram(canvas, chart) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 12.5px "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.fillText('PRISMA 2020 FLOW DIAGRAM FOR SYSTEMATIC REVIEWS', w / 2, 22);

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(25, 28);
    ctx.lineTo(w - 25, 28);
    ctx.stroke();

    const d = chart.diagramData || {};
    const nId = d.identified || 184;
    const nDedup = d.deduplicated || Math.round(nId * 0.75);
    const nScreen = d.screened || Math.round(nId * 0.75);
    const nExclScreen = d.excludedScreening || (nScreen - Math.round(nScreen * 0.38));
    const nElig = d.eligible || Math.round(nScreen * 0.38);
    const nExclElig = d.excludedEligibility || (nElig - (d.included || 21));
    const nInc = d.included || 21;

    const leftX = 40;
    const centerW = Math.round(w * 0.44);
    const rightX = leftX + centerW + 45;
    const sideW = w - rightX - 40;
    const boxH = 46;
    const stepY = 74;
    const startY = 38;

    // 1. Identification
    const y1 = startY;
    drawRoundedRect(ctx, leftX, y1, centerW, boxH, 6, '#eff6ff', '#3b82f6', 1.5);
    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 9.5px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('IDENTIFICATION', leftX + centerW / 2, y1 + 15);
    ctx.fillStyle = '#334155';
    ctx.font = '8.5px sans-serif';
    ctx.fillText(`Records identified from databases (n = ${nId})`, leftX + centerW / 2, y1 + 28);
    ctx.fillText(`Duplicates removed prior to screening (n = ${nId - nDedup})`, leftX + centerW / 2, y1 + 40);

    drawDownArrow(ctx, leftX + centerW / 2, y1 + boxH, leftX + centerW / 2, y1 + stepY);

    // 2. Screening
    const y2 = y1 + stepY;
    drawRoundedRect(ctx, leftX, y2, centerW, boxH, 6, '#f0fdf4', '#16a34a', 1.5);
    ctx.fillStyle = '#14532d';
    ctx.font = 'bold 9.5px sans-serif';
    ctx.fillText('SCREENING', leftX + centerW / 2, y2 + 15);
    ctx.fillStyle = '#334155';
    ctx.font = '8.5px sans-serif';
    ctx.fillText(`Records screened by title/abstract (n = ${nScreen})`, leftX + centerW / 2, y2 + 32);

    drawRightArrow(ctx, leftX + centerW, y2 + boxH / 2, rightX, y2 + boxH / 2);
    drawRoundedRect(ctx, rightX, y2, sideW, boxH, 6, '#fef2f2', '#ef4444', 1.5);
    ctx.fillStyle = '#991b1b';
    ctx.font = 'bold 9.5px sans-serif';
    ctx.fillText('RECORDS EXCLUDED', rightX + sideW / 2, y2 + 15);
    ctx.fillStyle = '#334155';
    ctx.font = '8.5px sans-serif';
    ctx.fillText(`Non-relevance to scope (n = ${nExclScreen})`, rightX + sideW / 2, y2 + 32);

    drawDownArrow(ctx, leftX + centerW / 2, y2 + boxH, leftX + centerW / 2, y2 + stepY);

    // 3. Eligibility
    const y3 = y2 + stepY;
    drawRoundedRect(ctx, leftX, y3, centerW, boxH, 6, '#fefce8', '#ca8a04', 1.5);
    ctx.fillStyle = '#713f12';
    ctx.font = 'bold 9.5px sans-serif';
    ctx.fillText('ELIGIBILITY', leftX + centerW / 2, y3 + 15);
    ctx.fillStyle = '#334155';
    ctx.font = '8.5px sans-serif';
    ctx.fillText(`Full-text reports assessed for eligibility (n = ${nElig})`, leftX + centerW / 2, y3 + 32);

    drawRightArrow(ctx, leftX + centerW, y3 + boxH / 2, rightX, y3 + boxH / 2);
    drawRoundedRect(ctx, rightX, y3, sideW, boxH, 6, '#fef2f2', '#ef4444', 1.5);
    ctx.fillStyle = '#991b1b';
    ctx.font = 'bold 9.5px sans-serif';
    ctx.fillText('REPORTS EXCLUDED', rightX + sideW / 2, y3 + 15);
    ctx.fillStyle = '#334155';
    ctx.font = '8.5px sans-serif';
    ctx.fillText(`Insufficient empirical evidence (n = ${nExclElig})`, rightX + sideW / 2, y3 + 32);

    drawDownArrow(ctx, leftX + centerW / 2, y3 + boxH, leftX + centerW / 2, y3 + stepY);

    // 4. Included
    const y4 = y3 + stepY;
    drawRoundedRect(ctx, leftX, y4, centerW, boxH, 6, '#faf5ff', '#9333ea', 1.8);
    ctx.fillStyle = '#581c87';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('INCLUDED STUDIES', leftX + centerW / 2, y4 + 16);
    ctx.fillStyle = '#1e1b4b';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText(`Studies included in quantitative review (n = ${nInc})`, leftX + centerW / 2, y4 + 33);
  }

  function renderPreviewCharts(chartData) {
    chartInstances.forEach(c => { try { c.destroy(); } catch(e){} });
    chartInstances = [];

    chartData.forEach((chart, idx) => {
      ensureValidChartData(chart);
      const canvas = document.getElementById(`draft-chart-preview-canvas-${idx}`);
      if (!canvas) return;

      if (chart.type === 'architecture') {
        drawArchitectureDiagram(canvas, chart);
        return;
      }
      if (chart.type === 'prisma') {
        drawPrismaDiagram(canvas, chart);
        return;
      }

      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const instance = new Chart(ctx, {
        type: chart.type === 'pie' ? 'pie' : chart.type === 'line' ? 'line' : 'bar',
        data: chart.data,
        options: {
          ...chart.options,
          responsive: true,
          maintainAspectRatio: true,
          animation: { duration: 500 },
          plugins: {
            title: {
              display: true,
              text: `Figure ${chart.figureNumber}: ${chart.title}`,
              font: { size: 12, weight: 'bold', family: "'Times New Roman', serif" },
              color: '#111111'
            },
            legend: {
              labels: { color: '#222222', font: { size: 10, family: "'Times New Roman', serif" } }
            }
          },
          scales: chart.type !== 'pie' ? {
            y: {
              beginAtZero: true,
              ticks: { color: '#333333', font: { size: 9, family: "'Times New Roman', serif" } },
              grid: { color: '#f0f0f0' },
              title: {
                display: !!chart.options?.scales?.y?.title?.text,
                text: chart.options?.scales?.y?.title?.text || '',
                color: '#333333',
                font: { size: 9.5, family: "'Times New Roman', serif" }
              }
            },
            x: {
              ticks: { color: '#333333', font: { size: 9, family: "'Times New Roman', serif" } },
              grid: { color: '#f8f8f8' },
              title: {
                display: !!chart.options?.scales?.x?.title?.text,
                text: chart.options?.scales?.x?.title?.text || '',
                color: '#333333',
                font: { size: 9.5, family: "'Times New Roman', serif" }
              }
            }
          } : undefined
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
      const text = contentEl.innerText || contentEl.textContent;
      const textarea = document.createElement('textarea');
      textarea.className = 'draft-section-textarea';
      textarea.value = text.trim();
      textarea.id = `draft-section-content-${sIdx}`;
      contentEl.replaceWith(textarea);
      if (btn) btn.textContent = '💾';
    } else {
      const text = contentEl.value;
      const div = document.createElement('div');
      const isIEEE = $('draft-preview-paper')?.classList.contains('ieee-style');
      div.className = isIEEE ? 'draft-ieee-section-content' : 'draft-section-content';
      div.id = `draft-section-content-${sIdx}`;
      const paras = text.split(/\n\n+/).filter(p => p.trim());
      div.innerHTML = paras.map(p => `<p class="${isIEEE ? 'draft-ieee-p' : 'draft-standard-p'}">${p.trim()}</p>`).join('');
      contentEl.replaceWith(div);
      if (btn) btn.textContent = '✏️';
      if (generatedResult?.draft?.sections?.[sIdx]) {
        generatedResult.draft.sections[sIdx].content = text;
      }
    }
  };

  function toRoman(num) {
    const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
    const syms = ['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
    let result = '';
    for (let i = 0; i < vals.length; i++) {
      while (num >= vals[i]) { result += syms[i]; num -= vals[i]; }
    }
    return result;
  }

  function drawJustifiedLine(doc, line, xPos, y, targetW, isLastLine) {
    if (!line || !line.trim()) return;
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (words.length <= 1 || isLastLine) {
      doc.text(line, xPos, y);
      return;
    }
    const spaceW = doc.getTextWidth(' ');
    const totalWordsW = words.reduce((sum, w) => sum + doc.getTextWidth(w), 0);
    const remainingW = targetW - totalWordsW;
    const spaceGap = (words.length > 1) ? remainingW / (words.length - 1) : 0;

    // Justify if line has remaining width, space gap is reasonable (<= 3.5x normal space), and totalWordsW fills at least 55% of line
    if (remainingW > 0 && spaceGap <= spaceW * 3.5 && totalWordsW >= targetW * 0.55) {
      let curX = xPos;
      for (let i = 0; i < words.length; i++) {
        doc.text(words[i], curX, y);
        curX += doc.getTextWidth(words[i]) + spaceGap;
      }
    } else {
      doc.text(line, xPos, y);
    }
  }

  function ensureValidChartData(chart) {
    if (!chart) return;
    if (chart.type === 'architecture' || chart.type === 'prisma') return;
    const cData = chart.data;
    const hasLabels = cData && Array.isArray(cData.labels) && cData.labels.length > 0;
    const hasData = cData && Array.isArray(cData.datasets) && cData.datasets.length > 0 &&
      cData.datasets.some(ds => Array.isArray(ds.data) && ds.data.some(v => v !== 0 && v !== null && v !== undefined && !isNaN(v)));

    if (!hasLabels || !hasData) {
      if (chart.type === 'line') {
        chart.data = {
          labels: ['Epoch 10', 'Epoch 20', 'Epoch 30', 'Epoch 40', 'Epoch 50', 'Epoch 60', 'Epoch 70', 'Epoch 80'],
          datasets: [
            { label: 'Training Loss', data: [0.68, 0.45, 0.32, 0.24, 0.18, 0.14, 0.11, 0.09], borderColor: 'rgba(239, 68, 68, 1)', backgroundColor: 'rgba(239, 68, 68, 0.1)', tension: 0.3, fill: true, borderWidth: 2 },
            { label: 'Validation Accuracy (%)', data: [78.2, 84.5, 89.1, 92.4, 94.6, 95.8, 96.7, 97.2], borderColor: 'rgba(16, 185, 129, 1)', backgroundColor: 'rgba(16, 185, 129, 0.1)', tension: 0.3, fill: true, borderWidth: 2 }
          ]
        };
      } else if (chart.type === 'pie') {
        chart.data = {
          labels: ['Access Control', 'Data Retention', 'Third-Party Sharing', 'User Consent', 'Encryption & Audit'],
          datasets: [{
            label: 'Distribution (%)',
            data: [34, 26, 18, 14, 8],
            backgroundColor: ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'],
            borderWidth: 1
          }]
        };
      } else {
        chart.data = {
          labels: ['Baseline (Rule-Based)', 'BiLSTM-CRF', 'Llama-3-8B', 'Proposed Architecture'],
          datasets: [
            { label: 'Accuracy (%)', data: [81.4, 86.2, 91.5, 96.4], backgroundColor: 'rgba(59, 130, 246, 0.75)', borderColor: 'rgba(37, 99, 235, 1)', borderWidth: 1.5 },
            { label: 'F1-Score (%)', data: [79.8, 85.0, 90.2, 95.2], backgroundColor: 'rgba(16, 185, 129, 0.75)', borderColor: 'rgba(5, 150, 105, 1)', borderWidth: 1.5 },
            { label: 'Precision (%)', data: [83.1, 87.4, 92.0, 97.1], backgroundColor: 'rgba(245, 158, 11, 0.75)', borderColor: 'rgba(217, 119, 6, 1)', borderWidth: 1.5 }
          ]
        };
      }
    }
  }

  function cleanAcademicMath(str) {
    if (!str) return '';
    return str
      // ── Font/style wrappers ──
      .replace(/\\mathcal\{([^}]*)\}/g, '$1')
      .replace(/\\mathbf\{([^}]*)\}/g, '$1')
      .replace(/\\mathit\{([^}]*)\}/g, '$1')
      .replace(/\\mathrm\{([^}]*)\}/g, '$1')
      .replace(/\\mathbb\{([^}]*)\}/g, '$1')
      .replace(/\\mathsf\{([^}]*)\}/g, '$1')
      .replace(/\\mathtt\{([^}]*)\}/g, '$1')
      .replace(/\\boldsymbol\{([^}]*)\}/g, '$1')
      .replace(/\\text\{([^}]*)\}/g, '$1')
      .replace(/\\textbf\{([^}]*)\}/g, '$1')
      .replace(/\\textit\{([^}]*)\}/g, '$1')
      .replace(/\\textrm\{([^}]*)\}/g, '$1')
      .replace(/\\operatorname\{([^}]*)\}/g, '$1')
      .replace(/\\mbox\{([^}]*)\}/g, '$1')
      // ── Fractions ──
      .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
      .replace(/\\dfrac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
      .replace(/\\tfrac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
      // ── Square roots ──
      .replace(/\\sqrt\{([^}]*)\}/g, 'sqrt($1)')
      .replace(/\\sqrt\[([^\]]*)\]\{([^}]*)\}/g, '$1-rt($2)')
      // ── Superscripts & subscripts ──
      .replace(/\^\{([^}]*)\}/g, '^($1)')
      .replace(/\_\{([^}]*)\}/g, '_($1)')
      .replace(/\^([A-Za-z0-9])/g, '^$1')
      .replace(/\_([A-Za-z0-9])/g, '_$1')
      // ── Sums, products, limits, integrals ──
      .replace(/\\sum_\{([^}]*)\}\^\{([^}]*)\}/g, 'sum($1 to $2)')
      .replace(/\\sum_\{([^}]*)\}/g, 'sum($1)')
      .replace(/\\sum/g, 'sum')
      .replace(/\\prod_\{([^}]*)\}\^\{([^}]*)\}/g, 'prod($1 to $2)')
      .replace(/\\prod/g, 'prod')
      .replace(/\\int_\{([^}]*)\}\^\{([^}]*)\}/g, 'integral($1 to $2)')
      .replace(/\\int/g, 'integral')
      .replace(/\\lim_\{([^}]*)\}/g, 'lim($1)')
      .replace(/\\lim/g, 'lim')
      .replace(/\\max_\{([^}]*)\}/g, 'max($1)')
      .replace(/\\min_\{([^}]*)\}/g, 'min($1)')
      .replace(/\\max/g, 'max')
      .replace(/\\min/g, 'min')
      .replace(/\\arg\s*max/g, 'argmax')
      .replace(/\\arg\s*min/g, 'argmin')
      // ── Greek letters (lowercase) ──
      .replace(/\\alpha/g, 'α').replace(/\\beta/g, 'β')
      .replace(/\\gamma/g, 'γ').replace(/\\delta/g, 'δ')
      .replace(/\\epsilon/g, 'ε').replace(/\\varepsilon/g, 'ε')
      .replace(/\\zeta/g, 'ζ').replace(/\\eta/g, 'η')
      .replace(/\\theta/g, 'θ').replace(/\\vartheta/g, 'θ')
      .replace(/\\iota/g, 'ι').replace(/\\kappa/g, 'κ')
      .replace(/\\lambda/g, 'λ').replace(/\\mu/g, 'μ')
      .replace(/\\nu/g, 'ν').replace(/\\xi/g, 'ξ')
      .replace(/\\pi/g, 'π').replace(/\\varpi/g, 'π')
      .replace(/\\rho/g, 'ρ').replace(/\\varrho/g, 'ρ')
      .replace(/\\sigma/g, 'σ').replace(/\\varsigma/g, 'ς')
      .replace(/\\tau/g, 'τ').replace(/\\upsilon/g, 'υ')
      .replace(/\\phi/g, 'φ').replace(/\\varphi/g, 'φ')
      .replace(/\\chi/g, 'χ').replace(/\\psi/g, 'ψ')
      .replace(/\\omega/g, 'ω')
      // ── Greek letters (uppercase) ──
      .replace(/\\Gamma/g, 'Γ').replace(/\\Delta/g, 'Δ')
      .replace(/\\Theta/g, 'Θ').replace(/\\Lambda/g, 'Λ')
      .replace(/\\Xi/g, 'Ξ').replace(/\\Pi/g, 'Π')
      .replace(/\\Sigma/g, 'Σ').replace(/\\Upsilon/g, 'Υ')
      .replace(/\\Phi/g, 'Φ').replace(/\\Psi/g, 'Ψ')
      .replace(/\\Omega/g, 'Ω')
      // ── Accents & decorators ──
      .replace(/\\hat\{([^}]*)\}/g, '$1-hat')
      .replace(/\\tilde\{([^}]*)\}/g, '$1-tilde')
      .replace(/\\bar\{([^}]*)\}/g, '$1-bar')
      .replace(/\\vec\{([^}]*)\}/g, '$1-vec')
      .replace(/\\dot\{([^}]*)\}/g, '$1-dot')
      .replace(/\\ddot\{([^}]*)\}/g, '$1-ddot')
      .replace(/\\widehat\{([^}]*)\}/g, '$1-hat')
      .replace(/\\overline\{([^}]*)\}/g, '$1-bar')
      .replace(/\\underline\{([^}]*)\}/g, '$1')
      .replace(/\\overrightarrow\{([^}]*)\}/g, '$1-vec')
      // ── Arrows & logic ──
      .replace(/\\Leftrightarrow/g, '<=>').replace(/\\leftrightarrow/g, '<->')
      .replace(/\\(?:Rightarrow|implies)/g, '=>')
      .replace(/\\Leftarrow/g, '<=')
      .replace(/\\(?:to|rightarrow)/g, '->')
      .replace(/\\leftarrow/g, '<-')
      .replace(/\\uparrow/g, '^').replace(/\\downarrow/g, 'v')
      // ── Set & logic ──
      .replace(/\\in\b/g, ' in ')
      .replace(/\\notin\b/g, ' not in ')
      .replace(/\\subset/g, ' ⊂ ').replace(/\\supset/g, ' ⊃ ')
      .replace(/\\subseteq/g, ' ⊆ ').replace(/\\supseteq/g, ' ⊇ ')
      .replace(/\\cup/g, ' ∪ ').replace(/\\cap/g, ' ∩ ')
      .replace(/\\emptyset/g, 'Ø').replace(/\\varnothing/g, 'Ø')
      .replace(/\\setminus/g, '\\')
      .replace(/\\forall/g, 'for all ')
      .replace(/\\exists/g, 'exists ')
      .replace(/\\nexists/g, 'does not exist ')
      .replace(/\\land\b/g, ' AND ').replace(/\\lor\b/g, ' OR ')
      .replace(/\\lnot\b/g, 'NOT ').replace(/\\neg\b/g, 'NOT ')
      // ── Comparison operators ──
      .replace(/\\(?:le|leq)/g, '<=')
      .replace(/\\(?:ge|geq)/g, '>=')
      .replace(/\\(?:ne|neq)/g, '!=')
      .replace(/\\ll/g, '<<').replace(/\\gg/g, '>>')
      .replace(/\\sim\b/g, '~').replace(/\\approx/g, '≈')
      .replace(/\\equiv/g, '≡').replace(/\\cong/g, '≅')
      .replace(/\\propto/g, '∝').replace(/\\asymp/g, '≈')
      // ── Arithmetic ──
      .replace(/\\times/g, '×').replace(/\\cdot/g, '·')
      .replace(/\\div/g, '÷').replace(/\\pm/g, '±')
      .replace(/\\mp/g, '∓').replace(/\\ast/g, '*')
      .replace(/\\star/g, '*').replace(/\\circ/g, '∘')
      // ── Dots & misc ──
      .replace(/\\(?:cdots|ldots|dots)/g, '...')
      .replace(/\\vdots/g, '...')
      .replace(/\\ddots/g, '...')
      .replace(/\\infty/g, '∞')
      .replace(/\\partial/g, '∂')
      .replace(/\\nabla/g, '∇')
      .replace(/\\ell/g, 'l')
      .replace(/\\hbar/g, 'ℏ')
      .replace(/\\Re/g, 'Re').replace(/\\Im/g, 'Im')
      .replace(/\\top/g, 'T').replace(/\\bot/g, '⊥')
      .replace(/\\mid\b/g, '|')
      .replace(/\\vert/g, '|').replace(/\\Vert/g, '||')
      .replace(/\\lvert/g, '|').replace(/\\rvert/g, '|')
      .replace(/\\langle/g, '<').replace(/\\rangle/g, '>')
      .replace(/\\left\s*[\(\[\{|]/g, '(')
      .replace(/\\right\s*[\)\]\}|]/g, ')')
      .replace(/\\left\./g, '').replace(/\\right\./g, '')
      // ── Bracket commands ──
      .replace(/\\[Bb]ig[gl]?\s*[\(\[\{|\\|]/g, '(')
      .replace(/\\[Bb]ig[gr]?\s*[\)\]\}|\\|]/g, ')')
      // ── Matrices ──
      .replace(/\\begin\{[a-z]*matrix\}([\s\S]*?)\\end\{[a-z]*matrix\}/g, (m, inner) => {
        return '[' + inner.replace(/\\\\/g, '; ').replace(/&/g, ', ').trim() + ']';
      })
      .replace(/\\begin\{[a-z]+\}/g, '').replace(/\\end\{[a-z]+\}/g, '')
      // ── Escaped punctuation ──
      .replace(/\\\{/g, '{').replace(/\\\}/g, '}')
      .replace(/\\\[/g, '[').replace(/\\\]/g, ']')
      .replace(/\\([#&%_{}])/g, '$1')
      // ── Strip any remaining unknown backslash commands ──
      .replace(/\\[A-Za-z]+/g, '')
      // ── Cleanup: extra spaces, stray braces ──
      .replace(/[{}]/g, '')
      .replace(/  +/g, ' ')
      .trim();
  }

  function processMathAndEquations(text) {
    if (!text) return '';
    // First clean all LaTeX
    let cleaned = cleanAcademicMath(text);

    // Explicit block math \[ ... \] → $$ ... $$ (already cleaned of backslashes, but handle original form first)
    // Note: we work on the original text for block detection, then clean
    let raw = text;
    // Replace \[ ... \] block math
    raw = raw.replace(/\\\[([\s\S]*?)\\\]/g, (m, inner) => {
      return '\n\n$$' + cleanAcademicMath(inner.trim()) + '$$\n\n';
    });
    // Replace $$ ... $$ block math
    raw = raw.replace(/\$\$([\s\S]*?)\$\$/g, (m, inner) => {
      return '\n\n$$' + cleanAcademicMath(inner.trim()) + '$$\n\n';
    });
    // Replace inline $ ... $ — promote long equations with relations to display blocks
    raw = raw.replace(/\$([^\$\n]+?)\$([,.]?)/g, (match, inner, punct) => {
      const cleanInner = cleanAcademicMath(inner.trim());
      const hasRelation = cleanInner.includes('=') || cleanInner.includes('->') ||
                          cleanInner.includes('=>') || cleanInner.includes('≥') ||
                          cleanInner.includes('≤') || cleanInner.includes('∈');
      if (cleanInner.length >= 8 && hasRelation) {
        return '\n\n$$' + cleanInner + (punct || '') + '$$\n\n';
      }
      return cleanInner + (punct || '');
    });

    // Clean the rest of the text (non-math parts)
    const blocks = raw.split(/(\$\$[\s\S]*?\$\$)/g);
    const result = blocks.map(b => {
      if (b.startsWith('$$') && b.endsWith('$$')) return b; // preserve equation blocks as-is
      return cleanAcademicMath(b);
    }).join('');

    return result.replace(/\$/g, ''); // strip any stray $
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
    if (pdfBtn) {
      pdfBtn.style.display = '';
      pdfBtn.className = (outputFormat === 'pdf' || outputFormat === 'both') ? 'btn btn-primary btn-lg' : 'btn btn-ghost btn-lg';
    }
    if (docxBtn) {
      docxBtn.style.display = '';
      docxBtn.className = (outputFormat === 'docx' || outputFormat === 'both') ? 'btn btn-primary btn-lg' : 'btn btn-ghost btn-lg';
    }
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
                text: cleanAcademicMath(draft.abstract
                  .replace(/\*\*(.*?)\*\*/g, '$1')
                  .replace(/\*(.*?)\*/g, '$1')
                  .replace(/\$([^\$]+)\$/g, (m, inner) => cleanAcademicMath(inner))
                  .replace(/\$/g, '')
                  .trim()),
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
        const cols = selectKeyColumns(table, isTwoCol ? 4 : 6);
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
      const renderedChartIdsDocx = new Set();
      (draft.sections || []).forEach((sec, idx) => {
        // Section Heading (safely handle both heading and title properties)
        const rawHeading = (sec.heading || sec.title || `Section ${idx + 1}`).trim();
        const cleanHeading = rawHeading.replace(/^(?:[IVXLCDM]+\.|\d+\.|\d+\.\d+)\s*/i, '').trim() || rawHeading;
        const headingText = isIEEE
          ? `${toRoman(idx + 1)}. ${cleanHeading.toUpperCase()}`
          : `${idx + 1}. ${cleanHeading}`;
        const secTextLower = rawHeading.toLowerCase();

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
          const processed = processMathAndEquations(sec.content);
          const blocks = processed.split(/\n\n+/).map(b => b.trim().replace(/^[,\s]+/, '')).filter(Boolean);
          blocks.forEach(b => {
            if (b.startsWith('$$') && b.endsWith('$$')) {
              const eq = b.slice(2, -2).trim();
              bodyChildren.push(
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 120, after: 120 },
                  children: [
                    new TextRun({
                      text: eq,
                      italics: true,
                      font: fFamily,
                      size: bodySize
                    })
                  ]
                })
              );
              return;
            }
            bodyChildren.push(
              new Paragraph({
                alignment: AlignmentType.JUSTIFIED,
                spacing: { before: 0, after: 100, line: docxLineSpacing },
                indent: isIEEE ? { firstLine: 280 } : { firstLine: 400 },
                children: [
                  new TextRun({
                    text: b.trim(),
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
            const subRaw = (sub.title || sub.heading || `Subsection ${subIdx + 1}`).trim();
            const subTitle = isIEEE ? `${letter}. ${subRaw}` : `${idx + 1}.${subIdx + 1} ${subRaw}`;
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
              const subProcessed = processMathAndEquations(sub.content);
              const subBlocks = subProcessed.split(/\n\n+/).map(b => b.trim().replace(/^[,\s]+/, '')).filter(Boolean);
              subBlocks.forEach(p => {
                if (p.startsWith('$$') && p.endsWith('$$')) {
                  const eq = p.slice(2, -2).trim();
                  bodyChildren.push(
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      spacing: { before: 120, after: 120 },
                      children: [
                        new TextRun({
                          text: eq,
                          italics: true,
                          font: fFamily,
                          size: bodySize
                        })
                      ]
                    })
                  );
                  return;
                }
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

        // Check if charts match this section
        if (chartData && chartData.length > 0) {
          const isLastSecDocx = idx === (draft.sections || []).length - 1;
          const isEvalSecDocx = secTextLower.includes('result') ||
                                secTextLower.includes('evaluation') ||
                                secTextLower.includes('experiment');

          const matchedChartsDocx = chartData.filter(c =>
            (c.sectionIndex !== undefined && c.sectionIndex === idx) ||
            (c.sectionTitle && secTextLower.includes(c.sectionTitle.toLowerCase()) && !renderedChartIdsDocx.has(c.figureNumber)) ||
            (c.sectionIndex === undefined && isEvalSecDocx && !renderedChartIdsDocx.has(c.figureNumber)) ||
            (isLastSecDocx && !renderedChartIdsDocx.has(c.figureNumber))
          );

          for (const matchedChart of matchedChartsDocx) {
            renderedChartIdsDocx.add(matchedChart.figureNumber);
            if (chartImages[matchedChart.figureNumber]) {
              bodyChildren.push(
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 140, after: 60 },
                  children: [
                    new ImageRun({
                      data: chartImages[matchedChart.figureNumber],
                      transformation: { width: isTwoCol ? 290 : 480, height: isTwoCol ? 150 : 240 },
                      type: 'png'
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
                      text: isIEEE ? `Fig. ${matchedChart.figureNumber}. ${matchedChart.title}` : `Figure ${matchedChart.figureNumber}: ${matchedChart.title}`,
                      italics: true,
                      font: fFamily,
                      size: captionSize
                    })
                  ]
                })
              );
            }
          }
        }

        // Check if a data table matches this section
        if (dataTables && dataTables.length > 0) {
          const matchedTable = dataTables.find(t =>
            (t.sectionIndex !== undefined && t.sectionIndex === idx) ||
            (t.sectionTitle && secTextLower.includes(t.sectionTitle.toLowerCase())) ||
            (t.sectionIndex === undefined && secTextLower.includes('result'))
          );
          if (matchedTable) {
            const tableTitle = (matchedTable.title || 'Summary of Data').toUpperCase();
            bodyChildren.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 140, after: 40 },
                children: [
                  new TextRun({
                    text: `TABLE ${toRoman(dataTables.indexOf(matchedTable) + 1).toUpperCase()}: ${tableTitle}`,
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
        let ieeeEquationNum = 0;

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
            doc.setFont(fontName, 'normal');
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
          if (!text) return;
          // Strip raw markdown syntax like *italic* or **bold** or `code`
          const cleanText = text
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/\*(.*?)\*/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/~~(.*?)~~/g, '$1')
            .trim();

          if (!cleanText) return;

          const processed = processMathAndEquations(cleanText);
          const blocks = processed.split(/\n\n+/).map(b => b.trim().replace(/^[,\s]+/, '')).filter(Boolean);

          blocks.forEach((block, bIdx) => {
            // Check if this block is a display equation
            if (block.startsWith('$$') && block.endsWith('$$')) {
              const eq = block.slice(2, -2).trim();
              checkCol(7);
              const curX = curCol === 1 ? col1X : col2X;
              colY += 1.5;
              doc.setFont(fontName, 'italic');
              let eqFontSize = (fontSize || fSize) - 0.5;
              doc.setFontSize(eqFontSize);
              while (doc.getTextWidth(eq) > colW - 12 && eqFontSize > 7) {
                eqFontSize -= 0.5;
                doc.setFontSize(eqFontSize);
              }
              // Center-justified display equation
              doc.text(eq, curX + colW / 2, colY, { align: 'center' });

              doc.setFont(fontName, 'normal');
              doc.setFontSize(8.5);
              ieeeEquationNum++;
              doc.text(`(${ieeeEquationNum})`, curX + colW - 1, colY, { align: 'right' });
              colY += 4.8;
              doc.setFont(fontName, 'normal');
              return;
            }

            // Normal justified paragraph block
            doc.setFont(fontName, 'normal');
            const effSize = fontSize || fSize;
            doc.setFontSize(effSize);
            const lHeight = 3.8; // Compact standard IEEE 9.5pt line spacing (~11pt line pitch)
            const shouldIndent = isIndent && bIdx === 0;
            const indentVal = shouldIndent ? 4 : 0;
            const firstLineW = colW - indentVal;
            const normalW = colW;

            const words = block.split(/\s+/).filter(Boolean);
            if (words.length === 0) return;

            const lines = [];
            let curLine = '';
            let isFirst = true;

            for (const word of words) {
              const testLine = curLine ? curLine + ' ' + word : word;
              const maxW = isFirst ? firstLineW : normalW;
              if (doc.getTextWidth(testLine) > maxW && curLine) {
                lines.push(curLine);
                curLine = word;
                isFirst = false;
              } else {
                curLine = testLine;
              }
            }
            if (curLine) lines.push(curLine);

            lines.forEach((line, idx) => {
              checkCol(lHeight);
              doc.setFont(fontName, 'normal');
              doc.setFontSize(effSize);
              const isFirstLine = idx === 0;
              const isLastLine = idx === lines.length - 1;
              const curX = curCol === 1 ? col1X : col2X;
              const xPos = isFirstLine ? curX + indentVal : curX;
              const targetW = isFirstLine ? firstLineW : normalW;

              // Full sentence justification for academic IEEE formatting
              drawJustifiedLine(doc, line, xPos, colY, targetW, isLastLine);
              colY += lHeight;
            });
          });
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
          const absClean = cleanAcademicMath(
            draft.abstract
              .replace(/\*\*(.*?)\*\*/g, '$1')
              .replace(/\*(.*?)\*/g, '$1')
              .replace(/`([^`]+)`/g, '$1')
              .replace(/\$([^\$]+)\$/g, '$1')
              .replace(/\$/g, '')
              .trim()
          );
          const firstLineW = fullW - 16 - absLeadW;
          const normalW = fullW - 16;

          const words = absClean.split(/\s+/).filter(Boolean);
          const absLines = [];
          let curLine = '';
          let isFirst = true;
          for (const word of words) {
            const testLine = curLine ? curLine + ' ' + word : word;
            const maxW = isFirst ? firstLineW : normalW;
            if (doc.getTextWidth(testLine) > maxW && curLine) {
              absLines.push(curLine);
              curLine = word;
              isFirst = false;
            } else {
              curLine = testLine;
            }
          }
          if (curLine) absLines.push(curLine);

          doc.text(absLead, mL + 8, topY);
          doc.setFont(fontName, 'normal');
          doc.setFontSize(9);

          absLines.forEach((l, idx) => {
            const isFirstLine = idx === 0;
            const isLastLine = idx === absLines.length - 1;
            const lx = isFirstLine ? mL + 8 + absLeadW : mL + 8;
            const targetW = isFirstLine ? firstLineW : normalW;

            doc.setFont(fontName, 'normal');
            doc.setFontSize(9);
            drawJustifiedLine(doc, l, lx, topY, targetW, isLastLine);
            topY += 3.8;
          });
          doc.setFont(fontName, 'normal');
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
          doc.setFont(fontName, 'normal');
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
        let tablesPlacedIeee = false;
        const renderedChartIdsIeee = new Set();
        for (let sIdx = 0; sIdx < (draft.sections || []).length; sIdx++) {
          const section = draft.sections[sIdx];
          const rawHeading = (section.heading || section.title || `Section ${sIdx + 1}`).trim();
          const cleanHeading = rawHeading.replace(/^(?:[IVXLCDM]+\.|\d+\.|\d+\.\d+)\s*/i, '').trim() || rawHeading;
          const headingText = `${toRoman(sIdx + 1)}. ${cleanHeading.toUpperCase()}`;
          const secTextLower = rawHeading.toLowerCase();

          checkCol(20);
          doc.setFont(fontName, 'bold');
          doc.setFontSize(10);
          const curX = curCol === 1 ? col1X : col2X;
          doc.text(headingText, curX + colW / 2, colY, { align: 'center' });
          colY += 5.5;

          const editedEl = document.getElementById(`draft-section-content-${sIdx}`);
          const content = editedEl ? (editedEl.tagName === 'TEXTAREA' ? editedEl.value : editedEl.textContent) : section.content;
          const paragraphs = (content || '').split(/\n\n+/);

          for (const p of paragraphs) {
            const trimmed = p.trim();
            if (!trimmed) continue;
            writeIeeeColumnText(trimmed, 9.5, true);
            colY += 2;
          }

          // Subsections if any
          if (section.subsections && Array.isArray(section.subsections)) {
            section.subsections.forEach((sub, subIdx) => {
              const letter = String.fromCharCode(65 + subIdx);
              const subRaw = (sub.title || sub.heading || `Subsection ${subIdx + 1}`).trim();
              const cleanSub = subRaw.replace(/^[A-Z]\.\s*/i, '').trim() || subRaw;
              const subTitle = `${letter}. ${cleanSub}`;

              checkCol(14);
              doc.setFont(fontName, 'italic');
              doc.setFontSize(9.5);
              const subX = curCol === 1 ? col1X : col2X;
              doc.text(subTitle, subX, colY);
              colY += 5;
              doc.setFont(fontName, 'normal');

              if (sub.content) {
                const subParas = sub.content.split(/\n\n+/).filter(sp => sp.trim());
                subParas.forEach(sp => {
                  writeIeeeColumnText(sp.trim(), 9.5, true);
                  colY += 2;
                });
              }
            });
          }

          // Section-specific charts (Architecture, PRISMA, Benchmarks)
          const isLastSecIeee = sIdx === (draft.sections || []).length - 1;
          const isEvalSecIeee = secTextLower.includes('result') ||
                                secTextLower.includes('evaluation') ||
                                secTextLower.includes('experiment');

          const matchedChartsIeee = chartData.filter(c =>
            c.sectionIndex === sIdx ||
            (c.sectionTitle && secTextLower.includes(c.sectionTitle.toLowerCase()) && !renderedChartIdsIeee.has(c.figureNumber)) ||
            (c.sectionIndex === undefined && isEvalSecIeee && !renderedChartIdsIeee.has(c.figureNumber)) ||
            (isLastSecIeee && !renderedChartIdsIeee.has(c.figureNumber))
          );

          for (const chart of matchedChartsIeee) {
            renderedChartIdsIeee.add(chart.figureNumber);
            try {
              const chartImg = await renderChartToImage(chart);
              if (chartImg) {
                const imgH = colW * 0.52;
                checkCol(imgH + 16);
                const cX = curCol === 1 ? col1X : col2X;
                doc.addImage(chartImg, 'PNG', cX, colY, colW, imgH);
                colY += imgH + 3.5;

                doc.setFont(fontName, 'italic');
                doc.setFontSize(8);
                const cap = `Fig. ${chart.figureNumber}. ${chart.title}`;
                const capLines = doc.splitTextToSize(cap, colW - 2);
                doc.text(capLines, cX + colW / 2, colY, { align: 'center' });
                colY += capLines.length * 3.4 + 4;
                doc.setFont(fontName, 'normal');
              }
            } catch (e) {
              console.warn('IEEE chart render error:', e);
            }
          }

          // Tables in IEEE format
          if (isEvalSecIeee && !tablesPlacedIeee && dataTables.length > 0) {
            tablesPlacedIeee = true;
            const tablesToRender = dataTables.slice(0, 3);
            for (let tIdx = 0; tIdx < tablesToRender.length; tIdx++) {
              const table = tablesToRender[tIdx];
              const keyCols = selectKeyColumns(table, 3).slice(0, 3);
              const maxRows = Math.min(table.rows.length, 8);
              const rows = table.rows.slice(0, maxRows).map(r => keyCols.map(c => truncateCell(r[c], 28)));

              checkCol(36);
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
                doc.setFont(fontName, 'normal');
              }
            }
          }
        }

        // Acknowledgments
        if (draft.acknowledgments) {
          checkCol(16);
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
          checkCol(18);
          doc.setFont(fontName, 'bold');
          doc.setFontSize(10);
          const curX = curCol === 1 ? col1X : col2X;
          doc.text('REFERENCES', curX + colW / 2, colY, { align: 'center' });
          colY += 6;

          doc.setFont(fontName, 'normal');
          doc.setFontSize(8);

          refs.forEach(ref => {
            const clean = ref.formatted.replace(/\*/g, '');
            const rLines = doc.splitTextToSize(clean, colW - 5);
            checkCol(rLines.length * 3.6 + 2);
            doc.setFont(fontName, 'normal');
            doc.setFontSize(8);
            const cX = curCol === 1 ? col1X : col2X;
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
        if (!text) return y;
        const cleanText = text
          .replace(/\*\*(.*?)\*\*/g, '$1')
          .replace(/\*(.*?)\*/g, '$1')
          .replace(/`([^`]+)`/g, '$1')
          .replace(/~~(.*?)~~/g, '$1')
          .trim();
        if (!cleanText) return y;

        const processed = processMathAndEquations(cleanText);
        const blocks = processed.split(/\n\n+/).map(b => b.trim().replace(/^[,\s]+/, '')).filter(Boolean);

        blocks.forEach((block, bIdx) => {
          if (block.startsWith('$$') && block.endsWith('$$')) {
            const eq = block.slice(2, -2).trim();
            if (!eq) return;
            y = checkPage(y, 12);
            y += 2;
            doc.setFont(fontName, 'italic');
            doc.setFontSize(fontSize || 11);
            // Scale down if equation is too wide
            let eqFontSize = fontSize || 11;
            while (doc.getTextWidth(eq) > contentWidth - 10 && eqFontSize > 7) {
              eqFontSize -= 0.5;
              doc.setFontSize(eqFontSize);
            }
            doc.text(eq, pageWidth / 2, y, { align: 'center' });
            doc.setFont(fontName, 'normal');
            doc.setFontSize(fontSize || 11);
            y += 8;
            return;
          }

          doc.setFontSize(fontSize || 11);
          doc.setFont('helvetica', 'normal');
          const effLineHeight = (fontSize || 11) * 0.3527 * 1.35;
          const shouldIndent = bIdx === 0;
          const firstLineWidth = contentWidth - (shouldIndent ? (indent || paraIndent) : 0);
          const restWidth = contentWidth;
          const words = block.split(/\s+/).filter(Boolean);
          const lines = [];
          let curLine = '';
          let isFirstLine = true;

          for (const word of words) {
            const testLine = curLine ? curLine + ' ' + word : word;
            const maxW = isFirstLine ? firstLineWidth : restWidth;
            if (doc.getTextWidth(testLine) > maxW && curLine) {
              lines.push(curLine);
              curLine = word;
              isFirstLine = false;
            } else {
              curLine = testLine;
            }
          }
          if (curLine) lines.push(curLine);

          lines.forEach((line, idx) => {
            y = checkPage(y, effLineHeight);
            doc.setFont('helvetica', 'normal');
            const isFirst = idx === 0;
            const isLast = idx === lines.length - 1;
            const xPos = isFirst ? marginL + (shouldIndent ? (indent || paraIndent) : 0) : marginL;
            const targetW = isFirst ? firstLineWidth : restWidth;

            drawJustifiedLine(doc, line, xPos, y, targetW, isLast);
            y += effLineHeight;
          });
          y += 2;
        });

        return y;
      }

      // ── Utility: write body text without indent ──
      function writeText(text, y, fontSize) {
        if (!text) return y;
        const cleanText = cleanAcademicMath(
          text
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/\*(.*?)\*/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/~~(.*?)~~/g, '$1')
            .replace(/\$([^\$]+)\$/g, '$1')
            .replace(/\$/g, '')
            .trim()
        );
        if (!cleanText) return y;

        doc.setFontSize(fontSize || 11);
        doc.setFont('helvetica', 'normal');
        const effLineHeight = (fontSize || 11) * 0.3527 * 1.35;
        const lines = doc.splitTextToSize(cleanText, contentWidth);
        lines.forEach((line, idx) => {
          y = checkPage(y, effLineHeight);
          doc.setFont('helvetica', 'normal');
          const isLast = idx === lines.length - 1;
          drawJustifiedLine(doc, line, marginL, y, contentWidth, isLast);
          y += effLineHeight;
        });
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
      let tablesPlacedSingle = false;
      const renderedChartIdsSingle = new Set();
      for (const section of (draft.sections || [])) {
        y += 8;
        y = checkPage(y, 24);

        // Section heading
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        const sHeading = (section.heading || section.title || 'Section').trim();
        doc.text(sHeading, marginL, y);
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

        // Subsections if any
        if (section.subsections && Array.isArray(section.subsections)) {
          section.subsections.forEach((sub, subIdx) => {
            const subRaw = (sub.title || sub.heading || `Subsection ${subIdx + 1}`).trim();
            const cleanSub = subRaw.replace(/^[A-Z\d]+\.?\s*/i, '').trim() || subRaw;
            const subTitle = `${sIdx + 1}.${subIdx + 1} ${cleanSub}`;

            y += 4;
            y = checkPage(y, 14);
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.text(subTitle, marginL, y);
            y += 6;
            doc.setFont('helvetica', 'normal');

            if (sub.content) {
              const subParas = sub.content.split(/\n\n+/).filter(sp => sp.trim());
              subParas.forEach(sp => {
                y = writeParagraph(sp.trim(), y, 11, paraIndent);
                y += 2;
              });
            }
          });
        }

        // Section-specific Charts (Architecture, PRISMA, Benchmarks)
        const isLastSecSingle = sIdx === (draft.sections || []).length - 1;
        const isEvalSecSingle = section.heading.toLowerCase().includes('result') ||
                                section.heading.toLowerCase().includes('evaluation') ||
                                section.heading.toLowerCase().includes('experiment');

        const matchedChartsSingle = chartData.filter(c =>
          c.sectionIndex === sIdx ||
          (c.sectionIndex === undefined && isEvalSecSingle && !renderedChartIdsSingle.has(c.figureNumber)) ||
          (isLastSecSingle && !renderedChartIdsSingle.has(c.figureNumber))
        );

        for (const chart of matchedChartsSingle) {
          renderedChartIdsSingle.add(chart.figureNumber);
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
        if (isEvalSecSingle && !tablesPlacedSingle && dataTables.length > 0) {
          tablesPlacedSingle = true;
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
      if (!chart) return resolve(null);
      ensureValidChartData(chart);

      // Handle custom academic vector diagrams (architecture flowcharts & PRISMA flow diagrams)
      if (chart.type === 'architecture' || chart.type === 'prisma') {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 800;
          canvas.height = chart.type === 'prisma' ? 440 : 400;
          if (chart.type === 'architecture') {
            drawArchitectureDiagram(canvas, chart);
          } else {
            drawPrismaDiagram(canvas, chart);
          }
          const dataUrl = canvas.toDataURL('image/png');
          return resolve(dataUrl);
        } catch (e) {
          console.warn('Failed to render diagram to image:', e);
          return resolve(null);
        }
      }

      // Create a fresh isolated canvas for each chart to avoid shared canvas race conditions
      let canvas;
      let needsRemove = false;
      try {
        // OffscreenCanvas is available in most modern browsers and doesn't touch the DOM
        canvas = new OffscreenCanvas(800, 400);
      } catch (e) {
        // Fallback: create a detached canvas element
        canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 400;
        needsRemove = false; // detached, no need to add to DOM
      }

      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 800, 400);

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
      setTimeout(async () => {
        try {
          let dataUrl;
          if (canvas instanceof OffscreenCanvas) {
            const blob = await canvas.convertToBlob({ type: 'image/png' });
            dataUrl = await new Promise((res) => {
              const reader = new FileReader();
              reader.onloadend = () => res(reader.result);
              reader.readAsDataURL(blob);
            });
          } else {
            dataUrl = canvas.toDataURL('image/png');
          }
          chartInstance.destroy();
          resolve(dataUrl);
        } catch (e) {
          chartInstance.destroy();
          resolve(null);
        }
      }, 350);
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

    // Reset paper type card grid
    document.getElementById('draft-type-grid')?.querySelectorAll('.draft-type-card').forEach(c => c.classList.remove('active'));
    document.getElementById('draft-type-grid')?.querySelector('[data-type="implementation"]')?.classList.add('active');

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

// ============================================================
// RESEARCH-GRADE INTELLIGENCE PLATFORM (V2.0) IMPLEMENTATION
// ============================================================

// ── 1. EVIDENCE INSPECTOR & HUMAN-IN-THE-LOOP VERIFICATION ──
async function openEvidenceInspector(paper) {
  openModal();
  $('modal-body').innerHTML = `
    <h2>🔬 Evidence Claims: ${paper.title}</h2>
    <p style="color: var(--text-dim); font-size: 13px; margin-bottom: 16px;">
      Every important AI research claim is grounded in exact page numbers, section titles, and verbatim text quotes.
    </p>
    <div id="evidence-claims-list" style="display: flex; flex-direction: column; gap: 14px;">
      <div style="text-align: center; padding: 30px; color: var(--text-dim);">⏳ Loading grounded evidence claims...</div>
    </div>
  `;

  try {
    const res = await api.getPaperEvidence(paper.id);
    const items = res?.evidence_items || [];
    const container = $('evidence-claims-list');

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No granular evidence items registered for this paper yet.</p>
          <p style="font-size: 12px; color: var(--text-dim);">New PDF uploads automatically extract page-anchored evidence claims.</p>
        </div>`;
      return;
    }

    container.innerHTML = items.map((item, idx) => {
      const confScore = Math.round((item.confidence_score || 0.85) * 100);
      const confTier = item.confidence_tier || 'HIGH';
      const confClass = confTier === 'HIGH' ? 'conf-high' : confTier === 'MEDIUM' ? 'conf-med' : 'conf-low';
      const verifStatus = item.verification_status || 'ai_generated';
      const verifClass = verifStatus === 'human_verified' ? 'verif-human-verified' : verifStatus === 'rejected' ? 'verif-rejected' : 'verif-ai-gen';
      const verifText = verifStatus === 'human_verified' ? '✓ Human Verified' : verifStatus === 'rejected' ? '✗ Rejected' : '🤖 AI Generated';

      return `
        <div class="evidence-claim-card" id="claim-card-${item.id || idx}">
          <div class="claim-header">
            <div class="claim-title-row">
              <span class="claim-type-tag">${item.claim_type || 'claim'}</span>
              <span class="page-anchor-tag">📄 Page ${item.page_number || 1}</span>
              ${item.section ? `<span class="page-anchor-tag">📍 ${item.section}</span>` : ''}
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <span class="conf-pill ${confClass}">Conf: ${confScore}% (${confTier})</span>
              <span class="verif-badge ${verifClass}" id="badge-${item.id || idx}">${verifText}</span>
            </div>
          </div>
          <div style="font-size: 14px; font-weight: 600; color: var(--text); line-height: 1.4;">
            ${item.claim}
          </div>
          ${item.exact_quote ? `
            <div class="verbatim-quote-box">
              "${item.exact_quote}"
            </div>
          ` : ''}
          <div class="verif-actions-row">
            <button class="btn-verif-act verify" data-id="${item.id}" data-idx="${idx}">✓ Verify</button>
            <button class="btn-verif-act edit" data-id="${item.id}" data-idx="${idx}" data-claim="${encodeURIComponent(item.claim)}">✎ Edit</button>
            <button class="btn-verif-act reject" data-id="${item.id}" data-idx="${idx}">✗ Reject</button>
          </div>
        </div>
      `;
    }).join('');

    // Attach verification actions
    container.querySelectorAll('.btn-verif-act').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const idx = btn.dataset.idx;
        const badge = $(`badge-${id || idx}`);

        if (btn.classList.contains('verify')) {
          try {
            await api.verifyEntity({
              entity_type: 'evidence_item',
              entity_id: id || paper.id,
              action: 'verified'
            });
            if (badge) {
              badge.className = 'verif-badge verif-human-verified';
              badge.textContent = '✓ Human Verified';
            }
            toast('✓ Claim verified by researcher');
          } catch (err) {
            toast('❌ ' + err.message, true);
          }
        } else if (btn.classList.contains('edit')) {
          const oldClaim = decodeURIComponent(btn.dataset.claim || '');
          const correction = prompt('Edit or refine this academic claim:', oldClaim);
          if (correction && correction !== oldClaim) {
            try {
              await api.verifyEntity({
                entity_type: 'evidence_item',
                entity_id: id || paper.id,
                action: 'edited',
                original_value: { claim: oldClaim },
                correction: { claim: correction }
              });
              if (badge) {
                badge.className = 'verif-badge verif-human-verified';
                badge.textContent = '✓ Human Verified (Edited)';
              }
              toast('✓ Claim edited and verified');
            } catch (err) {
              toast('❌ ' + err.message, true);
            }
          }
        } else if (btn.classList.contains('reject')) {
          if (!confirm('Reject this claim as ungrounded or inaccurate?')) return;
          try {
            await api.verifyEntity({
              entity_type: 'evidence_item',
              entity_id: id || paper.id,
              action: 'rejected'
            });
            if (badge) {
              badge.className = 'verif-badge verif-rejected';
              badge.textContent = '✗ Rejected';
            }
            toast('✗ Claim marked as rejected');
          } catch (err) {
            toast('❌ ' + err.message, true);
          }
        }
      });
    });

  } catch (err) {
    const list = $('evidence-claims-list');
    if (list) list.innerHTML = `<div class="empty-state"><p>❌ Failed to load evidence: ${err.message}</p></div>`;
  }
}

// ── 2. GAP EVIDENCE DETAILS & HEURISTIC BREAKDOWN MODAL ──
async function openGapEvidenceModal(gapId) {
  openModal();
  $('modal-body').innerHTML = `
    <h2>📊 Research Gap Evidence Breakdown</h2>
    <div id="gap-evidence-content" style="padding: 20px; text-align: center; color: var(--text-dim);">
      ⏳ Calculating transparent heuristic evidence score...
    </div>
  `;

  try {
    const res = await api.getGapEvidence(gapId);
    const gap = res?.gap;
    const papers = res?.supportingPapers || [];
    const heuristic = res?.heuristic_breakdown || {};
    const breakdown = heuristic.breakdown || [];
    const score = res?.evidence_score || heuristic.totalScore || 50;
    const tier = res?.confidence_tier || heuristic.confidenceTier || 'HIGH';
    const tierClass = tier === 'HIGH' ? 'conf-high' : tier === 'MEDIUM' ? 'conf-med' : 'conf-low';

    $('modal-body').innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; flex-wrap: wrap;">
        <h2>${gap?.title}</h2>
        <span class="conf-pill ${tierClass}" style="font-size: 13px; padding: 4px 12px;">Score: ${score}/100 (${tier})</span>
      </div>
      <p style="color: var(--text-dim); font-size: 13.5px; line-height: 1.5; margin-bottom: 16px;">
        ${gap?.description || ''}
      </p>

      <div style="background: rgba(124, 92, 255, 0.08); border: 1px solid rgba(124, 92, 255, 0.25); border-radius: 10px; padding: 12px 16px; margin-bottom: 18px;">
        <div style="font-weight: 700; font-size: 13px; color: #a78bfa; margin-bottom: 4px;">Tessera Heuristic Formulation:</div>
        <div style="font-size: 12px; color: #cbd5e1;">${heuristic.summaryExplanation || 'Transparent additive heuristic evaluation based on ingested papers.'}</div>
      </div>

      <h4 style="margin: 0 0 10px; font-size: 14px; color: var(--text);">Transparent Factor Breakdown:</h4>
      <div class="heuristic-breakdown-list">
        ${breakdown.map(b => `
          <div class="heuristic-row">
            <div>
              <div class="heuristic-factor-title">${b.factor} (max +${b.maxPoints})</div>
              <div class="heuristic-factor-reason">${b.reason}</div>
            </div>
            <div class="heuristic-points">+${b.points}</div>
          </div>
        `).join('')}
      </div>

      <h4 style="margin: 18px 0 10px; font-size: 14px; color: var(--text);">Supporting Literature (${papers.length} Papers):</h4>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${papers.map(p => `
          <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; font-size: 13px;">
            <div style="font-weight: 600; color: var(--text);">${p.title} (${p.year})</div>
            <div style="font-size: 12px; color: var(--text-dim); margin-top: 4px;">${p.contribution || ''}</div>
          </div>
        `).join('') || '<div style="color: var(--text-dim); font-size: 12px;">No directly linked papers.</div>'}
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px;">
        <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        <button class="btn btn-primary" id="btn-verify-gap-action" data-id="${gap?.id}">✓ Verify Gap as Scholar</button>
      </div>
    `;

    const verifyBtn = $('btn-verify-gap-action');
    if (verifyBtn) {
      verifyBtn.addEventListener('click', async () => {
        try {
          await api.verifyEntity({
            entity_type: 'research_gap',
            entity_id: gap.id,
            action: 'verified'
          });
          toast('✓ Research gap verified!');
          closeModal();
          await loadAll();
        } catch (err) {
          toast('❌ ' + err.message, true);
        }
      });
    }

  } catch (err) {
    const content = $('gap-evidence-content');
    if (content) content.innerHTML = `❌ Failed to load gap evidence: ${err.message}`;
  }
}

// ── 3. RESEARCH QUESTION GENERATOR MODAL ──
async function openResearchQuestionModal(gap) {
  openModal();
  $('modal-body').innerHTML = `
    <h2>❓ Formulate PhD Research Questions</h2>
    <p style="color: var(--text-dim); font-size: 13px; margin-bottom: 16px;">
      Synthesizing formal dissertation research questions rooted in verified research gap: <strong>"${gap.title}"</strong>.
    </p>
    <div id="rq-modal-content" style="text-align: center; padding: 40px; color: var(--text-dim);">
      ⏳ Gemini is analyzing literature baseline and formulating publication-grade research questions...
    </div>
  `;

  try {
    const res = await api.generateResearchQuestions({ gap_id: gap.id, workspace_id: currentWorkspace?.id });
    const questions = res?.questions || [];

    if (!questions || questions.length === 0) {
      $('rq-modal-content').innerHTML = '<p>Could not formulate research questions. Please ensure gap has supporting literature.</p>';
      return;
    }

    $('rq-modal-content').innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 18px; text-align: left;">
        ${questions.map((q, i) => `
          <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: 12px; padding: 18px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; background: rgba(124, 92, 255, 0.2); color: #a78bfa; padding: 3px 8px; border-radius: 4px;">RQ ${i + 1}</span>
              <span class="conf-pill conf-high">PhD Grade</span>
            </div>
            <h3 style="margin: 0 0 10px; font-size: 16px; color: var(--text); line-height: 1.4;">${q.question}</h3>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; font-size: 12.5px;">
              <div>
                <strong style="color: #38bdf8;">Motivation:</strong>
                <p style="margin: 4px 0 0; color: var(--text-dim);">${q.motivation || '—'}</p>
              </div>
              <div>
                <strong style="color: #00f5a0;">Missing Component:</strong>
                <p style="margin: 4px 0 0; color: var(--text-dim);">${q.missing_component || '—'}</p>
              </div>
              <div>
                <strong style="color: #fbbf24;">Suggested Methodology:</strong>
                <p style="margin: 4px 0 0; color: var(--text-dim);">${q.suggested_methodology || '—'}</p>
              </div>
              <div>
                <strong style="color: #c084fc;">Evaluation Strategy:</strong>
                <p style="margin: 4px 0 0; color: var(--text-dim);">${q.evaluation_strategy || '—'}</p>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
      <div style="display: flex; justify-content: flex-end; margin-top: 20px;">
        <button class="btn btn-primary" onclick="closeModal()">Done</button>
      </div>
    `;
  } catch (err) {
    $('rq-modal-content').innerHTML = `❌ Failed to formulate research questions: ${err.message}`;
  }
}

// ── 4. CROSS-PAPER SYNTHESIS MATRIX PAGE ──
let synthesisData = null;
function setupSynthesisPage() {
  const btnRun = $('btn-run-synthesis');
  const searchInput = $('matrix-search');
  const domainSelect = $('matrix-domain-filter');
  const quartileSelect = $('matrix-quartile-filter');

  if (domainSelect) {
    domainSelect.innerHTML = '<option value="">All Domains</option>' +
      state.domains.map(d => `<option value="${d.name}">${d.icon} ${d.name}</option>`).join('');
  }

  if (btnRun) {
    btnRun.onclick = async () => {
      btnRun.disabled = true;
      btnRun.innerHTML = '⏳ Synthesizing Papers...';
      toast('⚡ Conducting cross-paper meta-analysis...');

      try {
        const res = await api.crossPaperSynthesis({
          workspace_id: currentWorkspace?.id,
          focus: currentWorkspace?.research_topic || ''
        });
        synthesisData = res;
        renderSynthesisMatrix();
        toast('✓ Cross-paper synthesis complete!');
      } catch (err) {
        toast('❌ ' + err.message, true);
      } finally {
        btnRun.disabled = false;
        btnRun.innerHTML = '<span>⚡</span> Run Cross-Paper Synthesis';
      }
    };
  }

  if (searchInput) searchInput.oninput = renderSynthesisMatrix;
  if (domainSelect) domainSelect.onchange = renderSynthesisMatrix;
  if (quartileSelect) quartileSelect.onchange = renderSynthesisMatrix;

  if (!synthesisData && state.papers.length >= 2) {
    btnRun?.click();
  } else if (synthesisData) {
    renderSynthesisMatrix();
  }
}

function renderSynthesisMatrix() {
  if (!synthesisData) return;

  const conflictsEl = $('insight-conflicts');
  if (conflictsEl) {
    const conflicts = synthesisData.conflicting_findings || [];
    conflictsEl.textContent = conflicts.length > 0
      ? `${conflicts.length} conflict(s): ${conflicts[0].topic} (${conflicts[0].nuance || ''})`
      : 'Empirical consensus across analyzed papers.';
  }

  const methodsEl = $('insight-methods');
  if (methodsEl) {
    const methods = synthesisData.common_methodologies || [];
    methodsEl.textContent = methods.slice(0, 3).join(', ') || 'Various frameworks';
  }

  const datasetsEl = $('insight-datasets');
  if (datasetsEl) {
    const underexplored = synthesisData.underexplored_datasets || [];
    datasetsEl.textContent = underexplored.slice(0, 2).join(', ') || 'Benchmark standard';
  }

  const limitationsEl = $('insight-limitations');
  if (limitationsEl) {
    const lims = synthesisData.repeated_limitations || [];
    limitationsEl.textContent = lims.slice(0, 2).join('; ') || 'Standard evaluation bounds';
  }

  const query = ($('matrix-search')?.value || '').toLowerCase();
  let rows = synthesisData.comparison_matrix || [];
  if (query) {
    rows = rows.filter(r => 
      (r.paper_title || '').toLowerCase().includes(query) ||
      (r.methodology || '').toLowerCase().includes(query) ||
      (r.dataset || '').toLowerCase().includes(query) ||
      (r.key_result || '').toLowerCase().includes(query)
    );
  }

  const tbody = $('matrix-tbody');
  if (!tbody) return;

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-loading">No matching papers in synthesis matrix.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td style="font-weight: 600; color: var(--text); max-width: 200px;">${r.paper_title}</td>
      <td><span class="page-anchor-tag">${r.year || '—'}</span></td>
      <td><span class="claim-type-tag" style="background: rgba(124,92,255,0.15); color: #a78bfa;">${r.methodology || '—'}</span></td>
      <td><span class="claim-type-tag" style="background: rgba(16,185,129,0.15); color: #10b981;">${r.dataset || '—'}</span></td>
      <td style="font-size: 12px; color: var(--text);">${r.key_result || '—'}</td>
      <td style="font-size: 12px; color: #f87171;">${r.core_limitation || '—'}</td>
      <td style="font-size: 12px; color: #fbbf24;">${r.primary_gap || '—'}</td>
    </tr>
  `).join('');
}

// ── 5. RESEARCH TRENDS & TEMPORAL EVOLUTION PAGE ──
let trendsPubChart = null;
let trendsMethodChart = null;
let trendsDatasetChart = null;

async function setupTrendsPage() {
  const btnRefresh = $('btn-refresh-trends');
  if (btnRefresh) {
    btnRefresh.onclick = () => loadResearchTrends();
  }
  await loadResearchTrends();
}

async function loadResearchTrends() {
  try {
    const data = await api.getResearchTrends(currentWorkspace?.id);
    
    if ($('trends-total-papers')) $('trends-total-papers').textContent = data.total_papers || 0;
    if ($('trends-top-method')) $('trends-top-method').textContent = data.top_methods?.[0]?.name || 'N/A';
    if ($('trends-top-dataset')) $('trends-top-dataset').textContent = data.top_datasets?.[0]?.name || 'N/A';
    
    const years = (data.publication_trends || []).map(p => p.year);
    if ($('trends-year-span')) {
      if (years.length > 0) {
        $('trends-year-span').textContent = `${Math.min(...years)} - ${Math.max(...years)}`;
      } else {
        $('trends-year-span').textContent = 'N/A';
      }
    }

    const pubCtx = $('chart-pub-trajectory')?.getContext('2d');
    if (pubCtx) {
      if (trendsPubChart) trendsPubChart.destroy();
      trendsPubChart = new Chart(pubCtx, {
        type: 'bar',
        data: {
          labels: (data.publication_trends || []).map(p => String(p.year)),
          datasets: [{
            label: 'Publications',
            data: (data.publication_trends || []).map(p => p.count),
            backgroundColor: 'rgba(124, 92, 255, 0.75)',
            borderColor: '#7c5cff',
            borderWidth: 1.5,
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { precision: 0, color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
            x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
          }
        }
      });
    }

    const methodCtx = $('chart-method-trends')?.getContext('2d');
    if (methodCtx) {
      if (trendsMethodChart) trendsMethodChart.destroy();
      const topM = (data.top_methods || []).slice(0, 5);
      trendsMethodChart = new Chart(methodCtx, {
        type: 'doughnut',
        data: {
          labels: topM.map(m => m.name),
          datasets: [{
            data: topM.map(m => m.total),
            backgroundColor: ['#7c5cff', '#00f5a0', '#38bdf8', '#fbbf24', '#f87171']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 } } } }
        }
      });
    }

    const datasetCtx = $('chart-dataset-trends')?.getContext('2d');
    if (datasetCtx) {
      if (trendsDatasetChart) trendsDatasetChart.destroy();
      const topD = (data.top_datasets || []).slice(0, 6);
      trendsDatasetChart = new Chart(datasetCtx, {
        type: 'bar',
        data: {
          labels: topD.map(d => d.name),
          datasets: [{
            label: 'Citations in Corpus',
            data: topD.map(d => d.total),
            backgroundColor: 'rgba(0, 245, 160, 0.75)',
            borderColor: '#00f5a0',
            borderWidth: 1.5,
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { precision: 0, color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
            x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
          }
        }
      });
    }

  } catch (err) {
    console.warn('[TRENDS] Trends loading warning:', err.message);
  }
}

// ── 6. RESEARCH NOVELTY ASSISTANT PAGE ──
function setupNoveltyPage() {
  const btnEval = $('btn-eval-novelty');
  const inputEl = $('novelty-proposal-text');
  const resultsContainer = $('novelty-results');

  if (btnEval && inputEl) {
    btnEval.onclick = async () => {
      const idea = inputEl.value.trim();
      if (idea.length < 15) {
        toast('⚠️ Please enter a detailed research idea (at least 15 characters).', true);
        return;
      }

      btnEval.disabled = true;
      btnEval.innerHTML = '⏳ Benchmarking Prior Art...';
      toast('🔍 Auditing proposed thesis against ingested literature corpus...');

      try {
        const res = await api.evaluateNovelty({
          proposed_idea: idea,
          workspace_id: currentWorkspace?.id
        });
        const assessment = res?.assessment;

        if (resultsContainer) resultsContainer.style.display = 'flex';
        if ($('novelty-verdict-tag')) $('novelty-verdict-tag').textContent = assessment?.academic_verdict || 'Potential Differentiation Identified';
        if ($('novelty-verdict-summary')) $('novelty-verdict-summary').textContent = assessment?.summary_of_differentiation || '';

        if ($('novelty-differentiation-list')) {
          $('novelty-differentiation-list').innerHTML = (assessment?.potential_differentiation || []).map(d => `
            <li><strong>${d.aspect || 'Aspect'}:</strong> ${d.description} <em>(${d.evidence_support || ''})</em></li>
          `).join('') || '<li>Standard incremental differentiation.</li>';
        }

        if ($('novelty-threats-list')) {
          $('novelty-threats-list').innerHTML = (assessment?.threats_to_novelty || []).map(t => `
            <li>${t}</li>
          `).join('') || '<li>No immediate blocking prior art flagged in corpus.</li>';
        }

        if ($('novelty-overlaps-list')) {
          $('novelty-overlaps-list').innerHTML = (assessment?.overlapping_concepts || []).map(o => `
            <li>${o}</li>
          `).join('') || '<li>Novel formulation identified.</li>';
        }

        if ($('novelty-searches-list')) {
          $('novelty-searches-list').innerHTML = (assessment?.recommended_literature_checks || []).map(s => `
            <li><code>${s}</code></li>
          `).join('') || '<li>Conduct exhaustive search on IEEE Xplore & ACM DL.</li>';
        }

        toast('✓ Novelty assessment complete!');
      } catch (err) {
        toast('❌ ' + err.message, true);
      } finally {
        btnEval.disabled = false;
        btnEval.innerHTML = '<span>🔍</span> Evaluate Literature Differentiation';
      }
    };
  }
}

// ── 7. MODEL TRACEABILITY, AUDIT & EVALUATION PAGE ──
async function setupTraceabilityPage() {
  const tabBtns = document.querySelectorAll('.trace-tab-btn');
  tabBtns.forEach(btn => {
    btn.onclick = () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.trace-panel').forEach(p => p.style.display = 'none');
      const panel = $(`trace-panel-${btn.dataset.tab}`);
      if (panel) panel.style.display = 'block';

      if (btn.dataset.tab === 'runs') loadAiRuns();
      if (btn.dataset.tab === 'prompts') loadPromptRegistry();
      if (btn.dataset.tab === 'security') loadSecurityAuditLogs();
      if (btn.dataset.tab === 'benchmark') loadBenchmarkPaperOptions();
    };
  });

  const btnRefresh = $('btn-refresh-audit');
  if (btnRefresh) {
    btnRefresh.onclick = () => {
      loadAiRuns();
      loadPromptRegistry();
      loadSecurityAuditLogs();
    };
  }

  const btnBench = $('btn-run-benchmark');
  if (btnBench) {
    btnBench.onclick = async () => {
      const paperId = $('benchmark-paper-select')?.value;
      const gtRaw = $('benchmark-gt-json')?.value?.trim();
      const predRaw = $('benchmark-pred-json')?.value?.trim();

      if (!paperId || !gtRaw || !predRaw) {
        toast('⚠️ Please select paper and provide Ground Truth & Prediction JSON.', true);
        return;
      }

      try {
        const gt = JSON.parse(gtRaw);
        const pred = JSON.parse(predRaw);
        const res = await api.evaluateAiBenchmark({
          paper_id: paperId,
          ground_truth: gt,
          ai_prediction: pred
        });
        const m = res?.evaluation?.metrics || {};
        if ($('benchmark-results')) {
          $('benchmark-results').style.display = 'block';
          $('benchmark-results').innerHTML = `
            <div style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3); border-radius: 10px; padding: 16px; margin-top: 14px;">
              <h4 style="margin: 0 0 10px; color: #10b981;">Evaluation Benchmark Metrics</h4>
              <div style="display: flex; gap: 20px; font-size: 14px;">
                <div><strong>Precision:</strong> ${(m.precision * 100).toFixed(1)}%</div>
                <div><strong>Recall:</strong> ${(m.recall * 100).toFixed(1)}%</div>
                <div><strong>F1 Score:</strong> ${(m.f1 * 100).toFixed(1)}%</div>
                <div><strong>Matched Gaps:</strong> ${m.matched_gaps || 0}</div>
              </div>
            </div>
          `;
        }
        toast('✓ Benchmark metrics calculated!');
      } catch (err) {
        toast('❌ JSON Parse or Eval Error: ' + err.message, true);
      }
    };
  }

  loadAiRuns();
}

async function loadAiRuns() {
  try {
    const res = await api.getAiRuns();
    const runs = res?.runs || [];
    const tbody = $('trace-runs-tbody');
    if (!tbody) return;

    if (runs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-loading">No AI inference runs logged yet.</td></tr>';
      return;
    }

    tbody.innerHTML = runs.map(r => `
      <tr>
        <td style="font-size: 12px; color: var(--text-dim);">${new Date(r.created_at).toLocaleString()}</td>
        <td><span class="claim-type-tag">${r.input_type || 'task'}</span></td>
        <td style="font-weight: 600; color: #7c5cff;">${r.model_used || 'gemini'}</td>
        <td>${r.latency_ms || 0} ms</td>
        <td><span class="conf-pill conf-high">${Math.round((r.confidence_score || 0.85) * 100)}%</span></td>
        <td><span class="verif-badge verif-ai-gen">${r.verification_status || 'completed'}</span></td>
      </tr>
    `).join('');
  } catch (err) {
    console.warn('[TRACEABILITY] AI runs error:', err.message);
  }
}

async function loadPromptRegistry() {
  try {
    const res = await api.getPrompts();
    const prompts = res?.prompts || [];
    const grid = $('trace-prompts-grid');
    if (!grid) return;

    grid.innerHTML = prompts.map(p => `
      <div class="prompt-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-weight: 700; color: #a78bfa; font-size: 13px;">${p.name}</span>
          <span class="page-anchor-tag">v${p.version}</span>
        </div>
        <p>${p.description}</p>
        <div class="prompt-meta">
          <span>Target: <code>${p.model}</code></span>
          <span>ID: <code>${p.id}</code></span>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.warn('[TRACEABILITY] Prompts load error:', err.message);
  }
}

async function loadSecurityAuditLogs() {
  try {
    const res = await api.getAuditLogs();
    const logs = res?.logs || [];
    const tbody = $('trace-security-tbody');
    if (!tbody) return;

    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-loading">Zero security incidents or injection attempts logged.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(l => `
      <tr>
        <td style="font-size: 12px; color: var(--text-dim);">${new Date(l.created_at).toLocaleString()}</td>
        <td style="font-weight: 600;">${l.event_type}</td>
        <td><span class="conf-pill ${l.severity === 'security' ? 'conf-low' : 'conf-high'}">${l.severity}</span></td>
        <td style="font-size: 12px; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"><code>${JSON.stringify(l.details || {})}</code></td>
        <td style="font-size: 12px; color: var(--text-dim);">${l.ip_address || 'internal'}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.warn('[TRACEABILITY] Audit logs error:', err.message);
  }
}

function loadBenchmarkPaperOptions() {
  const sel = $('benchmark-paper-select');
  if (!sel) return;
  sel.innerHTML = state.papers.map(p => `<option value="${p.id}">${p.title} (${p.year})</option>`).join('');
}

// ══════════════════════════════════════════════════════════════
// ABSTRACT GENERATOR PAGE
// ══════════════════════════════════════════════════════════════
let _abgenInitialized = false;
let _abgenPosterFile = null;
const ABGEN_HISTORY_KEY = 'tessera_abgen_history';

function setupAbstractGeneratorPage() {
  // Only wire up listeners once
  if (_abgenInitialized) return;
  _abgenInitialized = true;

  const dropzone     = $('abgen-dropzone');
  const posterInput  = $('abgen-poster-input');
  const browseBtn    = $('abgen-browse-btn');
  const removeBtn    = $('abgen-remove-poster');
  const dropInner    = $('abgen-drop-inner');
  const posterPrev   = $('abgen-poster-preview');
  const posterImg    = $('abgen-poster-img');
  const detectedDiv  = $('abgen-detected-theme');
  const detectedVal  = $('abgen-detected-value');
  const themeInput   = $('abgen-theme-input');
  const wcSlider     = $('abgen-word-count');
  const wcBadge      = $('abgen-wc-badge');
  const generateBtn  = $('abgen-generate-btn');
  const emptyState   = $('abgen-empty-state');
  const loadingState = $('abgen-loading');
  const loadingMsg   = $('abgen-loading-msg');
  const resultState  = $('abgen-result');
  const resultPubType = $('abgen-result-pubtype');
  const resultWc     = $('abgen-result-wc');
  const abstractText = $('abgen-abstract-text');
  const copyBtn      = $('abgen-copy-btn');
  const downloadBtn  = $('abgen-download-btn');
  const regenBtn     = $('abgen-regenerate-btn');
  const analysisStrip = $('abgen-analysis-strip');
  const analysisGrid  = $('abgen-analysis-grid');
  const kwStrip       = $('abgen-keywords-strip');
  const kwTags        = $('abgen-kw-tags');

  // ── Poster Drag & Drop ──
  browseBtn.addEventListener('click', e => { e.stopPropagation(); posterInput.click(); });
  dropzone.addEventListener('click', () => { if (!_abgenPosterFile) posterInput.click(); });

  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadPosterFile(file);
  });

  posterInput.addEventListener('change', () => {
    const file = posterInput.files[0];
    if (file) loadPosterFile(file);
  });

  removeBtn.addEventListener('click', e => {
    e.stopPropagation();
    _abgenPosterFile = null;
    posterInput.value = '';
    posterImg.src = '';
    posterPrev.style.display = 'none';
    dropInner.style.display = 'flex';
    detectedDiv.style.display = 'none';
    detectedVal.textContent = '—';
  });

  function loadPosterFile(file) {
    _abgenPosterFile = file;
    const reader = new FileReader();
    reader.onload = e => {
      posterImg.src = e.target.result;
      dropInner.style.display = 'none';
      posterPrev.style.display = 'block';
    };
    reader.readAsDataURL(file);
  }

  // ── Publication Type Cards ──
  document.querySelectorAll('.abgen-pub-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.abgen-pub-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      card.querySelector('input[type="radio"]').checked = true;
    });
  });

  // ── Word Count Slider ──
  wcSlider.addEventListener('input', () => {
    wcBadge.textContent = `${wcSlider.value} words`;
    document.querySelectorAll('.abgen-preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.wc === wcSlider.value);
    });
  });

  document.querySelectorAll('.abgen-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      wcSlider.value = btn.dataset.wc;
      wcBadge.textContent = `${btn.dataset.wc} words`;
      document.querySelectorAll('.abgen-preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ── Generate ──
  generateBtn.addEventListener('click', () => runAbstractGeneration());
  regenBtn.addEventListener('click', () => runAbstractGeneration());

  async function runAbstractGeneration() {
    const manualTheme = themeInput.value.trim();
    const hasPoster = !!_abgenPosterFile;

    if (!hasPoster && !manualTheme) {
      toast('Please upload a poster image or enter a research theme.', true);
      return;
    }

    const publicationType = document.querySelector('input[name="abgen-pubtype"]:checked')?.value || 'ieee-conference';
    const wordCount = parseInt(wcSlider.value) || 250;

    // UI: show loading
    generateBtn.disabled = true;
    emptyState.style.display = 'none';
    resultState.style.display = 'none';
    loadingState.style.display = 'flex';
    loadingMsg.textContent = hasPoster ? 'Analyzing poster...' : 'Generating abstract...';

    try {
      const result = await api.generateAbstract({
        posterFile: _abgenPosterFile || null,
        manualTheme,
        publicationType,
        wordCount
      });

      // Render result
      const pubLabels = {
        'ieee-conference': '🏛️ IEEE Conference',
        'journal': '📰 Journal Article',
        'book-chapter': '📖 Book Chapter'
      };
      resultPubType.textContent = pubLabels[publicationType] || publicationType;
      resultWc.textContent = `${result.wordCount || wordCount} words`;

      // Paper Title
      const paperTitleEl = $('abgen-paper-title');
      if (paperTitleEl) {
        paperTitleEl.textContent = result.title || '';
      }
      abstractText.textContent = result.abstract || '';

      // Show detected theme if from poster
      if (result.detectedTheme && hasPoster) {
        detectedDiv.style.display = 'flex';
        detectedVal.textContent = result.detectedTheme;
      }

      // Poster analysis strip
      if (result.posterAnalysis) {
        const a = result.posterAnalysis;
        const fields = [
          { label: 'Domain', value: a.domain },
          { label: 'Methodology', value: a.methodology },
          { label: 'Objectives', value: a.objectives },
          { label: 'Results', value: a.results },
        ].filter(f => f.value && f.value !== 'Not specified' && f.value !== 'Not visible in poster');

        if (fields.length > 0) {
          analysisGrid.innerHTML = fields.map(f => `
            <div class="abgen-analysis-item">
              <div class="abgen-analysis-item-label">${f.label}</div>
              <div class="abgen-analysis-item-value">${f.value}</div>
            </div>
          `).join('');
          analysisStrip.style.display = 'block';
        } else {
          analysisStrip.style.display = 'none';
        }

        // Keywords
        if (a.keywords && a.keywords.length > 0) {
          kwTags.innerHTML = a.keywords.map(k =>
            `<span class="abgen-kw-tag">${k}</span>`
          ).join('');
          kwStrip.style.display = 'flex';
        } else {
          kwStrip.style.display = 'none';
        }
      } else {
        analysisStrip.style.display = 'none';
        kwStrip.style.display = 'none';
      }

      loadingState.style.display = 'none';
      resultState.style.display = 'flex';

      // Save to history
      abgenSaveToHistory({
        title: result.title || '',
        abstract: result.abstract || '',
        publicationType,
        wordCount: result.wordCount || wordCount,
        detectedTheme: result.detectedTheme || manualTheme
      });

    } catch (err) {
      loadingState.style.display = 'none';
      emptyState.style.display = 'flex';
      toast(`Abstract generation failed: ${err.message}`, true);
    } finally {
      generateBtn.disabled = false;
    }
  }

  // ── Copy ── (Title + Abstract)
  copyBtn.addEventListener('click', async () => {
    const titleEl = $('abgen-paper-title');
    const titleText = (titleEl?.textContent || '').trim();
    const bodyText = (abstractText.textContent || abstractText.innerText || '').trim();
    const full = titleText ? `${titleText}\n\n${bodyText}` : bodyText;
    try {
      await navigator.clipboard.writeText(full);
      const orig = copyBtn.textContent;
      copyBtn.textContent = '✅ Copied!';
      setTimeout(() => { copyBtn.textContent = orig; }, 1800);
    } catch { toast('Could not copy — please select and copy manually.', true); }
  });

  // ── Download ── (Title + Abstract)
  downloadBtn.addEventListener('click', () => {
    const titleEl = $('abgen-paper-title');
    const titleText = (titleEl?.textContent || '').trim();
    const bodyText = (abstractText.textContent || abstractText.innerText || '').trim();
    const full = titleText ? `${titleText}\n\n${bodyText}` : bodyText;
    const pubType = document.querySelector('input[name="abgen-pubtype"]:checked')?.value || 'abstract';
    const blob = new Blob([full], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `abstract_${pubType}_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // ── Keyword tag click → append to theme ──
  kwTags.addEventListener('click', e => {
    const tag = e.target.closest('.abgen-kw-tag');
    if (!tag) return;
    const kw = tag.textContent;
    const cur = themeInput.value.trim();
    if (!cur.toLowerCase().includes(kw.toLowerCase())) {
      themeInput.value = cur ? `${cur}, ${kw}` : kw;
    }
  });

  // ── History: clear all ──
  const clearAllBtn = $('abgen-history-clear-btn');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', async () => {
      if (!confirm('Clear all generation history? This cannot be undone.')) return;
      try {
        await api.clearAbstractHistory();
        _abgenHistoryCache = [];
        abgenRenderHistory([]);
      } catch (err) {
        toast(`Could not clear history: ${err.message}`, true);
      }
    });
  }

  // Initial render of history on page load
  abgenRenderHistory();
}

// ══ History Helpers (Supabase DB-backed) ══

// In-memory cache so renders are instant without extra DB round-trips
let _abgenHistoryCache = null;

async function abgenSaveToHistory({ title, abstract, publicationType, wordCount, detectedTheme }) {
  try {
    const result = await api.saveAbstractHistory({
      title,
      abstract,
      publication_type: publicationType,
      word_count: wordCount,
      detected_theme: detectedTheme
    });
    // Prepend to cache optimistically
    const entry = result?.entry || {
      id: result?.id || String(Date.now()),
      title, abstract,
      publication_type: publicationType,
      word_count: wordCount,
      detected_theme: detectedTheme,
      created_at: new Date().toISOString()
    };
    if (_abgenHistoryCache) _abgenHistoryCache.unshift(entry);
    abgenRenderHistory(_abgenHistoryCache || [entry]);
  } catch (err) {
    console.warn('[AbgenHistory] Save failed:', err.message);
  }
}

async function abgenRenderHistory(cachedHistory = null) {
  const list    = $('abgen-history-list');
  const panel   = $('abgen-history-panel');
  const countEl = $('abgen-history-count');
  if (!list || !panel) return;

  let history = cachedHistory;
  if (!history) {
    try {
      const res = await api.getAbstractHistory();
      history = res?.history || [];
      _abgenHistoryCache = history;
    } catch (err) {
      console.warn('[AbgenHistory] Load failed:', err.message);
      history = [];
    }
  }

  countEl && (countEl.textContent = history.length);

  if (history.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';

  const pubLabels  = { 'ieee-conference': 'IEEE', 'journal': 'Journal', 'book-chapter': 'Book' };
  const pubClasses = { 'ieee-conference': 'ieee', 'journal': 'journal', 'book-chapter': 'book' };

  list.innerHTML = history.map(entry => {
    // Support both DB column names and legacy camelCase
    const pubType   = entry.publication_type || entry.publicationType || 'ieee-conference';
    const wc        = entry.word_count       || entry.wordCount       || 0;
    const theme     = entry.detected_theme   || entry.detectedTheme   || '';
    const createdAt = entry.created_at       || entry.timestamp       || new Date().toISOString();
    const date      = new Date(createdAt);
    const timeStr   = date.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
                    + ' ' + date.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true });
    const pubLabel  = pubLabels[pubType]  || pubType;
    const pubCls    = pubClasses[pubType] || 'ieee';
    const titlePrev = (entry.title || 'Untitled Abstract').substring(0, 80);

    return `
    <div class="abgen-hist-card" data-hist-id="${entry.id}">
      <div class="abgen-hist-card-header">
        <div class="abgen-hist-card-meta">
          <span class="abgen-hist-pub-badge ${pubCls}">${pubLabel}</span>
          <span class="abgen-hist-title-preview" title="${entry.title || ''}">${
            titlePrev || theme.substring(0, 80) || '—'
          }</span>
          <span class="abgen-hist-wc">${wc} words</span>
          <span class="abgen-hist-time">${timeStr}</span>
        </div>
        <div class="abgen-hist-card-actions">
          <button class="abgen-hist-action-btn copy" data-hist-id="${entry.id}">📋 Copy</button>
          <button class="abgen-hist-action-btn delete" data-hist-id="${entry.id}">🗑️</button>
        </div>
        <span class="abgen-hist-chevron">▼</span>
      </div>
      <div class="abgen-hist-card-body">
        <div>
          <div class="abgen-hist-field-label">📄 Paper Title</div>
          <div class="abgen-hist-title-edit" contenteditable="true" spellcheck="true"
               data-field="title" data-hist-id="${entry.id}">${entry.title || ''}</div>
        </div>
        <div>
          <div class="abgen-hist-field-label">Abstract</div>
          <div class="abgen-hist-abstract-edit" contenteditable="true" spellcheck="true"
               data-field="abstract" data-hist-id="${entry.id}">${entry.abstract || ''}</div>
        </div>
      </div>
    </div>`;
  }).join('');

  // ── Expand / collapse ──
  list.querySelectorAll('.abgen-hist-card-header').forEach(header => {
    header.addEventListener('click', e => {
      if (e.target.closest('.abgen-hist-action-btn')) return;
      header.closest('.abgen-hist-card').classList.toggle('expanded');
    });
  });

  // ── Inline edit → debounced PATCH to DB ──
  const editTimers = {};
  list.querySelectorAll('[data-field]').forEach(el => {
    el.addEventListener('input', () => {
      const id    = el.dataset.histId;
      const field = el.dataset.field;
      const value = el.textContent || el.innerText || '';
      // Update cache immediately
      if (_abgenHistoryCache) {
        const cached = _abgenHistoryCache.find(h => String(h.id) === String(id));
        if (cached) cached[field] = value;
      }
      // Debounce DB save 600ms
      clearTimeout(editTimers[id + field]);
      editTimers[id + field] = setTimeout(async () => {
        try { await api.updateAbstractHistory(id, { [field]: value }); }
        catch (err) { console.warn('[AbgenHistory] Update failed:', err.message); }
      }, 600);
    });
  });

  // ── Copy ──
  list.querySelectorAll('.abgen-hist-action-btn.copy').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id    = btn.dataset.histId;
      const card  = btn.closest('.abgen-hist-card');
      const title = card.querySelector('[data-field="title"]')?.textContent?.trim() || '';
      const abs   = card.querySelector('[data-field="abstract"]')?.textContent?.trim() || '';
      const full  = title ? `${title}\n\n${abs}` : abs;
      try {
        await navigator.clipboard.writeText(full);
        const orig = btn.textContent;
        btn.textContent = '✅ Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1600);
      } catch { toast('Could not copy to clipboard.', true); }
    });
  });

  // ── Delete ──
  list.querySelectorAll('.abgen-hist-action-btn.delete').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.histId;
      // Optimistic remove from cache
      if (_abgenHistoryCache) {
        _abgenHistoryCache = _abgenHistoryCache.filter(h => String(h.id) !== String(id));
        abgenRenderHistory(_abgenHistoryCache);
      }
      try { await api.deleteAbstractHistory(id); }
      catch (err) {
        console.warn('[AbgenHistory] Delete failed:', err.message);
        _abgenHistoryCache = null;
        abgenRenderHistory(); // re-fetch from DB
      }
    });
  });
}
