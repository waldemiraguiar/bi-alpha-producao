#!/usr/bin/env python3
"""Robô de nuvem do AGENTE CRM — MATRIZ  (frota "Agentes de IA Alpha").

Reusa build_financeiro.build() (a MESMA consulta ao MySQL operacional) e monta a
visão de MOVIMENTAÇÃO DE CLIENTES *sem nenhum valor R$* — pronta para o time
comercial: reativar, em queda, parados, novos esfriando, em alta, carteira.

Os sparklines são NORMALIZADOS (0..100 = só a forma da tendência), nunca expõem
faturamento. Tier/R$ ficam de fora — a priorização usa recência + magnitude da
variação.  Cifra (AES-256-GCM, senha do time CRM) -> site_crm/data/crm.enc.

Env: MYSQL_*, BI_PWD (exigido por build_financeiro), CRM_PWD (cifra a saída CRM)."""
import os, json, base64, datetime, time
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_ENC = os.path.join(ROOT, "site_crm", "data", "crm.enc")
ITER = 250_000
CRM_PWD = os.environ.get("CRM_PWD", "")


def spark(sem):
    """semanas (R$) cronológico -> shape 0..100 (esconde o valor, mostra a tendência)."""
    sem = list(sem or [])
    if not sem:
        return [0, 0, 0, 0, 0]
    m = max(sem)
    if m <= 0:
        return [0] * len(sem)
    return [round(100 * v / m) for v in sem]


def crm_from(D):
    """Transforma o dataset financeiro (com R$) na visão CRM (sem R$)."""
    radar = D.get("radar", []) or []
    perd = D.get("perdidos", {}) or {}
    nv = D.get("novos", {}) or {}
    tiers = D.get("tiers", []) or []

    sumidos = perd.get("sumidos", []) or []
    queda_forte_src = perd.get("queda", []) or []
    down = [x for x in radar if x.get("flag") == "down"]
    up = [x for x in radar if x.get("flag") == "up"]
    novos_all = (nv.get("recem", []) or []) + (nv.get("maturando", []) or [])
    esfri = sorted([x for x in novos_all if x.get("esfriando")],
                   key=lambda x: -(x.get("dias_inativo") or 0))
    novos_ok = sorted([x for x in novos_all if not x.get("esfriando")],
                      key=lambda x: -(x.get("dias_cad") or 0))

    def base(x):
        return {"cod": x.get("cod"), "nome": x.get("nome") or ("#" + str(x.get("cod"))),
                "cidade": x.get("cidade") or "—", "uf": x.get("uf")}

    def mov(x):  # item tipo radar
        b = base(x)
        b.update({"delta": x.get("delta"), "flag": x.get("flag"),
                  "spark": spark(x.get("semanas")), "dias_inativo": x.get("dias_inativo")})
        return b

    em_queda = [{**mov(x), "motivo": "queda"} for x in down]
    em_alta = [{**mov(x), "motivo": "alta"} for x in up]
    parados = [{**base(x), "dias_inativo": x.get("dias_inativo"), "ultima": x.get("ultima"),
                "delta": x.get("delta"), "spark": spark(x.get("semanas")), "motivo": "parado"}
               for x in sumidos]
    qforte = [{**base(x), "delta": x.get("delta"), "dias_inativo": x.get("dias_inativo"),
               "ultima": x.get("ultima"), "spark": spark(x.get("semanas")), "motivo": "queda_forte"}
              for x in queda_forte_src]
    novos_esfri = [{**base(x), "dias_inativo": x.get("dias_inativo"), "dias_cad": x.get("dias_cad"),
                    "spark": spark(x.get("semanas")), "motivo": "novo_esfriando"} for x in esfri]
    novos = [{**base(x), "dias_cad": x.get("dias_cad"), "spark": spark(x.get("semanas")),
              "motivo": "novo"} for x in novos_ok[:40]]

    # ---- REATIVAR: fila acionável única (dedupe por cliente, ordenada por prioridade) ----
    RANK = {"parado": 0, "queda_forte": 1, "queda": 2, "novo_esfriando": 3}
    LABEL = {"parado": "Parado", "queda_forte": "Queda forte",
             "queda": "Em queda", "novo_esfriando": "Novo esfriando"}
    pool = parados + qforte + em_queda + novos_esfri
    seen = set(); reativar = []
    for x in sorted(pool, key=lambda x: (RANK.get(x["motivo"], 9),
                                         -(x.get("dias_inativo") or 0),
                                         -abs(x.get("delta") or 0))):
        if x["cod"] in seen:
            continue
        seen.add(x["cod"])
        di = x.get("dias_inativo"); dl = abs(x.get("delta") or 0)
        m = x["motivo"]
        if m == "parado":
            acao = f"Ligar — sem enviar há {di}d" if di is not None else "Ligar — cliente parado"
        elif m == "queda_forte":
            acao = f"Contato urgente — caiu {round(dl)}%"
        elif m == "queda":
            acao = f"Acompanhar — caiu {round(dl)}%"
        else:
            acao = f"Engajar novo — parou há {di}d" if di is not None else "Engajar cliente novo"
        reativar.append({**x, "prioridade": LABEL[m], "acao": acao})

    # ---- CARTEIRA ativa (sem R$): nome/cidade/variação/tendência/situação ----
    paradoset = {p["cod"] for p in parados}
    carteira = []
    for x in tiers:
        sit = ("parado" if x.get("cod") in paradoset else
               "alta" if x.get("flag") == "up" else
               "queda" if x.get("flag") == "down" else "estável")
        carteira.append({**base(x), "delta": x.get("delta"), "flag": x.get("flag"),
                         "spark": spark(x.get("semanas")), "situacao": sit})

    resumo = {"reativar": len(reativar), "em_queda": len(em_queda), "em_alta": len(em_alta),
              "parados": len(parados), "queda_forte": len(qforte),
              "novos_esfriando": len(novos_esfri), "novos": len(novos),
              "carteira": len(carteira),
              "ativos": (D.get("kpis", {}) or {}).get("clientes_ativos_l12")}

    meta = D.get("meta", {}) or {}
    return {
        "meta": {"gerado_em": meta.get("gerado_em"), "max_data": meta.get("max_data"),
                 "fonte": "MySQL bi_alpha (nuvem) · Agente CRM",
                 "periodo": "última semana vs média das 4 anteriores (±10%)"},
        "resumo": resumo, "reativar": reativar, "em_queda": em_queda, "em_alta": em_alta,
        "parados": parados, "queda_forte": qforte, "novos_esfriando": novos_esfri,
        "novos": novos, "carteira": carteira,
    }


