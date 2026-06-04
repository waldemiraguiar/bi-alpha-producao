#!/usr/bin/env python3
"""Gera um crm.enc de DEMONSTRAÇÃO (sem MySQL) para o Agente CRM subir já
funcionando. Usa o MESMO crm_from()/encrypt() do robô — então valida o pipeline.
Em produção o GitHub Actions roda build_crm.py e substitui por dados reais.

Uso: CRM_PWD='AlphaCRMTV2026' python3 seed_demo_crm.py"""
import os, random, datetime
from build_crm import crm_from, encrypt

random.seed(42)
hoje = datetime.date.today()

CLINICAS = [
    ("Hospital Veterinário Bichos & Cia", "Niterói", "RJ"),
    ("Clínica Vet PetCare", "Cabo Frio", "RJ"),
    ("CãoVida Clínica Veterinária", "Rio de Janeiro", "RJ"),
    ("Pet Saúde Centro Veterinário", "São Gonçalo", "RJ"),
    ("AmorPet Hospital Animal", "Araruama", "RJ"),
    ("Vida Animal Diagnósticos", "Maricá", "RJ"),
    ("Clínica Patas Felizes", "Rio das Ostras", "RJ"),
    ("VetCenter Especialidades", "Macaé", "RJ"),
    ("Bicho Bom Veterinária", "Búzios", "RJ"),
    ("Hospital Pet Premium", "Petrópolis", "RJ"),
    ("Clínica Focinho Carinhoso", "Nova Friburgo", "RJ"),
    ("AnimalLab Veterinária", "Itaboraí", "RJ"),
    ("Pet Vida Clínica", "Saquarema", "RJ"),
    ("Reino Animal Hospital Vet", "Teresópolis", "RJ"),
    ("Clínica Quatro Patas", "Volta Redonda", "RJ"),
    ("VetExpress Diagnóstico", "Resende", "RJ"),
    ("Pet Center Saúde Animal", "Angra dos Reis", "RJ"),
    ("Clínica Bem-Estar Animal", "Barra Mansa", "RJ"),
    ("Doutor Pet Veterinária", "Campos dos Goytacazes", "RJ"),
    ("Vida Pet Hospital", "Nova Iguaçu", "RJ"),
    ("Clínica Amigo Fiel", "Duque de Caxias", "RJ"),
    ("PetLove Cabo Frio", "Cabo Frio", "RJ"),
    ("Veterinária São Francisco", "Magé", "RJ"),
    ("Clínica AnimalCare", "Mesquita", "RJ"),
    ("Hospital Vet Boa Saúde", "Belford Roxo", "RJ"),
    ("Pet Diagnose Laboratório", "Itaguaí", "RJ"),
    ("Clínica Cão & Gato", "Queimados", "RJ"),
    ("VetSaúde Especializada", "Japeri", "RJ"),
    ("Animal Center Veterinária", "Seropédica", "RJ"),
    ("Clínica Pet Total", "Guapimirim", "RJ"),
    ("Hospital dos Bichos", "Casimiro de Abreu", "RJ"),
    ("Vet Premium Diagnósticos", "Iguaba Grande", "RJ"),
]

cod = 1000
def novo_cod():
    global cod; cod += 1; return cod

def serie(base_val, trend, ruido=0.18):
    """5 semanas (R$). trend em fração por semana; retorna cronológico [s-4..atual]."""
    v = base_val; out = []
    for _ in range(5):
        v = max(0, v * (1 + trend + random.uniform(-ruido, ruido)))
        out.append(round(v, 2))
    return out

def delta_de(sem):
    atual = sem[-1]; base = sum(sem[:-1]) / 4.0
    return round(100 * (atual - base) / base, 1) if base > 0 else (100.0 if atual > 0 else 0.0)

pool = list(CLINICAS); random.shuffle(pool)
def take(n):
    return [pool.pop() for _ in range(min(n, len(pool)))]

radar = []
# quedas ≥10%
for nome, cid, uf in take(6):
    sem = serie(random.uniform(1500, 9000), random.uniform(-0.30, -0.12))
    radar.append({"cod": novo_cod(), "nome": nome, "cidade": cid, "uf": uf,
                  "delta": delta_de(sem), "flag": "down", "semanas": sem})
# altas ≥10%
for nome, cid, uf in take(5):
    sem = serie(random.uniform(1200, 7000), random.uniform(0.12, 0.32))
    radar.append({"cod": novo_cod(), "nome": nome, "cidade": cid, "uf": uf,
                  "delta": delta_de(sem), "flag": "up", "semanas": sem})

# parados (sumidos ≥35d)
sumidos = []
for nome, cid, uf in take(5):
    di = random.randint(38, 120)
    sem = [0, 0, 0, 0, 0]
    ult = (hoje - datetime.timedelta(days=di)).isoformat()
    sumidos.append({"cod": novo_cod(), "nome": nome, "cidade": cid, "uf": uf,
                    "dias_inativo": di, "ultima": ult, "delta": -100.0, "semanas": sem})

# queda forte (≤-40%)
queda = []
for nome, cid, uf in take(3):
    sem = serie(random.uniform(2000, 8000), -0.45, ruido=0.10)
    queda.append({"cod": novo_cod(), "nome": nome, "cidade": cid, "uf": uf,
                  "delta": min(-40.0, delta_de(sem)), "dias_inativo": random.randint(10, 30),
                  "ultima": (hoje - datetime.timedelta(days=random.randint(10, 30))).isoformat(),
                  "semanas": sem})

# novos (≤90d): alguns esfriando, outros aquecendo
recem = []
for nome, cid, uf in take(4):
    dias_cad = random.randint(8, 88)
    esfri = random.random() < 0.5
    di = random.randint(16, 40) if esfri else random.randint(1, 8)
    sem = serie(random.uniform(300, 2200), -0.25 if esfri else 0.20)
    recem.append({"cod": novo_cod(), "nome": nome, "cidade": cid, "uf": uf,
                  "dias_cad": dias_cad, "dias_inativo": di, "esfriando": esfri,
                  "semanas": sem, "grupo": "recem" if dias_cad <= 30 else "maturando"})

# carteira (tiers) — inclui os de cima + estáveis
tiers = []
for it in radar:
    tiers.append({**it})
for nome, cid, uf in take(8):
    sem = serie(random.uniform(800, 6000), random.uniform(-0.06, 0.06))
    d = delta_de(sem)
    tiers.append({"cod": novo_cod(), "nome": nome, "cidade": cid, "uf": uf,
                  "delta": d, "flag": None, "semanas": sem})
for s in sumidos:
    tiers.append({"cod": s["cod"], "nome": s["nome"], "cidade": s["cidade"], "uf": s["uf"],
                  "delta": -100.0, "flag": "down", "semanas": s["semanas"]})

D = {
    "meta": {"gerado_em": datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M") + " UTC (DEMO)",
             "max_data": hoje.isoformat()},
    "kpis": {"clientes_ativos_l12": len(tiers)},
    "radar": radar,
    "perdidos": {"sumidos": sumidos, "queda": queda},
    "novos": {"recem": [x for x in recem if x["grupo"] == "recem"],
              "maturando": [x for x in recem if x["grupo"] == "maturando"]},
    "tiers": tiers,
}

D2 = crm_from(D)
D2["meta"]["fonte"] = "DEMO (dados fictícios) · Agente CRM — substituído por dados reais no 1º ciclo"
encrypt(D2)
print("crm.enc de DEMONSTRAÇÃO gerado.")
