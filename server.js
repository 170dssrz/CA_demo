// server.js
// 웹 채팅(Socket.io)과 Unity 채팅(HTTP API)을 모두 지원하는 서버
//
// - Unity:  POST /api/chat  { roomId, sender, text, ais: [{ name }] }  ->  { replies: [...] }
// - 웹:     Socket.io 이벤트 (join, chat message)
// - 테스트: .env에 MOCK_AI=1 을 넣으면 Claude API 없이 가짜 답장으로 연결만 확인할 수 있음

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const MOCK_AI = process.env.MOCK_AI === '1';
const anthropic = MOCK_AI ? null : new Anthropic(); // ANTHROPIC_API_KEY를 .env에서 읽음

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
- 기본은 한 문장이다. 길어도 두 문장을 넘기지 않는다. 가끔은 "아" "ㅇㅇ" "글쎄" 같은 한두 단어만 말한다.
- 문장을 마침표로 딱 끝맺지 않는 경우가 많다. 말줄임(...)이나 물음표, 그냥 끊기를 섞는다.
- 정돈된 글이 아니라 구어체로 쓴다. 가끔 띄어쓰기를 틀리거나 말을 바꿔 말해도 된다. 과하게 틀리지는 않는다.
- 이모지, 마크다운(*, #), 번호 목록, 따옴표, 괄호 설명을 쓰지 않는다.
- 도와주는 말투를 쓰지 않는다. ("도움이 되었으면", "궁금한 점", "~해 드릴게요", "좋은 질문이에요" 금지)

[대화 태도]
- 모든 말에 답하려 하지 않는다. 방금 나온 말 중 하나에만 반응한다.
- 다른 사람이 한 말을 그대로 반복하거나 요약하지 않는다. 앞에서 이미 나온 말과 같은 말은 하지 않는다.
- 정답을 아는 것처럼 굴지 않는다. 모르면 모른다고, 헷갈리면 헷갈린다고 한다.
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
  '소라', '도윤', '지안', '유나', '하준', '서연', '민재', '예은', '태오', '다은',
  '시우', '나래', '재현', '은서', '현우', '보람', '지호', '채원', '준서', '아린',
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
const MIN_AI = Number(process.env.MIN_AI) || 3; // 인원수를 따로 안 정하면 MIN_AI ~ MAX_AI 중 랜덤
const MAX_AI = Number(process.env.MAX_AI) || 5;
const rosters = new Map(); // roomId -> [{ name, spriteIndex, traits: [...] }]

function makeRoster(count, spriteCount) {
  const n = Math.min(count > 0 ? count : randInt(MIN_AI, MAX_AI), 8, NAME_POOL.length);
  const names = shuffle(NAME_POOL).slice(0, n);
  const sprites = shuffle([...Array(Math.max(spriteCount, 1)).keys()]); // 이미지가 충분하면 겹치지 않게

  return names.map((name, i) => ({
    name,
    spriteIndex: sprites[i % sprites.length],
    traits: Object.values(TRAIT_AXES).map(pick), // 축마다 하나씩 뽑아 조합
  }));
}

const publicRoster = (roster) => roster.map(({ name, spriteIndex }) => ({ name, spriteIndex }));

function getSystemPrompt(roomId, rawName) {
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
const MAX_LOG = 40;

function getLog(roomId) {
  if (!logs.has(roomId)) logs.set(roomId, []);
  return logs.get(roomId);
}

function pushLog(roomId, sender, text) {
  const log = getLog(roomId);
  log.push({ sender, text });
  if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
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
// AI가 말할지 판단 + 답장 생성
// -----------------------------
// 한 번의 발언에 답하는 AI 수의 상한 (실제 사람들은 다 같이 답하지 않아요)
const MAX_REPLIES = Number(process.env.MAX_REPLIES) || 3;
const RESPOND_CHANCE = 0.5;

// 이번 발언에 답할 AI를 고른다: 이름이 불린 AI는 반드시, 나머지는 확률적으로 (순서도 매번 섞음)
function chooseResponders(aiNames, text) {
  const mentioned = aiNames.filter((n) => text.includes(n));
  const others = shuffle(aiNames.filter((n) => !mentioned.includes(n)));
  const chosen = [...mentioned];
  for (const n of others) {
    if (chosen.length >= MAX_REPLIES) break;
    if (Math.random() < RESPOND_CHANCE) chosen.push(n);
  }
  if (!chosen.length && others.length) chosen.push(others[0]); // 아무도 안 답하면 한 명은 답함
  return shuffle(chosen);
}

// 모델 답장을 메신저 채팅처럼 다듬는다 (이모지/마크다운/긴 문장 제거)
function humanize(text) {
  let t = String(text || '');
  t = t.replace(/\p{Extended_Pictographic}/gu, '');     // 이모지
  t = t.replace(/[*#`_>~]/g, '');                         // 마크다운 기호
  t = t.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '').trim(); // 겉따옴표
  const sentences = t.match(/[^.!?…]+(?:[.!?…]+|$)/g) || [t];
  if (sentences.length > 2) t = sentences.slice(0, 2).join('').trim();   // 두 문장까지만
  if (/[^.]\.$/.test(t)) t = t.slice(0, -1);              // 마침표 하나로 끝나면 뗌 (채팅체)
  return t.trim();
}

async function generateReply(roomId, aiName) {
  if (MOCK_AI) {
    const samples = ['ㅇㅇ 들었어', '음.. 그래?', '그건 좀 의심스러운데', '나는 잘 모르겠어', 'ㅋㅋ 그럴 수도'];
    return samples[Math.floor(Math.random() * samples.length)];
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 120,
    system: getSystemPrompt(roomId, aiName),
    messages: buildMessagesFor(roomId, aiName),
  });

  let reply = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  // 모델이 "[이름] ..." 형태로 말을 시작하면 이름표를 떼어냄
  reply = reply.replace(/^\[[^\]]{1,20}\]\s*/, '');
  return humanize(reply);
}

// 글자를 치는 시간 + 생각하는 시간 (매번 조금씩 다르게)
function typingDelay(text) {
  return Math.min(1000 + text.length * 110 + randInt(0, 1200), 6500);
}

// 한 번의 유저 발언에 대해 각 AI가 순서대로 반응 (동시에 쏟아지지 않게 순차 처리)
async function runAiTurn(roomId, aiNames, userText, onReply) {
  for (const name of chooseResponders(aiNames, userText)) {
    try {
      const text = await generateReply(roomId, name);
      if (!text) continue;
      pushLog(roomId, name, text);
      await onReply({ sender: name, text, delay: typingDelay(text) });
    } catch (err) {
      console.error(`[${name}] 응답 오류:`, err.status || '', err.message);
    }
  }
}

// -----------------------------
// Unity용 HTTP API
// -----------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, mock: MOCK_AI, model: MODEL });
});

