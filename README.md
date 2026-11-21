# Guia C++

Site: https://wallysondevs.github.io/guia-cpp/

Curso de C++ moderno (C++23) em português, do zero ao avançado, feito para quem **nunca programou**. Funciona como uma escola: uma aula para cada assunto, organizadas em **3 níveis + projetos + referência** (144 páginas).

Cada aula explica o código linha por linha (anatomia), mostra a saída real, o que acontece quando dá errado (com a mensagem verdadeira do compilador ou do programa), formas diferentes de fazer e exercícios no fim. Todas as saídas e mensagens de erro foram conferidas com o **g++ 15.2**.

Para praticar, as páginas trazem o editor **Experimente** (`.trycpp`), que **compila e roda C++ de verdade** no navegador:

- Edite o código, clique em **Rodar** e veja o comando de compilação, os erros e avisos e a saída do programa, com o código de saída no fim.
- Nas **missões**, a caixa confere se o seu programa chegou ao resultado pedido.

O editor usa `assets/cppsim.js` com o **Clang 22.1 (LLVM) compilado para WebAssembly** e a **libc++ 22**. Não é uma imitação: é o compilador de verdade, hospedado no próprio site (`assets/cpp/`). Ele só é baixado no primeiro clique em **Rodar** (cerca de 33 MB); depois o navegador guarda tudo e as próximas visitas não baixam de novo.

Site 100% estático (HTML + CSS + JS, sem build e sem dependências externas): funciona no GitHub Pages. Para usar o editor no seu computador, sirva a raiz do site com um servidor local em vez de abrir o arquivo direto.

## Estrutura

```
index.html                 página inicial
<tema>.html                uma aula por tema
assets/style.css           visual
assets/site.js             níveis/menu (lista NIVEIS), Anterior/Próximo, anatomia, exercícios
assets/cppsim.js           o editor "Experimente" (caixas .trycpp)
assets/cpp/                o compilador do editor (Clang 22 em WebAssembly + libc++); veja assets/cpp/LEIA.md
assets/cpp/pch/            <iostream> e <print> pré-compilados (compilação mais rápida)
tools/sim.js               compila e roda um .cpp como o editor faria
tools/testar-missoes.js    testa todas as caixas "Experimente" com o mesmo Clang do navegador
tools/cpp-node.js          roda no Node o mesmo compilador do navegador
tools/lab-nativo.js        compara com o g++ 15 nativo do laboratório
tools/construir-cpp.mjs    gera a pasta assets/cpp/
tools/cpp-src/             fontes do motor do editor
tools/demo.html            página de teste com caixas de todos os tipos
tools/licencas/            licenças dos componentes do compilador
tools/package.json         dependências para regenerar o compilador
CONTRIBUINDO.md            como escrever uma aula
```

## Testes

As ferramentas usam Node 24 e não precisam de `npm install`.

```bash
node tools/testar-missoes.js                 # todas as missões, com o mesmo Clang do navegador
node tools/testar-missoes.js pagina.html     # só estas páginas (-v mostra as saídas)
node tools/testar-missoes.js --nativo pagina.html   # compara também com o g++ 15 (precisa do laboratório)
node tools/sim.js programa.cpp               # compila e roda um programa como o editor
bash tools/checar-privacidade.sh             # páginas e histórico; lista extra: PROIBIDO=lista.txt
```

## Publicar no GitHub Pages

Envie a pasta para um repositório e ative **Settings → Pages → Deploy from a branch → main / (root)**.

## Adicionar uma aula

Leia `CONTRIBUINDO.md` e inclua a página na lista `NIVEIS` de `assets/site.js`.
