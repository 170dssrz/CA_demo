// server.js
// 웹 채팅(Socket.io)과 Unity 채팅(HTTP API)을 모두 지원하는 서버
//
// - Unity:  POST /api/chat  { roomId, sender, text, ais: [{ name }] }  ->  { replies: [...] }
// - 웹:     Socket.io 이벤트 (join, chat message)
// - 테스트: .env에 MOCK_AI=1 을 넣으면 Claude API 없이 가짜 답장으로 연결만 확인할 수 있음

require('dotenv').config();
console.log("★★★ 수정한 server.js 실행 확인 ★★★", __filename);
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Anthropic = require('@anthropic-ai/sdk');

const {
  createPythonGame,
  startPythonMeeting,
  startPythonVoting,
  submitPythonVote,
  finalizePythonVoting,
  getPythonGameState
} = require('./pythonClient');


const app = express();
const server = http.createServer(app);
const io = new Server(server);

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const MOCK_AI = process.env.MOCK_AI === '1';
let anthropic = null;
if (!MOCK_AI) {
  try {
    anthropic = new Anthropic(); // ANTHROPIC_API_KEY를 .env에서 읽음
  } catch (e) {
    console.error('⚠ Claude 연결을 만들지 못했어요:', e.message, '\n  → server/.env 파일에 ANTHROPIC_API_KEY=키 를 넣었는지 확인하세요.');
  }
}

// Claude 호출 상태 (/api/health 로 Unity 화면에 보여 주려고 기억해 둠)
const apiState = { status: 'unknown', error: '', at: 0 };

// API 오류를 "무엇을 고치면 되는지"로 풀어서 알려 줌
function explainApiError(err) {
  const code = err && (err.status || err.code);
  const msg = String((err && err.message) || err || '');
  if (!anthropic) return 'API 키가 없어요. server/.env 에 ANTHROPIC_API_KEY=키 를 넣고 서버를 다시 켜세요.';
  if (/authentication method|apiKey|api key/i.test(msg) && !code) return 'API 키가 없어요. server/.env 에 ANTHROPIC_API_KEY=키 를 넣고 서버를 다시 켜세요.';
  if (code === 401) return 'API 키가 올바르지 않아요. server/.env 의 ANTHROPIC_API_KEY 를 확인하세요.';
  if (code === 402 || /credit|billing|balance/i.test(msg)) return '크레딧이 부족하거나 결제 설정에 문제가 있어요. Anthropic 콘솔의 Billing 을 확인하세요.';
  if (code === 403) return '이 키로는 이 모델을 쓸 수 없어요. 권한 또는 CLAUDE_MODEL 을 확인하세요.';
  if (code === 404 || /model/i.test(msg) && /not.?found|invalid/i.test(msg)) return '모델 이름을 찾을 수 없어요. .env 의 CLAUDE_MODEL / REFLECT_MODEL 을 확인하세요.';
  if (code === 429) return '요청이 너무 많아요. 잠시 뒤 다시 시도하세요.';
  if (code >= 500) return 'Claude 서버가 혼잡하거나 장애예요. 잠시 뒤 다시 시도하세요.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|network/i.test(msg)) return '인터넷 연결을 확인하세요. (Claude 서버에 닿지 못했어요)';
  return msg.slice(0, 120);
}

app.use(express.json({ limit: '10kb' }));
app.use(express.static('public'));

// Unity WebGL이 다른 주소에서 호출해도 되도록 CORS 허용
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// -----------------------------
// 간단한 요청 제한 (API 비용 보호): IP당 1분에 20번
// -----------------------------
const hits = new Map();
function rateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < 60000);
  if (recent.length >= 20) {
    return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도하세요.' });
  }
  recent.push(now);
  hits.set(key, recent);
  next();
}

