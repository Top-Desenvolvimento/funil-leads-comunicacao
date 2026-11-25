
"""
Robô de conferência de presenças – Funil de Leads da Comunicação.
 
Para cada unidade:
  1. Entra no sistema da clínica com o usuário e a senha guardados nos Secrets do GitHub.
  2. Agendas > Busca de Consultas: Status "Concluído", serviços de AVALIAÇÃO,
     do 1º dia do mês anterior até hoje.
  3. Lê o código do paciente (número entre parênteses) de cada consulta concluída.
Depois, no Funil (Firebase):
  4. Procura leads "Agendado" sem status, da mesma cidade, com a consulta até hoje.
  5. Se o COD do lead aparece entre as avaliações concluídas (em data igual ou posterior
     à entrada do lead), grava Status = "Presença".
 
Regras de segurança:
  - Só LÊ o sistema da clínica (nenhum clique em editar, cancelar ou excluir).
  - Nunca sobrescreve status já lançado pela equipe.
  - Os registros (logs) mostram só números. O repositório é público: nada de nomes,
    telefones ou códigos de pacientes nos logs.
"""
import datetime as dt
import json
import os
import re
import sys
import unicodedata
 
import requests
from bs4 import BeautifulSoup
 
# ---------------------------------------------------------------- configuração
UNIDADES = {
    # chave: (endereço base, nomes de cidade usados no Funil)
    "caxias": ("http://caxias.topesteticabucal.com.br/sistema/", ["Caxias", "Caxias do Sul"]),
    "bento": ("http://bento.topesteticabucal.com.br/sistema/", ["Bento Gonçalves", "Bento"]),
    "farroupilha": ("http://farroupilha.topesteticabucal.com.br/sistema/", ["Farroupilha"]),
    "flores": ("http://flores.topesteticabucal.com.br/sistema/", ["Flores da Cunha", "Flores"]),
    "veranopolis": ("http://veranopolis.topesteticabucal.com.br/sistema/", ["Veranópolis"]),
    "encantado": ("https://encantado.topesteticabucal.com.br/sistema/", ["Encantado"]),
    "soledade": ("http://soledade.topesteticabucal.com.br/sistema/", ["Soledade"]),
}
SERVICOS = [
    "AVALIAÇÃO (CLÍNICO)",
    "AVALIAÇÃO (ESTÉTICA)",
    "AVALIAÇÃO (IMPLANTE)",
    "AVALIAÇÃO (MENORES 6 ANOS)",
    "AVALIAÇÃO (ORTO)",
    "AVALIAÇÃO ASSERTIVA",
]
STATUS_CONCLUIDO = "1"
PRIMEIRO_MES_LIVE = "2026-11"  # meses a partir deste ficam no Firebase (m/<mes>/leads)
FUSO = dt.timezone(dt.timedelta(hours=-3))  # America/Sao_Paulo
UA = "Mozilla/5.0 (FunilLeads-Robo/1.0)"
TIMEOUT = 40
 
 
def norm(txt):
    t = unicodedata.normalize("NFD", str(txt or ""))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", t).strip().upper()
 
 
def texto(conteudo):
    """O sistema declara windows-1252, mas aceita também UTF-8."""
    try:
        return conteudo.decode("utf-8")
    except UnicodeDecodeError:
        return conteudo.decode("cp1252", errors="replace")
 
 
def log(msg):
    print(msg, flush=True)
 
 
# ---------------------------------------------------------------- sistema da clínica
class ErroLogin(Exception):
    pass
 
 
def credenciais(chave):
    """Usuário/senha da unidade: CLINICA_USUARIO_<UNIDADE> ou, se não houver, CLINICA_USUARIO."""
    u = os.environ.get("CLINICA_USUARIO_" + chave.upper()) or os.environ.get("CLINICA_USUARIO")
    s = os.environ.get("CLINICA_SENHA_" + chave.upper()) or os.environ.get("CLINICA_SENHA")
    return u, s
 
 
