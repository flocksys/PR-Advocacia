"""Gera public/index.html a partir de src/app.html (a interface do sistema).
Uso: python3 tools/build.py"""
import pathlib, re

raiz = pathlib.Path(__file__).resolve().parent.parent
app = (raiz / 'src' / 'app.html').read_text(encoding='utf-8')

# Textos que só faziam sentido dentro do claude.ai
trocas = [
    ('1) No botão <b>Compartilhar</b> desta página, convide o e-mail do cliente como <b>Visualizador</b>. 2) Pesquise o nome dele abaixo e clique em Vincular.',
     '1) Peça ao cliente para criar o acesso neste site, com o e-mail dele. 2) Pesquise o nome ou e-mail abaixo e clique em Vincular.'),
    ('Ninguém encontrado. Confira se o cliente já foi convidado no compartilhamento.',
     'Ninguém encontrado. Confira se o cliente já criou o acesso neste site.'),
    ("(h.guest?'convidado externo':'membro da organização')", "(h.guest?'cliente':'equipe')"),
    ('A IA fica disponível com o sistema aberto no claude.ai', 'A IA ainda não foi ativada nesta versão'),
    ('A IA só funciona com o sistema aberto no claude.ai e com a permissão de IA liberada.',
     'A IA ainda não foi ativada nesta versão do sistema.'),
    ('A pesquisa de pessoas só funciona com o sistema aberto no claude.ai.', 'Entre no sistema para pesquisar pessoas.'),
]
for a, b in trocas:
    app = app.replace(a, b)

# O título vai para o <head>
m = re.match(r'\s*<title>(.*?)</title>', app)
titulo = m.group(1) if m else 'Pontes Rodrigues'
if m:
    app = app[m.end():]

html = f'''<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{titulo}</title>
<meta name="robots" content="noindex">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>
<script src="/config.js"></script>
<script src="/shim.js"></script>
</head>
<body>
{app}
</body>
</html>
'''
(raiz / 'public' / 'index.html').write_text(html, encoding='utf-8')
print('public/index.html', len(html), 'bytes')
