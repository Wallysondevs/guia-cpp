#!/usr/bin/env node
/* =====================================================================
   Gera assets/cpp/ (o C++ de verdade do "Experimente"):
     cpp-worker.js          worker: núcleo do @yowasp/clang (remendado) + tools/cpp-src/*
     llvm.core.wasm.gz      o Clang/LLD 22 em WebAssembly, gzip -9
     sysroot.tar.gz         cabeçalhos (libc++ 22, wasi-libc, clang) + bibliotecas
                            (libc++/libc++abi/libunwind COM exceções, libguia) + guia-rt.o
     pch/<nome>.pch.gz      cabeçalhos pré-compilados (<iostream>, <print>…)
     LICENSE-*.txt, LEIA.md
   e atualiza os tamanhos em assets/cppsim.js.

   Uso:  cd tools && npm install && node construir-cpp.mjs
         node construir-cpp.mjs --libcxx   (recompila a libc++ com exceções; ver abaixo)

   A libc++ do pacote vem SEM exceções. tools/.libcxx-eh/ guarda a libc++,
   a libc++abi e a libunwind recompiladas com -fwasm-exceptions. Se a pasta
   não existir, o script a recria:
     1. com --libcxx (ou se não houver assets/cpp/sysroot.tar.gz): baixa só
        libcxx/libcxxabi/libunwind/runtimes/libc do llvm-project no MESMO
        commit do Clang do pacote (git sparse, em tools/.llvm-src) e compila
        com o clang-21 + cmake + ninja do sistema (alvo wasm32-wasip1);
     2. senão: tira as bibliotecas do assets/cpp/sysroot.tar.gz atual.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { remendarBundleYowasp, remendarFormatFunctions } from "./cpp-src/remendo.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..");
const SAIDA = path.join(RAIZ, "assets/cpp");
const NM = path.join(AQUI, "node_modules");
const PKG = path.join(NM, "@yowasp/clang");
const GEN = path.join(PKG, "gen");
const EH = path.join(AQUI, ".libcxx-eh");
const require = createRequire(import.meta.url);
const VERSAO_PKG = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).version;
const COMMIT_LLVM = "9560ae0f2cc440e4fc891fddbc119da6f56daa59"; // "clang version 22.1.0 (https://codeberg.org/YoWASP/llvm-project 9560ae0f…)"

// PCH: um por conjunto de cabeçalhos. O editor usa o maior PCH cujos
// cabeçalhos o arquivo inclui (no começo); senão compila sem PCH.
const PCHS = [
  { nome: "iostream", cabecalhos: ["iostream"], ansioso: true },
  { nome: "print", cabecalhos: ["print"], ansioso: false },
];

const t0 = Date.now();
const log = (...a) => console.log("[" + ((Date.now() - t0) / 1000).toFixed(1) + "s]", ...a);
fs.mkdirSync(SAIDA, { recursive: true });

/* ---------- 0. núcleo do YoWASP (remendado) ---------- */
const NUCLEO = path.join(NM, ".guia-cpp", "nucleo.mjs");
fs.mkdirSync(path.dirname(NUCLEO), { recursive: true });
fs.writeFileSync(NUCLEO, remendarBundleYowasp(fs.readFileSync(path.join(GEN, "bundle.js"), "utf8")));
const Y = await import(pathToFileURL(NUCLEO).href);
const M = await import(pathToFileURL(path.join(AQUI, "cpp-src/motor.mjs")).href);

