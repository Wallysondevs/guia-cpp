/* =====================================================================
   Remendos aplicados a código de terceiros na hora de construir.
   Cada remendo confere se o trecho original existe UMA vez; se a versão
   do pacote mudar e o trecho sumir, o build para com uma mensagem clara.
   ===================================================================== */

function trocar(src, antes, depois, rotulo) {
  const n = src.split(antes).length - 1;
  if (n !== 1) throw new Error("remendo " + rotulo + ": trecho encontrado " + n + " vezes (versão nova do pacote?)");
  return src.replace(antes, () => depois);
}

/**
 * gen/bundle.js do @yowasp/clang (o Clang/LLD em WebAssembly + o runtime WASI
 * do YoWASP). O editor não usa o runClang() do pacote: ele chama o núcleo
 * direto (Environment + instantiate), com o sysroot do guia em memória.
 * 1. exporta as peças internas;
 * 2. WriteStream: o arquivo crescia copiando tudo a cada escrita (O(n²));
 *    agora cresce em blocos (gravar um .o/.pch fica muito mais rápido).
 */
export function remendarBundleYowasp(src) {
  src = trocar(src,
    "export {\n  Exit,\n  commands,\n  runClang,\n  runLLVM,\n  version\n};",
    "export {\n  Exit,\n  Environment,\n  Directory,\n  File,\n  directoryFromTree,\n  directoryIntoTree,\n  instantiate,\n  version\n};",
    "exportar");
  src = trocar(src,
    `  write(contents) {
    const offset = Number(this.offset);
    const newData = new Uint8Array(Math.max(this.file.data.length, offset + contents.length));
    newData.set(this.file.data);
    newData.subarray(offset).set(contents);
    this.file.data = newData;
    this.offset += BigInt(contents.length);
  }`,
    `  write(contents) {
    const offset = Number(this.offset);
    const fim = offset + contents.length;
    let d = this.file.data;
    if (fim > d.length) {
      if (d.__guiaCap && d.byteOffset === 0 && d.buffer.byteLength >= fim) d = new Uint8Array(d.buffer, 0, fim);
      else { const nb = new Uint8Array(Math.max(fim, d.length * 2, 65536)); nb.set(d); d = nb.subarray(0, fim); }
      d.__guiaCap = true;
      this.file.data = d;
    }
    d.set(contents, offset);
    this.offset += BigInt(contents.length);
  }`,
    "WriteStream");
  return src;
}

/**
 * libc++ (include/c++/v1/__format/format_functions.h): std::vformat
 * (usada por std::format, std::print e std::println) passa a chamar uma
 * função já compilada na biblioteca do guia (libguia.a, de guia-format.cpp)
 * em vez de instanciar toda a máquina de formatação em cada programa.
 * O resultado é idêntico; só a compilação fica vários segundos mais rápida.
 */
export function remendarFormatFunctions(src) {
  src = trocar(src,
    `template <class = void>
[[nodiscard]] _LIBCPP_ALWAYS_INLINE inline _LIBCPP_HIDE_FROM_ABI string vformat(string_view __fmt, format_args __args) {
  auto __result = __format::__try_constant_folding(__fmt, __args);`,
    `// Guia C++: a formatação fica pré-compilada na libguia.a (ver tools/cpp-src/guia-format.cpp).
_LIBCPP_EXPORTED_FROM_ABI string __guia_vformat(string_view __fmt, format_args __args);
_LIBCPP_EXPORTED_FROM_ABI string __guia_vformat_loc(locale __loc, string_view __fmt, format_args __args);
#    ifndef _GUIA_CPP_FORMAT_INTERNO
template <class = void>
[[nodiscard]] _LIBCPP_ALWAYS_INLINE inline _LIBCPP_HIDE_FROM_ABI string vformat(string_view __fmt, format_args __args) {
  return std::__guia_vformat(__fmt, __args);
}
#    else
template <class = void>
[[nodiscard]] _LIBCPP_ALWAYS_INLINE inline _LIBCPP_HIDE_FROM_ABI string vformat(string_view __fmt, format_args __args) {
  auto __result = __format::__try_constant_folding(__fmt, __args);`,
    "vformat");
  src = trocar(src,
    `  std::vformat_to(__buffer.__make_output_iterator(), __fmt, __args);
  return string{__buffer.__view()};
}
`,
    `  std::vformat_to(__buffer.__make_output_iterator(), __fmt, __args);
  return string{__buffer.__view()};
}
#    endif // _GUIA_CPP_FORMAT_INTERNO
`,
    "vformat-fim");
  src = trocar(src,
    `template <class = void>
[[nodiscard]] _LIBCPP_ALWAYS_INLINE inline _LIBCPP_HIDE_FROM_ABI string
vformat(locale __loc, string_view __fmt, format_args __args) {
  __format::__allocating_buffer<char> __buffer;`,
    `#    ifndef _GUIA_CPP_FORMAT_INTERNO
template <class = void>
[[nodiscard]] _LIBCPP_ALWAYS_INLINE inline _LIBCPP_HIDE_FROM_ABI string
vformat(locale __loc, string_view __fmt, format_args __args) {
  return std::__guia_vformat_loc(std::move(__loc), __fmt, __args);
}
#    else
template <class = void>
[[nodiscard]] _LIBCPP_ALWAYS_INLINE inline _LIBCPP_HIDE_FROM_ABI string
vformat(locale __loc, string_view __fmt, format_args __args) {
  __format::__allocating_buffer<char> __buffer;`,
    "vformat-loc");
  src = trocar(src,
    `  std::vformat_to(__buffer.__make_output_iterator(), std::move(__loc), __fmt, __args);
  return string{__buffer.__view()};
}
`,
    `  std::vformat_to(__buffer.__make_output_iterator(), std::move(__loc), __fmt, __args);
  return string{__buffer.__view()};
}
#    endif // _GUIA_CPP_FORMAT_INTERNO
`,
    "vformat-loc-fim");
  return src;
}
