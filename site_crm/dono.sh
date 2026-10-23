#!/bin/zsh
# 🔒 Trava "UM DONO POR VEZ" do app (Wal 23/10/2026). GENÉRICO: roda na PRÓPRIA pasta, uma cópia
# idêntica serve pra qualquer app. Evita que a sessão INTERATIVA (Claude/Wal) e o AUTÔNOMO
# (claude -p via rodar.sh) editem/deployem o mesmo app ao mesmo tempo (perde trabalho / publica lixo).
# Uso:  ./dono.sh acquire <nome>   # "sessao" = interativa, "auto" = autônomo
#       ./dono.sh release <nome>   # só solta se for sua
#       ./dono.sh status
# Trava mais velha que o TTL = órfã (dono sumiu) e pode ser tomada. Mesmo nome re-pega (refresh).
cd "${0:A:h}" 2>/dev/null || exit 2
LOCK=".dono.lock"
TTL=$((45*60))
acao="$1"; nome="$2"
agora=$(date +%s)

leia() {
  [ -f "$LOCK" ] || return 0
  local n ts
  n=$(sed -n '1p' "$LOCK" 2>/dev/null); ts=$(sed -n '2p' "$LOCK" 2>/dev/null)
  case "$ts" in ''|*[!0-9]*) rm -f "$LOCK"; return 0;; esac
  if [ $((agora - ts)) -ge $TTL ]; then rm -f "$LOCK"; return 0; fi
  echo "$n|$ts"
}

case "$acao" in
  acquire)
    [ -z "$nome" ] && { echo "uso: ./dono.sh acquire <nome>"; exit 2; }
    cur=$(leia); curn="${cur%%|*}"; curt="${cur##*|}"
    if [ -n "$cur" ] && [ "$curn" != "$nome" ]; then
      echo "❌ OCUPADO por '$curn' há $(( (agora - curt) / 60 ))min — NÃO edite/deploye o app agora."
      exit 1
    fi
    printf '%s\n%s\n' "$nome" "$agora" > "$LOCK"
    echo "✅ dono do app agora: $nome"
    ;;
  release)
    [ -z "$nome" ] && { echo "uso: ./dono.sh release <nome>"; exit 2; }
    cur=$(leia); curn="${cur%%|*}"
    if [ -z "$cur" ] || [ "$curn" = "$nome" ]; then rm -f "$LOCK"; echo "✅ trava liberada ($nome)"; else
      echo "⚠️ a trava é de '$curn' — não solto a dos outros"; exit 1
    fi
    ;;
  status)
    cur=$(leia)
    if [ -z "$cur" ]; then echo "🔓 livre"; else echo "🔒 ocupado por '${cur%%|*}' há $(( (agora - ${cur##*|}) / 60 ))min"; fi
    ;;
  *) echo "uso: ./dono.sh {acquire|release|status} <nome>"; exit 2;;
esac
