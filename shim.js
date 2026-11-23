
/* Camada de compatibilidade: faz o app rodar fora do Claude, usando Firebase (login Google + Firestore).
   O app chama window.claude.use("db" | "user" | "downloads"); aqui essas chamadas viram Firebase. */
(function () {
  "use strict";
  const CFG = window.FUNIL_CONFIG || {};
  if (!CFG.firebase || !CFG.firebase.apiKey || CFG.firebase.apiKey.indexOf("COLE") === 0) {
    document.addEventListener("DOMContentLoaded", () => telaAviso(
      "Configuração pendente",
      "Abra o arquivo <b>config.js</b> e cole os dados do seu projeto Firebase (passo 3 do LEIA-ME)."));
    return;
  }
  firebase.initializeApp(CFG.firebase);
  const auth = firebase.auth();
  const fs = firebase.firestore();
  const donaEmail = String(CFG.donaEmail || "").toLowerCase().trim();
  // E-mails com acesso total (Funil + Administrativo), além da dona
  const acessoTotal = (CFG.acessoTotal || []).map((e) => String(e).toLowerCase().trim());
  window.__ehAdm = () => !!auth.currentUser && acessoTotal.includes(String(auth.currentUser.email || "").toLowerCase());

  /* ---------- erros no formato que o app espera ---------- */
  function codigo(err) {
    const c = (err && err.code) || "";
    if (c.includes("permission-denied") || c.includes("invalid-argument") || c.includes("not-found")) return "invalid_argument";
    if (c.includes("resource-exhausted")) return "resource_exhausted";
    return "unavailable";
  }
  const falha = (err) => { const e = { code: codigo(err), message: (err && err.message) || "" }; return Promise.reject(e); };

  /* ---------- db ---------- */
  function snapDoc(d) {
    return { id: d.id, exists: d.exists, data: () => d.data(),
      metadata: { fromCache: d.metadata.fromCache, hasPendingWrites: d.metadata.hasPendingWrites } };
  }
  function snapQuery(q) {
    const docs = q.docs.map(snapDoc);
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [],
      metadata: { fromCache: q.metadata.fromCache, hasPendingWrites: q.metadata.hasPendingWrites } };
  }
  function docRef(path) {
    const r = fs.doc(path);
    return {
      id: r.id, path,
      get: () => r.get().then(snapDoc, falha),
      set: (d) => r.set(d).catch(falha),
      update: (d) => r.update(d).catch(falha),
      delete: () => r.delete().catch(falha),
      acquire: async () => ({ acquired: true }),
      onSnapshot: (next, error) => r.onSnapshot((s) => next(snapDoc(s)), (e) => error && error({ code: codigo(e), message: e.message })),
      collection: (c) => colRef(path + "/" + c),
    };
  }
  function colRef(path) {
    const c = fs.collection(path);
    return {
      path,
      doc: (id) => docRef(id ? path + "/" + id : c.doc().path),
      add: (d) => c.add(d).then((r) => docRef(r.path), falha),
      get: () => c.get().then(snapQuery, falha),
      onSnapshot: (next, error) => c.onSnapshot((s) => next(snapQuery(s)), (e) => error && error({ code: codigo(e), message: e.message })),
    };
  }
  const db = { doc: docRef, collection: colRef };

  /* ---------- usuário ---------- */
  let legado = null;
  async function nomesLegado() {
    if (legado) return legado;
    try { const d = await fs.doc("legado/nomes").get(); legado = (d.exists && d.data().nomes) || {}; } catch (e) { legado = {}; }
    return legado;
  }
  const user = {
    isOwner: () => !!auth.currentUser && String(auth.currentUser.email || "").toLowerCase() === donaEmail,
    canEdit: () => user.isOwner(),
    can: () => null,
    id: async () => (auth.currentUser ? auth.currentUser.uid : null),
    me: async () => ({ id: auth.currentUser.uid, name: auth.currentUser.displayName || auth.currentUser.email || "" }),
    profiles: async (ids) => {
      const out = {}; const leg = await nomesLegado();
      await Promise.all(ids.map(async (id) => {
        try { const d = await fs.doc("perfis/" + id).get(); if (d.exists) { out[id] = { id, name: d.data().nome || "" }; return; } } catch (e) {}
        out[id] = { id, name: leg[id] || "" };
      }));
      return out;
    },
    search: async () => {
      try { const q = await fs.collection("perfis").get(); return q.docs.map((d) => ({ id: d.id, name: d.data().nome || d.data().email || "" })); }
      catch (e) { return []; }
    },
  };

  /* ---------- downloads ---------- */
  const downloads = {
    save: async ({ filename, data }) => {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { status: "saved" };
    },
  };

  window.claude = { use: async (nome) => (nome === "db" ? db : nome === "user" ? user : nome === "downloads" ? downloads : null) };

  /* ---------- histórico (jan–out/2026) guardado no Firestore ---------- */
  window.__fetchHist = async () => {
    const q = await fs.collection("hist").get();
    const meses = {};
    q.forEach((d) => { try { meses[d.id] = JSON.parse(d.data().json || "[]"); } catch (e) { meses[d.id] = []; } });
    return { meses };
  };

  /* ---------- restaurar backup (só a dona) ---------- */
  window.__restaurar = async (arquivo) => {
    if (!user.isOwner()) { alertaLeve("Só a dona do sistema pode restaurar o backup."); return; }
    let b;
    try { b = JSON.parse(await arquivo.text()); } catch (e) { alertaLeve("Arquivo inválido: não é um backup do Funil de Leads."); return; }
    if (!b || b.formato !== "funil-leads-backup-1") { alertaLeve("Arquivo inválido: não é um backup do Funil de Leads."); return; }
    const ops = [];
    for (const [k, linhas] of Object.entries(b.historico || {})) ops.push(["hist/" + k, { json: JSON.stringify(linhas) }]);
    for (const [k, docs] of Object.entries(b.leads || {})) for (const d of docs) ops.push(["m/" + k + "/leads/" + d.id, d.data]);
    for (const [k, d] of Object.entries(b.adm || {})) ops.push(["adm/" + k, d]);
    for (const [k, d] of Object.entries(b.pub || {})) ops.push(["pub/" + k, d]);
    for (const [k, d] of Object.entries(b.risc || {})) ops.push(["risc/" + k, d]);
    for (const s of (b.solic || [])) ops.push(["solic/" + s.id, s.data]);
    for (const [k, d] of Object.entries(b.sys || {})) ops.push(["sys/" + k, d]);
    ops.push(["cfg/acesso", { gestores: [] }]);
    ops.push(["legado/nomes", { nomes: b.nomes || {} }]);
    const total = ops.length;
    const barra = alertaLeve("Restaurando backup… 0 de " + total, true);
    try {
      for (let i = 0; i < ops.length; i += 400) {
        const lote = fs.batch();
        for (const [p, d] of ops.slice(i, i + 400)) lote.set(fs.doc(p), d);
        await lote.commit();
        barra.textContent = "Restaurando backup… " + Math.min(i + 400, total) + " de " + total;
      }
      barra.textContent = "Backup restaurado. Recarregando…";
      setTimeout(() => location.reload(), 1500);
    } catch (e) {
      barra.textContent = "A restauração parou (" + (e.code || "erro") + "). Confira as regras do Firestore e tente de novo.";
    }
  };

  /* ---------- tela de login ---------- */
  function estilo() {
    if (document.getElementById("fl-css")) return;
    const st = document.createElement("style"); st.id = "fl-css";
    st.textContent = `#fl-login{position:fixed;inset:0;z-index:100;background:var(--bg,#f4f6f8);display:grid;place-items:center;padding:20px}
#fl-login .bx{background:var(--card,#fff);border:1px solid var(--line,#e2e6eb);border-radius:14px;padding:28px;max-width:420px;width:100%;text-align:center;font-family:Figtree,system-ui,sans-serif;color:var(--ink,#16202c)}
#fl-login h1{font-size:20px;margin:0 0 6px}#fl-login p{color:var(--muted,#5f6b7a);font-size:14px;margin:0 0 18px}
#fl-login button{background:#0f6e66;color:#fff;border:0;border-radius:8px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer}
#fl-login button.sec{background:transparent;color:#0f6e66;border:1px solid #0f6e66;margin-top:10px}
#fl-login input{width:100%;box-sizing:border-box;border:1px solid var(--line,#cfd5dc);border-radius:8px;padding:10px 12px;font:inherit;font-size:14px;margin:0 0 10px;background:#fff;color:inherit}
#fl-login form{margin:0;text-align:left}#fl-login form button{width:100%}
#fl-login .ou{display:flex;align-items:center;gap:10px;color:var(--muted,#5f6b7a);font-size:12px;margin:16px 0}#fl-login .ou:before,#fl-login .ou:after{content:"";flex:1;border-top:1px solid var(--line,#e2e6eb)}
#fl-login .links{margin:12px 0 0;font-size:13px}#fl-login .links a{color:#0f6e66;font-weight:600;text-decoration:none}#fl-login .links a:hover{text-decoration:underline}
#fl-sair{border:1px solid var(--line,#e2e6eb);background:transparent;border-radius:8px;padding:6px 10px;cursor:pointer;color:inherit;font:inherit;font-size:13px}
.fl-alerta{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#16202c;color:#fff;padding:12px 18px;border-radius:10px;z-index:120;font-weight:600;max-width:90vw}`;
    document.head.appendChild(st);
  }
  function alertaLeve(txt, fixo) {
    estilo(); const d = document.createElement("div"); d.className = "fl-alerta"; d.textContent = txt; document.body.appendChild(d);
    if (!fixo) setTimeout(() => d.remove(), 4000); return d;
  }
  function telaAviso(titulo, html, botoes) {
    estilo();
    let el = document.getElementById("fl-login");
    if (!el) { el = document.createElement("div"); el.id = "fl-login"; document.body.appendChild(el); }
    el.innerHTML = `<div class="bx"><h1>${titulo}</h1><p>${html}</p>${botoes || ""}</div>`;
    return el;
  }
  const MSG = {
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/wrong-password": "E-mail ou senha incorretos.",
    "auth/user-not-found": "E-mail ou senha incorretos.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/email-already-in-use": "Este e-mail já tem senha. Volte e use \"Entrar\" (ou \"Esqueci a senha\").",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    "auth/missing-email": "Digite o seu e-mail.",
    "auth/too-many-requests": "Muitas tentativas. Espere alguns minutos e tente de novo.",
    "auth/operation-not-allowed": "Login com e-mail e senha não está ativado no Firebase.",
    "auth/popup-closed-by-user": "A janela do Google foi fechada antes de terminar.",
    "auth/unauthorized-domain": "Este endereço não está autorizado no Firebase (Domínios autorizados).",
  };
  const erroLogin = (e) => alertaLeve(MSG[e && e.code] || "Não foi possível entrar (" + ((e && e.code) || "erro") + ").");
  function telaLogin(modo) {
    const criar = modo === "criar";
    const el = telaAviso(criar ? "Criar minha senha" : "Funil de Leads da Comunicação",
      criar ? "Primeiro acesso: use o e-mail que a administração liberou, o seu nome e escolha uma senha (mínimo 6 caracteres)."
            : "Entre com o seu e-mail, nome e senha.",
      `<form id="fl-form" autocomplete="on">
        <input id="fl-email" type="email" placeholder="E-mail" autocomplete="username" required>
        <input id="fl-nome-login" list="fl-nomes-l" placeholder="Nome" autocomplete="off" required>
        <datalist id="fl-nomes-l"><option value="Vinícius"><option value="Samara"><option value="Bernardo"><option value="Juliana"></datalist>
        <input id="fl-senha" type="password" placeholder="${criar ? "Escolha uma senha" : "Senha"}" autocomplete="${criar ? "new-password" : "current-password"}" minlength="6" required>
        ${criar ? `<input id="fl-senha2" type="password" placeholder="Repita a senha" autocomplete="new-password" minlength="6" required>` : ""}
        <button type="submit">${criar ? "Criar senha e entrar" : "Entrar"}</button>
      </form>
      <p class="links">${criar
        ? `<a href="#" id="fl-voltar">Já tenho senha</a>`
        : `<a href="#" id="fl-criar">Primeiro acesso? Criar minha senha</a> · <a href="#" id="fl-esqueci">Esqueci a senha</a>`}</p>
      ${criar ? "" : `<div class="ou">ou</div><button class="sec" id="fl-entrar" type="button">Entrar com Google</button>`}`);
    const q = (id) => el.querySelector(id);
    if (q("#fl-criar")) q("#fl-criar").onclick = (ev) => { ev.preventDefault(); telaLogin("criar"); };
    if (q("#fl-voltar")) q("#fl-voltar").onclick = (ev) => { ev.preventDefault(); telaLogin(); };
    if (q("#fl-esqueci")) q("#fl-esqueci").onclick = (ev) => {
      ev.preventDefault();
      const em = q("#fl-email").value.trim();
      if (!em) { alertaLeve("Digite o seu e-mail no campo E-mail e clique de novo em \"Esqueci a senha\"."); return; }
      auth.sendPasswordResetEmail(em)
        .then(() => alertaLeve("Se esse e-mail tiver acesso, chegará uma mensagem para criar uma nova senha. Confira também o spam.", false))
        .catch(erroLogin);
    };
    q("#fl-form").onsubmit = (ev) => {
      ev.preventDefault();
      const em = q("#fl-email").value.trim(), se = q("#fl-senha").value;
      if (criar && se !== q("#fl-senha2").value) { alertaLeve("As duas senhas não são iguais."); return; }
      nomeDigitado = q("#fl-nome-login").value.trim();
      // Sessão só nesta aba: ao fechar o navegador, precisa entrar de novo (computador compartilhado)
      auth.setPersistence(firebase.auth.Auth.Persistence.SESSION)
        .then(() => criar ? auth.createUserWithEmailAndPassword(em, se) : auth.signInWithEmailAndPassword(em, se))
        .catch((e) => { nomeDigitado = null; erroLogin(e); });
    };
    if (q("#fl-entrar")) q("#fl-entrar").onclick = () => auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
      .then(() => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider())).catch(erroLogin);
  }
  let nomeDigitado = null;
  const semAcento = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const primeiro = (x) => semAcento(x).split(/\s+/)[0];
  // Primeiro acesso de um usuário de e-mail e senha: pergunta o nome (é ele que liga o login às metas)
  function pedirNome(u) {
    return new Promise((ok) => {
      const sug = String(u.email || "").split("@")[0].split(/[._-]/)[0];
      const ini = sug ? sug.charAt(0).toUpperCase() + sug.slice(1) : "";
      const el = telaAviso("Primeiro acesso", "Como você se chama? Use o mesmo nome da equipe (ex.: Vinícius, Samara, Bernardo). Ele aparece nos seus lançamentos e nas metas.",
        `<form id="fl-nome-f"><input id="fl-nome" list="fl-nomes" value="${ini.replace(/["<>&]/g, "")}" required>
        <datalist id="fl-nomes"><option value="Vinícius"><option value="Samara"><option value="Bernardo"><option value="Juliana"></datalist>
        <button type="submit">Continuar</button></form>`);
      el.querySelector("#fl-nome-f").onsubmit = async (ev) => {
        ev.preventDefault();
        const n = el.querySelector("#fl-nome").value.trim(); if (!n) return;
        try { await u.updateProfile({ displayName: n }); } catch (e) {}
        ok(n);
      };
    });
  }
  function botaoSair() {
    if (document.getElementById("fl-sair")) return;
    const b = document.createElement("button"); b.id = "fl-sair"; b.textContent = "Sair"; b.onclick = () => auth.signOut().then(() => location.reload());
    const top = document.querySelector(".topin"); if (top) top.appendChild(b);
  }

  let iniciado = false;
  document.addEventListener("DOMContentLoaded", () => {
    estilo();
    auth.onAuthStateChanged(async (u) => {
      if (!u) { telaLogin(); return; }
      if (nomeDigitado !== null) {
        const n = nomeDigitado; nomeDigitado = null;
        if (!u.displayName) {
          // Primeiro acesso: o nome digitado fica registrado para este usuário
          try { await u.updateProfile({ displayName: n }); } catch (e) {}
        } else if (primeiro(u.displayName) !== primeiro(n)) {
          await auth.signOut();
          alertaLeve("O nome não confere com este usuário. Confira e tente de novo.");
          return;
        }
      }
      if (!auth.currentUser.displayName) await pedirNome(u);
      telaAviso("Entrando…", "Conferindo o seu acesso.");
      try { await fs.doc("perfis/" + u.uid).set({ nome: auth.currentUser.displayName || "", email: u.email || "", visto: new Date().toISOString() }, { merge: true }); } catch (e) {}
      try { await fs.doc("cfg/acesso").get(); }
      catch (e) {
        const el = telaAviso("Acesso não liberado", `O usuário <b>${(u.email || "").replace(/[<>&]/g, "")}</b> ainda não tem acesso. Peça à administração para incluí-lo nas regras do sistema.`,
          `<button class="sec" id="fl-outra">Entrar com outro usuário</button>`);
        el.querySelector("#fl-outra").onclick = () => auth.signOut();
        return;
      }
      const el = document.getElementById("fl-login"); if (el) el.remove();
      botaoSair();
      if (!iniciado && window.__iniciar) { iniciado = true; window.__iniciar(); }
    });
  });
})();
