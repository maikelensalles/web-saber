// ============================================================
// WebSaber - Tracking de mãos + Game Loop (blocos, sabres, colisão)
// ============================================================

const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output');
const canvasCtx = canvasElement.getContext('2d');
const vrToggleButton = document.getElementById('vr-toggle');

const CYAN = '#00e5ff';
const MAGENTA = '#ff0057';

// ------------------------------------------------------------
// Modo VR / Espacial
// ------------------------------------------------------------

let isVRMode = false;

vrToggleButton.addEventListener('click', () => {
  isVRMode = !isVRMode;
  vrToggleButton.textContent = isVRMode ? 'Desativar Modo VR' : 'Ativar Modo VR';
  vrToggleButton.classList.toggle('active', isVRMode);
});

// Índices de landmarks da mão usados para orientar o sabre
// (https://developers.google.com/mediapipe/solutions/vision/hand_landmarker)
const WRIST = 0;
const MIDDLE_FINGER_MCP = 9; // nó da base do dedo médio, não a ponta

// Pares ponta/PIP usados para detectar punho fechado (indicador, médio, anelar, mindinho)
const FINGER_TIPS = [8, 12, 16, 20];
const FINGER_PIPS = [6, 10, 14, 18];

const SABER_LENGTH = 260; // comprimento fixo da lâmina em pixels

// Landmarks usados para achar o centro do punho fechado (wrist + as 4 MCPs)
const GRIP_LANDMARKS = [0, 5, 9, 13, 17];

const HILT_LENGTH = 35; // comprimento do cabo/hilt em pixels
const HILT_COLOR = '#3a3a3a'; // cinza-metálico escuro, sem glow
const HILT_BASE_WIDTH = 10;
const BLADE_HALO_BASE_WIDTH = 14;
const BLADE_CORE_BASE_WIDTH = 5;

// Distância (em px) entre wrist e middle-MCP considerada "tamanho normal"
// de mão a uma distância confortável da webcam - usada para escalar a
// espessura do sabre conforme a mão fica maior/menor na tela.
const REFERENCE_HAND_SIZE_PX = 120;
const MIN_SABER_SCALE = 0.6;
const MAX_SABER_SCALE = 1.8;

// Estado mais recente de mãos detectadas, atualizado por onResults()
// e consumido pelo game loop. Cada item: { landmarks (espelhados), color, isFist }.
let latestHands = [];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Um dedo é considerado "fechado" quando sua ponta está mais perto do
 * pulso do que sua articulação intermediária (PIP) — ao dobrar o dedo
 * em direção à palma, a ponta "volta" na direção do pulso. A mão é
 * considerada punho fechado quando isso vale para a maioria dos 4
 * dedos (indicador, médio, anelar, mindinho).
 */
function isFist(landmarks) {
  const wrist = landmarks[WRIST];
  let closedFingers = 0;

  for (let i = 0; i < FINGER_TIPS.length; i++) {
    const tip = landmarks[FINGER_TIPS[i]];
    const pip = landmarks[FINGER_PIPS[i]];
    const tipDistance = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
    const pipDistance = Math.hypot(pip.x - wrist.x, pip.y - wrist.y);
    if (tipDistance < pipDistance) {
      closedFingers++;
    }
  }

  return closedFingers >= 3;
}

// ------------------------------------------------------------
// Blocos (com profundidade Z, efeito de estrada/túnel)
// ------------------------------------------------------------

const BLOCK_SIZE = 70;
const BLOCK_SPAWN_INTERVAL_MS = 1200;
const Z_FAR = 1000; // onde o bloco nasce (longe)
const Z_SPEED = 450; // unidades de z removidas por segundo
const FOCAL_LENGTH = 400; // controla a "força" da perspectiva (300-600 costuma ficar bem)

class Block {
  constructor() {
    this.z = Z_FAR;
    // Posição normalizada (0-1) para onde o bloco vai quando chega perto do jogador
    this.targetX = 0.15 + Math.random() * 0.7;
    this.targetY = 0.4 + Math.random() * 0.45;
    this.color = Math.random() < 0.5 ? CYAN : MAGENTA;

    // Recalculados a cada update() via projeção em perspectiva
    this.screenX = 0;
    this.screenY = 0;
    this.screenSize = 0;
  }

