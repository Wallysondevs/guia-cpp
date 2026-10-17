// Guia C++: std::vformat pré-compilada (libguia.a). O cabeçalho
// <__format/format_functions.h> do sysroot do guia declara estas funções e
// faz std::vformat chamá-las (tools/cpp-src/remendo.mjs); assim cada programa
// com std::format/std::print/std::println não precisa compilar de novo toda a
// máquina de formatação. O resultado é o mesmo da libc++ original.
#define _GUIA_CPP_FORMAT_INTERNO
#include <format>
#include <locale>

_LIBCPP_BEGIN_NAMESPACE_STD
string __guia_vformat(string_view __fmt, format_args __args) { return std::vformat(__fmt, __args); }
string __guia_vformat_loc(locale __loc, string_view __fmt, format_args __args) { return std::vformat(std::move(__loc), __fmt, __args); }
_LIBCPP_END_NAMESPACE_STD
