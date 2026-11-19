# Código-fonte do StremCompat

<p align="center">
  <img src="docs/assets/stremcompat-hero-en.png" alt="Tela inicial do StremCompat" width="1200">
</p>

<p align="center"><a href="README.md">English</a> · <b>Português</b></p>

O StremCompat leva sua conta e seus addons do **Stremio ou do Nuvio** para as TVs que os apps oficiais deixaram de lado. Este repositório tem o código-fonte da versão web e do servidor local que as duas versões usam. É um projeto independente e não oficial, sem ligação com Stremio, Nuvio, LG, Samsung ou Google.

> **Quer instalar?** Escolha sua TV. Cada página tem os downloads, o passo a passo de instalação, as capturas de tela e as tabelas de compatibilidade.
>
> | TV | Página |
> |---|---|
> | **LG** (webOS 3 ou mais novo) | [StremCompat/webos](https://github.com/StremCompat/webos/blob/main/README.pt.md) |
> | **Samsung** (Tizen 4 ou mais novo) | [StremCompat/samsung](https://github.com/StremCompat/samsung/blob/main/README.pt.md) |
> | **Android TV / Google TV** (7.0 ou mais novo) | [StremCompat/android-tv](https://github.com/StremCompat/android-tv/blob/main/README.pt.md) |
>
> Este repositório antes se chamava `Alexesmm/stremcompat-lg-webos`. Os links antigos continuam funcionando, e os endereços do Homebrew da LG continuam atualizando o app sem perder seus dados.

## As duas versões

| | **StremCompat** (estável) | **StremCompat Native** (beta, ainda não estável) |
|---|---|---|
| Interface | Uma página web (ES5, roda no Chromium 38), em [`src/ui`](src/ui) | C com SDL2 e OpenGL ES, em [StremCompat/native](https://github.com/StremCompat/native) |
| Servidor | O [`service`](service) deste repositório, usado pelas duas | O mesmo |

A maior parte da lógica do app (fileiras do Início, contas, biblioteca, catálogos) fica nos módulos de dados compartilhados em [`src/ui/data`](src/ui/data). A interface web usa esses módulos diretamente. O servidor roda os mesmos módulos e os entrega à versão Native como uma API JSON em `/app`, então as duas versões se comportam igual.

## Organização do repositório

| Pasta | O que tem nela |
|---|---|
| [`src/ui`](src/ui) | Interface web: telas, módulos de dados, estilos e textos |
| [`src/player`](src/player) | Player web: controles, legendas, fontes e progresso |
| [`service`](service) | Servidor Node local: ponte de addons, proxy, torrents, legendas, canais, loja, API `/app` |
| [`platforms`](platforms), [`app`](app) | Empacotamento para LG e Samsung |
| [`android`](android) | App de Android TV (dois sabores: `web` e `native`) |
| [`profiles`](profiles) | Um perfil de build por pacote (ID, versão, porta, resolução) |
| [`scripts`](scripts) | Builds, empacotamento e testes |
| [`docs`](docs) | [Notas técnicas](docs/TECHNICAL.md), notas de versão e imagens |

## Compilar

Requisitos: Node 20 ou mais novo e PowerShell no Windows. Rode `npm ci` e depois `npm run runtime` para baixar os programas ARM (Node, FFmpeg).

| Pacote | Comando |
|---|---|
| LG, 1080p e 720p | `npm run package` e `npm run package:720` |
| LG Native | compile o [StremCompat/native](https://github.com/StremCompat/native) (`./build.sh webos`) e depois `powershell scripts/build.ps1 -Profile lg-native` |
| Samsung | `npm run package:tizen` (`-Target tizen-native` para a versão Native) |
| Android TV | `npm run package:android` (precisa do Android SDK e do NDK; veja [android/README.md](android/README.md)) |

## Testes

- `npm test` roda os testes da interface, do player, do servidor e do Chromium 38.
- `npm run test:visual:layouts` confere o layout em 720p e 1080p no Chrome headless.
- `npx eslint .` roda o linter.

Os testes rodam em modo headless. Nada abre na tela.

## Como contribuir

Dúvidas e ideias vão para [Discussions](https://github.com/StremCompat/webos/discussions), bugs que dá para reproduzir vão para as Issues da página da sua TV. Veja o [CONTRIBUTING.md](CONTRIBUTING.md).

Se o StremCompat foi útil para você, você pode me [pagar um café ☕](https://buymeacoffee.com/Alexesmm), totalmente opcional. Uma estrela no GitHub também ajuda.

Licenciado sob a [GPL-3.0](LICENSE). Os avisos de terceiros estão em [THIRD_PARTY.md](THIRD_PARTY.md) e [NOTICE.md](NOTICE.md).
