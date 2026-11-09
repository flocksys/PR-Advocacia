/* Integração com a conta Google do escritório: Google Agenda (sincroniza a agenda do sistema)
   e Google Drive (escolher arquivos para os documentos). Usa o login do Google no navegador
   (Google Identity Services); nenhum token é guardado no banco. */
(function () {
  var C = window.PR_CONFIG || {};
  var ESCOPOS = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/drive.file';
  var TOKEN = null, EXPIRA = 0, tokenClient = null, pendentes = [];
  var G = window.PRG = { pronto: !!C.googleClientId };

  try { var s = JSON.parse(sessionStorage.getItem('prg-token') || 'null'); if (s && s.exp > Date.now() + 60000) { TOKEN = s.t; EXPIRA = s.exp; } } catch (e) {}
  G.conectado = function () { return !!TOKEN && EXPIRA > Date.now() + 30000; };

  function carregar(src) {
    return new Promise(function (ok, erro) {
      if (document.querySelector('script[src="' + src + '"]')) return ok();
      var s = document.createElement('script'); s.src = src; s.async = true; s.onload = ok; s.onerror = function () { erro(new Error('Não foi possível carregar ' + src)); };
      document.head.appendChild(s);
    });
  }

  /* ---------- login Google ---------- */
  G.token = async function (interativo) {
    if (G.conectado()) return TOKEN;
    if (!C.googleClientId) throw new Error('sem_config');
    await carregar('https://accounts.google.com/gsi/client');
    return new Promise(function (ok, erro) {
      if (!tokenClient) tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: C.googleClientId, scope: ESCOPOS,
        callback: function (r) {
          var fila = pendentes; pendentes = [];
          if (r.error) return fila.forEach(function (p) { p[1](new Error(r.error)); });
          TOKEN = r.access_token; EXPIRA = Date.now() + (Number(r.expires_in) || 3600) * 1000;
          try { sessionStorage.setItem('prg-token', JSON.stringify({ t: TOKEN, exp: EXPIRA })); } catch (e) {}
          fila.forEach(function (p) { p[0](TOKEN); }); atualizarSelo();
        },
        error_callback: function (e) { var fila = pendentes; pendentes = []; fila.forEach(function (p) { p[1](new Error(e && e.type || 'cancelado')); }); }
      });
      pendentes.push([ok, erro]);
      tokenClient.requestAccessToken({ prompt: interativo ? '' : 'none', login_hint: (window.CFG && CFG.googleConta) || undefined });
    });
  };
  G.desconectar = function () {
    if (TOKEN && window.google && google.accounts) try { google.accounts.oauth2.revoke(TOKEN, function () {}); } catch (e) {}
    TOKEN = null; EXPIRA = 0; try { sessionStorage.removeItem('prg-token'); } catch (e) {} atualizarSelo();
  };
  async function api(metodo, url, corpo) {
    var t = await G.token(false).catch(function () { return G.token(true); });
    var r = await fetch(url, { method: metodo, headers: Object.assign({ Authorization: 'Bearer ' + t }, corpo ? { 'Content-Type': 'application/json' } : {}), body: corpo ? JSON.stringify(corpo) : undefined });
    if (r.status === 401) { TOKEN = null; throw new Error('Sessão do Google expirou. Conecte de novo.'); }
    if (r.status === 204 || r.status === 410) return null;
    var j = await r.json().catch(function () { return null; });
    if (!r.ok) throw new Error((j && j.error && j.error.message) || ('HTTP ' + r.status));
    return j;
  }

  /* ---------- Google Agenda ---------- */
  var CAL = 'https://www.googleapis.com/calendar/v3';
  function calId() { return (window.CFG && CFG.googleAgenda) || 'primary'; }
  function addMin(hhmm, min) { var p = hhmm.split(':'), t = (+p[0]) * 60 + (+p[1]) + min; return ('0' + Math.floor(t / 60) % 24).slice(-2) + ':' + ('0' + t % 60).slice(-2); }
  function addDia(iso, n) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
  function evento(a) {
    var pr = a.processo && byId('processos', a.processo), cli = a.cliente ? nomeCli(a.cliente) : (pr ? nomeCli(pr.cliente) : '');
    var dur = a.tipo === 'Audiência' ? 90 : 60;
    var lemb = { 'No dia': 0, '1 dia antes': 1440, '3 dias antes': 4320, '5 dias antes': 7200 }[a.lembrete];
    var ev = {
      summary: '[' + (a.tipo || 'Compromisso') + '] ' + (a.titulo || ''),
      description: [pr ? 'Processo: ' + (pr.numero || '') : '', cli ? 'Cliente: ' + cli : '', a.responsavel ? 'Responsável: ' + a.responsavel : '', a.prioridade && a.prioridade !== 'Normal' ? 'Prioridade: ' + a.prioridade : '', a.obs || '', '', 'Sistema Pontes Rodrigues: ' + location.origin].filter(function (x, i, arr) { return x || (i > 0 && arr[i - 1]); }).join('\n'),
      location: a.local || '',
      extendedProperties: { private: { prId: a.id } },
      reminders: lemb == null ? { useDefault: true } : { useDefault: false, overrides: [{ method: 'popup', minutes: a.hora ? Math.max(lemb, 30) : lemb + 540 }] },
      colorId: a.tipo === 'Prazo' ? '11' : a.tipo === 'Audiência' ? '5' : undefined
    };
    if (a.hora) { ev.start = { dateTime: a.data + 'T' + a.hora + ':00', timeZone: 'America/Sao_Paulo' }; ev.end = { dateTime: a.data + 'T' + addMin(a.hora, dur) + ':00', timeZone: 'America/Sao_Paulo' }; }
    else { ev.start = { date: a.data }; ev.end = { date: addDia(a.data, 1) }; }
    return ev;
  }
  G.syncItem = async function (a) {
    if (!a || !a.data) return 'ignorado';
    var id = encodeURIComponent(calId());
    if (a.status === 'Cancelado') { if (a.gcalId) { await api('DELETE', CAL + '/calendars/' + id + '/events/' + encodeURIComponent(a.gcalId)); await patchSilencioso(a.id, { gcalId: '' }); return 'removido'; } return 'ignorado'; }
    var ev = evento(a);
    if (a.gcalId) {
      try { await api('PUT', CAL + '/calendars/' + id + '/events/' + encodeURIComponent(a.gcalId), ev); return 'atualizado'; }
      catch (e) { if (!/not found|deleted|HTTP 404/i.test(e.message)) throw e; }
    }
    var r = await api('POST', CAL + '/calendars/' + id + '/events', ev);
    await patchSilencioso(a.id, { gcalId: r.id, gcalAgenda: calId() });
    return 'criado';
  };
  async function patchSilencioso(id, p) { var cur = byId('agenda', id); if (!cur) return; await save('agenda', Object.assign({}, cur, p), id); }
  G.syncTudo = async function (aviso) {
    await G.token(true);
    var desde = addDia(today(), -30), itens = S.agenda.filter(function (a) { return !a.exemplo && a.data && a.data >= desde && (a.status !== 'Concluído' || a.gcalId); });
    var n = { criado: 0, atualizado: 0, removido: 0, erro: 0 };
    for (var i = 0; i < itens.length; i++) {
      if (aviso) aviso('Sincronizando ' + (i + 1) + ' de ' + itens.length + '…');
      try { var r = await G.syncItem(itens[i]); if (n[r] != null) n[r]++; } catch (e) { n.erro++; console.warn(e); }
    }
    return n;
  };
  G.importar = async function () {
    var ini = new Date(); ini.setHours(0, 0, 0, 0); var fim = new Date(ini); fim.setDate(fim.getDate() + 90);
    var r = await api('GET', CAL + '/calendars/' + encodeURIComponent(calId()) + '/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=' + ini.toISOString() + '&timeMax=' + fim.toISOString());
    var ja = {}; S.agenda.forEach(function (a) { if (a.gcalId) ja[a.gcalId] = 1; });
    var novos = (r.items || []).filter(function (e) { return !ja[e.id] && !(e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private.prId) && e.status !== 'cancelled'; });
    for (var i = 0; i < novos.length; i++) {
      var e = novos[i], dt = e.start.dateTime || e.start.date;
      await save('agenda', { tipo: 'Compromisso', titulo: e.summary || '(sem título)', data: dt.slice(0, 10), hora: e.start.dateTime ? dt.slice(11, 16) : '', local: e.location || e.hangoutLink || '', obs: (e.description || '').slice(0, 2000), status: 'Pendente', prioridade: 'Normal', coluna: 'A fazer', lembrete: '1 dia antes', responsavel: (equipe()[0] || ''), gcalId: e.id, gcalAgenda: calId(), origem: 'Google Agenda' });
    }
    return novos.length;
  };
  G.agendas = async function () { var r = await api('GET', CAL + '/users/me/calendarList?minAccessRole=writer'); return r.items || []; };

  /* sincroniza sozinho ao salvar ou excluir um compromisso, se estiver conectado */
  var _save = window.save;
  window.save = async function (col, data, id) {
    var antes = col === 'agenda' && id ? byId('agenda', id) : null;
    var nid = await _save.apply(this, arguments);
    if (col === 'agenda' && G.conectado() && data) {
      var veioDoGoogle = !id && data.gcalId;
      var mudou = !antes || ['titulo', 'data', 'hora', 'tipo', 'status', 'local', 'obs', 'lembrete', 'processo', 'cliente', 'responsavel', 'prioridade'].some(function (k) { return (antes[k] || '') !== (data[k] || ''); });
      if (!veioDoGoogle && (mudou || !data.gcalId)) setTimeout(function () { var a = byId('agenda', nid); if (a) G.syncItem(a).catch(function (e) { toast('Google Agenda: ' + e.message); }); }, 800);
    }
    return nid;
  };
  var _remove = window.removeDoc;
  window.removeDoc = async function (col, id) {
    var a = col === 'agenda' && byId('agenda', id);
    var r = await _remove.apply(this, arguments);
    if (a && a.gcalId && G.conectado()) api('DELETE', CAL + '/calendars/' + encodeURIComponent(a.gcalAgenda || calId()) + '/events/' + encodeURIComponent(a.gcalId)).catch(function () {});
    return r;
  };

  /* ---------- Google Drive (seletor de arquivos) ---------- */
  G.escolherDrive = async function (ok) {
    if (!C.googleApiKey) return toast('Falta a chave de API do Google para o seletor do Drive.');
    var t = await G.token(true);
    await carregar('https://apis.google.com/js/api.js');
    await new Promise(function (r) { gapi.load('picker', r); });
    var view = new google.picker.DocsView(google.picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(true);
    var b = new google.picker.PickerBuilder().setOAuthToken(t).setDeveloperKey(C.googleApiKey).addView(view).addView(new google.picker.DocsUploadView())
      .setLocale('pt-BR').setTitle('Escolha um arquivo do Google Drive')
      .setCallback(function (d) { if (d.action === google.picker.Action.PICKED && d.docs && d.docs[0]) ok({ nome: d.docs[0].name, link: d.docs[0].url, id: d.docs[0].id, tipo: d.docs[0].mimeType }); });
    if (C.googleAppId) b.setAppId(C.googleAppId);
    b.build().setVisible(true);
  };
  window.driveNoForm = function () {
    G.escolherDrive(function (f) {
      var l = document.getElementById('fm-link'); if (l) l.value = f.link;
      var n = document.getElementById('fm-nome'); if (n && !n.value) n.value = f.nome.replace(/\.[a-z0-9]{2,5}$/i, '');
      toast('Arquivo do Drive vinculado: ' + f.nome);
    }).catch(function (e) { toast('Google Drive: ' + (e.message === 'sem_config' ? 'integração ainda não configurada' : e.message)); });
  };
  document.addEventListener('focusin', function (ev) {
    if (!ev.target || ev.target.id !== 'fm-link' || !window.CUR || CUR.col !== 'documentos' && CUR.col !== 'contratos') return;
    if (!G.pronto || document.getElementById('btn-drive')) return;
    ev.target.insertAdjacentHTML('afterend', '<button type="button" id="btn-drive" class="btn sm" style="margin-top:6px;align-self:flex-start" onclick="driveNoForm()">Escolher do Google Drive</button>');
  });
  /* mostra o botão do Drive assim que o formulário de documento abre */
  var _openForm = window.openForm;
  window.openForm = function (col) {
    var r = _openForm.apply(this, arguments);
    if (G.pronto && (col === 'documentos' || col === 'contratos')) { var l = document.getElementById('fm-link'); if (l && !document.getElementById('btn-drive')) l.insertAdjacentHTML('afterend', '<button type="button" id="btn-drive" class="btn sm" style="margin-top:6px;align-self:flex-start" onclick="driveNoForm()">Escolher do Google Drive</button>'); }
    return r;
  };

  /* ---------- tela de conexão ---------- */
  function atualizarSelo() { var b = document.getElementById('prg-selo'); if (b) b.textContent = G.conectado() ? 'Google conectado' : 'Conectar Google'; }
  G.tela = async function (msg) {
    var h = '<div class="hd"><h2>Google Agenda e Drive</h2><button class="x" onclick="closeModal()" aria-label="Fechar">×</button></div><div class="bd block" style="display:flex;flex-direction:column;gap:14px">';
    if (!G.pronto) {
      h += '<div class="banner warn"><span>A integração ainda não foi configurada. Falta cadastrar o sistema no Google Cloud (ID do cliente OAuth e chave de API). Depois disso este botão passa a conectar a conta Google do escritório.</span></div>';
    } else {
      h += '<div class="banner info"><span>Conecte a conta Google do escritório. Os compromissos da Agenda do sistema (prazos, audiências, reuniões, tarefas) vão para o Google Agenda e são atualizados sozinhos quando você edita ou exclui. No Drive, o sistema só acessa os arquivos que você escolher.</span></div>';
      if (msg) h += '<div class="banner ' + (/erro|não/i.test(msg) ? 'warn' : 'info') + '"><span>' + esc(msg) + '</span></div>';
      if (G.conectado()) {
        var ags = []; try { ags = await G.agendas(); } catch (e) {}
        h += '<div class="f"><label for="prg-cal">Agenda do Google que recebe os compromissos</label><select id="prg-cal" onchange="PRG.trocarAgenda(this.value)">' + (ags.length ? ags : [{ id: 'primary', summary: 'Agenda principal' }]).map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === calId() || (c.primary && calId() === 'primary') ? ' selected' : '') + '>' + esc(c.summary + (c.primary ? ' (principal)' : '')) + '</option>'; }).join('') + '</select></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn pri" onclick="PRG.botaoSync()">Sincronizar agenda agora</button><button class="btn" onclick="PRG.botaoImportar()">Trazer eventos do Google (90 dias)</button><button class="btn" onclick="PRG.botaoDrive()">Testar Google Drive</button></div><div id="prg-st" class="hint"></div>';
      } else {
        h += '<div><button class="btn pri" onclick="PRG.botaoConectar()">Conectar conta Google</button></div>';
      }
    }
    h += '</div><div class="ft">' + (G.conectado() ? '<button class="btn ghost danger" onclick="PRG.desconectar();PRG.tela(\'Conta Google desconectada neste navegador.\')">Desconectar</button>' : '<span></span>') + '<div class="r"><button class="btn" onclick="closeModal()">Fechar</button></div></div>';
    openModal(h);
  };
  function st(t) { var e = document.getElementById('prg-st'); if (e) e.textContent = t; }
  G.botaoConectar = async function () { try { await G.token(true); G.tela('Conta conectada.'); } catch (e) { G.tela('Não foi possível conectar: ' + e.message); } };
  G.trocarAgenda = async function (id) { try { await saveCfg({ googleAgenda: id }); toast('Agenda escolhida'); } catch (e) { toast('Não foi possível salvar'); } };
  G.botaoSync = async function () { try { var n = await G.syncTudo(st); st('Pronto: ' + n.criado + ' criados, ' + n.atualizado + ' atualizados, ' + n.removido + ' removidos' + (n.erro ? ', ' + n.erro + ' com erro' : '') + '.'); } catch (e) { st('Erro: ' + e.message); } };
  G.botaoImportar = async function () { try { st('Buscando eventos…'); var n = await G.importar(); st(n ? n + ' eventos trazidos para a Agenda do sistema.' : 'Nenhum evento novo no Google.'); } catch (e) { st('Erro: ' + e.message); } };
  G.botaoDrive = function () { G.escolherDrive(function (f) { st('Drive funcionando: ' + f.nome); }).catch(function (e) { st('Erro: ' + e.message); }); };

  /* item no menu do usuário e botão na Agenda */
  function menu() {
    var m = document.querySelector('#pr-user .menu'); if (!m) return setTimeout(menu, 500);
    if (m.querySelector('[data-a="google"]')) return;
    var b = document.createElement('button'); b.setAttribute('data-a', 'google'); b.textContent = 'Google Agenda e Drive';
    b.onclick = function () { document.getElementById('pr-user').classList.remove('on'); G.tela(); };
    m.insertBefore(b, m.querySelector('[data-a="sair"]'));
  }
  menu();
  var _vAgenda = window.vAgenda;
  if (_vAgenda) window.vAgenda = function () {
    var h = _vAgenda.apply(this, arguments);
    return h.replace('<div class="acts">', '<div class="acts"><button class="btn" id="prg-selo" onclick="PRG.tela()">' + (G.conectado() ? 'Google conectado' : 'Conectar Google') + '</button>');
  };
})();