  update(deltaSeconds, canvasWidth, canvasHeight) {
    this.z -= Z_SPEED * deltaSeconds;

    const scale = FOCAL_LENGTH / (FOCAL_LENGTH + this.z);
    const vanishingX = canvasWidth / 2;
    const vanishingY = 0;

    this.screenX = lerp(vanishingX, this.targetX * canvasWidth, scale);
    this.screenY = lerp(vanishingY, this.targetY * canvasHeight, scale);
    this.screenSize = BLOCK_SIZE * scale;
  }

  get bounds() {
    const half = this.screenSize / 2;
    return { x: this.screenX - half, y: this.screenY - half, w: this.screenSize, h: this.screenSize };
  }

  get centerX() {
    return this.screenX;
  }

  get centerY() {
    return this.screenY;
  }

  get isLost() {
    return this.z <= 0;
  }

  draw(ctx) {
    const half = this.screenSize / 2;
    const left = this.screenX - half;
    const top = this.screenY - half;

    ctx.save();

    // Halo neon (glow externo)
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 25;
    ctx.fillStyle = this.color;
    ctx.fillRect(left, top, this.screenSize, this.screenSize);

    // Núcleo mais claro por cima, sem blur, para dar nitidez
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    const inset = this.screenSize * 0.2;
    ctx.fillRect(left + inset, top + inset, this.screenSize - inset * 2, this.screenSize - inset * 2);

    ctx.restore();
  }
}

class BlockManager {
  constructor() {
    this.blocks = [];
    this.timeSinceLastSpawnMs = 0;
  }

  update(deltaSeconds, canvasWidth, canvasHeight) {
    this.timeSinceLastSpawnMs += deltaSeconds * 1000;
    if (this.timeSinceLastSpawnMs >= BLOCK_SPAWN_INTERVAL_MS) {
      this.timeSinceLastSpawnMs = 0;
      this.blocks.push(new Block());
    }

    for (const block of this.blocks) {
      block.update(deltaSeconds, canvasWidth, canvasHeight);
    }

    // Remove blocos cortados (removidos externamente) e os perdidos (z <= 0)
    this.blocks = this.blocks.filter((block) => !block.isLost);
  }

  draw(ctx) {
    for (const block of this.blocks) {
      block.draw(ctx);
    }
  }

  remove(block) {
    const index = this.blocks.indexOf(block);
    if (index !== -1) {
      this.blocks.splice(index, 1);
    }
  }
}

// ------------------------------------------------------------
// Partículas (efeito de quebra)
// ------------------------------------------------------------

const PARTICLE_COUNT_PER_HIT = 14;
const PARTICLE_LIFETIME = 0.5; // segundos

class Particle {
  constructor(x, y, color) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 80 + Math.random() * 180;
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.size = 3 + Math.random() * 4;
    this.color = color;
    this.life = PARTICLE_LIFETIME;
  }

  update(deltaSeconds) {
    this.x += this.vx * deltaSeconds;
    this.y += this.vy * deltaSeconds;
    this.life -= deltaSeconds;
  }

  get dead() {
    return this.life <= 0;
  }

  draw(ctx) {
    const alpha = Math.max(this.life / PARTICLE_LIFETIME, 0);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);
    ctx.restore();
  }
}

class ParticleManager {
  constructor() {
    this.particles = [];
  }

  spawnBurst(x, y, color) {
    for (let i = 0; i < PARTICLE_COUNT_PER_HIT; i++) {
      this.particles.push(new Particle(x, y, color));
    }
  }

  update(deltaSeconds) {
    for (const particle of this.particles) {
      particle.update(deltaSeconds);
    }
    this.particles = this.particles.filter((particle) => !particle.dead);
  }

  draw(ctx) {
    for (const particle of this.particles) {
      particle.draw(ctx);
    }
  }
}

const blockManager = new BlockManager();
const particleManager = new ParticleManager();

// ------------------------------------------------------------
// Fundo warp speed (hiperespaço) - usado só no Modo VR
// ------------------------------------------------------------

const SPACE_BACKGROUND_COLOR = '#050510';
const STAR_COUNT = 400;
const STAR_MAX_DEPTH = 600; // "z" de nascimento/renascimento (longe)
const WARP_SPEED = 300; // unidades de z removidas por segundo
const STARFIELD_FOCAL_LENGTH = 300;