def campos_login(html):
    """Lê o formulário de login: campos ocultos (inclui o token que muda a cada acesso)."""
    sp = BeautifulSoup(html, "html.parser")
    form = sp.find("form", attrs={"name": "login"})
    if not form:
        raise ErroLogin("formulário de login não encontrado")
    dados = {}
    for inp in form.find_all("input"):
        nome = inp.get("name")
        if nome and (inp.get("type") or "text").lower() == "hidden":
            dados[nome] = inp.get("value", "")
    return form.get("action") or "efetuar_login.php", dados
 
 
def tela_de_login(html):
    return 'name="login"' in html and 'name="senha"' in html
 
 
def ids_servicos(html):
    """Valores dos 6 serviços de avaliação no <select name="servicos[]"> desta unidade."""
    sp = BeautifulSoup(html, "html.parser")
    sel = sp.find("select", attrs={"name": "servicos[]"})
    if not sel:
        raise RuntimeError("campo Serviço(s) não encontrado")
    alvo = {norm(s) for s in SERVICOS}
    ids = [o.get("value") for o in sel.find_all("option") if o.get("value") and norm(o.get_text()) in alvo]
    return ids
 
 
def ler_resultado(html):
    """Linhas da busca: [{idpaciente, data(AAAA-MM-DD), tel8}] e o total informado pela página."""
    sp = BeautifulSoup(html, "html.parser")
    linhas = []
    for tr in sp.find_all("tr", attrs={"idconsulta": True}):
        idp = (tr.get("idpaciente") or "").strip()
        tds = tr.find_all("td", recursive=False)
        data = ""
        status = ""
        if len(tds) >= 6:
            m = re.search(r"(\d{2})/(\d{2})/(\d{4})", tds[3].get_text())
            if m:
                data = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
            status = norm(tds[5].get_text())
        if not idp:
            # reserva: número entre parênteses no nome do paciente
            m = re.search(r"\((\d+)\)", tds[1].get_text() if len(tds) > 1 else "")
            idp = m.group(1) if m else ""
        tel = ""
        if len(tds) > 1:
            span = tds[1].find("span")
            dig = re.sub(r"\D", "", span.get_text() if span else "")
            tel = dig[-8:] if len(dig) >= 8 else ""
        if idp and (not status or status.startswith("CONCLU")):
            linhas.append({"idpaciente": idp, "data": data, "tel8": tel})
    total = None
    m = re.search(r"Total de consultas nesta busca:\s*(\d+)", sp.get_text(" "))
    if m:
        total = int(m.group(1))
    return linhas, total
 
 
def buscar_unidade(chave, base, data_ini, data_fim):
    usuario, senha = credenciais(chave)
    if not usuario or not senha:
        raise ErroLogin("usuário/senha não cadastrados nos Secrets")
    s = requests.Session()
    s.headers["User-Agent"] = UA
 
    r = s.get(base + "index.php", timeout=TIMEOUT)
    acao, dados = campos_login(texto(r.content))
    dados.update({"usuario": usuario, "senha": senha, "redir": dados.get("redir", "")})
    # usa sempre o endereço da unidade (o formulário pode apontar para http em vez de https)
    url_login = base + (acao.split("?")[0].rstrip("/").split("/")[-1] or "efetuar_login.php")
    s.post(url_login, data=dados, timeout=TIMEOUT)
 
    r = s.get(base + "index2.php", params={"conteudo": "busca_consultas"}, timeout=TIMEOUT)
    html = texto(r.content)
    if tela_de_login(html):
        raise ErroLogin("login recusado (confira usuário e senha)")
    ids = ids_servicos(html)
    if len(ids) < len(SERVICOS):
        log(f"  aviso: {len(ids)} de {len(SERVICOS)} serviços de avaliação encontrados nesta unidade")
    if not ids:
        raise RuntimeError("nenhum serviço de avaliação encontrado")
 
    params = [("conteudo", "busca_consultas"), ("pesquisa", "pesquisa"), ("idade_minima", ""), ("idade_maxima", "")]
    params += [("servicos[]", i) for i in ids]
    params += [("situacao", ""), ("baixa", ""), ("status", STATUS_CONCLUIDO),
               ("data_inicio", data_ini.strftime("%d/%m/%Y")), ("data_fim", data_fim.strftime("%d/%m/%Y"))]
    todas, inicio, total = [], 0, None
    for _ in range(200):  # no máximo 6.000 consultas por unidade
        r = s.get(base + "index2.php", params=params + [("inicio", str(inicio))], timeout=TIMEOUT)
        html = texto(r.content)
        if tela_de_login(html):
            raise ErroLogin("sessão expirou durante a busca")
        linhas, t = ler_resultado(html)
        total = t if t is not None else total
        if not linhas:
            break
        todas += linhas
        inicio += 30
        if total is not None and inicio >= total:
            break
    try:
        s.get(base + "sair.php", timeout=TIMEOUT)
    except Exception:
        pass
    return todas, total
 
 
