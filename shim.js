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
  function telaLogin() {
    const el = telaAviso("Funil de Leads da Comunicação", "Entre com a sua conta Google da clínica.", `<button id="fl-entrar">Entrar com Google</button>`);
    el.querySelector("#fl-entrar").onclick = () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider())
      .catch((e) => alertaLeve("Não foi possível entrar (" + (e.code || "erro") + ")."));
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
      telaAviso("Entrando…", "Conferindo o seu acesso.");
      try { await fs.doc("perfis/" + u.uid).set({ nome: u.displayName || "", email: u.email || "", visto: new Date().toISOString() }, { merge: true }); } catch (e) {}
      try { await fs.doc("cfg/acesso").get(); }
      catch (e) {
        const el = telaAviso("Acesso não liberado", `O e-mail <b>${(u.email || "").replace(/[<>&]/g, "")}</b> ainda não tem acesso. Peça à administradora para incluí-lo nas regras do sistema.`,
          `<button class="sec" id="fl-outra">Entrar com outra conta</button>`);
        el.querySelector("#fl-outra").onclick = () => auth.signOut();
        return;
      }
      const el = document.getElementById("fl-login"); if (el) el.remove();
      botaoSair();
      if (!iniciado && window.__iniciar) { iniciado = true; window.__iniciar(); }
    });
  });
})();
