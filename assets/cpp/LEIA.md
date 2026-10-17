# assets/cpp — o compilador C++ do "Experimente"

Gerado por `tools/construir-cpp.mjs`. Não edite à mão.

| Arquivo | O que é |
| --- | --- |
| `cpp-worker.js` | Web Worker: núcleo do `@yowasp/clang` (runtime WASI do YoWASP + cola do jco, com 2 remendos de `tools/cpp-src/remendo.mjs`) + `tools/cpp-src/motor.mjs` (driver do clang++, executor WASI dos programas, entrada linha a linha) + `tools/cpp-src/worker.mjs` |
| `llvm.core.wasm.gz` | Clang/LLD 22.1 (`clang version 22.1.0 (https://codeberg.org/YoWASP/llvm-project 9560ae0f2cc4…)`) em WebAssembly, do pacote npm `@yowasp/clang@22.0.0-git20542-10`, gzip -9 |
| `sysroot.tar.gz` | `/usr` do compilador: cabeçalhos da libc++ 22 (sem `__cxx03`), da wasi-libc e os genéricos do Clang; `libc.a` etc. da wasi-libc do pacote; **libc++/libc++abi/libunwind recompiladas com `-fwasm-exceptions`**; `guia-rt.o` e `libguia.a` (fontes em `tools/cpp-src/`) |
| `pch/iostream.pch.gz`, `pch/print.pch.gz` | cabeçalhos pré-compilados (`-std=c++23 -Wall -Wextra` + as opções internas). Só aceleram: o editor só usa um PCH quando o arquivo começa incluindo aquele cabeçalho |
| `manifesto.json` | tamanhos, hashes e a "assinatura" das opções de cada PCH |
| `LICENSE-*.txt` | LLVM (Apache-2.0 WITH LLVM-exception: Clang, LLD, libc++), wasi-libc (MIT/Apache-2.0) + musl (MIT), YoWASP (ISC) |

## Como o código vira programa
1. O worker pergunta ao driver (`clang++ -### …`) quais comandos rodar.
2. Roda o `cc1` de cada `.cpp`. Se o arquivo começa com `#include <iostream>` (ou `<print>`) e as opções são as mesmas do PCH, acrescenta `-include-pch`.
3. Roda o `wasm-ld` com os extras do guia:
   - `guia-rt.o` e `--wrap=__main_void,abort`: a pasta `/home/ana`, a mensagem da exceção não tratada e o sinal do `abort`;
   - `-lunwind`;
   - pilha de 8 MB (`--stack-first`);
   - no máximo 256 MB de memória.
4. Opções internas, que o leitor não vê:
   - `-fwasm-exceptions`;
   - `-fsanitize=null -fsanitize-trap=null`: um ponteiro nulo vira "Falha de segmentação";
   - `-D_WASI_EMULATED_SIGNAL/PROCESS_CLOCKS/GETPID`;
   - cores ANSI nos diagnósticos.
5. O programa (WASI preview1) roda em `motor.mjs/rodarPrograma`:
   - sistema de arquivos em memória;
   - stdout como terminal (com buffer de linha);
   - entrada linha a linha, que pausa com JSPI (`WebAssembly.Suspending`) ou, sem JSPI, roda o programa de novo com as linhas já digitadas;
   - traps viram sinais (134, 136, 139).

Remendo na libc++ (`__format/format_functions.h`): `std::vformat` chama `std::__guia_vformat`, que já vem compilada na `libguia.a` (`tools/cpp-src/guia-format.cpp`). O resultado é o mesmo; um programa com `std::println` compila em cerca de 1 s em vez de cerca de 10 s.

## Regenerar
```bash
cd tools && npm install            # @yowasp/clang 22.0.0-git20542-10 + esbuild (versões em package.json)
node construir-cpp.mjs             # usa tools/.libcxx-eh/ ou tira as libs do sysroot.tar.gz atual
node construir-cpp.mjs --libcxx    # recompila a libc++ com exceções
```
O `--libcxx` precisa de `git`, `cmake`, `ninja`, `clang-21` e `llvm-ar-21`. Ele baixa só `libcxx/libcxxabi/libunwind/runtimes/libc` do llvm-project no commit `9560ae0f2cc4` (git sparse, em `tools/.llvm-src`) e confere se o `__config_site` gerado é idêntico ao do pacote.

Depois de regenerar, rode `node tools/testar-missoes.js` em todas as páginas.