/* ---------- 1. libc++ com exceções ---------- */
function construirLibcxx() {
  const src = path.join(AQUI, ".llvm-src");
  if (!fs.existsSync(path.join(src, "libcxx"))) {
    log("baixando libcxx/libcxxabi/libunwind/libc do llvm-project", COMMIT_LLVM.slice(0, 10), "(git sparse)…");
    fs.mkdirSync(src, { recursive: true });
    const git = (...a) => execFileSync("git", a, { cwd: src, stdio: "inherit" });
    git("init", "-q");
    git("remote", "add", "origin", "https://codeberg.org/YoWASP/llvm-project.git");
    git("sparse-checkout", "set", "--no-cone", "/libcxx/", "/libcxxabi/", "/libunwind/", "/runtimes/", "/cmake/", "/llvm/cmake/", "/llvm/utils/llvm-lit/", "/third-party/", "/libc/", "!/libc/test/", "!/libc/docs/", "!/libc/benchmarks/", "!/libc/fuzzing/", "!/libcxx/test/", "!/libcxxabi/test/", "!/libunwind/test/");
    git("fetch", "--depth", "1", "--filter=blob:none", "origin", COMMIT_LLVM);
    git("checkout", "-q", "FETCH_HEAD");
  }
  const sysroot = path.join(AQUI, ".llvm-src", ".sysroot");
  fs.rmSync(sysroot, { recursive: true, force: true });
  fs.mkdirSync(sysroot, { recursive: true });
  execFileSync("tar", ["xf", path.join(GEN, "llvm-resources.tar"), "-C", sysroot]);
  const build = path.join(AQUI, ".llvm-src", ".build");
  fs.rmSync(build, { recursive: true, force: true });
  const F = "-fwasm-exceptions -mllvm -wasm-use-legacy-eh=true";
  log("configurando (cmake)…");
  execFileSync("cmake", ["-G", "Ninja", "-S", path.join(src, "runtimes"), "-B", build,
    "-DLLVM_ENABLE_RUNTIMES=libcxx;libcxxabi;libunwind",
    "-DCMAKE_SYSTEM_NAME=WASI", "-DCMAKE_SYSTEM_PROCESSOR=wasm32", "-DUNIX=ON",
    "-DCMAKE_C_COMPILER=clang-21", "-DCMAKE_CXX_COMPILER=clang++-21", "-DCMAKE_AR=/usr/bin/llvm-ar-21", "-DCMAKE_RANLIB=/usr/bin/llvm-ranlib-21",
    "-DCMAKE_C_COMPILER_TARGET=wasm32-wasip1", "-DCMAKE_CXX_COMPILER_TARGET=wasm32-wasip1", "-DCMAKE_ASM_COMPILER_TARGET=wasm32-wasip1",
    "-DCMAKE_SYSROOT=" + sysroot, "-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY", "-DLLVM_COMPILER_CHECKED=ON",
    "-DCMAKE_C_COMPILER_WORKS=ON", "-DCMAKE_CXX_COMPILER_WORKS=ON",
    "-DCMAKE_C_FLAGS=" + F, "-DCMAKE_CXX_FLAGS=" + F, "-DCMAKE_BUILD_TYPE=MinSizeRel",
    "-DLIBCXX_ENABLE_SHARED=OFF", "-DLIBCXXABI_ENABLE_SHARED=OFF", "-DLIBUNWIND_ENABLE_SHARED=OFF",
    "-DLIBCXX_ENABLE_EXCEPTIONS=ON", "-DLIBCXXABI_ENABLE_EXCEPTIONS=ON", "-DLIBCXXABI_USE_LLVM_UNWINDER=ON",
    "-DLIBCXXABI_SILENT_TERMINATE=OFF", "-DLIBCXX_ENABLE_THREADS=ON", "-DLIBCXX_HAS_PTHREAD_API=OFF",
    "-DLIBCXXABI_ENABLE_THREADS=ON", "-DLIBCXXABI_HAS_PTHREAD_API=OFF", "-DLIBUNWIND_ENABLE_THREADS=OFF", "-DLIBUNWIND_HIDE_SYMBOLS=ON",
    "-DLIBCXX_HAS_MUSL_LIBC=ON", "-DLIBCXX_ABI_VERSION=2", "-DLIBCXX_ENABLE_FILESYSTEM=ON", "-DLIBCXX_ENABLE_TIME_ZONE_DATABASE=OFF",
    "-DLIBCXX_ENABLE_ABI_LINKER_SCRIPT=OFF", "-DLIBCXX_CXX_ABI=libcxxabi", "-DLIBCXX_HARDENING_MODE=none",
    "-DLIBCXX_INCLUDE_TESTS=OFF", "-DLIBCXX_INCLUDE_BENCHMARKS=OFF", "-DLIBCXXABI_INCLUDE_TESTS=OFF", "-DLIBUNWIND_INCLUDE_TESTS=OFF",
    "-DLIBCXX_INCLUDE_DOCS=OFF", "-DLIBUNWIND_INCLUDE_DOCS=OFF", "-DLIBCXX_INSTALL_MODULES=OFF",
  ], { stdio: ["ignore", "ignore", "inherit"] });
  log("compilando a libc++ (ninja -j2)…");
  execFileSync("nice", ["ninja", "-C", build, "-j2", "cxx", "cxxabi", "unwind"], { stdio: ["ignore", "ignore", "inherit"] });
  // os cabeçalhos gerados têm de ser IDÊNTICOS aos do pacote (mesma configuração)
  const a = fs.readFileSync(path.join(build, "include/c++/v1/__config_site"), "utf8");
  const b = fs.readFileSync(path.join(sysroot, "include/c++/v1/__config_site"), "utf8");
  if (a !== b) throw new Error("__config_site da libc++ recompilada difere do pacote — confira as opções do cmake");
  fs.mkdirSync(EH, { recursive: true });
  for (const f of ["libc++.a", "libc++abi.a", "libunwind.a", "libc++experimental.a"]) fs.copyFileSync(path.join(build, "lib", f), path.join(EH, f));
}
const LIBS_EH = ["libc++.a", "libc++abi.a", "libunwind.a", "libc++experimental.a"];
if (process.argv.includes("--libcxx") || !LIBS_EH.every((f) => fs.existsSync(path.join(EH, f)))) {
  const atual = path.join(SAIDA, "sysroot.tar.gz");
  if (!process.argv.includes("--libcxx") && fs.existsSync(atual)) {
    log("tirando a libc++ com exceções do assets/cpp/sysroot.tar.gz atual");
    const t = M.lerTar(zlib.gunzipSync(fs.readFileSync(atual)));
    fs.mkdirSync(EH, { recursive: true });
    for (const f of LIBS_EH) fs.writeFileSync(path.join(EH, f), t.lib["wasm32-wasip1"][f]);
  } else construirLibcxx();
}

