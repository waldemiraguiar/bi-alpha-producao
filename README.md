# Painel de Produção · Lab Alpha (robô de atualização)

Robô que mantém o **painel de produção da TV** (https://producao-lab-alpha.netlify.app) atualizado a cada ~10 min.

Roda no **GitHub Actions** (grátis): consulta o sistema operacional (MySQL), monta os números de **produção (somente volume — zero R$)**, cifra com AES-256-GCM e publica no Netlify.

## Como funciona
- `.github/workflows/atualiza.yml` — agenda a cada 10 min (e botão manual "Run workflow").
- `build_and_encrypt.py` — consulta enxuta ao MySQL (janela de ~13 meses + 1 agregado histórico), gera o dataset e o cifra em `site_prod/data/producao.enc`.
- `site_prod/` — o site estático da TV (index.html + app.js). Os dados só existem cifrados.

## Segredos (Settings → Secrets and variables → Actions)
`MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PWD`, `MYSQL_DB`, `PROD_PWD` (senha da equipe p/ cifrar), `NETLIFY_AUTH_TOKEN`, `PROD_SITE_ID`.

Nenhuma credencial fica no código — tudo via Secrets. Os dados nunca são gravados em texto puro no repositório.

## Trocar a senha da equipe
Atualize o secret `PROD_PWD` e rode o workflow (Run workflow). A TV pedirá a nova senha no próximo acesso.
