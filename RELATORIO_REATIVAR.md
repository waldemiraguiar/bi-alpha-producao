# Relatório — O que faz sentido na fila REATIVAR (foco de energia da equipe)

> Objetivo: a equipe não desperdiçar energia tratando igual coisas muito diferentes.
> Base: régua da skin do CRM (`build_crm.py`) + dados reais.

## 1. Como está hoje (a régua)
A fila "Reativar" junta **4 grupos** numa lista única (dedupe por cliente, prioridade
parado > queda forte > queda > novo esfriando):

| Grupo | Critério (régua) | Hoje | Ação sugerida |
|---|---|---|---|
| ⛔ Parados | **≥21 dias sem enviar nada** | 34 | "Ligar — sem enviar há Xd" |
| 🔻 Queda forte | caiu **≥40%** vs normal (ainda envia) | 39 | "Contato urgente — caiu X%" |
| ▼ Em queda | caiu **≥10%** vs normal (ainda envia) | 23 | "Acompanhar — caiu X%" |
| 🌱 Novos esfriando | cliente **novo (≤90d)** que parou após começar | 77 | "Engajar novo — parou há Xd" |

Encerrados (22) e Inativos já estão fora de tudo. % em risco já está sem parados.

## 2. Diagnóstico — esforço × retorno (ROI)
| Grupo | Janela | Recuperabilidade | Esforço | Veredito |
|---|---|---|---|---|
| 🔻 Queda forte | **aberta** (ainda compra) | **alta** | médio | 🟢 **Prioridade máxima** — maior ROI |
| ▼ Em queda | aberta, cedo | alta | **baixo** | 🟢 Preventivo barato — pega antes de piorar |
| 🌱 Novos esfriando | aberta (recém-entrou) | alta por unidade | médio | 🟡 **Outra motion**: é *onboarding/nutrição*, não "resgate". E é o maior volume (77). |
| ⛔ Parados | **fechando/fechada** (≥21d quieto) | **menor** | **alto** | 🔴 Dreno de energia — muitos já decidiram sair |

**O problema central:** os 4 no mesmo balde fazem a equipe tratar igual o *urgente-recuperável*
(queda forte), o *preventivo barato* (em queda), o *onboarding* (novos) e o *resgate difícil*
(parados). Aí gasta-se energia ligando parado de 60 dias enquanto um "queda forte" — que ainda
compra e dá pra salvar hoje — espera.

## 3. Opções de reorganização

### Opção A — Separar por "motion" (recomendada)
- **🎯 Reativar (foco DIÁRIO)** = Queda forte + Em queda → clientes **ativos caindo**, janela aberta. É o número que a equipe persegue todo dia.
- **🌱 Novos / Onboarding** = Novos esfriando → aba própria, abordagem de boas-vindas/nutrição (não "resgate").
- **🆘 Resgate** = Parados → aba própria, **campanha em lote** (mensal/quinzenal), não no balde diário.
- Ganho: o "em risco do dia" fica enxuto e 100% acionável; nada se perde (cada grupo tem seu fluxo).

### Opção B — Manter junto, ordenar por ROI
- Um "score de recuperação" (recência + intensidade da queda) ordena a fila; parados antigos caem pro fim. Menos mudança, mas a equipe ainda vê tudo junto.

### Opção C — Só tirar Parados do balde diário (mínima)
- Parados saem do somatório/worklist diário → aba "Parados / Resgate" própria. Queda forte + Em queda + Novos esfriando seguem na fila. (Extensão natural do que já fizemos com o %.)

## 4. Recomendação
**Opção A** (ou C como 1º passo). Motivo: concentra a energia diária onde o retorno é maior
(queda forte + em queda), trata Parados como resgate de lote (sem drenar o dia a dia) e dá aos
77 Novos esfriando o tratamento certo (onboarding, não resgate).

## 5. Próximo passo
Escolher A, B ou C → eu implemento (abas, somatório, legenda e o briefing 7h seguem a mesma régua).
