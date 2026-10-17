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
| `erro:TEXTO` | a compilação **falhou** e a mensagem contém o texto (missões "provoque o erro"). Use um trecho que exista no Clang **e** no g++, como `'x' was not declared` × `use of undeclared identifier 'x'`. Se as mensagens diferirem, use uma regex com as duas formas (veja a nota abaixo da tabela) |
| `aviso:TEXTO` | a compilação deu um aviso contendo o texto, por exemplo `aviso:unused variable` |
| `semaviso` | compilou sem nenhum aviso |
| `exit:N` | o programa terminou com o código N |
| `src:REGEX` | o código do leitor casa com a regex (para exigir um recurso, como `src:for\s*\(`) |

**Regex nas metas** (`outre:`, `src:`, `erro:/…/`): é a regex normal do JavaScript — `|` é alternativa e `\|` é uma barra vertical literal. Exemplo: `erro:/undeclared identifier|was not declared/` (escrito aqui fora da tabela porque, dentro de tabela Markdown, a barra aparece escapada). Lembre que `,` separa metas: dentro de uma meta, vírgula literal é `\,`.

### Outros blocos
`dl.anatomy`, `div.note/.tip/.warning/.cenario`, `ol.passo`, `div.table-wrap > table.ref`, `.exercise`, `.mc`, `figure`.

No `.exercise`, `data-answer="a|b"` aceita respostas alternativas. Para uma barra vertical dentro da resposta (`||`, `|=`), escreva `\|`.

## 4. O "simulador": C++ real no navegador (`assets/cppsim.js`)
Não é uma imitação: é o **Clang 22.1 oficial (LLVM) compilado para WebAssembly** (pacote `@yowasp/clang`, licença ISC), com a **libc++ 22** (a biblioteca padrão do LLVM) recompilada **com exceções**. Tudo fica hospedado no próprio site (`assets/cpp/`). O compilador só é baixado quando o leitor clica em **Rodar**. Ele gera um programa WebAssembly (WASI) e roda esse programa no navegador, num Web Worker. Detalhes técnicos e como regenerar: `assets/cpp/LEIA.md`.

### O que o leitor vê
- O terminal da caixa mostra o comando real e depois a execução:
  - `$ clang++ -std=c++23 -Wall -Wextra programa.cpp -o programa` (ou as opções do `data-flags`);
  - os erros e avisos do Clang, com as cores do terminal;
  - `$ ./programa` (mais os argumentos);
  - a saída, a mensagem do "sinal" quando o programa morre (`Abortado (imagem do núcleo gravada)`, `Falha de segmentação (imagem do núcleo gravada)`, `Exceção de ponto flutuante (imagem do núcleo gravada)`) e `[código de saída: N]`.
- O executável recebe o nome do primeiro `.cpp` sem a extensão: `ola.cpp` vira `./ola`. Sem `data-file`, o arquivo é `programa.cpp`.
- **`data-flags` substitui todas as opções.** Escreva a linha inteira: `data-flags="-std=c++17 -Wall -Wextra"`.
- Debaixo de cada caixa há uma nota curta: "o editor compila com o Clang (e a libc++); os terminais das aulas mostram o g++", com link para `simulador.html`.

### Download e tempo
- **Primeira vez:** cerca de 33 MB (o compilador tem 22,8 MB, as bibliotecas e cabeçalhos 2,2 MB e o `<iostream>` pré-compilado 7,6 MB). Se a página usar `<print>` sem `<iostream>`, baixa mais 5,8 MB.
- O navegador guarda tudo (Cache API). Nas próximas visitas não há download.
- **Tempo de compilação** (Chrome 155, nesta máquina):
  - a primeira compilação leva o download e mais 1 a 2 s;
  - depois, de 0,3 a 1 s por programa que começa com `#include <iostream>` ou `#include <print>`, porque esses cabeçalhos já vêm pré-compilados;
  - um arquivo sem esses cabeçalhos no começo, ou com outro `-std` no `data-flags`, leva de 2 a 5 s.
- O cabeçalho pré-compilado não muda nada no resultado. Ele só é usado quando o arquivo **começa** incluindo aquele cabeçalho, então tirar o `#include <iostream>` continua dando o erro de verdade.

### O que funciona
- C++23 inteiro: `std::print`/`println`, `std::format`, ranges, `std::expected`, concepts, lambdas, smart pointers e todos os contêineres.
  - `__cplusplus` vale `202302` com `-std=c++23`.
  - `-std=c++17` e `-std=c++20` funcionam pelo `data-flags`.
