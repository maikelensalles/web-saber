# ⚔️ WebSaber

Um web game estilo *Beat Saber* que roda direto no navegador, usando a webcam para capturar os movimentos do jogador em tempo real. Construído com foco em alta performance, sem frameworks pesados.

🎮 **Jogue online:** [https://web-saber.web.app](https://web-saber.web.app)

👩🏽‍💻 **Desenvolvido por:** Maikelen Salles

---

## 📖 Sobre o Projeto

O WebSaber transforma sua webcam em um controle de movimento: feche o punho para empunhar um sabre de luz neon e corte blocos coloridos que vêm em sua direção. O jogo conta com:

- 🖐️ **Rastreamento de mãos em tempo real**, via MediaPipe Hands
- ⚔️ **Sabres de luz** com cabo físico e lâmina neon, ancorados ao punho e com espessura proporcional à distância da câmera
- 🧊 **Blocos com profundidade Z**, se aproximando em perspectiva como numa estrada/túnel
- 💥 **Física de colisão** sabre × bloco por cor, com efeito de partículas ao acertar
- 🌌 **Modo VR/Espacial**, substituindo o vídeo por um fundo de hiperespaço em *warp speed*

## 🛠️ Tecnologias Usadas

- **HTML5** & **CSS3**
- **JavaScript puro (Vanilla JS)** — sem frameworks, focado em performance
- **Canvas 2D API** — toda a renderização do jogo
- **[MediaPipe Hands](https://developers.google.com/mediapipe)** — detecção e rastreamento de mãos via webcam

## 🚀 Como rodar localmente

Como o acesso à webcam exige um contexto seguro, é necessário servir os arquivos por um servidor local simples. Exemplo:

```bash
python3 -m http.server 8000
```

Depois, abra [http://localhost:8000](http://localhost:8000) no navegador e autorize o acesso à câmera.