# ---------------------------------------------------------------- comparação
def cods_do_lead(lead):
    """Códigos possíveis no campo COD do lead (ex.: '13197 | NOME', '12129 / 2502')."""
    txt = str(lead.get("cod") or "")
    return {c.lstrip("0") for c in re.findall(r"(?<!\d)\d{2,7}(?!\d)", txt) if c.lstrip("0")}
 
 
def tel8(x):
    d = re.sub(r"\D", "", str(x or ""))
    return d[-8:] if len(d) >= 8 else ""
 
 
def decidir(lead, concluidas):
    """Devolve a data da avaliação concluída que confirma a presença, ou None."""
    cods = cods_do_lead(lead)
    t8 = tel8(lead.get("contato"))
    entrada = lead.get("data") or ""
    melhor = None
    for c in concluidas:
        bate = (cods and c["idpaciente"].lstrip("0") in cods) or (not cods and t8 and c.get("tel8") == t8)
        if not bate:
            continue
        if entrada and c["data"] and c["data"] < entrada:
            continue  # avaliação antiga, de antes de o lead entrar
        if melhor is None or (c["data"] or "") < melhor:
            melhor = c["data"] or ""
    return melhor
 
 
def meses_live(hoje):
    out, a, m = [], int(PRIMEIRO_MES_LIVE[:4]), int(PRIMEIRO_MES_LIVE[5:])
    while (a, m) <= (hoje.year, hoje.month):
        out.append(f"{a:04d}-{m:02d}")
        a, m = (a + 1, 1) if m == 12 else (a, m + 1)
    return out
 
 
def unidade_da_cidade(cidade):
    n = norm(cidade)
    for chave, (_, nomes) in UNIDADES.items():
        if n in {norm(x) for x in nomes}:
            return chave
    return None
 
 
