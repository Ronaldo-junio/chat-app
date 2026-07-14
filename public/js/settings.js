'use strict';

const Settings = (() => {
  const COLORS = [
    '#00a884','#25d366','#128c7e','#075e54',
    '#ef5350','#e91e63','#9c27b0','#7b1fa2',
    '#3f51b5','#1976d2','#00bcd4','#0097a7',
    '#ff9800','#f57c00','#ff5722','#8bc34a'
  ];

  let currentUser = null;
  let selectedAvatarColor = null;
  let selectedThemeColor = null;

  function renderAvatar(el, displayName, color, size) {
    if (!el) return;
    const s = size || parseInt(el.dataset.size) || 40;
    const initials = (displayName || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    el.style.cssText = `width:${s}px;height:${s}px;border-radius:50%;background:${color || '#00a884'};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${s * 0.38}px;color:#fff;flex-shrink:0;user-select:none;`;
    el.textContent = initials;
  }

  function renderColorPicker(containerId, selectedColor, onSelect) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    container.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:4px 0;';
    for (const color of COLORS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = `width:28px;height:28px;border-radius:50%;background:${color};border:3px solid ${color === selectedColor ? '#fff' : 'transparent'};cursor:pointer;transition:border 0.15s;`;
      btn.title = color;
      btn.addEventListener('click', () => {
        container.querySelectorAll('button').forEach(b => b.style.borderColor = 'transparent');
        btn.style.borderColor = '#fff';
        onSelect(color);
      });
      container.appendChild(btn);
    }
  }

  function applyTheme(user) {
    if (!user) return;
    document.body.className = `theme-${user.theme_mode || 'dark'}`;
    const accent = user.theme_accent || '#00a884';
    document.documentElement.style.setProperty('--accent', accent);
    const meta = document.getElementById('theme-color-meta');
    if (meta) meta.setAttribute('content', accent);
  }

  function openSettings() {
    const panel = document.getElementById('settings-panel');
    if (!panel) return;
    panel.classList.remove('hidden');

    const user = Auth.getUser();
    if (!user) return;
    currentUser = { ...user };
    selectedAvatarColor = user.avatar_color || '#00a884';
    selectedThemeColor  = user.theme_accent || '#00a884';

    const dn = document.getElementById('settings-display-name');
    const bio = document.getElementById('settings-bio');
    if (dn) dn.value = user.display_name || '';
    if (bio) bio.value = user.bio || '';

    const avatar = document.getElementById('settings-avatar');
    renderAvatar(avatar, user.display_name, user.avatar_color, 80);

    renderColorPicker('theme-color-picker', selectedThemeColor, (c) => { selectedThemeColor = c; });

    // Theme toggle
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === (user.theme_mode || 'dark'));
      btn.onclick = () => {
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentUser.theme_mode = btn.dataset.theme;
        applyTheme({ ...currentUser, theme_accent: selectedThemeColor });
      };
    });
  }

  async function saveSettings() {
    const dn  = document.getElementById('settings-display-name')?.value.trim();
    const bio = document.getElementById('settings-bio')?.value.trim();
    if (!dn) { App.showToast('Nome não pode estar vazio', 'error'); return; }

    const payload = {
      display_name: dn,
      bio: bio || '',
      avatar_color: selectedAvatarColor,
      theme_accent: selectedThemeColor,
      theme_mode: currentUser.theme_mode || 'dark'
    };

    try {
      const res = await Auth.apiFetch('/api/me', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Falha ao salvar');
      const data = await res.json();
      Auth.setSession(Auth.getToken(), data);
      applyTheme(data);

      // Update avatar in sidebar
      const myAvatar = document.getElementById('my-avatar');
      renderAvatar(myAvatar, data.display_name, data.avatar_color, 40);

      document.getElementById('settings-panel')?.classList.add('hidden');
      App.showToast('Configurações salvas!', 'success');
    } catch (e) {
      App.showToast('Erro ao salvar configurações', 'error');
    }
  }

  function init(user) {
    currentUser = user;
    selectedAvatarColor = user.avatar_color || '#00a884';
    selectedThemeColor  = user.theme_accent || '#00a884';
    applyTheme(user);

    // My avatar in sidebar
    const myAvatar = document.getElementById('my-avatar');
    renderAvatar(myAvatar, user.display_name, user.avatar_color, 40);
    if (myAvatar) {
      myAvatar.style.cursor = 'pointer';
      myAvatar.addEventListener('click', openSettings);
    }

    document.getElementById('btn-settings')?.addEventListener('click', openSettings);
    document.getElementById('btn-close-settings')?.addEventListener('click', () => {
      document.getElementById('settings-panel')?.classList.add('hidden');
    });
    document.getElementById('btn-save-settings')?.addEventListener('click', saveSettings);
    document.getElementById('btn-logout')?.addEventListener('click', () => {
      ChatSocket.disconnect();
      Auth.clearSession();
      localStorage.removeItem('last_conv_id');
      window.location.reload();
    });

    document.getElementById('btn-change-avatar-color')?.addEventListener('click', () => {
      const existing = document.getElementById('avatar-color-modal');
      if (existing) { existing.remove(); return; }
      const modal = document.createElement('div');
      modal.id = 'avatar-color-modal';
      modal.style.cssText = 'position:fixed;inset:0;background:var(--overlay);z-index:1000;display:flex;align-items:center;justify-content:center;';
      modal.innerHTML = `<div style="background:var(--bg-modal);padding:24px;border-radius:12px;max-width:280px;width:90%;">
        <h4 style="margin-bottom:16px;color:var(--text-primary);">Cor do avatar</h4>
        <div id="avatar-color-picker-inner"></div>
        <button id="close-avatar-modal" style="margin-top:16px;color:var(--accent);background:none;border:none;cursor:pointer;font-size:14px;font-weight:600;">FECHAR</button>
      </div>`;
      document.body.appendChild(modal);
      renderColorPicker('avatar-color-picker-inner', selectedAvatarColor, (c) => {
        selectedAvatarColor = c;
        const av = document.getElementById('settings-avatar');
        renderAvatar(av, Auth.getUser()?.display_name, c, 80);
      });
      document.getElementById('close-avatar-modal')?.addEventListener('click', () => modal.remove());
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    });
  }

  return { init, applyTheme, renderAvatar, renderColorPicker, openSettings, saveSettings, COLORS };
})();

window.Settings = Settings;