class Star {
  constructor(canvasWidth, canvasHeight) {
    this.respawn(canvasWidth, canvasHeight);
    // Espalha as estrelas em profundidades variadas no início, para não
    // nascerem todas juntas no centro no primeiro frame.
    this.z = Math.random() * STAR_MAX_DEPTH;
    const projected = this.project(canvasWidth, canvasHeight);
    this.screenX = projected.x;
    this.screenY = projected.y;
    this.prevScreenX = projected.x;
    this.prevScreenY = projected.y;
  }

  respawn(canvasWidth, canvasHeight) {
    this.x = (Math.random() * 2 - 1) * canvasWidth;
    this.y = (Math.random() * 2 - 1) * canvasHeight;
    this.z = STAR_MAX_DEPTH;
  }

  project(canvasWidth, canvasHeight) {
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    return {
      x: cx + (this.x / this.z) * STARFIELD_FOCAL_LENGTH,
      y: cy + (this.y / this.z) * STARFIELD_FOCAL_LENGTH,
    };
  }

  update(deltaSeconds, canvasWidth, canvasHeight) {
    this.prevScreenX = this.screenX;
    this.prevScreenY = this.screenY;

    this.z -= WARP_SPEED * deltaSeconds;

    if (this.z <= 1) {
      this.respawn(canvasWidth, canvasHeight);
      const projected = this.project(canvasWidth, canvasHeight);
      this.screenX = projected.x;
      this.screenY = projected.y;
      // Evita uma linha gigante de "teleporte" no frame do renascimento
      this.prevScreenX = projected.x;
      this.prevScreenY = projected.y;
      return;
    }

    const projected = this.project(canvasWidth, canvasHeight);
    this.screenX = projected.x;
    this.screenY = projected.y;
  }