- **Exceções:** `try`/`catch`/`throw` funcionam, e a biblioteca lança de verdade (`std::stoi("abc")` lança `std::invalid_argument`; `v.at(10)` lança `std::out_of_range`; `new` grande demais lança `std::bad_alloc`).
  - Uma exceção que ninguém trata mostra `libc++abi: terminating due to uncaught exception of type std::invalid_argument: stoi: no conversion`, depois `Abortado (imagem do núcleo gravada)`, com código 134.
- **Entrada:** `std::cin`, `std::getline` e `scanf`.
  - Com `data-stdin`, cada linha aparece no terminal **no ponto em que o programa a lê**, como se o leitor tivesse digitado ali. Para várias linhas, use `\n`: `data-stdin="Ana\n29"`. Tudo numa linha só (`"10 25 7 0"`) aparece uma vez, como num terminal de verdade.
  - **Sem `data-stdin`, o programa pausa e o leitor digita** no próprio terminal da caixa: Enter envia, Ctrl+D encerra a entrada e Ctrl+C para o programa. Isso funciona em qualquer navegador. Nos navegadores sem JSPI, o editor roda o programa de novo desde o começo com as linhas já digitadas e esconde a saída repetida; nesse modo, um programa com números aleatórios pode mudar.
- **Arquivos:** as abas que não são `.cpp` (`.h`, `.txt`, `.csv`) ficam na pasta do programa, `/home/ana`.
  - `std::ifstream`, `std::ofstream` e `std::filesystem` funcionam numa pasta em memória, que começa limpa a cada Rodar.
  - `current_path()` dá `"/home/ana"` e `getenv("HOME")` dá `/home/ana`.
- `argc`/`argv` (`data-args`), `return N` e `exit(N)` (o código vai de 0 a 255, como no Linux).
- `std::random_device`, `<chrono>`, `std::this_thread::sleep_for`, `clock()`, `std::signal`/`std::raise` (só sinais que o próprio programa levanta) e `getpid()`.
- **Erros de execução, como no Linux:**
  - ponteiro nulo (`*p` com `p == nullptr`) dá `Falha de segmentação`, código 139;
  - divisão inteira por zero dá `Exceção de ponto flutuante`, código 136;
  - recursão infinita estoura a pilha (8 MB) e dá `Falha de segmentação`;
  - `abort()` e `assert` falho dão `Abortado`, código 134.

### O que não funciona (deixe só no `pre.term`)
- **Threads:** `std::thread` compila, mas lança `std::system_error` ("thread constructor failed: Not supported"). `std::mutex` e `std::atomic` compilam e funcionam com uma thread só.
- **Rede** (sockets) e **`system()`**. Este último compila, mas imprime `sh: 1: COMANDO: not found` (não há shell).
- **Sinais de fora**, como o Ctrl+C mandado para um `signal(SIGINT, …)`: o Ctrl+C do editor só para o programa. Um `raise(SIGTERM)` sem tratador termina como `Abortado`, e não como `Terminado`.
- **Fuso horário:** `localtime` dá UTC, enquanto o laboratório usa `America/Sao_Paulo`.
- **`import std;`** (módulos do C++23) não funciona: dá `fatal error: module 'std' not found`. Use `#include`.
- **Sanitizers e `gdb`.**
- **Limites:**
  - 15 s rodando, sem contar o tempo esperando o leitor digitar; depois disso o editor para o programa (laço infinito);
  - 2 MB de saída;
  - 256 MB de memória (depois disso, `std::bad_alloc`);
  - 8 MB de pilha.

### O que muda entre o editor (Clang + libc++, WebAssembly de 32 bits) e o g++ (libstdc++, Linux de 64 bits)
Tudo abaixo foi conferido com `tools/sim.js` e `--nativo`. **Nas metas, use o que é igual nos dois**, ou uma regex com as duas formas.

