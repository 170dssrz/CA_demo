// server.js
// 웹 채팅(Socket.io)과 Unity 채팅(HTTP API)을 모두 지원하는 서버
//
// - Unity:  POST /api/chat  { roomId, sender, text, ais: [{ name }] }  ->  { replies: [...] }
// - 웹:     Socket.io 이벤트 (join, chat message)
// - 테스트: .env에 MOCK_AI=1 을 넣으면 Qwen API 없이 가짜 답장으로 연결만 확인할 수 있음

require('dotenv').config();
console.log("★★★ 수정한 server.js 실행 확인 ★★★", __filename);
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
// Qwen is served locally through Ollama's HTTP API (no API key needed).

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

const MODEL = process.env.QWEN_MODEL || 'qwen3:0.6b';
const MOCK_AI = process.env.MOCK_AI === '1';
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const apiState = { status: 'unknown', error: '', at: 0 };

function explainApiError(err) {
  const msg = String(err?.message || err || '');
  if (/ECONNREFUSED|fetch failed|ETIMEDOUT|abort/i.test(msg))
    return 'Ollama 연결 실패: Ollama를 실행하고 OLLAMA_URL을 확인하세요.';
  if (/404|not found/i.test(msg))
    return `Qwen 모델을 찾을 수 없어요. ollama pull ${MODEL} 을 실행하세요.`;
  return msg.slice(0, 160);
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
const rosters = new Map(); // roomId -> [{ playerId, name, spriteIndex, traits, examples, lastSpokeAt }]

const gameIds = new Map(); // roomId -> Python game_id

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


    return {
      name,
      spriteIndex: sprites[i % sprites.length],
      traits,
      examples: card ? toArr(card.예시대사).slice(0, 8) : [], // 이 사람이 실제로 쓸 법한 말 (말투 학습용)
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



// 실험용 고정 Seed Memory: AI 순서별로 항상 동일한 페르소나를 사용한다.
const FIXED_SEED_IDS = ['seed_001', 'seed_002', 'seed_003', 'seed_004'];
// 우선순위: .env의 SEED_PERSONA_PATH → CAserver와 같은 위치의 AI-backend → CAserver 내부
// Render 등 원격 서버의 파일은 로컬 경로로 읽을 수 없다.
const SEED_CANDIDATES = [
  process.env.SEED_PERSONA_PATH && path.resolve(__dirname, process.env.SEED_PERSONA_PATH),
  path.resolve(__dirname, '..', 'AI-backend', 'data', 'seed_personas.json'),
  path.resolve(__dirname, '..', 'AIbackend', 'data', 'seed_personas.json'),
  path.join(__dirname, 'seed_personas.json')
].filter(Boolean);
const FIXED_SEED_FILE = SEED_CANDIDATES.find((file) => fs.existsSync(file)) || SEED_CANDIDATES[0];
console.log('[Seed Memory] 파일 경로:', FIXED_SEED_FILE);

function loadFixedSeeds() {
  const seeds = JSON.parse(fs.readFileSync(FIXED_SEED_FILE, 'utf8'));
  if (!Array.isArray(seeds)) throw new Error('Seed Memory 파일은 배열이어야 합니다.');
  for (const id of FIXED_SEED_IDS) {
    if (!seeds.some((seed) => seed.seed_id === id)) {
      throw new Error(`고정 페르소나 누락: ${id}`);
    }
  }
  return seeds;
}

function fixedSeedAt(index, seeds) {
  const id = FIXED_SEED_IDS[index];
  if (!id) throw new Error(`실험 모드는 AI 최대 ${FIXED_SEED_IDS.length}명까지 지원합니다.`);
  return seeds.find((seed) => seed.seed_id === id);
}

function seedToTraits(seed) {
  const b = seed.big_five || {};
  const style = seed.speech_style || {};
  const behavior = seed.conversation_behavior || {};
  return [
    `페르소나: ${seed.persona_name}`,
    `기본 성격: ${seed.description}`,
    `말투: ${style.tone || ''}`,
    `대답 습관: ${style.response_habit || ''}`,
    `발언 예시(그대로 반복하지 말 것): ${style.example || ''}`,
    `판단 방식: ${behavior.reasoning || ''}`,
    `압박받을 때: ${behavior.under_pressure || ''}`,
    `Big Five(0~1): 개방성=${b.openness}, 성실성=${b.conscientiousness}, 외향성=${b.extraversion}, 친화성=${b.agreeableness}, 신경성=${b.neuroticism}`,
    'Big Five 수치는 성격 경향의 강도를 뜻한다. 실제 발언에서는 수치를 언급하지 말고 말투, 질문 방식, 판단에 자연스럽게 반영한다.'
  ];
}

function rosterFromPython(aiCharacters, spriteCount) {
  const seeds = loadFixedSeeds();
  const sprites = shuffle([...Array(Math.max(spriteCount, 1)).keys()]);
  return aiCharacters.map((character, i) => {
    const seed = fixedSeedAt(i, seeds);
    return {
      playerId: character.player_id,
      name: cleanName(character.name),
      spriteIndex: sprites[i % sprites.length],
      seedId: seed.seed_id,
      personaName: seed.persona_name,
      bigFive: seed.big_five,
      traits: seedToTraits(seed),
      examples: [seed.speech_style?.example].filter(Boolean),
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
  return `너는 '${name}'라는 이름의 마을 주민이다. 다른 주민들과 함께 마을에서 대화하고 있다.\n[너의 성격]\n${traitText}\n${COMMON_RULES}`;
}

// -----------------------------
// 대화 기록 (방별)
// -----------------------------
const logs = new Map(); // roomId -> [{ sender, text }]
const MAX_LOG = 20; // 최근 대화 20개만 유지

function getLog(roomId) {
  if (!logs.has(roomId)) logs.set(roomId, []);
  return logs.get(roomId);
}

function pushLog(roomId, sender, text) {
  const log = getLog(roomId);
  log.push({ sender, text });
  if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
}

// 특정 AI의 시점에서 대화 기록을 채팅 메시지 형식으로 변환
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
async function callLLM({ model, system, messages, max_tokens }) {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || MODEL,
        stream: false,
        think: false,
        messages: [{ role: 'system', content: system || '' }, ...(messages || [])],
        options: { num_predict: max_tokens || 512 }
      }),
      signal: AbortSignal.timeout(180000)
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Ollama HTTP ${response.status}: ${detail.slice(0, 200)}`);
    }
    const result = await response.json();
    const output = String(result.message?.content || '').trim();
    if (!output) throw new Error('Qwen 응답이 비어 있습니다.');
    apiState.status = 'ok'; apiState.error = ''; apiState.at = Date.now();
    return output;
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
    const initiative = null;
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

const PROACTIVE_NUDGE = '[진행] 한동안 대화가 잠잠하다. 네 성격에 따라 네가 먼저 말을 꺼내도 좋다. 누군가를 지목해 의심하거나 질문하고, 화제를 바꾸거나, 누구 편을 들어도 된다. 방금 한 말을 반복하지 말고, 정말 할 말이 없을 때만 정확히 ... 세 글자만 출력한다.';
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

  const systemPrompt = getSystemPrompt(roomId, aiName, query);

  let reply = await callLLM({
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
        console.warn(`[${name}] Qwen 응답이 비어 있습니다`);
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
    const score = silence * 0.3 + Math.random() * 12;
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
    hasKey: true, // 로컬 Ollama는 API 키가 필요 없음
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


// AI가 최근 회의 대화를 바탕으로 투표할 대상을 선택한다.
async function chooseAiVote(roomId, ai, alivePlayers) {
  const candidates = alivePlayers.filter(
    (p) => p.player_id !== ai.playerId
  );

  if (!candidates.length) return 'skip';

  const recentChat = getLog(roomId)
    .slice(-20)
    .map((e) => `[${e.sender}] ${e.text}`)
    .join('\n');

  const choices = candidates
    .map((p) => `${p.player_id}: ${p.name}`)
    .join('\n');

  if (MOCK_AI) {
    return candidates[0].player_id;
  }

  const answer = await callLLM({
    model: MODEL,
    max_tokens: 100,
    system: `너는 마피아 게임 참가자 '${ai.name}'이다.
성격: ${ai.traits.join(' ')}

지금은 투표 시간이다.
회의 대화를 근거로 판단한다.
대화에 없는 사실을 만들어내지 않는다.
자기 자신에게 투표할 수 없다.
판단 근거가 부족하면 기권할 수 있다.

반드시 후보의 player_id 또는 skip 하나만 출력한다.
설명이나 다른 문장은 출력하지 않는다.`,
    messages: [{
      role: 'user',
      content: `[투표 가능한 후보]
${choices}
skip: 기권

[최근 회의 대화]
${recentChat || '없음'}


누구에게 투표할 것인가?`
    }]
  });

  const selected = answer.trim();

  if (selected === 'skip') return 'skip';

  const valid = candidates.find(
    (p) => p.player_id === selected
  );

  if (!valid) {
    console.warn(
      `[AI 투표] ${ai.name}의 잘못된 응답: ${selected}`
    );
    return 'skip';
  }

  return valid.player_id;
}


 // AI 전원이 자동으로 투표하는 API
app.post('/api/game/voting/ai-votes', async (req, res) => {
  const roomId = getRoomId((req.body || {}).roomId);
  const gameId = gameIds.get(roomId);
  const roster = rosters.get(roomId) || [];

  if (!gameId) {
    return res.status(404).json({
      ok: false,
      error: '연결된 Python 게임이 없습니다.'
    });
  }

  try {
    const state = await getPythonGameState(gameId);

    if (state.phase !== 'voting') {
      return res.status(400).json({
        ok: false,
        error: '현재 투표 단계가 아닙니다.'
      });
    }

    const alivePlayers = state.players.filter(
      (p) => p.is_alive
    );

    const results = [];

    for (const ai of roster) {
      const alive = alivePlayers.some(
        (p) => p.player_id === ai.playerId
      );

      if (!alive) continue;

      try {
        const targetId = await chooseAiVote(
          roomId,
          ai,
          alivePlayers
        );

        await submitPythonVote(
          gameId,
          ai.playerId,
          targetId
        );

        results.push({
          voter_id: ai.playerId,
          voter_name: ai.name,
          target_id: targetId,
          success: true
        });

        console.log(
          `[AI 투표 성공] ${ai.name} → ${targetId}`
        );

      } catch (error) {
        console.error(
          `[AI 투표 실패] ${ai.name}:`,
          error.message
        );

        results.push({
          voter_id: ai.playerId,
          voter_name: ai.name,
          success: false,
          error: error.message
        });
      }
    }

    return res.json({
      ok: results.every((r) => r.success),
      game_id: gameId,
      votes: results
    });

  } catch (error) {
    console.error('[AI 자동 투표 오류]', error.message);

    return res.status(502).json({
      ok: false,
      error: error.message
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


// 새 게임 시작: Python에서 AI 4명을 생성하고 고정 Seed Memory를 순서대로 배정
//   body: { roomId, count(0이면 서버가 랜덤), spriteCount(Unity에 있는 캐릭터 이미지 수) }

app.post('/api/roster', rateLimit, async (req, res) => {
  const body = req.body || {};
  const roomId = getRoomId(body.roomId);
  const count = Math.max(0, Math.min(parseInt(body.count, 10) || 0, 8));
  const spriteCount = Math.max(
    1,
    Math.min(parseInt(body.spriteCount, 10) || 1, 50)
  );

  const aiCount = FIXED_SEED_IDS.length; // 실험용 고정 4명

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

  const seeds = loadFixedSeeds();
  if (given.length > FIXED_SEED_IDS.length) {
    return res.status(400).json({ error: '고정 페르소나는 최대 4명까지 지원합니다.' });
  }
  const roster = given.map((a, i) => {
    const seed = fixedSeedAt(i, seeds);
    return {
      playerId: null, // 복구 요청에는 원래 playerId가 없으므로 투표 전 새 게임 시작 필요
      name: a.name,
      spriteIndex: a.spriteIndex,
      seedId: seed.seed_id,
      personaName: seed.persona_name,
      bigFive: seed.big_five,
      traits: seedToTraits(seed),
      examples: [seed.speech_style?.example].filter(Boolean),
      lastSpokeAt: 0
    };
  });
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

// Removed memory, reflection, and relationship APIs.
app.get('/api/gauges', (req, res) => res.json({ targets: [] }));
app.get('/api/debug', (req, res) => {
  if (process.env.DEBUG_API !== '1') return res.status(404).end();
  res.json((rosters.get(getRoomId(req.query.roomId)) || []).map(a => ({ name: a.name, seedId: a.seedId, personaName: a.personaName, bigFive: a.bigFive, traits: a.traits })));
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
    for (const [k, v] of data.rosters || []) rosters.set(k, v.map((a) => ({ name: a.name, playerId: a.playerId, spriteIndex: a.spriteIndex, traits: a.traits || [], examples: a.examples || [], seedId: a.seedId, personaName: a.personaName, bigFive: a.bigFive, lastSpokeAt: a.lastSpokeAt || 0 })));
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

  // 켜자마자 Qwen 호출을 한 번 시험해서, 문제가 있으면 바로 알려 줌 (비용은 거의 0)
  const ping = (model) =>
    callLLM({ model, max_tokens: 8, system: 'ping', messages: [{ role: 'user', content: 'hi' }] });
  ping(MODEL)
    .then(() => console.log(`✅ Qwen 연결 확인됨 (대화 모델: ${MODEL})`))
    .catch((e) => console.error(`❌ Qwen 연결 실패 (${MODEL}): ${explainApiError(e)}`))
;
});