# 🎮 GameRetroProject

Uma **PWA estática estilo Netflix** para jogar clássicos do Atari, NES, SNES, Mega Drive, Master System e Game Boy diretamente no navegador — usando **EmulatorJS (WebAssembly)**.

Sem backend. Sem build. Sem instalação. Só abrir e jogar.

---

## ✨ Funcionalidades

- 🎬 Interface inspirada na Netflix (Hero rotativo + carrosséis horizontais)
- 🕹️ Emulação no navegador via **EmulatorJS** (WebAssembly)
- 💾 **Saves persistentes** dos jogos em IndexedDB (battery saves / SRAM)
- ⭐ Favoritos e histórico "Continue de Onde Parou" em LocalStorage
- 🔍 Busca em tempo real (título, console, gênero, tags, desenvolvedora)
- 📱 **PWA instalável** (manifest + Service Worker com cache offline)
- 🌐 Suporte a 6 consoles: Atari 2600, NES, SNES, Mega Drive, Master System, Game Boy / GBC

---

## 🚀 Como rodar localmente

Módulos ES6 exigem um servidor HTTP (não funciona abrindo `index.html` direto).

```bash
# Python
python -m http.server 8000

# Node
npx serve .

# Ou use a extensão Live Server do VS Code