def _jdef(o):
    import decimal, datetime as _dt
    if isinstance(o, decimal.Decimal):
        return float(o)
    if isinstance(o, (_dt.date, _dt.datetime)):
        return str(o)
    raise TypeError(str(type(o)))


def encrypt(D2, pwd=None, out=OUT_ENC):
    pwd = pwd or CRM_PWD
    if not pwd:
        raise SystemExit("CRM_PWD não definido (senha do time CRM para cifrar).")
    data = json.dumps(D2, ensure_ascii=False, separators=(",", ":"), default=_jdef).encode()
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(pwd.encode())
    ct = AESGCM(key).encrypt(iv, data, None)
    env = {"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITER, "salt": base64.b64encode(salt).decode(),
           "iv": base64.b64encode(iv).decode(), "ct": base64.b64encode(ct).decode()}
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(env, open(out, "w"), separators=(",", ":"))
    r = D2["resumo"]
    print(f"OK -> {os.path.basename(out)} ({round(os.path.getsize(out)/1024,1)} KB) · "
          f"reativar={r['reativar']} · parados={r['parados']} · em_queda={r['em_queda']} · "
          f"em_alta={r['em_alta']} · novos_esfriando={r['novos_esfriando']}")


if __name__ == "__main__":
    from build_financeiro import build  # importado só na nuvem (precisa do MySQL)
    last = None
    for attempt in range(1, 4):
        try:
            encrypt(crm_from(build())); break
        except Exception as e:
            import pymysql
            if isinstance(e, pymysql.err.OperationalError):
                last = e; print(f"tentativa {attempt} falhou ({e}); retry em 20s"); time.sleep(20)
            else:
                raise
    else:
        raise last
