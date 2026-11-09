/* Ponte entre o sistema (escrito para o claude.ai) e o Supabase.
   Implementa window.claude.use('db'|'user'|'assets'|'downloads'|'sample') e a tela de login. */
(function () {
  var cfg = window.PR_CONFIG;
  // Apaga a sessão e os dados guardados por este site no navegador (resolve travas de sessão antiga)
  function limparLocal() {
    [localStorage, sessionStorage].forEach(function (st) { try { Object.keys(st).forEach(function (k) { if (/^sb-|supabase|^prg-/.test(k)) st.removeItem(k); }); } catch (e) {} });
    try { if (navigator.serviceWorker) navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); }); } catch (e) {}
    try { if (window.caches) caches.keys().then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); }); } catch (e) {}
  }
  window.PR_limpar = function () { limparLocal(); try { sessionStorage.setItem('pr-limpou', '1'); } catch (e) {} setTimeout(function () { location.replace(location.pathname); }, 300); };
  if (/[?&]limpar\b/.test(location.search)) { limparLocal(); history.replaceState(null, '', location.pathname); }
  if (!window.supabase) {
    document.addEventListener('DOMContentLoaded', function () {
      document.body.innerHTML = '<div style="max-width:520px;margin:12vh auto;padding:24px;font:15px/1.5 system-ui,sans-serif;color:#333">' +
        '<h2 style="margin:0 0 8px">Não foi possível carregar o sistema</h2><p>O navegador não baixou um componente necessário (cdn.jsdelivr.net). Normalmente é um bloqueador de anúncios, antivírus ou VPN. Desative a extensão para este site ou adicione-o como exceção e recarregue a página.</p></div>';
    });
    return;
  }
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
    // Sem trava entre abas: a trava padrão pode ficar presa quando há mais de uma aba aberta
    lock: function (name, timeout, fn) { return fn(); } } });
  window.SB = sb;
  // Mostra na tela qualquer erro, para facilitar o suporte
  function avisoErro(t) {
    var d = document.getElementById('pr-erro');
    if (!d) { d = document.createElement('div'); d.id = 'pr-erro'; d.style.cssText = 'position:fixed;left:12px;right:12px;top:12px;z-index:10000;background:#fff3f0;border:1px solid #d9a99f;color:#8a1c12;padding:10px 14px;border-radius:8px;font:13px/1.4 system-ui,sans-serif;white-space:pre-wrap;max-height:40vh;overflow:auto'; (document.body || document.documentElement).appendChild(d); }
    d.textContent += (d.textContent ? '\n' : 'Erro (envie este texto ao suporte):\n') + t;
  }
  window.addEventListener('error', function (e) { avisoErro((e.message || 'erro') + (e.filename ? ' @ ' + e.filename.split('/').pop() + ':' + e.lineno : '')); });
  window.addEventListener('unhandledrejection', function (e) { var r = e.reason; avisoErro('Promessa: ' + (r && (r.message || r.code) || JSON.stringify(r))); });
  var ME = null; // {id,email,equipe,socio,nome}
  var readyResolve; var ready = new Promise(function (r) { readyResolve = r; });

  /* ---------------- login ---------------- */
  var css = document.createElement('style');
  css.textContent =
    '#pr-login{position:fixed;inset:0;z-index:9999;background:#f4f3f0;display:flex;align-items:center;justify-content:center;padding:16px;font-family:Quicksand,system-ui,sans-serif}' +
    '#pr-login .card{background:#fff;border:1px solid #e4e0d7;border-radius:14px;padding:28px;width:100%;max-width:380px;box-shadow:0 10px 30px rgba(0,0,0,.06)}' +
    '#pr-login h1{font-family:Oswald,sans-serif;font-weight:600;font-size:22px;margin:0 0 4px;color:#1c1b19}#pr-login p{margin:0 0 18px;color:#655f55;font-size:14px}' +
    '#pr-login label{display:block;font-size:13px;font-weight:600;color:#655f55;margin:12px 0 4px}#pr-login input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #e4e0d7;border-radius:8px;font:inherit;font-size:15px}' +
    '#pr-login button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:8px;background:#8a5e12;color:#fff;font:inherit;font-weight:700;font-size:15px;cursor:pointer}' +
    '#pr-login .lk{display:flex;justify-content:space-between;margin-top:14px;font-size:13px}#pr-login .lk a{color:#8a5e12;cursor:pointer;text-decoration:underline}' +
    '#pr-login .pr-msg{margin-top:12px;font-size:13px;color:#8a1c12;min-height:1em}#pr-login .pr-msg.ok{color:#2f6b2f}' +
    '#pr-user{position:fixed;right:12px;bottom:12px;z-index:900;font-family:Quicksand,system-ui,sans-serif}#pr-user>button{border:1px solid #e4e0d7;background:#fff;border-radius:20px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.08)}' +
    '#pr-user .menu{display:none;position:absolute;right:0;bottom:40px;background:#fff;border:1px solid #e4e0d7;border-radius:10px;min-width:200px;box-shadow:0 8px 24px rgba(0,0,0,.1);overflow:hidden}#pr-user.on .menu{display:block}' +
    '#pr-user .menu button{display:block;width:100%;text-align:left;border:0;background:none;padding:10px 14px;font:inherit;font-size:14px;cursor:pointer}#pr-user .menu button:hover{background:#f3efe6}#pr-user .menu .who{padding:10px 14px;font-size:12px;color:#655f55;border-bottom:1px solid #e4e0d7;word-break:break-all}';
  document.head.appendChild(css);

  var modo = 'entrar';
  function telaLogin(msg, ok) {
    var el = document.getElementById('pr-login');
    if (!el) { el = document.createElement('div'); el.id = 'pr-login'; document.body.appendChild(el); }
    var t = { entrar: ['Entrar', 'Acesse o sistema do escritório.'], criar: ['Criar acesso', 'Crie sua conta com seu e-mail.'], esqueci: ['Recuperar senha', 'Enviaremos um link para o seu e-mail.'], nova: ['Nova senha', 'Digite a nova senha.'] }[modo];
    el.innerHTML = '<form class="card" id="pr-f"><h1>' + t[0] + '</h1><p>' + t[1] + '</p>' +
      (modo === 'criar' ? '<label for="pr-n">Nome</label><input id="pr-n" autocomplete="name" required>' : '') +
      (modo !== 'nova' ? '<label for="pr-e">E-mail</label><input id="pr-e" type="email" autocomplete="email" required>' : '') +
      (modo !== 'esqueci' ? '<label for="pr-s">Senha</label><input id="pr-s" type="password" minlength="8" autocomplete="' + (modo === 'entrar' ? 'current-password' : 'new-password') + '" required>' : '') +
      '<button type="submit">' + (modo === 'esqueci' ? 'Enviar link' : t[0]) + '</button>' +
      '<div class="lk">' + (modo === 'entrar' ? '<a data-m="criar">Criar acesso</a><a data-m="esqueci">Esqueci a senha</a>' : (modo !== 'nova' ? '<a data-m="entrar">Voltar para entrar</a>' : '')) + '</div>' +
      '<div class="pr-msg' + (ok ? ' ok' : '') + '">' + (msg || '') + '</div>' +
      (modo === 'entrar' ? '<div class="lk" style="margin-top:6px"><a onclick="PR_limpar()" style="font-size:12px;opacity:.75">Não está entrando? Limpar dados deste navegador</a></div>' : '') + '</form>';
    el.querySelectorAll('a[data-m]').forEach(function (a) { a.onclick = function () { modo = a.getAttribute('data-m'); telaLogin(); }; });
    document.getElementById('pr-f').onsubmit = enviar;
  }
  async function enviar(ev) {
    ev.preventDefault();
    var v = function (id) { var x = document.getElementById(id); return x ? x.value.trim() : ''; };
    var r;
    try {
      if (modo === 'entrar') r = await sb.auth.signInWithPassword({ email: v('pr-e'), password: document.getElementById('pr-s').value });
      else if (modo === 'criar') {
        r = await sb.auth.signUp({ email: v('pr-e'), password: document.getElementById('pr-s').value, options: { data: { nome: v('pr-n') }, emailRedirectTo: location.origin } });
        if (!r.error && !r.data.session) { modo = 'entrar'; return telaLogin('Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre.', true); }
      } else if (modo === 'esqueci') {
        r = await sb.auth.resetPasswordForEmail(v('pr-e'), { redirectTo: location.origin });
        if (!r.error) return telaLogin('Se o e-mail estiver cadastrado, o link chegará em instantes.', true);
      } else if (modo === 'nova') {
        r = await sb.auth.updateUser({ password: document.getElementById('pr-s').value });
        if (!r.error) { modo = 'entrar'; location.hash = ''; return iniciar(); }
      }
      if (r && r.error) return telaLogin(traduz(r.error.message));
      telaLogin('Entrando…', true);
      iniciar();
    } catch (e) { telaLogin('Não foi possível conectar. Tente de novo.'); }
  }
  function traduz(m) {
    if (/Invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
    if (/not confirmed/i.test(m)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
    if (/already registered/i.test(m)) return 'Este e-mail já tem conta. Use "Entrar".';
    if (/least/i.test(m)) return 'A senha precisa ter pelo menos 8 caracteres.';
    return m;
  }
  sb.auth.onAuthStateChange(function (ev) { if (ev === 'PASSWORD_RECOVERY') { modo = 'nova'; telaLogin(); } });

  function comPrazo(p, ms, msg) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error(msg)); }, ms); })]); }
  async function iniciar() {
    try { await iniciar2(); }
    catch (e) {
      console.error(e);
      var ja = false; try { ja = sessionStorage.getItem('pr-limpou') === '1'; } catch (x) {}
      if (!ja) return window.PR_limpar(); // primeira falha: limpa a sessão antiga e tenta de novo sozinho
      try { sessionStorage.removeItem('pr-limpou'); } catch (x) {}
      telaLogin('Não foi possível abrir o sistema: ' + (e && e.message || e) + '. Se continuar, desative extensões (bloqueador de anúncios, antivírus, VPN) para este site.');
    }
  }
  function passo(t) { var m = document.querySelector('#pr-login .pr-msg'); if (m) { m.className = 'pr-msg ok'; m.textContent = t; } }
  async function iniciar2() {
    passo('Entrando… (1/3 sessão)');
    var s = (await comPrazo(sb.auth.getSession(), 8000, 'tempo esgotado ao ler a sessão')).data.session;
    if (!s || modo === 'nova') return telaLogin();
    if (location.hash.indexOf('access_token') >= 0) history.replaceState(null, '', location.pathname);
    passo('Entrando… (2/3 acesso)');
    var r = await comPrazo(sb.rpc('meu_acesso'), 12000, 'tempo esgotado ao consultar o acesso');
    if (r.error) throw new Error(r.error.message);
    ME = r.data || { id: s.user.id, email: s.user.email, equipe: false, socio: false };
    passo('Entrando… (3/3 dados)');
    var el = document.getElementById('pr-login'); if (el) el.remove();
    menuUsuario();
    try { sessionStorage.removeItem('pr-limpou'); } catch (x) {}
    readyResolve();
  }
  function menuUsuario() {
    var u = document.createElement('div'); u.id = 'pr-user';
    u.innerHTML = '<button aria-label="Minha conta">' + esc(ME.nome || ME.email || 'Conta') + ' ▾</button><div class="menu"><div class="who">' + esc(ME.email || '') + (ME.socio ? ' · sócio' : ME.equipe ? ' · equipe' : '') + '</div>' +
      (ME.socio ? '<button data-a="equipe">Equipe e acessos</button>' : '') + '<button data-a="sair">Sair</button></div>';
    document.body.appendChild(u);
    u.firstChild.onclick = function () { u.classList.toggle('on'); };
    u.querySelector('[data-a="sair"]').onclick = async function () { await sb.auth.signOut(); location.reload(); };
    var eq = u.querySelector('[data-a="equipe"]'); if (eq) eq.onclick = function () { u.classList.remove('on'); telaEquipe(); };
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------------- equipe (sócio) ---------------- */
  async function telaEquipe(msg) {
    var r = await sb.rpc('equipe_listar'); var l = r.data || [];
    var html = '<div class="hd"><h2>Equipe e acessos</h2><button class="x" onclick="closeModal()" aria-label="Fechar">×</button></div><div class="bd block" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="banner info"><span>Quem está na equipe vê e edita todos os dados. Para incluir alguém: a pessoa cria o acesso em <b>' + esc(location.host) + '</b> e depois você adiciona o e-mail dela aqui. Clientes não entram na equipe: eles veem só o próprio portal.</span></div>' +
      (msg ? '<div class="banner warn"><span>' + esc(msg) + '</span></div>' : '') +
      '<div class="panel rows">' + l.map(function (p) { return '<div class="row"><div style="min-width:0;flex:1"><div class="t">' + esc(p.nome || p.email) + '</div><div class="s">' + esc(p.email) + ' · ' + (p.papel === 'socio' ? 'sócio' : 'membro') + '</div></div>' + (p.user_id !== ME.id ? '<button class="btn sm" onclick="PR_eqRem(\'' + p.user_id + '\')">Remover</button>' : '') + '</div>'; }).join('') + '</div>' +
      '<div class="grid" style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end"><div class="f"><label for="eq-e">E-mail</label><input id="eq-e" type="email"></div><div class="f"><label for="eq-n">Nome</label><input id="eq-n"></div><div class="f"><label for="eq-p">Papel</label><select id="eq-p"><option value="membro">Membro</option><option value="socio">Sócio</option></select></div></div>' +
      '</div><div class="ft"><span></span><div class="r"><button class="btn" onclick="closeModal()">Fechar</button><button class="btn pri" onclick="PR_eqAdd()">Adicionar</button></div></div>';
    window.openModal(html);
  }
  window.PR_eqAdd = async function () {
    var r = await sb.rpc('equipe_adicionar', { p_email: document.getElementById('eq-e').value, p_nome: document.getElementById('eq-n').value, p_papel: document.getElementById('eq-p').value });
    if (r.error) return telaEquipe(r.error.message);
    telaEquipe(r.data === 'sem_conta' ? 'Esse e-mail ainda não tem conta. Peça para a pessoa criar o acesso primeiro.' : null);
  };
  window.PR_eqRem = async function (id) { if (!confirm('Remover esta pessoa da equipe?')) return; var r = await sb.rpc('equipe_remover', { p_user: id }); telaEquipe(r.error ? r.error.message : null); };

  /* ---------------- db ---------------- */
  var cache = {}, colL = {}, docL = {};
  function snapCol(c) { var m = cache[c] || {}; return { docs: Object.keys(m).map(function (id) { return { id: id, data: function () { return m[id]; } }; }) }; }
  function snapDoc(c, id) { var m = cache[c] || {}; return { id: id, exists: m[id] !== undefined, data: function () { return m[id]; } }; }
  function emit(c, id) {
    (colL[c] || []).forEach(function (f) { try { f(snapCol(c)); } catch (e) { console.error(e); } });
    Object.keys(docL).forEach(function (k) {
      var kc = k.slice(0, k.lastIndexOf('/')), kid = k.slice(k.lastIndexOf('/') + 1);
      if (kc === c && (id === '' || kid === id)) docL[k].forEach(function (f) { try { f(snapDoc(c, kid)); } catch (e) { console.error(e); } });
    });
  }
  async function load(c) {
    var all = {}, from = 0;
    for (;;) {
      var r = await sb.from('docs').select('id,data').eq('collection', c).range(from, from + 999);
      if (r.error) throw r.error;
      r.data.forEach(function (x) { all[x.id] = x.data; });
      if (r.data.length < 1000) break; from += 1000;
    }
    cache[c] = all; return all;
  }
  var loaded = {};
  function ensure(c) { return loaded[c] || (loaded[c] = load(c)); }
  function split(path) { var i = path.lastIndexOf('/'); return [path.slice(0, i), path.slice(i + 1)]; }
  function rid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  var db = {
    collection: function (c) {
      return {
        limit: function () { return this; },
        onSnapshot: function (cb, err) {
          (colL[c] = colL[c] || []).push(cb);
          ensure(c).then(function () { cb(snapCol(c)); }, function (e) { err && err(e); });
          return function () { colL[c] = (colL[c] || []).filter(function (f) { return f !== cb; }); };
        },
        get: async function () { await ensure(c); return snapCol(c); },
        add: async function (data) { var id = rid(); await db.doc(c + '/' + id).set(data); return { id: id }; },
        doc: function (id) { return db.doc(c + '/' + id); }
      };
    },
    doc: function (path) {
      var p = split(path), c = p[0], id = p[1];
      return {
        id: id,
        get: async function () { var r = await sb.from('docs').select('data').eq('collection', c).eq('id', id).maybeSingle(); if (r.error) throw r.error; return { id: id, exists: !!r.data, data: function () { return r.data && r.data.data; } }; },
        onSnapshot: function (cb, err) {
          var k = c + '/' + id; (docL[k] = docL[k] || []).push(cb);
          if (c === 'portal' && !ME.equipe) {
            sb.from('docs').select('data').eq('collection', c).eq('id', id).maybeSingle().then(function (r) {
              if (r.error) return err && err(r.error); cache[c] = cache[c] || {}; if (r.data) cache[c][id] = r.data.data; cb(snapDoc(c, id));
            });
          } else ensure(c).then(function () { cb(snapDoc(c, id)); }, function (e) { err && err(e); });
          return function () { docL[k] = (docL[k] || []).filter(function (f) { return f !== cb; }); };
        },
        set: async function (data) {
          var r = await sb.from('docs').upsert({ collection: c, id: id, data: data }, { onConflict: 'collection,id' });
          if (r.error) throw r.error; cache[c] = cache[c] || {}; cache[c][id] = data; emit(c, id);
        },
        update: async function (patch) {
          var cur = (cache[c] || {})[id]; if (cur === undefined) { var g = await this.get(); cur = g.data() || {}; }
          return this.set(Object.assign({}, cur, patch));
        },
        delete: async function () {
          var r = await sb.from('docs').delete().eq('collection', c).eq('id', id);
          if (r.error) throw r.error; if (cache[c]) delete cache[c][id]; emit(c, id);
        }
      };
    }
  };
  function tempoReal() {
    sb.channel('docs').on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, function (p) {
      var row = p.new && p.new.collection ? p.new : p.old; if (!row || !row.collection) return;
      var c = row.collection; if (!loaded[c]) return;
      cache[c] = cache[c] || {};
      if (p.eventType === 'DELETE') { if (p.old && p.old.id) delete cache[c][p.old.id]; else { loaded[c] = null; ensure(c).then(function () { emit(c, ''); }); return; } }
      else cache[c][row.id] = row.data;
      emit(c, row.id);
    }).subscribe();
    // Segurança: recarrega tudo ao voltar para a aba
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      Object.keys(loaded).forEach(function (c) { if (loaded[c]) { loaded[c] = null; ensure(c).then(function () { emit(c, ''); }); } });
    });
  }

  /* ---------------- user ---------------- */
  var user = {
    id: async function () { return ME.id; },
    me: async function () { return { id: ME.id, name: ME.nome || ME.email }; },
    isOwner: function () { return !!ME.socio; },
    canEdit: function () { return !!ME.equipe; },
    can: async function (n) { return n === 'data.write' ? !!ME.equipe : null; },
    search: async function (q) { var r = await sb.rpc('buscar_usuarios', { q: q || '' }); return (r.data || []).map(function (u) { return { id: u.id, name: u.nome + ' (' + u.email + ')', guest: !u.equipe }; }); },
    profiles: async function (ids) { var r = await sb.rpc('perfis', { ids: ids.filter(function (x) { return /^[0-9a-f-]{36}$/.test(x); }) }); var o = {}; (r.data || []).forEach(function (u) { o[u.id] = { id: u.id, name: u.nome }; }); return o; }
  };

  /* ---------------- arquivos ---------------- */
  var assets = {
    upload: async function (file) {
      var nome = (file.name || 'arquivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
      var path = rid() + '-' + nome;
      var r = await sb.storage.from('arquivos').upload(path, file, { contentType: file.type || undefined });
      if (r.error) throw r.error;
      return { id: path, url: '/_blob/' + path, sizeBytes: file.size, contentType: file.type };
    },
    list: async function () { return { assets: [], usage: {} }; },
    delete: async function (id) { await sb.storage.from('arquivos').remove([id]); }
  };
  document.addEventListener('click', async function (e) {
    var a = e.target.closest && e.target.closest('a[href^="/_blob/"]'); if (!a) return;
    e.preventDefault(); e.stopPropagation();
    var w = window.open('', '_blank');
    var r = await sb.storage.from('arquivos').createSignedUrl(decodeURIComponent(a.getAttribute('href').slice(7)), 600);
    if (r.error) { if (w) w.close(); return alert('Não foi possível abrir o arquivo.'); }
    if (w) w.location = r.data.signedUrl; else location.href = r.data.signedUrl;
  }, true);

  /* ---------------- downloads ---------------- */
  var downloads = {
    save: async function (o) {
      var blob = o.data instanceof Blob ? o.data : new Blob([o.data]);
      var u = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = u; a.download = o.filename || 'arquivo'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 5000);
    }
  };

  /* ---------------- window.claude ---------------- */
  var started = false;
  window.claude = {
    use: async function (name) {
      await ready;
      if (name === 'db') { if (!started) { started = true; tempoReal(); } return db; }
      if (name === 'user') return user;
      if (name === 'assets') return ME.equipe ? assets : null;
      if (name === 'downloads') return downloads;
      return null; // 'sample' (IA): será ligado depois
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