/* ---------- 2. sysroot enxuto ---------- */
log("montando o sysroot…");
const orig = M.lerTar(fs.readFileSync(path.join(GEN, "llvm-resources.tar")));
const sys = { include: {}, lib: { "wasm32-wasip1": {}, "wasm32-unknown-wasip1": {} } };
// cabeçalhos do Clang: só os genéricos (nada de intrínsecos de x86/ARM/CUDA…)
const CLANG_H = /^(__stdarg_.*|__stddef_.*|stdarg|stddef|stdint|stdbool|stdalign|stdatomic|stdnoreturn|stdckdint|stdcountof|float|limits|iso646|varargs|inttypes|tgmath|wasm_simd128|__wasm_.*|unwind|ptrauth|stdmchar|__clang_wasm.*)\.h$/;
for (const [n, v] of Object.entries(orig.include)) {
  if (v instanceof Uint8Array) { if (CLANG_H.test(n)) sys.include[n] = v; }
}
sys.include["wasm32-wasip1"] = orig.include["wasm32-wasip1"];
const cxx = Object.assign({}, orig.include["c++"].v1);
delete cxx.__cxx03;           // só com _LIBCPP_USE_FROZEN_CXX03_HEADERS
delete cxx["module.modulemap"]; delete cxx["libcxx.imp"];
cxx.__format = Object.assign({}, cxx.__format);
cxx.__format["format_functions.h"] = new TextEncoder().encode(remendarFormatFunctions(new TextDecoder().decode(cxx.__format["format_functions.h"])));
sys.include["c++"] = { v1: cxx };
const libOrig = orig.lib["wasm32-wasip1"];
for (const f of ["crt1-command.o", "crt1.o", "libc.a", "libm.a", "libdl.a", "libpthread.a", "librt.a", "libutil.a", "libxnet.a", "libresolv.a", "libcrypt.a", "libsetjmp.a",
  "libwasi-emulated-getpid.a", "libwasi-emulated-mman.a", "libwasi-emulated-process-clocks.a", "libwasi-emulated-signal.a", "libc-printscan-long-double.a"]) {
  if (libOrig[f]) sys.lib["wasm32-wasip1"][f] = libOrig[f];
}
for (const f of LIBS_EH) sys.lib["wasm32-wasip1"][f] = new Uint8Array(fs.readFileSync(path.join(EH, f)));
sys.lib["wasm32-unknown-wasip1"]["libclang_rt.builtins.a"] = orig.lib["wasm32-unknown-wasip1"]["libclang_rt.builtins.a"];

