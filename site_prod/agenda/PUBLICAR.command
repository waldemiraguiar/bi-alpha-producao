#!/bin/bash
# Publica a Fila carimbando DATA E HORA na versão que aparece na tela.
cd "$(dirname "$0")/../.."
export CARIMBO=$(date '+%d/%m %H:%M'); export V=$(date '+%s')
# marcador exclusivo /*CARIMBO*/ — nao pega o regex do vigia por engano
perl -pi -e 's{/\*CARIMBO\*/'"'"'[^'"'"']*'"'"'}{/*CARIMBO*/'"'"'$ENV{CARIMBO}'"'"'}' site_prod/agenda/fila.js
perl -pi -e 's{data-versao-publicada="[^"]*"}{data-versao-publicada="$ENV{CARIMBO}"}; s{\?v=[0-9]+}{?v=$ENV{V}}g' site_prod/agenda/index.html
node -e "new Function(require('fs').readFileSync('site_prod/agenda/fila.js','utf8'))" || { echo "❌ o JS quebrou — nao publiquei"; read -p "ENTER"; exit 1; }
git add site_prod/agenda/ && git commit -q -m "Fila: versao $CARIMBO" && git push -q origin main
gh workflow run atualiza.yml -f deploy=1
echo ""; echo "  ✅ publicado — versao $CARIMBO"; echo "  ~2 min para o site trocar. O selo na tela mostra essa data e hora."
sleep 5
