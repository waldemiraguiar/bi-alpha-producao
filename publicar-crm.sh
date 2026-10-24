#!/bin/zsh
# 🚀 Publicar o CRM (Matriz + Cabo Frio) com PORTÃO RÍGIDO "um dono por vez" (Wal 23/10/2026).
# O deploy do CRM é por GitHub Actions (atualiza_crm.yml + cabofrio_crm.yml) — este wrapper é o
# chokepoint local que: (0) pega a trava do dono e ABORTA se o outro lado estiver editando;
# (1) trava de sintaxe local (node --check app.js + functions) pra não empurrar quebrado;
# (2) commit+push (os workflows buildam do HEAD pushado); (3) dispara as DUAS frotas;
# (4) PROVA no ar que o version.json das DUAS mudou. Não solta a trava no fim (quem pegou solta;
# TTL de 45min é a rede de segurança). DONO=sessao (padrão) ou DONO=auto (autônomo).
# Uso: ./publicar-crm.sh "vDD/MM · o que mudou"
set -e
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
cd "$HOME/Claude BI Alpha/cloud_repo"
MSG="$1"
[ -z "$MSG" ] && { echo '❌ uso: ./publicar-crm.sh "vDD/MM · descrição"'; exit 1; }

# 0) PORTÃO RÍGIDO — trava "um dono por vez" (a dono.sh vive em site_crm/)
DONO="${DONO:-sessao}"
if ! ./site_crm/dono.sh acquire "$DONO"; then
  echo "❌ ABORTADO: o CRM está com outro dono — não publico pra não atropelar o trabalho do outro lado."
  exit 1
fi

# 1) TRAVA DE SINTAXE local (pega o erro ANTES de empurrar; smart-quotes em código quebram o esbuild)
echo "   🛡️ checando sintaxe (app.js + functions)..."
node --check site_crm/app.js || { echo "❌ ABORTADO: erro de sintaxe no site_crm/app.js (veja smart-quotes: grep -nP '[\x{201c}\x{201d}\x{2018}\x{2019}]' site_crm/app.js)"; exit 1; }
for f in site_crm/functions/*.mjs; do
  node --check "$f" || { echo "❌ ABORTADO: erro de sintaxe em $f"; exit 1; }
done
if grep -nP '[\x{201c}\x{201d}\x{2018}\x{2019}]' site_crm/app.js >/dev/null 2>&1; then
  echo "   ⚠️ aviso: há aspas inteligentes em app.js — OK se forem de TEXTO, QUEBRAM se forem em código. Confira."
fi
echo "   ✅ sintaxe ok"

# 2) estado ANTES (pra provar que mudou) + commit/push
B_MZ=$(curl -s --max-time 12 "https://agente-crm-matriz.netlify.app/version.json?_=$RANDOM" || true)
B_CF=$(curl -s --max-time 12 "https://agente-crm-cabofrio.netlify.app/version.json?_=$RANDOM" || true)
echo "   versões antes: MZ=$B_MZ · CF=$B_CF"
git add site_crm            # ⛔ SÓ o CRM — nunca varrer site_prod/outros apps pro commit do CRM
if ! git diff --cached --quiet; then
  git commit -qm "$MSG" && echo "   commitado (site_crm): $MSG"
  git push -q origin HEAD && echo "   push ok"
else
  echo "   (nada novo no site_crm — republico o HEAD atual)"
fi

# 3) dispara as DUAS frotas (publicar nas 2 — senão o CF fica pra trás)
echo "   🚀 disparando Matriz (atualiza_crm.yml -f deploy=1)..."
gh workflow run atualiza_crm.yml -f deploy=1 >/dev/null && echo "      ok"
echo "   🚀 disparando Cabo Frio (cabofrio_crm.yml)..."
gh workflow run cabofrio_crm.yml >/dev/null && echo "      ok"

# 4) PROVA no ar: espera o version.json das DUAS MUDAR (Actions levam alguns min)
echo "   ⏳ provando no ar (as Actions levam ~2-5min)..."
okmz=0; okcf=0
for i in $(seq 1 48); do   # até ~8min
  sleep 10
  NMZ=$(curl -s --max-time 12 "https://agente-crm-matriz.netlify.app/version.json?_=$RANDOM" || true)
  NCF=$(curl -s --max-time 12 "https://agente-crm-cabofrio.netlify.app/version.json?_=$RANDOM" || true)
  [ "$okmz" = 0 ] && [ -n "$NMZ" ] && [ "$NMZ" != "$B_MZ" ] && { okmz=1; echo "      ✅ Matriz no ar: $NMZ"; }
  [ "$okcf" = 0 ] && [ -n "$NCF" ] && [ "$NCF" != "$B_CF" ] && { okcf=1; echo "      ✅ Cabo Frio no ar: $NCF"; }
  [ "$okmz" = 1 ] && [ "$okcf" = 1 ] && break
done
if [ "$okmz" = 1 ] && [ "$okcf" = 1 ]; then
  echo "✅ NO AR nas DUAS frotas (Matriz + Cabo Frio) — $MSG"
  echo "   (trava segue com '$DONO'; solte com: ./site_crm/dono.sh release $DONO)"
  exit 0
else
  echo "⚠️ NÃO confirmei as duas no ar (MZ=$okmz CF=$okcf). Veja as Actions: gh run list --limit 4"
  echo "   ⚠️ armadilha conhecida: secret.mjs sem export (deploy morre calado) — gh run view <id> --log-failed"
  exit 1
fi