  draw(ctx) {
    const proximity = 1 - this.z / STAR_MAX_DEPTH; // 0 (longe) -> 1 (perto)
    ctx.beginPath();
    ctx.moveTo(this.prevScreenX, this.prevScreenY);
    ctx.lineTo(this.screenX, this.screenY);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + proximity * 0.7})`;
    ctx.lineWidth = 1 + proximity * 2;
    ctx.stroke();
  }
}

class WarpStarField {
  constructor() {
    this.stars = [];
  }

  ensureStars(canvasWidth, canvasHeight) {
    while (this.stars.length < STAR_COUNT) {
      this.stars.push(new Star(canvasWidth, canvasHeight));
    }
  }

  update(deltaSeconds, canvasWidth, canvasHeight) {
    this.ensureStars(canvasWidth, canvasHeight);
    for (const star of this.stars) {
      star.update(deltaSeconds, canvasWidth, canvasHeight);
    }
  }

  draw(ctx) {
    for (const star of this.stars) {
      star.draw(ctx);
    }
  }
}

const warpStarField = new WarpStarField();

// ------------------------------------------------------------
// Colisão: segmento de reta (sabre) x AABB (bloco)
// Algoritmo de Liang-Barsky: clipping de segmento contra retângulo,
// O(1), sem laços sobre pixels - ideal para rodar a cada frame.
// ------------------------------------------------------------

function lineIntersectsAABB(x1, y1, x2, y2, box) {
  const minX = box.x;
  const maxX = box.x + box.w;
  const minY = box.y;
  const maxY = box.y + box.h;

  const dx = x2 - x1;
  const dy = y2 - y1;

  let tMin = 0;
  let tMax = 1;

  const edges = [
    [-dx, x1 - minX],
    [dx, maxX - x1],
    [-dy, y1 - minY],
    [dy, maxY - y1],
  ];

  for (const [p, q] of edges) {
    if (p === 0) {
      // Segmento paralelo a este lado: se já está fora, nunca intersecta
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > tMax) return false;
        if (r > tMin) tMin = r;
      } else {
        if (r < tMin) return false;
        if (r < tMax) tMax = r;
      }
    }
  }

  return true;
}

// ------------------------------------------------------------
// Mãos: esqueleto + sabre
// ------------------------------------------------------------

/**
 * Calcula o segmento completo do sabre (cabo + lâmina) a partir dos
 * landmarks já espelhados de uma mão.
 *
 * Origem: em vez do WRIST isolado, usamos o centro do punho fechado -
 * a média do wrist com as 4 articulações MCP (5, 9, 13, 17). Isso cai
 * bem mais próximo de onde um objeto realmente ficaria segurado na mão
 * do que a base isolada da mão.
 *
 * Direção: continua vindo do vetor wrist(0) -> middleMcp(9), porque
 * esse nó quase não se move quando os dedos flexionam - mantém a
 * inclinação do sabre estável tanto com a mão aberta quanto fechada.
 *
 * A lâmina nasce onde o cabo termina (hiltEnd), não no centro do
 * punho. A espessura (scale) é derivada do tamanho aparente da mão na
 * tela (distância wrist -> middleMcp em pixels): mão maior/mais perto
 * da câmera = sabre mais grosso.
 */
function getSaberSegment(landmarks, canvasWidth, canvasHeight) {
  const wrist = landmarks[WRIST];
  const middleMcp = landmarks[MIDDLE_FINGER_MCP];

  const wristX = wrist.x * canvasWidth;
  const wristY = wrist.y * canvasHeight;
  const mcpX = middleMcp.x * canvasWidth;
  const mcpY = middleMcp.y * canvasHeight;

  let dirX = mcpX - wristX;
  let dirY = mcpY - wristY;
  const handSizePx = Math.hypot(dirX, dirY) || 1;
  dirX /= handSizePx;
  dirY /= handSizePx;

  let gripX = 0;
  let gripY = 0;
  for (const index of GRIP_LANDMARKS) {
    gripX += landmarks[index].x * canvasWidth;
    gripY += landmarks[index].y * canvasHeight;
  }
  gripX /= GRIP_LANDMARKS.length;
  gripY /= GRIP_LANDMARKS.length;

  const hiltEndX = gripX + dirX * HILT_LENGTH;
  const hiltEndY = gripY + dirY * HILT_LENGTH;

  const bladeEndX = hiltEndX + dirX * SABER_LENGTH;
  const bladeEndY = hiltEndY + dirY * SABER_LENGTH;

  const scale = Math.min(
    Math.max(handSizePx / REFERENCE_HAND_SIZE_PX, MIN_SABER_SCALE),
    MAX_SABER_SCALE
  );

  return {
    gripX,
    gripY,
    hiltEndX,
    hiltEndY,
    bladeEndX,
    bladeEndY,
    scale,
    // Segmento da lâmina, usado pela colisão (o cabo não corta nada)
    x1: hiltEndX,
    y1: hiltEndY,
    x2: bladeEndX,
    y2: bladeEndY,
  };
}

function drawSaberLine(ctx, segment, color) {
  ctx.save();
  ctx.lineCap = 'round';

  // Cabo/hilt: sólido, cinza-metálico, sem shadowBlur (sem glow)
  ctx.beginPath();
  ctx.moveTo(segment.gripX, segment.gripY);
  ctx.lineTo(segment.hiltEndX, segment.hiltEndY);
  ctx.strokeStyle = HILT_COLOR;
  ctx.shadowBlur = 0;
  ctx.lineWidth = HILT_BASE_WIDTH * segment.scale;
  ctx.stroke();

  // Lâmina - halo neon grosso
  ctx.beginPath();
  ctx.moveTo(segment.hiltEndX, segment.hiltEndY);
  ctx.lineTo(segment.bladeEndX, segment.bladeEndY);
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 35;
  ctx.lineWidth = BLADE_HALO_BASE_WIDTH * segment.scale;
  ctx.stroke();

  // Lâmina - núcleo branco brilhante, mais fino e sem blur
  ctx.beginPath();
  ctx.moveTo(segment.hiltEndX, segment.hiltEndY);
  ctx.lineTo(segment.bladeEndX, segment.bladeEndY);
  ctx.strokeStyle = '#ffffff';
  ctx.shadowBlur = 0;
  ctx.lineWidth = BLADE_CORE_BASE_WIDTH * segment.scale;
  ctx.stroke();

  ctx.restore();
}

/**
 * Desenha o esqueleto de cada mão (modo AR: sempre, como feedback de
 * tracking; modo VR: nunca, para mostrar só os sabres flutuando) e o
 * sabre apenas quando a mão estiver em punho fechado. Retorna a lista
 * de segmentos de sabre (só das mãos fechadas), para reuso na colisão
 * sem recomputar nada.
 */
function drawHandsAndGetSabers(ctx, canvasWidth, canvasHeight) {
  const sabers = [];

  for (const hand of latestHands) {
    if (!isVRMode) {
      drawConnectors(ctx, hand.landmarks, HAND_CONNECTIONS, {
        color: '#ffffff',
        lineWidth: 2,
      });
      drawLandmarks(ctx, hand.landmarks, {
        color: '#ffffff',
        radius: 3,
      });
    }

    if (!hand.isFist) {
      continue;
    }

    const segment = getSaberSegment(hand.landmarks, canvasWidth, canvasHeight);
    drawSaberLine(ctx, segment, hand.color);

    sabers.push({ ...segment, color: hand.color });
  }

  return sabers;
}

// ------------------------------------------------------------
// Colisão sabre x bloco: remove bloco acertado e gera partículas
// ------------------------------------------------------------

function resolveSaberBlockCollisions(sabers) {
  for (const block of [...blockManager.blocks]) {
    const wasHit = sabers.some(
      (saber) =>
        saber.color === block.color &&
        lineIntersectsAABB(saber.x1, saber.y1, saber.x2, saber.y2, block.bounds)
    );

    if (wasHit) {
      particleManager.spawnBurst(block.centerX, block.centerY, block.color);
      blockManager.remove(block);
    }
  }
}

// ------------------------------------------------------------
// MediaPipe: callback de resultados (apenas atualiza estado)
// ------------------------------------------------------------

function onResults(results) {
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    latestHands = [];
    return;
  }

  // O vídeo é exibido espelhado (CSS scaleX(-1)), mas os landmarks vêm
  // calculados sobre o frame "cru" (não espelhado). Em vez de aplicar
  // uma transformação no contexto do canvas na hora de desenhar,
  // espelhamos os próprios landmarks aqui (x: 1 - x). Assim todo o
  // desenho do jogo (mãos, sabres, blocos, partículas) acontece no
  // mesmo espaço de coordenadas normal do canvas.
  latestHands = results.multiHandLandmarks.map((landmarks, index) => {
    const handedness = results.multiHandedness[index];
    const color = handedness && handedness.label === 'Left' ? CYAN : MAGENTA;
    const mirrored = landmarks.map((lm) => ({ x: 1 - lm.x, y: lm.y }));
    return { landmarks: mirrored, color, isFist: isFist(landmarks) };
  });
}

// ------------------------------------------------------------
// Game loop principal (requestAnimationFrame)
// ------------------------------------------------------------

let lastTimestamp = null;

function gameLoop(timestamp) {
  if (lastTimestamp === null) {
    lastTimestamp = timestamp;
  }
  // Clampa o delta para evitar saltos grandes (ex.: aba em segundo plano)
  const deltaSeconds = Math.min((timestamp - lastTimestamp) / 1000, 0.05);
  lastTimestamp = timestamp;

  const canvasWidth = canvasElement.width;
  const canvasHeight = canvasElement.height;

  canvasCtx.clearRect(0, 0, canvasWidth, canvasHeight);

  if (isVRMode) {
    canvasCtx.fillStyle = SPACE_BACKGROUND_COLOR;
    canvasCtx.fillRect(0, 0, canvasWidth, canvasHeight);
    warpStarField.update(deltaSeconds, canvasWidth, canvasHeight);
    warpStarField.draw(canvasCtx);
  }

  blockManager.update(deltaSeconds, canvasWidth, canvasHeight);
  blockManager.draw(canvasCtx);

  const sabers = drawHandsAndGetSabers(canvasCtx, canvasWidth, canvasHeight);
  resolveSaberBlockCollisions(sabers);

  particleManager.update(deltaSeconds);
  particleManager.draw(canvasCtx);

  requestAnimationFrame(gameLoop);
}

// ------------------------------------------------------------
// Setup de câmera e inicialização
// ------------------------------------------------------------

async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720 },
    audio: false,
  });

  videoElement.srcObject = stream;

  await new Promise((resolve) => {
    videoElement.onloadedmetadata = () => {
      canvasElement.width = videoElement.videoWidth;
      canvasElement.height = videoElement.videoHeight;
      resolve();
    };
  });
}

async function main() {
  await setupCamera();

  const hands = new Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.5,
  });

  hands.onResults(onResults);

  const camera = new Camera(videoElement, {
    onFrame: async () => {
      await hands.send({ image: videoElement });
    },
    width: 1280,
    height: 720,
  });

  camera.start();

  requestAnimationFrame(gameLoop);
}

main().catch((err) => {
  console.error('Erro ao iniciar o WebSaber:', err);
  alert('Não foi possível acessar a câmera. Verifique as permissões do navegador.');
});
