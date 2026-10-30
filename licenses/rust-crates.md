# 编进桌面版 exe 的 Rust 依赖

由 `node tools/third-party.mjs` 从 `cargo metadata` 生成（目标 x86_64-pc-windows-msvc，只算普通依赖），共 234 个。
各 crate 包里带的许可证原文在 [rust-crates-LICENSES.txt](rust-crates-LICENSES.txt)。

| crate | 版本 | 许可证 | 来源 | 包里的许可证文件 |
| --- | --- | --- | --- | --- |
| adler2 | 2.0.1 | 0BSD OR MIT OR Apache-2.0 | https://github.com/oyvindln/adler2 | LICENSE-0BSD、LICENSE-APACHE、LICENSE-MIT |
| aho-corasick | 1.1.5 | Unlicense OR MIT | https://github.com/BurntSushi/aho-corasick | COPYING、LICENSE-MIT、UNLICENSE |
| alloc-no-stdlib | 3.0.0 | BSD-3-Clause | https://github.com/dropbox/rust-alloc-no-stdlib | LICENSE |
| alloc-stdlib | 0.3.0 | BSD-3-Clause | https://github.com/dropbox/rust-alloc-no-stdlib | 包里没有许可证文件 |
| anyhow | 1.0.104 | MIT OR Apache-2.0 | https://github.com/dtolnay/anyhow | LICENSE-APACHE、LICENSE-MIT |
| base64 | 0.23.1 | MIT OR Apache-2.0 | https://github.com/marshallpierce/rust-base64 | LICENSE-APACHE、LICENSE-MIT |
| bit-set | 0.8.0 | Apache-2.0 OR MIT | https://github.com/contain-rs/bit-set | LICENSE-APACHE、LICENSE-MIT |
| bit-vec | 0.8.0 | Apache-2.0 OR MIT | https://github.com/contain-rs/bit-vec | LICENSE-APACHE、LICENSE-MIT |
| bitflags | 1.3.2 | MIT/Apache-2.0 | https://github.com/bitflags/bitflags | LICENSE-APACHE、LICENSE-MIT |
| bitflags | 2.13.2 | MIT OR Apache-2.0 | https://github.com/bitflags/bitflags | LICENSE-APACHE、LICENSE-MIT |
| block-buffer | 0.10.4 | MIT OR Apache-2.0 | https://github.com/RustCrypto/utils | LICENSE-APACHE、LICENSE-MIT |
| brotli | 9.1.1 | BSD-3-Clause AND MIT | https://github.com/dropbox/rust-brotli | LICENSE.BSD-3-Clause、LICENSE.MIT |
| brotli-decompressor | 6.2.0 | BSD-3-Clause/MIT | https://github.com/dropbox/rust-brotli-decompressor | LICENSE |
| bs58 | 0.5.1 | MIT/Apache-2.0 | https://github.com/Nullus157/bs58-rs | LICENSE-APACHE、LICENSE-MIT |
| byteorder | 1.5.0 | Unlicense OR MIT | https://github.com/BurntSushi/byteorder | COPYING、LICENSE-MIT、UNLICENSE |
| bytes | 1.12.1 | MIT | https://github.com/tokio-rs/bytes | LICENSE |
| camino | 1.2.6 | MIT OR Apache-2.0 | https://github.com/camino-rs/camino | LICENSE-APACHE、LICENSE-MIT |
| cargo_metadata | 0.19.2 | MIT | https://github.com/oli-obk/cargo_metadata | LICENSE-MIT |
| cargo-platform | 0.1.9 | MIT OR Apache-2.0 | https://github.com/rust-lang/cargo | LICENSE-APACHE、LICENSE-MIT |
| cfb | 0.14.0 | MIT | https://github.com/mdsteele/rust-cfb | LICENSE |
| cfg-if | 1.0.5 | MIT OR Apache-2.0 | https://github.com/rust-lang/cfg-if | LICENSE-APACHE、LICENSE-MIT |
| chrono | 0.4.45 | MIT OR Apache-2.0 | https://github.com/chronotope/chrono | LICENSE.txt |
| cookie | 0.18.2 | MIT OR Apache-2.0 | https://github.com/SergioBenitez/cookie-rs | LICENSE-APACHE、LICENSE-MIT |
| cpufeatures | 0.2.17 | MIT OR Apache-2.0 | https://github.com/RustCrypto/utils | LICENSE-APACHE、LICENSE-MIT |
| crc32fast | 1.5.3 | MIT OR Apache-2.0 | https://github.com/srijs/rust-crc32fast | LICENSE-APACHE、LICENSE-MIT |
| crossbeam-channel | 0.5.17 | MIT OR Apache-2.0 | https://github.com/crossbeam-rs/crossbeam | LICENSE-APACHE、LICENSE-MIT、LICENSE-THIRD-PARTY |
| crossbeam-utils | 0.8.23 | MIT OR Apache-2.0 | https://github.com/crossbeam-rs/crossbeam | LICENSE-APACHE、LICENSE-MIT |
| crypto-common | 0.1.7 | MIT OR Apache-2.0 | https://github.com/RustCrypto/traits | LICENSE-APACHE、LICENSE-MIT |
| cssparser | 0.37.0 | MPL-2.0 | https://github.com/servo/rust-cssparser | LICENSE |
| cssparser-macros | 0.7.1 | MPL-2.0 | https://github.com/servo/rust-cssparser | LICENSE |
| ctor | 1.0.13 | Apache-2.0 OR MIT | https://github.com/mmastrac/linktime | LICENSE-APACHE、LICENSE-MIT |
| darling | 0.24.1 | MIT | https://github.com/TedDriggs/darling | LICENSE |
| darling_core | 0.24.1 | MIT | https://github.com/TedDriggs/darling | LICENSE |
| darling_macro | 0.24.1 | MIT | https://github.com/TedDriggs/darling | LICENSE |
| defmt | 1.2.0 | MIT OR Apache-2.0 | https://github.com/knurling-rs/defmt | LICENSE-APACHE、LICENSE-MIT |
| defmt-macros | 1.2.0 | MIT OR Apache-2.0 | https://github.com/knurling-rs/defmt | LICENSE-APACHE、LICENSE-MIT |
| defmt-parser | 1.1.0 | MIT OR Apache-2.0 | https://github.com/knurling-rs/defmt | LICENSE-APACHE、LICENSE-MIT |
| deranged | 0.5.9 | MIT OR Apache-2.0 | https://github.com/jhpratt/deranged | LICENSE-Apache、LICENSE-MIT |
| derive_more | 2.1.1 | MIT | https://github.com/JelteF/derive_more | LICENSE |
| derive_more-impl | 2.1.1 | MIT | https://github.com/JelteF/derive_more | LICENSE |
| digest | 0.10.7 | MIT OR Apache-2.0 | https://github.com/RustCrypto/traits | LICENSE-APACHE、LICENSE-MIT |
| dirs | 7.0.0 | MIT OR Apache-2.0 | https://codeberg.org/dirs/dirs-rs | LICENSE-APACHE、LICENSE-MIT |
| dirs-sys | 0.5.0 | MIT OR Apache-2.0 | https://github.com/dirs-dev/dirs-sys-rs | LICENSE-APACHE、LICENSE-MIT |
| displaydoc | 0.2.7 | MIT OR Apache-2.0 | https://github.com/yaahc/displaydoc | LICENSE-APACHE、LICENSE-MIT |
| dom_query | 0.28.0 | MIT | https://github.com/niklak/dom_query | LICENSE |
| dpi | 0.1.2 | Apache-2.0 AND MIT | https://github.com/rust-windowing/winit | LICENSE、LICENSE-LIBM-MIT |
| dtoa | 1.0.11 | MIT OR Apache-2.0 | https://github.com/dtolnay/dtoa | LICENSE-APACHE、LICENSE-MIT |
| dtoa-short | 0.3.5 | MPL-2.0 | https://github.com/upsuper/dtoa-short | LICENSE |
| dunce | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 | https://gitlab.com/kornelski/dunce | LICENSE |
| dyn-clone | 1.0.20 | MIT OR Apache-2.0 | https://github.com/dtolnay/dyn-clone | LICENSE-APACHE、LICENSE-MIT |
| equivalent | 1.0.3 | Apache-2.0 OR MIT | https://github.com/indexmap-rs/equivalent | LICENSE-APACHE、LICENSE-MIT |
| erased-serde | 0.4.11 | MIT OR Apache-2.0 | https://github.com/dtolnay/erased-serde | LICENSE-APACHE、LICENSE-MIT |
| fastrand | 2.5.0 | Apache-2.0 OR MIT | https://github.com/smol-rs/fastrand | LICENSE-APACHE、LICENSE-MIT |
| fdeflate | 0.3.7 | MIT OR Apache-2.0 | https://github.com/image-rs/fdeflate | LICENSE-APACHE、LICENSE-MIT |
| flate2 | 1.1.10 | MIT OR Apache-2.0 | https://github.com/rust-lang/flate2-rs | LICENSE-APACHE、LICENSE-MIT |
| fnv | 1.0.7 | Apache-2.0 / MIT | https://github.com/servo/rust-fnv | LICENSE-APACHE、LICENSE-MIT |
| foldhash | 0.2.0 | Zlib | https://github.com/orlp/foldhash | LICENSE |
| form_urlencoded | 1.2.2 | MIT OR Apache-2.0 | https://github.com/servo/rust-url | LICENSE-APACHE、LICENSE-MIT |
| generic-array | 0.14.7 | MIT | https://github.com/fizyk20/generic-array.git | LICENSE |
| getrandom | 0.3.4 | MIT OR Apache-2.0 | https://github.com/rust-random/getrandom | LICENSE-APACHE、LICENSE-MIT |
| getrandom | 0.4.3 | MIT OR Apache-2.0 | https://github.com/rust-random/getrandom | LICENSE-APACHE、LICENSE-MIT |
| glob | 0.3.4 | MIT OR Apache-2.0 | https://github.com/rust-lang/glob | LICENSE-APACHE、LICENSE-MIT |
| hashbrown | 0.12.3 | MIT OR Apache-2.0 | https://github.com/rust-lang/hashbrown | LICENSE-APACHE、LICENSE-MIT |
| hashbrown | 0.17.1 | MIT OR Apache-2.0 | https://github.com/rust-lang/hashbrown | LICENSE-APACHE、LICENSE-MIT |
| heck | 0.5.0 | MIT OR Apache-2.0 | https://github.com/withoutboats/heck | LICENSE-APACHE、LICENSE-MIT |
| hex | 0.4.3 | MIT OR Apache-2.0 | https://github.com/KokaKiwi/rust-hex | LICENSE-APACHE、LICENSE-MIT |
| html5ever | 0.39.0 | MIT OR Apache-2.0 | https://github.com/servo/html5ever | LICENSE-APACHE、LICENSE-MIT |
| http | 1.5.0 | MIT OR Apache-2.0 | https://github.com/hyperium/http | LICENSE-APACHE、LICENSE-MIT |
| ico | 0.6.0 | MIT | https://github.com/mdsteele/rust-ico | LICENSE |
| icu_collections | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x | LICENSE |
| icu_locale_core | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x | LICENSE |
| icu_normalizer | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x | LICENSE |
| icu_normalizer_data | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x | LICENSE |
| icu_properties | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x | LICENSE |
| icu_properties_data | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x | LICENSE |
| icu_provider | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x | LICENSE |
| ident_case | 1.0.1 | MIT/Apache-2.0 | https://github.com/TedDriggs/ident_case | LICENSE |
| idna | 1.1.0 | MIT OR Apache-2.0 | https://github.com/servo/rust-url/ | LICENSE-APACHE、LICENSE-MIT |
| idna_adapter | 1.2.2 | Apache-2.0 OR MIT | https://github.com/hsivonen/idna_adapter | LICENSE-APACHE、LICENSE-MIT |
| indexmap | 1.9.3 | Apache-2.0 OR MIT | https://github.com/bluss/indexmap | LICENSE-APACHE、LICENSE-MIT |
| indexmap | 2.14.2 | Apache-2.0 OR MIT | https://github.com/indexmap-rs/indexmap | LICENSE-APACHE、LICENSE-MIT |
| infer | 0.22.0 | MIT | https://github.com/bojand/infer | LICENSE |
| itoa | 1.0.18 | MIT OR Apache-2.0 | https://github.com/dtolnay/itoa | LICENSE-APACHE、LICENSE-MIT |
| jiff | 0.2.38 | Unlicense OR MIT | https://github.com/BurntSushi/jiff | COPYING、LICENSE-MIT、UNLICENSE |
| jiff-core | 0.1.1 | Unlicense OR MIT | https://github.com/BurntSushi/jiff | COPYING、LICENSE-MIT、UNLICENSE |
| jiff-tzdb | 0.1.9 | Unlicense OR MIT | https://github.com/BurntSushi/jiff | COPYING、LICENSE-MIT、UNLICENSE |
| jiff-tzdb-platform | 0.1.3 | Unlicense OR MIT | https://github.com/BurntSushi/jiff | COPYING、LICENSE-MIT、UNLICENSE |
| json-patch | 4.2.0 | MIT/Apache-2.0 | https://github.com/idubrov/json-patch | LICENSE-APACHE、LICENSE-MIT |
| jsonptr | 0.7.1 | MIT OR Apache-2.0 | https://github.com/chanced/jsonptr | LICENSE-APACHE、LICENSE-MIT |
| keyboard-types | 0.8.3 | MIT OR Apache-2.0 | https://github.com/rust-windowing/keyboard-types | LICENSE-APACHE、LICENSE-MIT |
| libc | 0.2.191 | MIT OR Apache-2.0 | https://github.com/rust-lang/libc | LICENSE-APACHE、LICENSE-MIT |
| litemap | 0.8.3 | Unicode-3.0 | https://github.com/unicode-org/icu4x | LICENSE |
| lock_api | 0.4.14 | MIT OR Apache-2.0 | https://github.com/Amanieu/parking_lot | LICENSE-APACHE、LICENSE-MIT |
| log | 0.4.34 | MIT OR Apache-2.0 | https://github.com/rust-lang/log | LICENSE-APACHE、LICENSE-MIT |
| markup5ever | 0.39.0 | MIT OR Apache-2.0 | https://github.com/servo/html5ever | LICENSE-APACHE、LICENSE-MIT |
| memchr | 2.8.3 | Unlicense OR MIT | https://github.com/BurntSushi/memchr | COPYING、LICENSE-MIT、UNLICENSE |
| mime | 0.3.17 | MIT OR Apache-2.0 | https://github.com/hyperium/mime | LICENSE-APACHE、LICENSE-MIT |
| miniz_oxide | 0.8.9 | MIT OR Zlib OR Apache-2.0 | https://github.com/Frommi/miniz_oxide/tree/master/miniz_oxide | LICENSE、LICENSE-APACHE.md、LICENSE-MIT.md、LICENSE-ZLIB.md |
| miniz_oxide | 0.9.1 | MIT OR Zlib OR Apache-2.0 | https://github.com/Frommi/miniz_oxide/tree/master/miniz_oxide | LICENSE、LICENSE-APACHE.md、LICENSE-MIT.md、LICENSE-ZLIB.md |
| mio | 1.2.4 | MIT | https://github.com/tokio-rs/mio | LICENSE |
| muda | 0.20.0 | Apache-2.0 OR MIT | https://github.com/tauri-apps/muda | LICENSE-APACHE、LICENSE-MIT、LICENSE.spdx |
| new_debug_unreachable | 1.0.6 | MIT | https://github.com/mbrubeck/rust-debug-unreachable | LICENSE-MIT |
| num-conv | 0.2.2 | MIT OR Apache-2.0 | https://github.com/jhpratt/num-conv | LICENSE-Apache、LICENSE-MIT |
| num-traits | 0.2.19 | MIT OR Apache-2.0 | https://github.com/rust-num/num-traits | LICENSE-APACHE、LICENSE-MIT |
| once_cell | 1.21.4 | MIT OR Apache-2.0 | https://github.com/matklad/once_cell | LICENSE-APACHE、LICENSE-MIT |
| open | 5.4.5 | MIT | https://github.com/Byron/open-rs | LICENSE.md |
| option-ext | 0.2.0 | MPL-2.0 | https://github.com/soc/option-ext.git | LICENSE.txt |
| parking_lot | 0.12.5 | MIT OR Apache-2.0 | https://github.com/Amanieu/parking_lot | LICENSE-APACHE、LICENSE-MIT |
| parking_lot_core | 0.9.12 | MIT OR Apache-2.0 | https://github.com/Amanieu/parking_lot | LICENSE-APACHE、LICENSE-MIT |
| percent-encoding | 2.3.2 | MIT OR Apache-2.0 | https://github.com/servo/rust-url/ | LICENSE-APACHE、LICENSE-MIT |
| phf | 0.13.1 | MIT | https://github.com/rust-phf/rust-phf | LICENSE |
| phf_generator | 0.13.1 | MIT | https://github.com/rust-phf/rust-phf | LICENSE |
| phf_macros | 0.13.1 | MIT | https://github.com/rust-phf/rust-phf | LICENSE |
| phf_shared | 0.13.1 | MIT | https://github.com/rust-phf/rust-phf | LICENSE |
| pin-project-lite | 0.2.17 | Apache-2.0 OR MIT | https://github.com/taiki-e/pin-project-lite | LICENSE-APACHE、LICENSE-MIT |
| plist | 1.10.3 | MIT | https://github.com/ebarnard/rust-plist/ | LICENCE |
| png | 0.18.1 | MIT OR Apache-2.0 | https://github.com/image-rs/image-png | LICENSE-APACHE、LICENSE-MIT |
| potential_utf | 0.1.6 | Unicode-3.0 | https://github.com/unicode-org/icu4x | LICENSE |
| powerfmt | 0.2.1 | MIT OR Apache-2.0 | https://github.com/jhpratt/powerfmt | LICENSE-Apache、LICENSE-MIT |
| precomputed-hash | 0.1.1 | MIT | https://github.com/emilio/precomputed-hash | LICENSE |
| proc-macro2 | 1.0.107 | MIT OR Apache-2.0 | https://github.com/dtolnay/proc-macro2 | LICENSE-APACHE、LICENSE-MIT |
| quick-xml | 0.42.0 | MIT | https://github.com/tafia/quick-xml | LICENSE-MIT.md |
| quote | 1.0.47 | MIT OR Apache-2.0 | https://github.com/dtolnay/quote | LICENSE-APACHE、LICENSE-MIT |
| raw-window-handle | 0.6.2 | MIT OR Apache-2.0 OR Zlib | https://github.com/rust-windowing/raw-window-handle | LICENSE-APACHE.md、LICENSE-MIT.md、LICENSE-ZLIB.md |
| ref-cast | 1.0.27 | MIT OR Apache-2.0 | https://github.com/dtolnay/ref-cast | LICENSE-APACHE、LICENSE-MIT |
| ref-cast-impl | 1.0.27 | MIT OR Apache-2.0 | https://github.com/dtolnay/ref-cast | LICENSE-APACHE、LICENSE-MIT |
| regex | 1.13.1 | MIT OR Apache-2.0 | https://github.com/rust-lang/regex | LICENSE-APACHE、LICENSE-MIT |
| regex-automata | 0.4.18 | MIT OR Apache-2.0 | https://github.com/rust-lang/regex | LICENSE-APACHE、LICENSE-MIT |
| regex-syntax | 0.8.11 | MIT OR Apache-2.0 | https://github.com/rust-lang/regex | LICENSE-APACHE、LICENSE-MIT |
| rfd | 0.17.2 | MIT | https://github.com/PolyMeilex/rfd | LICENSE |
| rustc-hash | 2.1.3 | Apache-2.0 OR MIT | https://github.com/rust-lang/rustc-hash | LICENSE-APACHE、LICENSE-MIT |
| same-file | 1.0.6 | Unlicense/MIT | https://github.com/BurntSushi/same-file | COPYING、LICENSE-MIT、UNLICENSE |
| schemars | 0.8.22 | MIT | https://github.com/GREsau/schemars | LICENSE |
| schemars | 0.9.0 | MIT | https://github.com/GREsau/schemars | LICENSE |
| schemars | 1.2.3 | MIT | https://github.com/GREsau/schemars | LICENSE |
| schemars_derive | 0.8.22 | MIT | https://github.com/GREsau/schemars | LICENSE |
| scopeguard | 1.2.0 | MIT OR Apache-2.0 | https://github.com/bluss/scopeguard | LICENSE-APACHE、LICENSE-MIT |
| selectors | 0.38.0 | MPL-2.0 | https://github.com/servo/stylo | 包里没有许可证文件 |
| semver | 1.0.28 | MIT OR Apache-2.0 | https://github.com/dtolnay/semver | LICENSE-APACHE、LICENSE-MIT |
| serde | 1.0.229 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde | LICENSE-APACHE、LICENSE-MIT |
| serde_core | 1.0.229 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde | LICENSE-APACHE、LICENSE-MIT |
| serde_derive | 1.0.229 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde | LICENSE-APACHE、LICENSE-MIT |
| serde_derive_internals | 0.29.1 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde | LICENSE-APACHE、LICENSE-MIT |
| serde_json | 1.0.154 | MIT OR Apache-2.0 | https://github.com/serde-rs/json | LICENSE-APACHE、LICENSE-MIT |
| serde_repr | 0.1.21 | MIT OR Apache-2.0 | https://github.com/dtolnay/serde-repr | LICENSE-APACHE、LICENSE-MIT |
| serde_spanned | 1.1.2 | MIT OR Apache-2.0 | https://github.com/toml-rs/toml | LICENSE-APACHE、LICENSE-MIT |
| serde_with | 3.24.0 | MIT OR Apache-2.0 | https://github.com/jonasbb/serde_with/ | LICENSE-APACHE、LICENSE-MIT |
| serde_with_macros | 3.24.0 | MIT OR Apache-2.0 | https://github.com/jonasbb/serde_with/ | LICENSE-APACHE、LICENSE-MIT |
| serde-untagged | 0.1.9 | MIT OR Apache-2.0 | https://github.com/dtolnay/serde-untagged | LICENSE-APACHE、LICENSE-MIT |
| serialize-to-javascript | 0.1.2 | MIT OR Apache-2.0 | https://github.com/chippers/serialize-to-javascript | LICENSE-APACHE、LICENSE-MIT |
| serialize-to-javascript-impl | 0.1.2 | MIT OR Apache-2.0 | https://github.com/chippers/serialize-to-javascript | LICENSE-APACHE、LICENSE-MIT |
| servo_arc | 0.4.3 | MIT OR Apache-2.0 | https://github.com/servo/stylo | LICENSE-APACHE、LICENSE-MIT |
| sha2 | 0.10.9 | MIT OR Apache-2.0 | https://github.com/RustCrypto/hashes | LICENSE-APACHE、LICENSE-MIT |
| simd-adler32 | 0.3.10 | MIT | https://github.com/mcountryman/simd-adler32 | LICENSE.md |
| siphasher | 1.0.4 | MIT OR Apache-2.0 | https://github.com/jedisct1/rust-siphash | COPYING、LICENSE-APACHE、LICENSE-MIT |
| smallvec | 1.16.4 | MIT OR Apache-2.0 | https://github.com/servo/rust-smallvec | LICENSE-APACHE、LICENSE-MIT |
| socket2 | 0.6.5 | MIT OR Apache-2.0 | https://github.com/rust-lang/socket2 | LICENSE-APACHE、LICENSE-MIT |
| softbuffer | 0.4.8 | MIT OR Apache-2.0 | https://github.com/rust-windowing/softbuffer | LICENSE-APACHE、LICENSE-MIT |
| stable_deref_trait | 1.2.1 | MIT OR Apache-2.0 | https://github.com/storyyeller/stable_deref_trait | LICENSE-APACHE、LICENSE-MIT |
| string_cache | 0.9.0 | MIT OR Apache-2.0 | https://github.com/servo/string-cache | LICENSE-APACHE、LICENSE-MIT |
| strsim | 0.11.1 | MIT | https://github.com/rapidfuzz/strsim-rs | LICENSE |
| syn | 2.0.119 | MIT OR Apache-2.0 | https://github.com/dtolnay/syn | LICENSE-APACHE、LICENSE-MIT |
| syn | 3.0.9 | MIT OR Apache-2.0 | https://github.com/dtolnay/syn | LICENSE-APACHE、LICENSE-MIT |
| synstructure | 0.14.0 | MIT | https://github.com/mystor/synstructure | LICENSE |
| tao | 0.37.2 | Apache-2.0 | https://github.com/tauri-apps/tao | LICENSE、LICENSE.spdx |
| tauri | 2.12.5 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri | LICENSE-APACHE-2.0、LICENSE-MIT |
| tauri-codegen | 2.7.4 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri | LICENSE-APACHE-2.0、LICENSE-MIT |
| tauri-macros | 2.7.4 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri | LICENSE-APACHE-2.0、LICENSE-MIT |
| tauri-plugin-dialog | 2.8.4 | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace | LICENSE.spdx、LICENSE_APACHE-2.0、LICENSE_MIT |
| tauri-plugin-fs | 2.7.1 | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace | LICENSE.spdx、LICENSE_APACHE-2.0、LICENSE_MIT |
| tauri-plugin-opener | 2.7.2 | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace | LICENSE.spdx、LICENSE_APACHE-2.0、LICENSE_MIT |
| tauri-plugin-single-instance | 2.5.5 | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace | LICENSE.spdx、LICENSE_APACHE-2.0、LICENSE_MIT |
| tauri-runtime | 2.12.2 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri | LICENSE-APACHE-2.0、LICENSE-MIT |
| tauri-runtime-wry | 2.12.3 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri | LICENSE-APACHE-2.0、LICENSE-MIT |
| tauri-utils | 2.10.2 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri | LICENSE-APACHE-2.0、LICENSE-MIT |
| tendril | 0.5.1 | MIT OR Apache-2.0 | https://github.com/servo/html5ever | LICENSE-APACHE、LICENSE-MIT |
| thiserror | 2.0.21 | MIT OR Apache-2.0 | https://github.com/dtolnay/thiserror | LICENSE-APACHE、LICENSE-MIT |
| thiserror-impl | 2.0.21 | MIT OR Apache-2.0 | https://github.com/dtolnay/thiserror | LICENSE-APACHE、LICENSE-MIT |
| time | 0.3.55 | MIT OR Apache-2.0 | https://github.com/time-rs/time | LICENSE-Apache、LICENSE-MIT |
| time-core | 0.1.9 | MIT OR Apache-2.0 | https://github.com/time-rs/time | LICENSE-Apache、LICENSE-MIT |
| time-macros | 0.2.32 | MIT OR Apache-2.0 | https://github.com/time-rs/time | LICENSE-Apache、LICENSE-MIT |
| tinystr | 0.8.5 | Unicode-3.0 | https://github.com/unicode-org/icu4x | LICENSE |
| tinyvec | 1.13.3 | Zlib OR Apache-2.0 OR MIT | https://github.com/Lokathor/tinyvec | LICENSE-APACHE.md、LICENSE-MIT.md、LICENSE-ZLIB.md |
| tokio | 1.54.1 | MIT | https://github.com/tokio-rs/tokio | LICENSE |
| toml | 1.1.8+spec-1.1.0 | MIT OR Apache-2.0 | https://github.com/toml-rs/toml | LICENSE-APACHE、LICENSE-MIT |
| toml_datetime | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 | https://github.com/toml-rs/toml | LICENSE-APACHE、LICENSE-MIT |
| toml_parser | 1.1.5+spec-1.1.0 | MIT OR Apache-2.0 | https://github.com/toml-rs/toml | LICENSE-APACHE、LICENSE-MIT |
| toml_writer | 1.1.3+spec-1.1.0 | MIT OR Apache-2.0 | https://github.com/toml-rs/toml | LICENSE-APACHE、LICENSE-MIT |
| tracing | 0.1.44 | MIT | https://github.com/tokio-rs/tracing | LICENSE |
| tracing-attributes | 0.1.31 | MIT | https://github.com/tokio-rs/tracing | LICENSE |
| tracing-core | 0.1.36 | MIT | https://github.com/tokio-rs/tracing | LICENSE |
| tray-icon | 0.25.1 | MIT OR Apache-2.0 | https://github.com/tauri-apps/tray-icon | LICENSE-APACHE、LICENSE-MIT、LICENSE.spdx |
| typeid | 1.0.3 | MIT OR Apache-2.0 | https://github.com/dtolnay/typeid | LICENSE-APACHE、LICENSE-MIT |
| typenum | 1.20.1 | MIT OR Apache-2.0 | https://github.com/paholg/typenum | LICENSE、LICENSE-APACHE、LICENSE-MIT |
| unicode-ident | 1.0.27 | (MIT OR Apache-2.0) AND Unicode-3.0 | https://github.com/dtolnay/unicode-ident | LICENSE-APACHE、LICENSE-MIT、LICENSE-UNICODE |
| unicode-segmentation | 1.13.3 | MIT OR Apache-2.0 | https://github.com/unicode-rs/unicode-segmentation | COPYRIGHT、LICENSE-APACHE、LICENSE-MIT |
| url | 2.5.8 | MIT OR Apache-2.0 | https://github.com/servo/rust-url | LICENSE-APACHE、LICENSE-MIT |
| urlpattern | 0.6.0 | MIT | https://github.com/denoland/rust-urlpattern | LICENSE |
| utf_types | 1.0.0 | Apache-2.0 OR MIT | https://github.com/hsivonen/utf_types | COPYRIGHT、LICENSE-APACHE、LICENSE-MIT |
| utf8_iter | 1.1.0 | Apache-2.0 OR MIT | https://github.com/hsivonen/utf8_iter | COPYRIGHT、LICENSE-APACHE、LICENSE-MIT |
| uuid | 1.29.0 | Apache-2.0 OR MIT | https://github.com/uuid-rs/uuid | LICENSE-APACHE、LICENSE-MIT |
| walkdir | 2.5.0 | Unlicense/MIT | https://github.com/BurntSushi/walkdir | COPYING、LICENSE-MIT、UNLICENSE |
| web_atoms | 0.2.6 | MIT OR Apache-2.0 | https://github.com/servo/html5ever | LICENSE-APACHE、LICENSE-MIT |
| web-time | 1.1.0 | MIT OR Apache-2.0 | https://github.com/daxpedda/web-time | LICENSE-APACHE、LICENSE-MIT |
| webview2-com | 0.39.1 | MIT | https://github.com/wravery/webview2-rs | 包里没有许可证文件 |
| webview2-com-macros | 0.8.1 | MIT | https://github.com/wravery/webview2-rs | 包里没有许可证文件 |
| webview2-com-sys | 0.39.1 | MIT | https://github.com/wravery/webview2-rs | 包里没有许可证文件 |
| winapi-util | 0.1.11 | Unlicense OR MIT | https://github.com/BurntSushi/winapi-util | COPYING、LICENSE-MIT、UNLICENSE |
| window-vibrancy | 0.8.1 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri-plugin-vibrancy | LICENSE-APACHE、LICENSE-MIT、LICENSE.spdx |
| windows | 0.62.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | license-apache-2.0、license-mit |
| windows-collections | 0.3.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | license-apache-2.0、license-mit |
| windows-core | 0.62.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | license-apache-2.0、license-mit |
| windows-future | 0.3.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | license-apache-2.0、license-mit |
| windows-implement | 0.60.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | license-apache-2.0、license-mit |
| windows-interface | 0.59.3 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | license-apache-2.0、license-mit |
| windows-link | 0.2.1 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | license-apache-2.0、license-mit |
| windows-numerics | 0.3.1 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | license-apache-2.0、license-mit |
| windows-result | 0.4.1 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | license-apache-2.0、license-mit |
| windows-strings | 0.5.1 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | license-apache-2.0、license-mit |
| windows-sys | 0.61.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | license-apache-2.0、license-mit |
| windows-threading | 0.2.1 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | license-apache-2.0、license-mit |
| windows-version | 0.1.7 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | license-apache-2.0、license-mit |
| winnow | 1.0.4 | MIT | https://github.com/winnow-rs/winnow | LICENSE-MIT |
| writeable | 0.6.4 | Unicode-3.0 | https://github.com/unicode-org/icu4x | LICENSE |
| wry | 0.57.1 | Apache-2.0 OR MIT | https://github.com/tauri-apps/wry | LICENSE-APACHE、LICENSE-MIT、LICENSE.spdx |
| yoke | 0.8.4 | Unicode-3.0 | https://github.com/unicode-org/icu4x | LICENSE |
| yoke-derive | 0.8.4 | Unicode-3.0 | https://github.com/unicode-org/icu4x | LICENSE |
| zerofrom | 0.1.8 | Unicode-3.0 | https://github.com/unicode-org/icu4x | LICENSE |
| zerofrom-derive | 0.1.8 | Unicode-3.0 | https://github.com/unicode-org/icu4x | LICENSE |
| zerotrie | 0.2.5 | Unicode-3.0 | https://github.com/unicode-org/icu4x | LICENSE |
| zerovec | 0.11.9 | Unicode-3.0 | https://github.com/unicode-org/icu4x | LICENSE |
| zerovec-derive | 0.11.7 | Unicode-3.0 | https://github.com/unicode-org/icu4x | LICENSE |
| zlib-rs | 0.6.8 | Zlib | https://github.com/trifectatechfoundation/zlib-rs | LICENSE |
| zmij | 1.0.23 | MIT | https://github.com/dtolnay/zmij | LICENSE-MIT |
