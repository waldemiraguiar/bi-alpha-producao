# 🎯 Agente CRM — Matriz  (frota "Agentes de IA Alpha")

3º painel da frota Alpha Labs, ao lado de **📺 Produção** e **💰 Financeiro**.
Foco: **movimentação de clientes para o time comercial — sem nenhum valor R$.**

- **No ar:** https://agente-crm-matriz.netlify.app
- **Senha do time CRM:** `AlphaCRMTV2026` (gate AES próprio, separado de Produção/Financeiro)
- **Netlify Project ID:** `39c8214e-84ae-48dc-bed6-476fadda5205` (secret `CRM_SITE_ID`)

## Como funciona (mesma infra dos outros agentes)
1. `build_crm.py` roda no GitHub Actions (`.github/workflows/atualiza_crm.yml`, **a cada 6h**).
2. Reusa `build_financeiro.build()` (a MESMA consulta ao MySQL operacional) e chama `crm_from(D)`:
   - retira **todos** os valores R$ / tier / faturamento;
   - **normaliza os sparklines** (0..100 = só a forma da tendência, nunca o montante);
   - monta as listas: `reativar` (fila priorizada), `em_queda`, `parados`, `queda_forte`,
     `novos_esfriando`, `novos`, `em_alta`, `carteira`.
3. Cifra com `CRM_PWD` (AES-256-GCM) → `site_crm/data/crm.enc`.
4. Publica `site_crm/` no Netlify (`CRM_SITE_ID`).

## Lógica de movimentação (herdada do radar financeiro)
- **Variação:** última semana ISO vs **média das 4 anteriores** (±10% = alta/queda).
- **Parado:** relevante (filtro interno ≥R$300/mês, não exposto) e ≥35d sem enviar.
- **Queda forte:** ≤ -40%.
- **Novo esfriando:** 1ª atividade ≤90d e parou ≥14d.
- **Fila Reativar:** união dedupada por cliente, prioridade `parado > queda_forte > queda > novo_esfriando`,
  desempate por recência e magnitude. Cada linha traz uma **ação sugerida**.

## Interface (skin BI Alpha)
- Abas com **rotação automática 15s** (modo TV p/ sala comercial); clique **fixa**.
- Hero **RADAR DE REATIVAÇÃO** pulsante (laranja↔vermelho) + anel "% em risco".
- Worklist acionável: cliente · cidade · dias sem enviar · **sparkline** · ▲▼% · ação.
- **Lupa** na aba Carteira (busca por cliente/cidade).

## Arquivos
- `build_crm.py` — robô (transform `crm_from` + `encrypt`). **Sem R$ na saída.**
- `seed_demo_crm.py` — gera `crm.enc` de DEMONSTRAÇÃO (sem MySQL) p/ subida imediata.
- `site_crm/` — `index.html` + `app.js` + `skin.css` + `gate-crypto.js` + `logo*.png` + `data/crm.enc`.
- `.github/workflows/atualiza_crm.yml` — agenda 6h + Run manual.

## Trocar a senha do time CRM
Atualize o secret `CRM_PWD` e rode o workflow (Run workflow). O painel pedirá a nova senha.

## Preview local
`python3 -m http.server 4557 --directory site_crm` → abrir e usar a senha do gate.
(Para regenerar o demo: `CRM_PWD='AlphaCRMTV2026' python3 seed_demo_crm.py`.)