const getRoomId = (v) => String(v || 'main').slice(0, 40);

// 새 게임 시작: AI를 무작위로 만들어 방에 배정 (이름/성격/이미지/인원수 전부 랜덤)
//   body: { roomId, count(0이면 서버가 랜덤), spriteCount(Unity에 있는 캐릭터 이미지 수) }
app.post('/api/roster', rateLimit, (req, res) => {
  const body = req.body || {};
  const roomId = getRoomId(body.roomId);
  const count = Math.max(0, Math.min(parseInt(body.count, 10) || 0, 8));
  const spriteCount = Math.max(1, Math.min(parseInt(body.spriteCount, 10) || 1, 50));

  const roster = makeRoster(count, spriteCount);
  rosters.set(roomId, roster);
  logs.delete(roomId); // 새 게임이니 이전 대화는 지움

  res.json({ roster: publicRoster(roster) });
});

// 이미 만들어진 명단 조회 (나중에 다른 플레이어가 같은 방에 들어올 때 사용)
app.get('/api/roster', (req, res) => {
  const roster = rosters.get(getRoomId(req.query.roomId));
  if (!roster) return res.status(404).json({ error: '아직 이 방에 AI가 없어요.' });
  res.json({ roster: publicRoster(roster) });
});

app.post('/api/chat', rateLimit, async (req, res) => {
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

  pushLog(roomId, sender, text);

  const replies = [];
  await runAiTurn(roomId, aiNames, text, async (r) => {
    replies.push(r);
  });

  res.json({ replies });
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}${MOCK_AI ? ' (MOCK_AI 모드)' : ''}`);
});