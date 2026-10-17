# Como escrever uma página do Guia C++

O guia é uma **escola**, estilo W3Schools, para quem **nunca programou**. **Uma aula = um assunto**. O dono do projeto reclamou de outro guia que juntava vários comandos numa página. Nunca mostre código "seco":
- explique cada linha (anatomia);
- mostre a saída real;
- mostre o que acontece quando dá errado (a mensagem real do compilador ou do programa);
- deixe o leitor praticar no editor do guia, que **compila e roda C++ de verdade** no navegador.

## 1. Esqueleto do arquivo
Igual ao do Guia Java ([CONTRIBUINDO do Guia Java](https://github.com/Wallysondevs/guia-java/blob/main/CONTRIBUINDO.md), seção 1; modelo pronto: `/home/wallyson/guia-php/variaveis.html`), com:
- `<title>C++ TEMA — descrição | Guia C++</title>`;
- `<h1>C++ <span class="hl">TEMA</span></h1>`.

Menu, selo e Anterior/Próximo vêm de `assets/site.js` (`NIVEIS`). **Não mude a `NIVEIS`**. Links internos só para páginas que estão nela.

## 2. Ordem de uma aula
1. Intro.
2. "Você vai aprender".
3. A ideia antes do código (comparação do dia a dia).
4. Do simples ao completo, uma novidade por vez, com `dl.anatomy` ou tabela "linha → o que faz".
5. **Saída real** depois de cada exemplo.
6. **Pelo menos dois "Experimente"** (`.trycpp`) por aula: um no meio e uma missão no fim.
7. Formas diferentes + "qual usar".
8. **Quando dá errado** (`div.cenario`): código, mensagem real do compilador ou do programa, o que significa, como consertar.
9. Referência (`table.ref`).
10. Exercícios (3 ou mais: `.exercise`, `.mc`).
11. Resumo.

## 3. Componentes

### Código C++ para ler
```html
<pre class="file" data-file="ola.cpp">#include &lt;iostream&gt;

int main() {
    std::cout &lt;&lt; "Olá, mundo!\n";
}
</pre>
```
Dentro de `<pre>`, escape `&lt; &gt; &amp;`. Isso vale **sempre** em C++: `#include &lt;iostream&gt;`, `std::cout &lt;&lt;`, `std::vector&lt;int&gt;`, `&amp;` de referência.

### Terminal (`pre.term`)
Igual aos outros guias:
- `$ ` = `ana@notebook:~$`;
- `> ` = continuação;
- `«` = anotação.

Use-o para `g++`, `./programa`, `make`, `cmake`, `gdb`.

### Editor "Experimente" (`.trycpp`), com compilador real
```html
<div class="trycpp" data-goal="out:Olá, Ana!">
<p class="try-task"><strong>Missão:</strong> troque "mundo" por "Ana" e clique em Rodar.</p>
<pre class="script">#include &lt;iostream&gt;

int main() {
    std::cout &lt;&lt; "Olá, mundo!\n";
}
</pre>
<pre class="solucao">#include &lt;iostream&gt;

int main() {
    std::cout &lt;&lt; "Olá, Ana!\n";
}
</pre>
</div>
```
- **Rodar** compila o código com um **compilador C++ real** (Clang compilado para WebAssembly, carregado na primeira vez que o leitor clica em Rodar), com `-std=c++23 -Wall -Wextra`, e roda o programa.
  - A caixa mostra os erros e avisos de compilação, a saída do programa e o código de saída.
  - O compilador do editor é o **Clang**; os `pre.term` mostram o **g++**. As mensagens dizem a mesma coisa com palavras diferentes. O editor tem uma nota sobre isso, e a aula `simulador.html` explica.
- **Vários arquivos** (para `.h`/`.cpp`, arquivos de dados `.txt`/`.csv`): vários `<pre class="script" data-file="…">` na mesma caixa, que viram abas.
  - Todos os `.cpp` são compilados juntos.
  - Os outros arquivos ficam na pasta em que o programa roda.
- `data-stdin="…"`: entrada para `std::cin`/`getline`. Sem `data-stdin`, o programa pode **pedir a entrada e o leitor digita** no terminal da caixa (se o simulador suportar; veja a seção 4).
- `data-args="…"`: o que chega em `argv`.
- `data-flags="…"`: troca as opções de compilação, por exemplo `-std=c++17` ou `-O2`.
- Sem `data-goal`: caixa livre.
- Com `data-goal`: missão, e o `pre.solucao` é **obrigatório**. Com várias abas, use um `pre.solucao data-file="…"` para cada arquivo que muda.

### Metas (`data-goal`, separadas por vírgula; `\,` = vírgula literal)
| Meta | Verdade quando… |
| --- | --- |
| `out:TEXTO` / `outre:REGEX` | a saída do programa (stdout e stderr, como no terminal) contém / casa |
| `compila` | compilou sem erros |
| `erro:TEXTO` | a compilação **falhou** e a mensagem contém o texto (missões "provoque o erro"). Use um trecho que exista no Clang **e** no g++, como `'x' was not declared` × `use of undeclared identifier 'x'`. Se as mensagens diferirem, use uma regex com as duas formas: `erro:/undeclared identifier\|was not declared/` |
| `aviso:TEXTO` | a compilação deu um aviso contendo o texto, por exemplo `aviso:unused variable` |
| `semaviso` | compilou sem nenhum aviso |
| `exit:N` | o programa terminou com o código N |
| `src:REGEX` | o código do leitor casa com a regex (para exigir um recurso, como `src:for\s*\(`) |

### Outros blocos
`dl.anatomy`, `div.note/.tip/.warning/.cenario`, `ol.passo`, `div.table-wrap > table.ref`, `.exercise`, `.mc`, `figure`.

No `.exercise`, `data-answer="a|b"` aceita respostas alternativas. Para uma barra vertical dentro da resposta (`||`, `|=`), escreva `\|`.

## 4. O "simulador": C++ real no navegador (`assets/cppsim.js`), sendo montado em paralelo
Não é uma imitação: é o **Clang/LLVM oficial compilado para WebAssembly** (pacote `@yowasp/clang`, licença ISC), hospedado no próprio site e carregado só quando o leitor roda algo. Ele gera um programa WebAssembly (WASI), que roda no navegador.

**O que funciona e o que não funciona: esta seção será completada pelo agente do simulador.** Até lá:
- não conte com threads, rede, `system()` ou sinais no editor (devem ficar só em `pre.term`);
- confira exceções e entrada interativa quando ele documentar.

Para testar as suas missões (quando o testador existir): `node tools/testar-missoes.js suas-paginas.html`. Ele compila e roda o código inicial e a solução com o mesmo Clang (WebAssembly, no Node) e confere as metas.

## 5. Fidelidade: o laboratório (`~/guia-cpp-lab/lab`)
É a máquina da Ana do Guia Bash: usuária `ana`, computador `notebook`, `/home/ana`, pt_BR. Ela usa as ferramentas do Ubuntu 26.04:
- **g++ 15.2**;
- **clang++ 21.1**;
- **make 4.4**;
- **cmake 4.2**;
- **gdb 17.1**;
- **ninja**.
```bash
L=~/guia-cpp-lab/lab
printf '%s\n' 'mkdir -p cpp && cd cpp' "cat > ola.cpp <<'FIM'" '#include <iostream>' 'int main() { std::cout << "Olá, mundo!\n"; }' 'FIM' 'g++ -std=c++23 -Wall -Wextra ola.cpp -o ola' './ola' | $L -n SEUNOME -i
```
- Opções do `lab`:
  - `-n SEUNOME`: pasta própria;
  - `-r`: recomeça do zero;
  - `-t`: terminal de verdade, para o `gdb` interativo;
  - `-N`: rede e processos isolados, sem internet.
- **Comando padrão das aulas: `g++ -std=c++23 -Wall -Wextra arquivo.cpp -o programa`.**
  - `primeiro-programa.html` usa o mínimo (`g++ ola.cpp -o ola`).
  - `compilar.html` explica cada opção.
  - Daí em diante, use sempre o comando padrão.
  - O g++ 15 usa **C++17 se você não pedir outro padrão** (`__cplusplus` = `201703L`). Por isso o `-std=c++23` é obrigatório para `std::print`, `std::format` e ranges.
- **O ligador (`ld`) e o `make` saem em português** no laboratório (`referência não definida para "main"`, `múltiplas definições de`, `faltando o separador`), porque o Ubuntu traz a tradução do binutils e do make. Mostre a saída real e cite o inglês (`LANG=C`: `undefined reference to`), que é o que aparece em fóruns e no editor do guia.
- **As mensagens do g++ saem em inglês** no laboratório, mesmo com o sistema em português. É o que o leitor vê no Ubuntu sem o pacote de tradução. Elas usam aspas tipográficas ‘assim’: copie como saíram.
  - Explique cada mensagem em português.
  - A aula `erros-compilacao.html` ensina a ler a estrutura `arquivo:linha:coluna: error: …`.
- **Fatos já conferidos:**
  - `int x` sem `;` antes de `return` dá `error: expected initializer before ‘return’`;
  - variável não usada com `-Wall` dá `warning: unused variable ‘x’ [-Wunused-variable]`;
  - `std::println` funciona com `-std=c++23`.
- Um processo por vez, sempre com `timeout 60`. Programas que travam rodam com `timeout 3`.
- **Privacidade:** nada da máquina real. Nas saídas do `gdb` e dos sanitizers, confira se os caminhos são todos `/home/ana/…`.

### Versões
O guia ensina **C++23** (com o g++ 15 e o Clang 21) e cita o **C++26** quando for útil.
- Marque recursos novos com `<span class="versao">C++20</span>` etc. e diga a alternativa antiga quando houver.
- Datas: C++98, C++03, C++11 (a grande virada: `auto`, lambdas, `nullptr`, smart pointers, move), C++14, C++17 (`optional`, `variant`, `string_view`, structured bindings), C++20 (concepts, ranges, `std::format`, módulos, `<=>`), C++23 (`std::print`, `std::expected`, `import std`) e C++26.
- **Confira no laboratório se cada recurso compila no g++ 15** antes de afirmar.

## 6. Escrita
- Português do Brasil, frases curtas, "você". O leitor nunca programou.
- Nomes em inglês ganham tradução: `cout` = "character output", saída de caracteres; `vector` = vetor, uma lista que cresce.
- Exemplos com a vida da Ana: lista de compras, notas de alunos, uma lojinha, um jogo.
- Toda mensagem de erro é a real.
- Segurança e boas práticas desde o começo, sempre com o porquê:
  - use `std::string`, `std::vector` e smart pointers, não arrays crus e `new`/`delete`;
  - inicialize as variáveis;
  - compile com `-Wall -Wextra`.
