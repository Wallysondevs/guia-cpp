// Guia C++: ligado a todo programa do editor (guia-rt.o, com -Wl,--wrap).
// Não muda o que o programa faz; só deixa o WebAssembly parecido com o Linux:
// 1. o programa roda na pasta /home/ana (onde ficam as abas da caixa);
// 2. exceção não tratada: com exceções do WebAssembly não há a "busca" antes
//    de desempilhar, então ela escaparia do main sem mensagem. Aqui ela cai em
//    std::terminate(), que mostra "libc++abi: terminating due to uncaught
//    exception of type ...", como no Linux;
// 3. abort() avisa o editor (sinal 6, SIGABRT) antes de parar o programa.
#include <exception>
#include <unistd.h>

extern "C" int __real___main_void(void);
extern "C" [[noreturn]] void __real_abort(void);
extern "C" __attribute__((import_module("guia"), import_name("sinal"))) void guia_sinal(int);

__attribute__((constructor(101))) static void guia_pasta_inicial() { (void)chdir("/home/ana"); }

extern "C" int __wrap___main_void(void) {
    try {
        return __real___main_void();
    } catch (...) {
        std::terminate();
    }
}

extern "C" [[noreturn]] void __wrap_abort(void) {
    guia_sinal(6);
    __builtin_trap();
}
