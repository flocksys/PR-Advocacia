# PR Advocacia — sistema de gestão do escritório

Sistema de gestão da Pontes Rodrigues Sociedade de Advogados: processos, atos processuais e intimações, atendimentos, agenda, contatos, contratos, documentos e faturas.

## Como está montado

- `src/app.html` — a interface do sistema (HTML, CSS e JavaScript em um arquivo só).
- `public/shim.js` — liga a interface ao Supabase (login, banco, arquivos, tempo real).
- `public/config.js` — endereço e chave pública do Supabase.
- `public/index.html` — gerado por `python3 tools/build.py` a partir de `src/app.html`. Não edite à mão.
- `supabase/*.sql` — estrutura do banco, regras de acesso e captura diária do DJEN.

Hospedagem: Vercel (publica automaticamente cada envio para a branch `main`). Banco, login e arquivos: Supabase (projeto "PR Advocacia", região São Paulo).

## Atualizar

1. Edite `src/app.html` (ou `public/shim.js`).
2. Rode `python3 tools/build.py`.
3. Faça commit e push. A Vercel publica sozinha.

Dados de clientes nunca vão para este repositório: ficam só no Supabase.