/* ---------- 3. o compilador (no Node) para gerar guia-rt.o, libguia.a e os PCHs ---------- */
const modulos = {};
for (const f of ["llvm.core.wasm", "llvm.core2.wasm", "llvm.core3.wasm", "llvm.core4.wasm"]) modulos[f] = new WebAssembly.Module(fs.readFileSync(path.join(GEN, f)));
function compiladorCom(arvore, pchs) { return M.criarCompilador({ Y, modulos, sysroot: arvore, pchs }); }
let C = compiladorCom(sys);
const fonte = (n) => fs.readFileSync(path.join(AQUI, "cpp-src", n), "utf8");
function objeto(nome, extra) {
  const r = C.executarDriver(["clang++", "-std=c++23", "-fwasm-exceptions", "-O2", "-Wall", "-Wextra", "-c", nome, "-o", nome.replace(/\.cpp$/, ".o")].concat(extra || []), [{ nome, codigo: fonte(nome) }]);
  if (r.exit) throw new Error(nome + ":\n" + r.saida);
  return r.ler(nome.replace(/\.cpp$/, ".o"));
}
log("compilando guia-rt.o e libguia.a…");
sys.lib["wasm32-wasip1"]["guia-rt.o"] = objeto("guia-rt.cpp").slice();
const fmtO = objeto("guia-format.cpp").slice();
{
  const r = C.ferramenta(["ar", "rcs", "libguia.a", "guia-format.o"], [{ nome: "guia-format.o", codigo: fmtO }]);
  if (r.exit) throw new Error("ar: " + r.saida);
  sys.lib["wasm32-wasip1"]["libguia.a"] = r.ler("libguia.a").slice();
}
C = compiladorCom(sys);

log("gerando os PCHs…");
const manifestoPchs = [];
sys.pch = {};
const cc1Padrao = C.comandos(["clang++"].concat(M.FLAGS_PADRAO, ["-fwasm-exceptions", "-fcolor-diagnostics", "-fansi-escape-codes", "programa.cpp", "-o", "programa"]), [{ nome: "programa.cpp", codigo: "" }]).find((c) => c[1] === "-cc1");
const assinatura = M.assinaturaCc1(cc1Padrao);
const pchBytes = {};
for (const p of PCHS) {
  const h = p.cabecalhos.map((x) => "#include <" + x + ">\n").join("");
  sys.pch[p.nome + ".h"] = new TextEncoder().encode(h);
  const args = cc1Padrao.slice();
  args[args.indexOf("-emit-obj")] = "-emit-pch";
  args.splice(args.lastIndexOf("-x"), 3, "-fno-pch-timestamp", "-x", "c++-header", "/usr/pch/" + p.nome + ".h");
  args[args.indexOf("-o") + 1] = "/tmp/x.pch";
  const Cp = compiladorCom(sys);
  const r = Cp.ferramenta(args, []);
  if (r.exit) throw new Error("PCH " + p.nome + ":\n" + r.saida);
  pchBytes[p.nome] = r.ler("tmp/x.pch").slice();
  log("  pch/" + p.nome + ".pch:", pchBytes[p.nome].length, "bytes");
}

/* ---------- 4. arquivos de saída ---------- */
function tarUstar(arvore) {
  const partes = [];
  const cab = (nome, tam, tipo) => {
    const b = Buffer.alloc(512);
    let n = nome, pre = "";
    if (Buffer.byteLength(n) > 100) { const i = n.lastIndexOf("/", 154); pre = n.slice(0, i); n = n.slice(i + 1); }
    b.write(n, 0, 100); b.write(tipo === "5" ? "0000755\0" : "0000644\0", 100); b.write("0000000\0", 108); b.write("0000000\0", 116);
    b.write(tam.toString(8).padStart(11, "0") + "\0", 124); b.write("00000000000\0", 136);
    b.write("        ", 148); b.write(tipo, 156); b.write("ustar\0" + "00", 257); b.write(pre, 345, 155);
    let s = 0; for (const x of b) s += x;
    b.write(s.toString(8).padStart(6, "0") + "\0 ", 148);
    return b;
  };
  (function anda(d, pref) {
    for (const k of Object.keys(d).sort()) {
      const v = d[k], nome = pref + k;
      if (v instanceof Uint8Array) {
        partes.push(cab(nome, v.length, "0"), Buffer.from(v));
        const r = v.length % 512; if (r) partes.push(Buffer.alloc(512 - r));
      } else { partes.push(cab(nome + "/", 0, "5")); anda(v, nome + "/"); }
    }
  })(arvore, "");
  partes.push(Buffer.alloc(1024));
  return Buffer.concat(partes);
}
const gz = (b) => zlib.gzipSync(b, { level: 9 });
function gravarGz(nome, dados) {
  const z = gz(dados);
  fs.mkdirSync(path.dirname(path.join(SAIDA, nome)), { recursive: true });
  fs.writeFileSync(path.join(SAIDA, nome + ".gz"), z);
  log(nome + ".gz:", dados.length, "→", z.length, "bytes");
  return { arquivo: nome, bytes: dados.length, bytesGz: z.length, sha1: crypto.createHash("sha1").update(dados).digest("hex").slice(0, 12) };
}
const sysSemPch = Object.assign({}, sys); // os .pch vão separados (baixados quando precisa)
const tar = tarUstar(sysSemPch);
const infoSys = gravarGz("sysroot.tar", tar);
const wasmCore = fs.readFileSync(path.join(GEN, "llvm.core.wasm"));
const destinoWasm = path.join(SAIDA, "llvm.core.wasm.gz");
let infoWasm;
const sha = crypto.createHash("sha1").update(wasmCore).digest("hex").slice(0, 12);
const marca = path.join(SAIDA, ".llvm.core.sha1");
if (fs.existsSync(destinoWasm) && fs.existsSync(marca) && fs.readFileSync(marca, "utf8") === sha) {
  infoWasm = { arquivo: "llvm.core.wasm", bytes: wasmCore.length, bytesGz: fs.statSync(destinoWasm).size, sha1: sha };
  log("llvm.core.wasm.gz já está atualizado");
} else { infoWasm = gravarGz("llvm.core.wasm", wasmCore); fs.writeFileSync(marca, sha); }
for (const p of PCHS) {
  const i = gravarGz("pch/" + p.nome + ".pch", pchBytes[p.nome]);
  manifestoPchs.push(Object.assign(i, { nome: p.nome, cabecalhos: p.cabecalhos, assinatura, ansioso: p.ansioso }));
}
const versao = crypto.createHash("sha1").update([infoWasm.sha1, infoSys.sha1].concat(manifestoPchs.map((p) => p.sha1)).join(",")).digest("hex").slice(0, 10);
const manifesto = { versao, pacote: VERSAO_PKG, wasm: infoWasm, sysroot: infoSys, pchs: manifestoPchs };