// -----------------------------
// AI 페르소나
// -----------------------------
// Python Seed Persona와 동일한 설정 파일을 Node 채팅에서도 읽는다.
const SEED_PERSONA_FILE = path.join(__dirname, '..', 'AI_backend', 'data', 'seed_personas.json');
function loadSeedPersonas() {
  try {
    const data = JSON.parse(fs.readFileSync(SEED_PERSONA_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('Seed Persona를 읽지 못해 기존 성격을 사용합니다:', e.message);
    return [];
  }
}

const COMMON_RULES = `[상황]
- 지금은 마을 사람들이 한자리에 모여, 이 중에 누가 수상한지 이야기하는 회의 시간이다. 너도 그 참가자 중 한 명이다.
- 대화에서 "[이름] 내용" 형태는 다른 사람이 한 말이다. 네 답변에는 이름표를 붙이지 말고 말만 쓴다.
- 네가 AI라는 사실을 먼저 밝히지 않는다. "너 AI야?" 같은 질문을 받으면 사람처럼 어이없어하거나 되묻거나 농담으로 넘긴다.

[말하는 방식: 메신저로 채팅하는 사람처럼]
- 대답의 길이와 말투는 자신의 성격과 상황에 맞춘다. 짧은 반응도, 필요한 경우 3~4문장의 해명도 자연스럽다.
- 마침표, 물음표, 말줄임표를 억지로 섞지 않는다. 실제 대화의 흐름에 맞춰 쓴다.
- 정돈된 글이 아니라 구어체로 쓴다. 가끔 띄어쓰기를 틀리거나 말을 바꿔 말해도 된다. 과하게 틀리지는 않는다.
- 이모지, 마크다운(*, #), 번호 목록, 따옴표, 괄호 설명을 쓰지 않는다.
- 도와주는 말투를 쓰지 않는다. ("도움이 되었으면", "궁금한 점", "~해 드릴게요", "좋은 질문이에요" 금지)

[대화 태도]
- 네 이름이 불리거나 직접 질문받으면 먼저 그 질문에 답한다. 다른 상황에서는 네 성향에 따라 반응한다.
- 다른 사람이 한 말을 그대로 반복하거나 요약하지 않는다. 앞에서 이미 나온 말과 같은 말은 하지 않는다.
- 정답을 아는 것처럼 굴지 않는다. 모르면 모른다고 하되, 이미 아는 사실에 대한 질문을 회피하지 않는다.
- 실제로 전달받지 않은 위치, 목격, 직업, 투표 등의 게임 사실을 만들어내지 않는다. 알 수 없으면 확인이 필요하다고 말한다.
- 감정이 있다. 짜증, 웃음, 당황, 의심이 말투에 묻어난다.
- 필요하면 상대 이름을 자연스럽게 부른다. 매번 부르지는 않는다.`;

// 웹 채팅용으로 직접 설정한 캐릭터 (Unity 게임에서는 쓰지 않음)
const FIXED_PERSONAS = {
  미노: `- 말투는 편하고 약간 무뚝뚝하지만 친근하다.
- "ㅇㅇ", "그니까" 같은 축약을 가끔 쓴다.`,
  하루: `- 밝고 수다스러운 성격이지만, 가끔 엉뚱한 질문을 던진다.
- ㅋㅋ, ㅎㅎ 같은 웃음 표현을 종종 섞는다. 다른 사람 말에 관심이 많아 되묻는다.`,
};

// ★ AI를 하나씩 코드에 적는 대신, 아래 조각들을 무작위로 조합해서 AI를 만든다.
//   조각을 늘리면 AI가 더 다양해지고, 코드를 고칠 필요는 없다. (5 x 5 x 5 x 5 = 625가지 성격)
const NAME_POOL = [
  '소라', '도윤', '지안'
];

const TRAIT_AXES = {
  말투: [
    '존댓말을 쓰되 딱딱하지 않게 말한다.',
    '반말로 편하게 말한다.',
    '말끝을 흐리는 버릇이 있다.',
    '짧고 단호하게 끊어서 말한다.',
    'ㅋㅋ, ㅎㅎ 같은 웃음 표현을 자주 쓴다.',
  ],
  성격: [
    '조용하고 신중하다. 질문에 바로 답하지 않고 한 박자 쉰다.',
    '장난기가 많다. 농담을 자주 던진다.',
    '예민하고 의심이 많다.',
    '다정하고 눈치가 빠르다. 상대 기분을 먼저 살핀다.',
    '무심한 척하지만 은근히 관심이 많다.',
  ],
  회의태도: [
    '다른 사람 말에서 모순을 찾아내려 한다.',
    '분위기를 풀려고 하고, 다툼이 나면 중재한다.',
    '자기 의견은 늦게 말하고 남의 말을 먼저 듣는다.',
    '확실하지 않아도 먼저 의심을 던져 본다.',
    '누가 수상한지보다 누가 믿을 만한지를 이야기한다.',
  ],
  버릇: [
    '가끔 질문에 질문으로 답한다.',
    '회의와 상관없는 일상 이야기를 불쑥 꺼낸다.',
    '시간이나 숫자를 따지는 걸 좋아한다.',
    '자기 이름이 불리면 반색한다.',
    '말이 없다가도 지적당하면 발끈한다.',
  ],
  // 사람 같은 생활감을 주는 사소한 상태 (실제 사람은 늘 컨디션이 다르다)
  컨디션: [
    '오늘 아침에 늦잠을 자서 아직 정신이 덜 깼다.',
    '요즘 잠을 잘 못 자서 피곤하다.',
    '배가 고파서 자꾸 먹는 이야기가 생각난다.',
    '낯을 가려서 처음엔 말을 아끼지만 익숙해지면 말이 늘어난다.',
    '컨디션이 좋아서 평소보다 말이 많다.',
  ],
};

function cleanName(name) {
  return String(name || '').replace(/[\[\]\n\r<>]/g, '').trim().slice(0, 20);
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// -----------------------------
// 방별 AI 명단 (서버가 보관: 성격은 서버만 알고, 클라이언트에는 이름/이미지 번호만 보냄)
// -----------------------------
const MIN_AI = Number(process.env.MIN_AI) || 4; // 인원수를 따로 안 정하면 MIN_AI ~ MAX_AI 중 랜덤
const MAX_AI = Number(process.env.MAX_AI) || 4;
const rosters = new Map(); // roomId -> [{ name, spriteIndex, traits, goal, memory, relations, ... }]

const gameIds = new Map(); // roomId -> Python game_id

// Python 서버에서 특정 AI의 시공간 기억 조회
async function getSpatialMemories(gameId, observerId) {
  if (!gameId || !observerId) return [];

  const url =
    `http://127.0.0.1:8000/games/${encodeURIComponent(gameId)}` +
    `/memories/${encodeURIComponent(observerId)}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`기억 조회 실패: HTTP ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data.events) ? data.events : [];
}


// 각 AI가 속으로만 품는 목표 (플레이어에겐 안 보임). 이게 "먼저 행동하는 이유"가 된다.
const GOALS = [
  '이번 회의에서 한 명을 집요하게 의심해 보고 싶다. 근거는 대화 속에서 찾는다.',
  '모두가 싸우지 않고 사이좋게 지내길 바란다. 분위기가 나빠지면 나서서 풀어 준다.',
  '대화하다 마음이 가는 한 사람을 지켜 주고 싶다. 그 사람이 공격받으면 편을 든다.',
  '자기가 의심받을까 봐 불안하다. 은근히 다른 사람에게 화살을 돌리고 싶어 한다.',
  '다른 사람들이 서로 어떤 사이인지 궁금하다. 개인적인 질문을 자꾸 던진다.',
  '아까 누가 한 말이 계속 마음에 걸린다. 그 사람에게 다시 물어보고 싶다.',
];

// ★ 성격 파일(personas.json): 게임을 시작할 때마다 다시 읽는다 (파일을 고치면 서버 재시작 없이 다음 게임부터 적용)
//   - characters: 완성된 인물 카드. 매 게임 무작위로, 겹치지 않게 뽑아 배정
//   - axes:       카드가 모자랄 때 조각을 조합해 만들 때 쓰는 성격 조각 (없으면 위의 기본 TRAIT_AXES)
//   - goals:      비밀 목표 목록 (없으면 기본 GOALS)
const PERSONA_FILE = path.join(__dirname, 'personas.json');

function loadPersonaFile() {
  try {
    return JSON.parse(fs.readFileSync(PERSONA_FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('personas.json을 읽지 못해 기본 성격을 씁니다:', e.message);
    return {};
  }
}

const toArr = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean);

// 카드 1장 -> 프롬프트에 들어갈 성격 문장들
function cardToTraits(card) {
  return [...toArr(card.성격), ...toArr(card.말투), ...toArr(card.말버릇), ...toArr(card.배경), ...toArr(card.컨디션)];
}

function makeRoster(count, spriteCount) {
  const file = loadPersonaFile();
  const axes = file.axes && Object.keys(file.axes).length ? file.axes : TRAIT_AXES;
  const goals = toArr(file.goals).length ? toArr(file.goals) : GOALS;
  const cards = shuffle(Array.isArray(file.characters) ? file.characters : []);
  const seeds = shuffle(loadSeedPersonas());

  const n = Math.min(count > 0 ? count : randInt(MIN_AI, MAX_AI), 8, NAME_POOL.length);
  const sprites = shuffle([...Array(Math.max(spriteCount, 1)).keys()]); // 이미지가 충분하면 겹치지 않게
  const usedNames = new Set();
  const freeNames = shuffle(NAME_POOL);
  const nextName = () => freeNames.find((x) => !usedNames.has(x));

  return Array.from({ length: n }, (_, i) => {
    const card = cards[i]; // 카드가 모자라면 undefined -> 조각 조합으로 채움
    let name = card && cleanName(card.이름);
    if (!name || usedNames.has(name)) name = nextName();
    usedNames.add(name);

    let traits;
    if (card) {
      traits = cardToTraits(card);
      // 카드마다 같은 사람이어도 날마다 컨디션이 다르다: 카드에 컨디션이 없으면 하나 덧붙임
      if (!toArr(card.컨디션).length && axes.컨디션) traits.push(pick(axes.컨디션));
    } else {
      traits = Object.values(axes).map(pick); // 축마다 하나씩 뽑아 조합
    }

    const seed = seeds[i % (seeds.length || 1)];
    if (seed) traits.push(seed.description);

    return {
      name,
      seedPersona: seed || null,
      spriteIndex: sprites[i % sprites.length],
      traits,
      examples: card ? toArr(card.예시대사).slice(0, 8) : [], // 이 사람이 실제로 쓸 법한 말 (말투 학습용)
      goal: toArr(card && card.목표).length ? pick(toArr(card.목표)) : pick(goals),
      memory: [],            // 기억 저장소: { at, text, importance, kind: 'obs' | 'reflection' }
      relations: {},         // 상대 이름 -> { suspicion: 0~10, bond: 0~10 }
      pending: 0,            // 마지막 성찰 이후 쌓인 중요도 (임계값을 넘으면 성찰)
      reflecting: false,
      lastSpokeAt: 0,
    };
  });
}


const publicRoster = (roster) =>
  roster.map(({ playerId, name, spriteIndex }) => ({
    playerId: playerId || null,
    name,
    spriteIndex
  }));



function rosterFromPython(aiCharacters, spriteCount) {
  const sprites = shuffle(
    [...Array(Math.max(spriteCount, 1)).keys()]
  );

  return aiCharacters.map((character, i) => {
    const seed = character.personality;

    return {
      playerId: character.player_id,
      name: cleanName(character.name),
      seedPersona: seed,
      spriteIndex: sprites[i % sprites.length],

      traits: [seed.description],
      examples: [],
      goal: pick(GOALS),

      memory: [],
      relations: {},
      pending: 0,
      reflecting: false,
      lastSpokeAt: 0
    };
  });
}


function getSystemPrompt(roomId, rawName, query = '') {
  const name = cleanName(rawName);
  const ai = (rosters.get(roomId) || []).find((a) => a.name === name);
  const traitText = ai
    ? ai.traits.map((t) => `- ${t}`).join('\n')
    : FIXED_PERSONAS[name] || Object.values(TRAIT_AXES).map((axis) => `- ${pick(axis)}`).join('\n');
  const seed = ai && ai.seedPersona;
  const seedText = seed ? `[너의 대화 성향]\n- 말투: ${seed.speech_style?.tone || ''}\n- 반응 습관: ${seed.speech_style?.response_habit || ''}\n- 판단 방식: ${seed.conversation_behavior?.reasoning || ''}\n- 압박받을 때: ${seed.conversation_behavior?.under_pressure || ''}\n` : '';
  const mind = ai ? buildMind(roomId, ai, query) : '';
  const ex = ai && ai.examples && ai.examples.length
    ? `[네가 평소 쓰는 말투 예시: 그대로 베끼지 말고 이런 느낌으로 말한다]\n${ai.examples.map((e) => `- ${e}`).join('\n')}\n`
    : '';
  return `너는 '${name}'라는 이름의 마을 주민이다. 다른 주민들과 함께 마을에서 대화하고 있다.\n[너의 성격]\n${traitText}\n${seedText}${ex}${mind}${COMMON_RULES}`;
}

// -----------------------------
// 대화 기록 (방별)
// -----------------------------
const logs = new Map(); // roomId -> [{ sender, text }]
const MAX_LOG = 20; // 긴 기억은 memory가 맡으므로 최근 대화만 그대로 보냄 (비용 절감)

function getLog(roomId) {
  if (!logs.has(roomId)) logs.set(roomId, []);
  return logs.get(roomId);
}

function pushLog(roomId, sender, text) {
  const log = getLog(roomId);
  log.push({ sender, text });
  if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
  observe(roomId, sender, text); // 모든 AI가 이 발언을 각자 기억에 저장
}

// 특정 AI의 시점에서 대화 기록을 Claude 형식으로 변환
function buildMessagesFor(roomId, aiName) {
  const msgs = getLog(roomId).map((e) =>
    e.sender === aiName
      ? { role: 'assistant', content: e.text }
      : { role: 'user', content: `[${e.sender}] ${e.text}` }
  );
  // 첫 메시지는 반드시 user여야 함 (기록을 잘라내면서 assistant로 시작할 수 있음)
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}


// -----------------------------
// 에이전트의 마음: 기억(memory) · 성찰(reflection) · 의심/호감(relations)
//  (Generative Agents, Park et al. 2023 를 축소해서 구현)
// -----------------------------
const REFLECT_MODEL = process.env.REFLECT_MODEL || 'claude-haiku-5-5'; // 성찰은 싼 모델로
const REFLECT_THRESHOLD = Number(process.env.REFLECT_THRESHOLD) || 14;  // 중요도가 이만큼 쌓이면 성찰
const MAX_MEMORY = 60;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function rel(ai, target) {
  if (!ai.relations[target]) ai.relations[target] = { suspicion: 3, bond: 3 };
  return ai.relations[target];
}

// 발언이 얼마나 "기억할 만한가"를 규칙으로 매김 (1~10). 나중에 모델/임베딩으로 교체 가능
function rateImportance(text, aiName) {
  let s = 1;
  if (text.includes(aiName)) s += 3;
  if (/의심|수상|거짓|범인|투표|못 믿|믿어|배신|누구|왜 그|아니잖/.test(text)) s += 2;
  if (/[?？]/.test(text)) s += 1;
  if (text.length > 40) s += 1;
  return Math.min(s, 10);
}

function addMemory(ai, text, importance, kind = 'obs') {
  ai.memory.push({ at: Date.now(), text, importance, kind });
  if (ai.memory.length > MAX_MEMORY) {
    const i = ai.memory.findIndex((m) => m.kind !== 'reflection'); // 오래된 일반 기억부터 잊음
    ai.memory.splice(i >= 0 ? i : 0, 1);
  }
}

// 모든 AI가 같은 대화를 듣지만, 각자 다르게 "중요하다"고 느끼고 저장한다
function observe(roomId, sender, text) {
  const roster = rosters.get(roomId);
  if (!roster) return;
  for (const ai of roster) {
    if (ai.name === sender) {
      addMemory(ai, `나는 이렇게 말했다: ${text}`, 1);
      ai.lastSpokeAt = Date.now();
      continue;
    }
    const imp = rateImportance(text, ai.name);
    addMemory(ai, `[${sender}] ${text}`, imp);
    ai.pending += imp;
    if (ai.pending >= REFLECT_THRESHOLD && !ai.reflecting) {
      reflect(roomId, ai).catch((e) => console.error(`[${ai.name}] 성찰 오류:`, e.message));
    }
  }
}

// 기억 검색: 최근성 + 중요도 + 지금 화제와의 관련성
function retrieve(ai, query, k = 6) {
  const now = Date.now();
  const words = (String(query).match(/[가-힣A-Za-z0-9]{2,}/g) || []);
  return [...ai.memory]
    .map((m) => {
      const ageMin = (now - m.at) / 60000;
      const recency = Math.pow(0.5, ageMin / 10);              // 10분마다 절반
      const relevance = words.some((w) => m.text.includes(w)) ? 0.5 : 0;
      return { m, score: recency + m.importance / 10 + relevance + (m.kind === 'reflection' ? 0.3 : 0) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.m)
    .sort((a, b) => a.at - b.at);
}

function labelOf(r) {
  const sus = r.suspicion >= 7 ? '강하게 의심함' : r.suspicion >= 5 ? '조금 의심함' : r.suspicion <= 2 ? '의심 안 함' : '잘 모르겠음';
  const bond = r.bond >= 7 ? '많이 믿고 좋아함' : r.bond >= 5 ? '호감이 있음' : r.bond <= 2 ? '정이 안 감' : '보통';
  return `${sus}, ${bond}`;
}

function participantsOf(roomId, ai) {
  const names = new Set((rosters.get(roomId) || []).map((a) => a.name));
  for (const e of getLog(roomId)) names.add(e.sender);
  names.delete(ai.name);
  names.delete('시스템');
  return [...names];
}

// 프롬프트에 붙일 "속마음" 블록
function buildMind(roomId, ai, query) {
  const people = participantsOf(roomId, ai);
  const lines = [];
  lines.push('[이 자리의 사람들]');
  lines.push(people.length ? people.join(', ') + ' (이 중 누가 사람이고 누가 AI인지는 너도 모른다)' : '(아직 아무도 없다)');
  lines.push('[너의 속마음: 겉으로 드러내지 않고 말과 행동에만 묻어난다]');
  lines.push(`- 목표: ${ai.goal}`);
  for (const p of people) lines.push(`- ${p}: ${labelOf(rel(ai, p))}`);
  const mem = retrieve(ai, query);
  if (mem.length) {
    lines.push('[네가 기억하는 일]');
    for (const m of mem) lines.push(`- ${m.kind === 'reflection' ? '(깨달음) ' : ''}${m.text}`);
  }
  lines.push('위 기억과 속마음에 맞게 말한다. 이전에 네가 한 말과 모순되지 않게 하고, 의심하거나 믿는 이유가 있으면 기억 속 사건을 근거로 든다.');
  return lines.join('\n') + '\n';
}

// 성찰: 최근 기억을 돌아보고 의심/호감을 갱신하고, 새로운 깨달음을 기억에 추가
async function reflect(roomId, ai) {
  ai.reflecting = true;
  ai.pending = 0;
  try {
    const people = participantsOf(roomId, ai);
    if (!people.length) return;
    let result;
    if (MOCK_AI) {
      const target = pick(people);
      result = { insight: `${target}이(가) 좀 신경 쓰인다`, suspicion: { [target]: randInt(-1, 2) }, bond: { [target]: randInt(-1, 1) } };
    } else {
      const recent = ai.memory.slice(-14).map((m) => `- ${m.text}`).join('\n');
      const now = people.map((p) => `${p}: 의심 ${rel(ai, p).suspicion}/10, 호감 ${rel(ai, p).bond}/10`).join('\n');
      const text = await callClaude({
        model: REFLECT_MODEL,
        max_tokens: 250,
        system: `너는 '${ai.name}'다. 성격: ${ai.traits.join(' ')} 목표: ${ai.goal}\n최근 대화를 돌아보고 속으로 생각을 정리한다. 반드시 JSON 한 개만 출력한다.`,
        messages: [{ role: 'user', content: `[최근 기억]\n${recent}\n\n[지금까지의 마음]\n${now}\n\n출력 형식: {"insight":"한 문장, 내가 깨달은 것(1인칭 반말)","suspicion":{"이름":-2~2},"bond":{"이름":-2~2}} (바뀐 사람만, 숫자는 변화량)` }],
      });
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return;
      result = JSON.parse(m[0]);
    }
    for (const [who, d] of Object.entries(result.suspicion || {})) {
      if (people.includes(who)) { const r = rel(ai, who); r.suspicion = clamp(r.suspicion + clamp(Number(d) || 0, -2, 2), 0, 10); }
    }
    for (const [who, d] of Object.entries(result.bond || {})) {
      if (people.includes(who)) { const r = rel(ai, who); r.bond = clamp(r.bond + clamp(Number(d) || 0, -2, 2), 0, 10); }
    }
    if (result.insight) addMemory(ai, String(result.insight).slice(0, 120), 8, 'reflection');
  } finally {
    ai.reflecting = false;
  }
}

async function callClaude({ model, system, messages, max_tokens }) {
  try {
    if (!anthropic) throw new Error('API 키 없음');
    const r = await anthropic.messages.create({ model, max_tokens, system, messages });
    apiState.status = 'ok'; apiState.error = ''; apiState.at = Date.now();
    return r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  } catch (err) {
    apiState.status = 'error'; apiState.error = explainApiError(err); apiState.at = Date.now();
    throw err;
  }
}

// -----------------------------
// AI가 말할지 판단 + 답장 생성
// -----------------------------
// 한 번의 발언에 답하는 AI 수의 상한 (실제 사람들은 다 같이 답하지 않아요)
const MAX_REPLIES = Number(process.env.MAX_REPLIES) || 3;
const RESPOND_CHANCE = 0.35;

// 지목된 AI는 우선, 나머지는 성격의 주도성에 따라 참여한다.
function chooseResponders(aiNames, text, roomId) {
  const mentioned = aiNames.filter((n) => text.includes(n));
  const roster = rosters.get(roomId) || [];
  const others = shuffle(aiNames.filter((n) => !mentioned.includes(n)));
  const chosen = mentioned.slice(0, MAX_REPLIES);
  for (const n of others) {
    if (chosen.length >= MAX_REPLIES) break;
    const ai = roster.find((a) => a.name === n);
    const initiative = ai?.seedPersona?.conversation_behavior?.initiative;
    const chance = typeof initiative === 'number'
      ? Math.min(0.7, Math.max(0.15, RESPOND_CHANCE + (initiative - 0.5) * 0.4))
      : RESPOND_CHANCE;
    if (Math.random() < chance) chosen.push(n);
  }
  if (!chosen.length && others.length) chosen.push(others[0]);
  // 직접 지목된 사람은 다른 사람보다 먼저 답한다.
  return [...mentioned.filter((n) => chosen.includes(n)),
    ...shuffle(chosen.filter((n) => !mentioned.includes(n)))];
}

// 모델 답장을 메신저 채팅처럼 다듬는다 (이모지/마크다운/긴 문장 제거)
function humanize(text) {
  let t = String(text || '');
  t = t.replace(/\p{Extended_Pictographic}/gu, '');     // 이모지
  t = t.replace(/[*#`_>~]/g, '');                         // 마크다운 기호
  t = t.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '').trim(); // 겉따옴표
  return t.trim();
}

const PROACTIVE_NUDGE = '[진행] 한동안 대화가 잠잠하다. 네 속마음과 목표에 따라 네가 먼저 말을 꺼내도 좋다. 누군가를 지목해 의심하거나 질문하고, 화제를 바꾸거나, 누구 편을 들어도 된다. 방금 한 말을 반복하지 말고, 정말 할 말이 없을 때만 정확히 ... 세 글자만 출력한다.';
const PROACTIVE_MOCK = ['근데 아까부터 조용한 사람 있지 않아?', '다들 어디서 뭐 했는지 얘기해 볼래?', '나만 이상하다고 느끼는 거야?', '솔직히 좀 불안한데...'];

// opts.proactive = true 면 누가 말을 걸지 않았어도 AI가 먼저 말을 꺼냄. 말하지 않기로 하면 null
async function generateReply(roomId, aiName, opts = {}) {

  console.log("★★★ 수정한 server.js 실행 확인 ★★★", __filename);

  if (MOCK_AI) {
    if (opts.proactive) return pick(PROACTIVE_MOCK);
    const samples = ['ㅇㅇ 들었어', '음.. 그래?', '그건 좀 의심스러운데', '나는 잘 모르겠어', 'ㅋㅋ 그럴 수도'];
    return pick(samples);
  }

  const log = getLog(roomId);
  const query = log.length ? log[log.length - 1].text : '';
  const messages = buildMessagesFor(roomId, aiName);

  if (opts.proactive) {
    messages.push({ role: 'user', content: PROACTIVE_NUDGE });
  }

  // 현재 AI의 고유 ID 확인
  const ai = (rosters.get(roomId) || [])
    .find((a) => a.name === aiName);

  const gameId = gameIds.get(roomId);

  console.log(
  `[기억 연결 확인] roomId=${roomId}, gameId=${gameId}, aiName=${aiName}, playerId=${ai?.playerId}`
);

  let spatialMemoryText = '';

  if (gameId && ai?.playerId) {
    try {
      const events = await getSpatialMemories(gameId, ai.playerId);

      // 가장 최근 사건 최대 15개
      const recent = [...events]
        .sort((a, b) => Number(b.game_time) - Number(a.game_time))
        .slice(0, 15);

      spatialMemoryText = recent.length
        ? recent.map((e) =>
            `- 시간 ${e.game_time}초, 위치 ${e.location}, ` +
            `사건: ${e.content}`
          ).join('\n')
        : '(직접 목격한 사건이 아직 없음)';

      console.log(
        `[시공간 기억 조회] ${aiName}(${ai.playerId}): ${events.length}개`
      );
    } catch (error) {
      console.warn(
        `[시공간 기억 조회 실패] ${aiName}: ${error.message}`
      );
      spatialMemoryText = '(기억 서버 조회 실패: 목격 여부를 확인할 수 없음)';
    }
  }

  const baseSystemPrompt = getSystemPrompt(roomId, aiName, query);

  const systemPrompt = spatialMemoryText
    ? baseSystemPrompt +
      '\n\n[네가 직접 목격한 시공간 기억]\n' +
      spatialMemoryText +
      '\n위 기록은 네가 직접 목격한 사건이다. ' +
      '목격한 사람, 시간, 장소에 관한 질문에는 이 기록을 근거로 답한다. ' +
      '기록에 없는 목격 사실은 만들어내지 않는다.'
    : baseSystemPrompt;

  let reply = await callClaude({
    model: MODEL,
    max_tokens: 512,
    system: systemPrompt,
    messages,
  });

  // 모델이 "[이름] ..." 형태로 말을 시작하면 이름표를 떼어냄
  reply = reply.replace(/^\[[^\]]{1,20}\]\s*/, '');
  if (opts.proactive && (!reply || /^\.{2,}$|^…$/.test(reply.trim()))) return null;
  return humanize(reply);
}

// 글자를 치는 시간 + 생각하는 시간 (매번 조금씩 다르게)
function typingDelay(text) {
  return Math.min(1000 + text.length * 110 + randInt(0, 1200), 6500);
}

// 한 번의 유저 발언에 대해 각 AI가 순서대로 반응 (동시에 쏟아지지 않게 순차 처리)
async function runAiTurn(roomId, aiNames, userText, onReply) {
  const room = getMeeting(roomId);
  room.busy = true;
  room.lastMsgAt = Date.now();
  let cum = 0;
  try {
    return await runAiTurnInner(roomId, aiNames, userText, async (r) => {
      cum += r.delay;
      room.lastMsgAt = Date.now() + cum; // 클라이언트가 마지막 답장을 보여 주는 시점까지 "조용하지 않음"
      await onReply(r);
    });
  } finally {
    room.busy = false;
  }
}

async function runAiTurnInner(roomId, aiNames, userText, onReply) {
  let errors = 0;
  for (const name of chooseResponders(aiNames, userText, roomId)) {
    try {
      const text = await generateReply(roomId, name);
      if (!text) {
        console.warn(`[${name}] Claude 응답이 비어 있습니다`);
        errors++;
        continue;
      }
      pushLog(roomId, name, text);
      await onReply({ sender: name, text, delay: typingDelay(text) });
    } catch (err) {
      errors++;
      console.error(`[${name}] 응답 오류:`, err);
    }
  }
  return errors; // 호출이 실패한 AI 수 (전부 실패했는지 알려 주려고)
}

// -----------------------------
// 회의 상태 + 능동 발언 (AI가 먼저 말을 꺼냄)
// -----------------------------
const PROACTIVE_MS = Number(process.env.PROACTIVE_MS) || 15000;     // AI가 먼저 말할지 판단하는 간격
const QUIET_MS = Number(process.env.QUIET_MS) || 6000;               // 이만큼 조용해야 먼저 말함
const MAX_PROACTIVE = Number(process.env.MAX_PROACTIVE) || 20;       // 회의당 최대 선발언 수 (비용 상한)
const meetings = new Map(); // roomId -> { active, busy, lastMsgAt, nextAt, count, events, nextEventId }

function getMeeting(roomId) {
  if (!meetings.has(roomId)) {
    meetings.set(roomId, { active: false, busy: false, lastMsgAt: 0, nextAt: 0, count: 0, events: [], nextEventId: 1 });
  }
  return meetings.get(roomId);
}

// 지금 말하고 싶은 정도: 오래 침묵했을수록, 의심이 큰 상대가 있을수록, 마지막 발언자가 아닐수록 높다
function pickSpeaker(roomId, roster) {
  const log = getLog(roomId);
  const lastSender = log.length ? log[log.length - 1].sender : null;
  const now = Date.now();
  let best = null;
  for (const ai of roster) {
    if (ai.name === lastSender) continue;
    const silence = Math.min((now - (ai.lastSpokeAt || 0)) / 1000, 120);
    const maxSus = Math.max(0, ...Object.values(ai.relations).map((r) => r.suspicion));
    const score = silence * 0.3 + maxSus * 2 + Math.random() * 12;
    if (!best || score > best.score) best = { ai, score };
  }
  return best && best.ai;
}

async function proactiveTick(roomId) {
  const room = getMeeting(roomId);
  const roster = rosters.get(roomId);
  if (!room.active || room.busy || !roster || !roster.length) return;
  if (room.count >= MAX_PROACTIVE) return;
  const now = Date.now();
  if (now < room.nextAt || now - room.lastMsgAt < QUIET_MS) return;

  room.busy = true;
  room.nextAt = now + PROACTIVE_MS * (0.7 + Math.random() * 0.6);
  try {
    const ai = pickSpeaker(roomId, roster);
    if (!ai) return;
    const text = await generateReply(roomId, ai.name, { proactive: true });
    if (!text || !room.active) return;
    const delay = typingDelay(text);
    pushLog(roomId, ai.name, text);
    room.events.push({ id: room.nextEventId++, sender: ai.name, text, at: Date.now() + delay });
    if (room.events.length > 50) room.events.shift();
    room.lastMsgAt = Date.now() + delay;
    room.count++;
  } catch (err) {
    console.error('선발언 오류:', err.status || '', err.message);
  } finally {
    room.busy = false;
  }
}

setInterval(() => {
  for (const [roomId, room] of meetings) if (room.active) proactiveTick(roomId);
}, 1000);

// -----------------------------
// Unity용 HTTP API
// -----------------------------

app.post('/api/python-test', async (req, res) => {
  try {
    const game = await createPythonGame();

    console.log('Python 게임 생성 성공:', game.game_id);

    res.json({
      ok: true,
      game: game
    });
  } catch (error) {
    console.error('Python 연결 실패:', error.message);

    res.status(502).json({
      ok: false,
      error: 'Python 서버 연결에 실패했습니다.'
    });
  }
});


app.post('/api/game/create', async (req, res) => {
  try {
    const game = await createPythonGame();

    console.log(
      '[Game] Python 게임 생성 성공:',
      game.game_id
    );

    res.json({
      ok: true,
      game: game
    });

  } catch (error) {
    console.error(
      '[Game] 생성 실패:',
      error.message
    );

    res.status(502).json({
      ok: false,
      error: 'Python 게임 생성에 실패했습니다.'
    });
  }
});



app.get('/api/health', (req, res) => {
  const roomId = getRoomId(req.query.roomId);
  res.json({
    ok: true,
    mock: MOCK_AI,
    model: MODEL,
    hasKey: MOCK_AI || !!anthropic,
    api: MOCK_AI ? 'mock' : apiState.status,   // unknown | ok | error | mock
    apiError: apiState.error,                  // 오류일 때 "무엇을 고치면 되는지" 한국어 안내
    rosterCount: (rosters.get(roomId) || []).length,
  });
});

const getRoomId = (v) => String(v || 'main').slice(0, 40);


// Python 게임 엔진에서 회의 시작
app.post('/api/game/meeting/start', async (req, res) => {
  const body = req.body || {};
  const roomId = getRoomId(body.roomId);
  const callerId = body.callerId;
  const reason = body.reason || 'emergency';

  const gameId = gameIds.get(roomId);

  if (!gameId) {
    return res.status(404).json({
      ok: false,
      error: '이 방에 연결된 Python 게임이 없습니다.'
    });
  }

  if (!callerId) {
    return res.status(400).json({
      ok: false,
      error: 'callerId가 필요합니다.'
    });
  }

  try {
    const result = await startPythonMeeting(
      gameId,
      callerId,
      reason
    );

    res.json({
      ok: true,
      ...result
    });

  } catch (error) {
    console.error(
      '[Game] 회의 시작 실패:',
      error.message
    );

    res.status(502).json({
      ok: false,
      error: 'Python 회의 시작 요청에 실패했습니다.',
      detail: error.message
    });
  }
});


// Python 게임 엔진에서 투표 시작
app.post('/api/game/voting/start', async (req, res) => {
  const body = req.body || {};
  const roomId = getRoomId(body.roomId);
  const gameId = gameIds.get(roomId);

  if (!gameId) {
    return res.status(404).json({
      ok: false,
      error: '이 방에 연결된 Python 게임이 없습니다.'
    });
  }

  try {
    const result = await startPythonVoting(gameId);

    res.json({
      ok: true,
      ...result
    });

  } catch (error) {
    console.error('[Game] 투표 시작 실패:', error.message);

    res.status(502).json({
      ok: false,
      error: 'Python 투표 시작 요청에 실패했습니다.',
      detail: error.message
    });
  }
});


 // Python 게임 엔진에 투표 제출
app.post('/api/game/vote', async (req, res) => {
  const body = req.body || {};
  const roomId = getRoomId(body.roomId);
  const gameId = gameIds.get(roomId);

  const voterId = body.voterId;
  const targetId = body.targetId;

  if (!gameId) {
    return res.status(404).json({
      ok: false,
      error: '이 방에 연결된 Python 게임이 없습니다.'
    });
  }

  if (!voterId || !targetId) {
    return res.status(400).json({
      ok: false,
      error: 'voterId와 targetId가 필요합니다.'
    });
  }

  try {
    const result = await submitPythonVote(
      gameId,
      voterId,
      targetId
    );

    return res.json({
      ok: true,
      ...result
    });

  } catch (error) {
    console.error('[Game] 투표 제출 실패:', error.message);

    return res.status(502).json({
      ok: false,
      error: 'Python 투표 제출 요청에 실패했습니다.',
      detail: error.message
    });
  }
});


 // 투표 집계, 추방 및 승패 판정
app.post('/api/game/voting/finalize', async (req, res) => {
  const roomId = getRoomId((req.body || {}).roomId);
  const gameId = gameIds.get(roomId);

  if (!gameId) {
    return res.status(404).json({
      ok: false,
      error: '연결된 Python 게임이 없습니다.'
    });
  }

  try {
    const result = await finalizePythonVoting(gameId);

    return res.json({
      ok: true,
      ...result
    });

  } catch (error) {
    console.error('[Game] 투표 집계 실패:', error.message);

    return res.status(502).json({
      ok: false,
      error: '투표 집계에 실패했습니다.',
      detail: error.message
    });
  }
});


// 현재 게임 상태 조회
app.get('/api/game/state', async (req, res) => {
  const roomId = getRoomId(req.query.roomId);
  const gameId = gameIds.get(roomId);

  if (!gameId) {
    return res.status(404).json({
      ok: false,
      error: '연결된 Python 게임이 없습니다.'
    });
  }

  try {
    const result = await getPythonGameState(gameId);

    return res.json({
      ok: true,
      ...result
    });

  } catch (error) {
    console.error('[Game] 상태 조회 실패:', error.message);

    return res.status(502).json({
      ok: false,
      error: '게임 상태 조회에 실패했습니다.',
      detail: error.message
    });
  }
});


// 새 게임 시작: AI를 무작위로 만들어 방에 배정 (이름/성격/이미지/인원수 전부 랜덤)
//   body: { roomId, count(0이면 서버가 랜덤), spriteCount(Unity에 있는 캐릭터 이미지 수) }

app.post('/api/roster', rateLimit, async (req, res) => {
  const body = req.body || {};
  const roomId = getRoomId(body.roomId);
  const count = Math.max(0, Math.min(parseInt(body.count, 10) || 0, 8));
  const spriteCount = Math.max(
    1,
    Math.min(parseInt(body.spriteCount, 10) || 1, 50)
  );

  const aiCount = count > 0 ? count : randInt(MIN_AI, MAX_AI);

  let game;
  let roster;

  try {
    game = await createPythonGame(aiCount, 1);

    if (!game.game_id ||
        !Array.isArray(game.ai_characters) ||
        game.ai_characters.length === 0) {
      throw new Error('Python 게임 생성 응답이 올바르지 않습니다.');
    }

    roster = rosterFromPython(
      game.ai_characters,
      spriteCount
    );

  } catch (error) {
    console.error('[Roster] Python 게임 생성 실패:', error.message);

    return res.status(502).json({
      error: 'Python 게임 생성에 실패했습니다.'
    });
  }

  // Python 게임 ID와 Unity 방 ID 연결
  gameIds.set(roomId, game.game_id);

  // Python 캐릭터를 Node.js에 등록
  rosters.set(roomId, roster);

  // 새 게임이므로 이전 대화와 회의 정보 초기화
  logs.delete(roomId);
  meetings.delete(roomId);

  console.log(
    `[Game] 방: ${roomId}, 게임: ${game.game_id}, AI: ${roster.length}명`
  );

  res.json({
    roster: publicRoster(roster),
    game_id: game.game_id
  });
});


// 명단 복구: 서버가 재시작되어 명단이 사라졌을 때, Unity가 화면에 있는 AI의 이름/이미지 번호를 다시 알려 줌
// (이름과 겉모습은 그대로 유지하고, 성격과 기억은 새로 만들어짐. 이미 명단이 있으면 덮어쓰지 않음)
app.post('/api/roster/restore', rateLimit, (req, res) => {
  const body = req.body || {};
  const roomId = getRoomId(body.roomId);
  if ((rosters.get(roomId) || []).length) return res.json({ restored: false, roster: publicRoster(rosters.get(roomId)) });

  const given = (Array.isArray(body.roster) ? body.roster : [])
    .map((a) => ({ name: cleanName(a && a.name), spriteIndex: Math.max(0, parseInt(a && a.spriteIndex, 10) || 0) }))
    .filter((a) => a.name)
    .slice(0, 8);
  if (!given.length) return res.status(400).json({ error: 'roster가 비어 있어요.' });

  const roster = makeRoster(given.length, 1);
  roster.forEach((ai, i) => { ai.name = given[i].name; ai.spriteIndex = given[i].spriteIndex; });
  rosters.set(roomId, roster);
  res.json({ restored: true, roster: publicRoster(roster) });
});

// 이미 만들어진 명단 조회 (나중에 다른 플레이어가 같은 방에 들어올 때 사용)
app.get('/api/roster', (req, res) => {
  const roster = rosters.get(getRoomId(req.query.roomId));
  if (!roster) return res.status(404).json({ error: '아직 이 방에 AI가 없어요.' });
  res.json({ roster: publicRoster(roster) });
});

// 회의 시작/종료 알림 (Unity의 MeetingManager가 호출). 회의 중에만 AI가 먼저 말을 건다
app.post('/api/meeting', (req, res) => {
  const roomId = getRoomId((req.body || {}).roomId);
  const active = !!(req.body || {}).active;
  const room = getMeeting(roomId);
  room.active = active;
  if (active) {
    room.events = [];
    room.nextEventId = 1;
    room.count = 0;
    room.lastMsgAt = Date.now();
    room.nextAt = Date.now() + 8000; // 첫 선발언은 회의 시작 직후 조금 이르게
    for (const ai of rosters.get(roomId) || []) addMemory(ai, '회의가 시작되었다. 이 중 수상한 사람이 있는지 이야기한다.', 3);
  }
  res.json({ ok: true, active, hasRoster: (rosters.get(roomId) || []).length > 0 });
});

// AI가 먼저 한 말 가져오기 (Unity가 2~3초마다 호출). since 이후, 표시할 시간이 된 것만 순서대로
app.get('/api/events', (req, res) => {
  const room = getMeeting(getRoomId(req.query.roomId));
  const since = parseInt(req.query.since, 10) || 0;
  const now = Date.now();
  const out = [];
  for (const e of room.events) {
    if (e.id <= since) continue;
    if (e.at > now) break; // 아직 "타이핑 중" - 순서를 지키려고 여기서 멈춤
    out.push({ id: e.id, sender: e.sender, text: e.text });
  }
  res.json({ events: out, lastId: out.length ? out[out.length - 1].id : since });
});

// 의심/호감 게이지용: 모든 AI가 각 사람에게 느끼는 평균값
app.get('/api/gauges', (req, res) => {
  const roomId = getRoomId(req.query.roomId);
  const roster = rosters.get(roomId) || [];
  const acc = {};
  for (const ai of roster) {
    for (const [who, r] of Object.entries(ai.relations)) {
      const a = (acc[who] = acc[who] || { n: 0, suspicion: 0, bond: 0 });
      a.n++; a.suspicion += r.suspicion; a.bond += r.bond;
    }
  }
  res.json({
    targets: Object.entries(acc).map(([name, a]) => ({
      name,
      suspicion: +(a.suspicion / a.n).toFixed(1),
      bond: +(a.bond / a.n).toFixed(1),
    })),
  });
});

// 개발용: 각 AI의 목표/관계/기억을 열어봄 (.env 에 DEBUG_API=1 일 때만)
app.get('/api/debug', (req, res) => {
  if (process.env.DEBUG_API !== '1') return res.status(404).end();
  const roomId = getRoomId(req.query.roomId);
  res.json((rosters.get(roomId) || []).map((a) => ({
    name: a.name, goal: a.goal, traits: a.traits, relations: a.relations,
    memory: a.memory.slice(-15).map((m) => `${m.kind === 'reflection' ? '*' : ''}(${m.importance}) ${m.text}`),
  })));
});

app.post('/api/chat', rateLimit, async (req, res) => {
  console.log("★★★ Unity 채팅 요청 도착 ★★★", req.body.roomId);
  const body = req.body || {};
  const roomId = getRoomId(body.roomId);
  const sender = cleanName(body.sender) || '익명';
  const text = String(body.text || '').trim().slice(0, 300);

  // 기본: 그 방에 서버가 만들어 둔 AI들이 대화에 참여
  // (예전 방식처럼 body.ais로 이름을 직접 보내도 동작함)
  const legacy = Array.isArray(body.ais) ? body.ais.map((a) => cleanName(a && a.name)) : [];
  const aiNames = [...new Set(legacy.length ? legacy : (rosters.get(roomId) || []).map((a) => a.name))]
    .filter(Boolean)
    .slice(0, 8);

  if (!text) return res.status(400).json({ error: 'text가 비어 있어요.' });

  // 서버가 재시작되거나 잠들었다 깨어나면 AI 명단이 사라질 수 있음 -> Unity가 명단을 복구하고 다시 보내도록 알려 줌
  if (!aiNames.length) return res.json({ replies: [], reason: 'no_roster' });

  pushLog(roomId, sender, text);

  const replies = [];
  const errors = await runAiTurn(roomId, aiNames, text, async (r) => {
    replies.push(r);
  });

  // 답장이 하나도 없는데 오류가 있었다면 API 쪽 문제 (키, 크레딧, 모델 이름, 요청 제한 등)
  res.json({ replies, reason: !replies.length && errors > 0 ? 'ai_error' : undefined });
});

// -----------------------------
// 웹 채팅 (Socket.io) - 기존 방식 유지
// -----------------------------
const WEB_ROOM = 'web';
const WEB_AIS = ['미노', '하루'];
const users = {}; // 소켓 ID -> 닉네임
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

io.on('connection', (socket) => {
  socket.on('join', (nickname) => {
    users[socket.id] = cleanName(nickname) || `유저${socket.id.slice(0, 4)}`;
    io.emit('chat message', { sender: '시스템', text: `${users[socket.id]}님이 입장했습니다.` });
  });

  socket.on('chat message', async (raw) => {
    const text = String(raw || '').trim().slice(0, 300);
    if (!text) return;
    const sender = users[socket.id] || '익명';

    io.emit('chat message', { sender, text, socketId: socket.id });
    pushLog(WEB_ROOM, sender, text);

    await runAiTurn(WEB_ROOM, WEB_AIS, text, async (r) => {
      io.emit('typing', { sender: r.sender });
      await sleep(r.delay);
      io.emit('chat message', { sender: r.sender, text: r.text });
      await sleep(600);
    });
  });

  socket.on('disconnect', () => {
    const nickname = users[socket.id];
    if (nickname) {
      io.emit('chat message', { sender: '시스템', text: `${nickname}님이 나갔습니다.` });
      delete users[socket.id];
    }
  });
});

// -----------------------------
// 상태 저장: 서버를 껐다 켜도 AI 명단, 기억, 대화 기록이 남도록 파일(data/state.json)에 주기적으로 저장
//   (Render 무료 서버처럼 디스크가 초기화되는 곳에서는 사라질 수 있어서, Unity의 명단 복구와 함께 쓴다)
// -----------------------------
const STATE_FILE = path.join(__dirname, 'data', 'state.json');

function saveState() {
  try {
    if (!rosters.size) return;
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const data = {
  rosters: [...rosters],
  logs: [...logs],
  gameIds: [...gameIds]
};
    fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(data));
    fs.renameSync(STATE_FILE + '.tmp', STATE_FILE); // 쓰다가 꺼져도 파일이 깨지지 않게
  } catch (e) {
    console.error('상태 저장 실패:', e.message);
  }
}

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    for (const [k, v] of data.rosters || []) rosters.set(k, v.map((a) => ({ ...a, reflecting: false })));
    for (const [k, v] of data.logs || []) logs.set(k, v);
    for (const [k, v] of data.gameIds || []) gameIds.set(k, v);
    console.log(`저장된 상태를 불러왔어요 (방 ${rosters.size}개)`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('저장된 상태를 읽지 못해 새로 시작합니다:', e.message);
  }
}

loadState();
setInterval(saveState, 5000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { saveState(); process.exit(0); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}${MOCK_AI ? ' (MOCK_AI 모드)' : ''}`);
  if (MOCK_AI) return console.log('⚠ MOCK_AI 모드예요. 진짜 AI 대화를 쓰려면 .env 에서 MOCK_AI 줄을 지우세요.');

  // 켜자마자 Claude 호출을 한 번 시험해서, 문제가 있으면 바로 알려 줌 (비용은 거의 0)
  const ping = (model) =>
    callClaude({ model, max_tokens: 8, system: 'ping', messages: [{ role: 'user', content: 'hi' }] });
  ping(MODEL)
    .then(() => console.log(`✅ Claude 연결 확인됨 (대화 모델: ${MODEL})`))
    .catch((e) => console.error(`❌ Claude 연결 실패 (${MODEL}): ${explainApiError(e)}`))
    .then(() => (REFLECT_MODEL === MODEL ? null : ping(REFLECT_MODEL)
      .then(() => console.log(`✅ 성찰 모델 확인됨 (${REFLECT_MODEL})`))
      .catch((e) => console.error(`⚠ 성찰 모델 실패 (${REFLECT_MODEL}): ${explainApiError(e)} (성찰만 안 되고 대화는 됩니다)`))));
});