# ---------------------------------------------------------------- principal
def main():
    simular = os.environ.get("SIMULAR", "true").lower() in ("1", "true", "sim", "yes")
    pedidas = [u.strip().lower() for u in (os.environ.get("UNIDADES") or "").replace(";", ",").split(",") if u.strip()]
    unidades = {k: v for k, v in UNIDADES.items() if not pedidas or k in pedidas}
 
    agora = dt.datetime.now(FUSO)
    hoje = agora.date()
    ini = (hoje.replace(day=1) - dt.timedelta(days=1)).replace(day=1)  # 1º dia do mês anterior
    hoje_iso = hoje.isoformat()
    log(f"Conferência de presenças – {agora:%d/%m/%Y %H:%M} – período {ini:%d/%m/%Y} a {hoje:%d/%m/%Y}")
    log("MODO SIMULAÇÃO: nada será gravado no Funil." if simular else "Modo normal: as presenças encontradas serão gravadas no Funil.")
 
    # Funil (Firebase)
    import firebase_admin
    from firebase_admin import credentials, firestore
 
    sa = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not sa:
        log("ERRO: o Secret FIREBASE_SERVICE_ACCOUNT não está cadastrado.")
        sys.exit(1)
    firebase_admin.initialize_app(credentials.Certificate(json.loads(sa)))
    db = firestore.client()
    if not simular:
        db.document("perfis/robo").set({"nome": "Robô de conferência", "email": "", "visto": agora.isoformat()}, merge=True)
 
    estado = db.document("robo/estado")
    estado.set({"estado": "rodando", "inicio": agora.isoformat(), "simular": simular}, merge=True)
 
    # 1) sistema da clínica
    concluidas, falhas, motivo = {}, [], {}
    for chave, (base, _) in unidades.items():
        try:
            linhas, total = buscar_unidade(chave, base, ini, hoje)
            concluidas[chave] = linhas
            log(f"[{chave}] {len(linhas)} avaliações concluídas lidas" + (f" (o sistema informa {total})" if total is not None else ""))
        except ErroLogin as e:
            falhas.append(chave)
            motivo[chave] = str(e)
            log(f"[{chave}] NÃO CONFERIDA: {e}")
        except Exception as e:  # sem detalhes do conteúdo da página
            falhas.append(chave)
            motivo[chave] = "erro ao acessar o sistema"
            log(f"[{chave}] NÃO CONFERIDA: erro {type(e).__name__}")
 
    res = {k: {"pendentes": 0, "presencas": 0, "pulados": 0} for k in unidades}
    sem_cidade = 0
    for mes in meses_live(hoje):
        for snap in db.collection(f"m/{mes}/leads").where("situacao", "==", "Agendado").stream():
            lead = snap.to_dict() or {}
            if lead.get("status") or not lead.get("agendamento") or lead["agendamento"] > hoje_iso:
                continue
            chave = unidade_da_cidade(lead.get("cidade"))
            if not chave:
                sem_cidade += 1
                continue
            if chave not in concluidas:
                continue
            res[chave]["pendentes"] += 1
            data_av = decidir(lead, concluidas[chave])
            if data_av is None:
                continue
            if simular:
                res[chave]["presencas"] += 1
                continue
 
            ref = snap.reference
            t = agora.isoformat()
            txt = "Robô de conferência: avaliação concluída" + (f" em {data_av[8:10]}/{data_av[5:7]}/{data_av[:4]}" if data_av else "") + " no sistema da clínica"
 
            @firestore.transactional
            def gravar(tr):
                atual = ref.get(transaction=tr).to_dict() or {}
                if atual.get("status") or atual.get("situacao") != "Agendado":
                    return False
                notas = atual.get("notas") if isinstance(atual.get("notas"), list) else []
                n = {"u": "robo", "t": t, "de": "Agendado", "para": "Agendado", "st": "Presença", "txt": txt}
                tr.update(ref, {"status": "Presença", "notas": (notas + [n])[-60:], "atualizado": t,
                                "atualizadoPor": "robo", "conferidoRobo": t})
                return True
 
            if gravar(db.transaction()):
                res[chave]["presencas"] += 1
            else:
                res[chave]["pulados"] += 1
 
    # 3) resumo (só números)
    log("")
    log("RESUMO" + (" (simulação)" if simular else ""))
    tot_p = tot_pr = 0
    for chave in unidades:
        if chave in falhas:
            log(f"  {chave:12s} não conferida (ver aviso acima)")
            continue
        r = res[chave]
        tot_p += r["pendentes"]
        tot_pr += r["presencas"]
        extra = f", {r['pulados']} pulados (alguém lançou o status antes)" if r["pulados"] else ""
        verbo = "teriam presença" if simular else "presenças gravadas"
        log(f"  {chave:12s} {r['pendentes']:4d} agendados sem status → {r['presencas']:3d} {verbo}{extra}")
    log(f"  TOTAL        {tot_p:4d} agendados sem status → {tot_pr:3d}")
    if sem_cidade:
        log(f"  {sem_cidade} agendados sem status ficaram de fora por não terem cidade de unidade.")
    log("Quem não teve avaliação concluída continua sem status para a equipe conferir.")
    resumo = {k: ({"falha": motivo.get(k, "erro")} if k in falhas else {**res[k], "lidas": len(concluidas.get(k, []))}) for k in unidades}
    estado.set({"estado": "erro" if falhas and len(falhas) == len(unidades) else "concluido",
                "fim": dt.datetime.now(FUSO).isoformat(), "simular": simular, "resumo": resumo,
                "semCidade": sem_cidade}, merge=True)
    if falhas:
        sys.exit(2)
 
 
if __name__ == "__main__":
    main()
 