/* ---------- 5. o worker ---------- */
const esbuild = require(path.join(NM, "esbuild"));
const cores = {};
for (const f of ["llvm.core2.wasm", "llvm.core3.wasm", "llvm.core4.wasm"]) cores[f] = fs.readFileSync(path.join(GEN, f)).toString("base64");
await esbuild.build({
  entryPoints: [path.join(AQUI, "cpp-src/worker.mjs")],
  bundle: true, format: "iife", platform: "browser", target: ["es2022"], minify: true, legalComments: "eof",
  alias: { "yowasp-nucleo": NUCLEO },
  define: { __MANIFESTO__: JSON.stringify(manifesto), __CORES_PEQUENOS__: JSON.stringify(cores), "import.meta.url": "self.location.href" },
  external: ["node:fs/promises"],
  banner: { js: "/* Guia C++ — Clang/LLD 22.1 em WebAssembly (@yowasp/clang " + VERSAO_PKG + ", ISC; LLVM: Apache-2.0 WITH LLVM-exception). Gerado por tools/construir-cpp.mjs; fonte em tools/cpp-src/. */" },
  outfile: path.join(SAIDA, "cpp-worker.js"),
  logLevel: "warning",
});
log("cpp-worker.js:", fs.statSync(path.join(SAIDA, "cpp-worker.js")).size, "bytes");

/* ---------- 6. licenças e tamanhos ---------- */
fs.copyFileSync(path.join(AQUI, "licencas/LLVM-LICENSE.txt"), path.join(SAIDA, "LICENSE-LLVM.txt"));
fs.writeFileSync(path.join(SAIDA, "LICENSE-wasi-libc.txt"),
  "wasi-libc (https://github.com/WebAssembly/wasi-libc): Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT.\nTexto MIT abaixo; o musl (parte da wasi-libc) vem depois.\n\n" +
  fs.readFileSync(path.join(AQUI, "licencas/wasi-libc-LICENSE-MIT"), "utf8") + "\n\n==== musl ====\n\n" + fs.readFileSync(path.join(AQUI, "licencas/musl-COPYRIGHT"), "utf8"));
fs.copyFileSync(path.join(AQUI, "licencas/yowasp-ISC.txt"), path.join(SAIDA, "LICENSE-yowasp.txt"));
const total = infoWasm.bytesGz + infoSys.bytesGz + manifestoPchs.filter((p) => p.ansioso).reduce((s, p) => s + p.bytesGz, 0);
const sim = path.join(RAIZ, "assets/cppsim.js");
if (fs.existsSync(sim)) {
  const s = fs.readFileSync(sim, "utf8");
  const novo = s.replace(/var CPP_BYTES = \d+;/, "var CPP_BYTES = " + total + ";");
  if (novo !== s) { fs.writeFileSync(sim, novo); log("assets/cppsim.js: CPP_BYTES =", total); }
}
fs.writeFileSync(path.join(SAIDA, "manifesto.json"), JSON.stringify(manifesto, null, 1) + "\n");
log("pronto. Download na primeira vez:", (total / 1e6).toFixed(1), "MB");