| Assunto | Editor (Clang 22 + libc++) | g++ 15 do laboratório (libstdc++) |
| --- | --- | --- |
| Exceção não tratada | `libc++abi: terminating due to uncaught exception of type std::out_of_range: vector` + `Abortado (imagem do núcleo gravada)` | `terminate called after throwing an instance of 'std::out_of_range'` / `  what():  vector::_M_range_check: __n (which is 0) >= this->size() (which is 0)` |
| Destrutores com exceção não tratada | rodam (a pilha é desfeita antes do `terminate`) | não rodam |
| `what()` de `std::stoi("abc")` / número grande | `stoi: no conversion` / `stoi: out of range` | `stoi` / `stoi` |
| `what()` de `vector::at`, `string::at`, `substr` | `vector`, `basic_string`, `basic_string` | `vector::_M_range_check: __n (which is 10) >= this->size() (which is 3)`, `basic_string::at: __n (which is 5) >= this->size() (which is 2)`, `basic_string::substr: __pos (which is 9) > this->size() (which is 2)` |
| Números sorteados com semente fixa | `std::mt19937(42)()` = `1608637542` (**igual**), mas `uniform_int_distribution(1, 6)` dá `4 5 3 5 5` | mesmo `mt19937`, mas a distribuição dá `5 6 2 5 5` |
| `sizeof` | `long` 4, ponteiro 4, `size_t` 4, `long double` 16; `LONG_MAX` = 2147483647 | `long` 8, ponteiro 8, `size_t` 8, `long double` 16; `LONG_MAX` = 9223372036854775807 |
| `typeid(std::string).name()` | `NSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEEE` | `NSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEE` (`int` = `i`, `double` = `d` nos dois) |
| `assert` falho | `Assertion failed: x > 0 (programa.cpp: main: 11)` | `programa: programa.cpp:11: int main(): Assertion `x > 0' failed.` |
| Mensagens do compilador | `error: use of undeclared identifier 'x'`, aspas retas `'x'` | `error: 'x' was not declared in this scope`, aspas curvas `‘x’` |
| Avisos e erros | o Clang tem os dele: `0 <= nota <= 10` é **erro** (`chained comparison 'X <= Y <= Z' does not behave the same as a mathematical expression`); `x =+ 5` avisa | o g++ tem outros (mesma recursão infinita: `warning: infinite recursion detected` × `all paths through this function will call itself`) |
| Memória | 256 MB no máximo: `std::vector<char> v(600 * 1024 * 1024)` lança `std::bad_alloc` | aloca normalmente |
| Fuso horário | UTC | `-03` (America/Sao_Paulo) |
| `std::thread` | lança `system_error` | funciona |

Iguais nos dois: `std::format` e `std::print` (inclusive a formatação de `double`), `0.1 + 0.2`, `std::mt19937`, `int` com 4 bytes, os códigos de saída (134, 136, 139) e o `__cplusplus`.

### Metas: regras exatas
- `out:` e `outre:` olham **só a saída do programa** (stdout e stderr, na ordem). Nunca olham as mensagens do compilador. Se o programa não compilou, elas são falsas.
- `outre:` aplica a regex do JavaScript **à saída inteira, sem flags**: `^` e `$` são o começo e o fim de toda a saída, e não de cada linha. Escreva `\n` para as quebras de linha, por exemplo `outre:^Olá\nTchau\n$`.
- `erro:` e `aviso:` aceitam texto ou `/regex/`, também com flags (`/…/i`).
  - `erro:` é verdade quando a compilação **falhou** e a mensagem (sem cores) contém o texto ou casa com a regex. O erro de linker também conta.
  - `aviso:` olha cada linha `warning:`.
- `exit:N` é o código do **programa** e é falso se ele não compilou.
- `src:` aplica a regex ao código de todas as abas, com a flag `m`.
- **Escapes no `data-goal`:**
  - `\,` é uma vírgula literal;
  - `\\` é **uma** barra invertida literal (por exemplo, para uma meta que termina em barra invertida);
  - qualquer outro `\x` fica como está, então `\d`, `\n` e `\|` das regex não mudam.
  - Uma vírgula sem escape só separa metas quando vem seguida do nome de uma meta.
- `>` e `&gt;` dentro de `data-goal` são a mesma coisa.

### Ferramentas (Node 24; não precisam de `npm install`)
- `node tools/sim.js arquivo.cpp`: compila e roda como o editor (mesmo Clang, mesma libc++, mesmo terminal). É assim que você confere o comportamento do editor.
  - Opções: `--stdin "Ana\n29"`, `--com outro.cpp`, `--flags "…"`, `-- args` e `--nativo` (mostra também o g++ do laboratório e as diferenças).
- `node tools/testar-missoes.js suas-paginas.html`:
  - o código inicial **não** pode cumprir a meta, e a solução **tem** de cumprir;
  - confere também `&lt;`/`&amp;` dentro dos `<pre>`, as metas e as regex;
  - guarda o resultado em cache;
  - `-v` mostra as saídas.
- `node tools/testar-missoes.js --nativo página.html`: roda também no g++ 15 do laboratório e mostra as diferenças, sem contar como falha.
  - As conhecidas, da tabela acima, saem marcadas como "esperado".
  - Ele avisa quando, no g++, a meta **não** seria cumprida.

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
