/* Auth module */
const Auth = (() => {
  const JWT_KEY = 'chat_jwt';
  const USER_KEY = 'chat_user';

  function getToken() {
    return localStorage.getItem(JWT_KEY);
  }

  function getUser() {
    const u = localStorage.getItem(USER_KEY);
    try { return u ? JSON.parse(u) : null; }
    catch { return null; }
  }

  function setSession(token, user) {
    localStorage.setItem(JWT_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(JWT_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function isLoggedIn() {
    const token = getToken();
    if (!token) return false;
    try {
      // Check if token is expired (basic check)
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp > Math.floor(Date.now() / 1000);
    } catch {
      return !!token;
    }
  }

  async function safeJson(res) {
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const text = await res.text();
      throw new Error(`Resposta inesperada do servidor (${res.status}): ${text.slice(0, 120)}`);
    }
    return res.json();
  }

  async function login(username, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'Erro ao entrar');
    setSession(data.token, data.user);
    return data;
  }

  async function register(username, password, display_name) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, display_name })
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'Erro ao criar conta');
    setSession(data.token, data.user);
    return data;
  }

  async function apiFetch(url, opts = {}) {
    const token = getToken();
    const res = await fetch(url, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(opts.headers || {})
      }
    });
    if (res.status === 401) {
      clearSession();
      window.location.reload();
      return null;
    }
    return res;
  }

  async function updateUser(data) {
    const res = await apiFetch('/api/me', {
      method: 'PUT',
      body: JSON.stringify(data)
    });
    if (!res) return null;
    const updated = await res.json();
    if (!res.ok) throw new Error(updated.error || 'Erro ao atualizar perfil');
    // Update stored user
    const current = getUser();
    setSession(getToken(), { ...current, ...updated });
    return updated;
  }

  return { getToken, getUser, setSession, clearSession, isLoggedIn, login, register, apiFetch, updateUser };
})();

window.Auth = Auth;
