// server.js
// 최소 프로토타입: 유저 1명 + AI 1명이 채팅으로 대화하는 서버

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 정적 파일(public 폴더 안의 index.html 등)을 제공
app.use(express.static('public'));

// Claude API 클라이언트 생성 (.env 파일의 ANTHROPIC_API_KEY를 자동으로 읽음)
const anthropic = new Anthropic();

// -----------------------------
// AI 캐릭터(페르소나) 목록
// 배열에 항목을 추가하면 AI가 더 늘어남
// -----------------------------
const AI_PERSONAS = [
  {
    name: '미노',
    systemPrompt: `너는 '미노'라는 이름의 마을 주민이다.
- 말투는 편하고 약간 무뚝뚝하지만 친근하다.
- 문장은 짧게, 가끔은 한두 단어로만 대답한다.
- 완벽하게 정돈된 문장보다는 구어체와 약간의 오타/축약("ㅇㅇ", "그니까" 등)을 섞어 쓴다.
- 너무 친절하거나 설명적으로 굴지 않는다. 사람처럼 감정 기복이 있다.
- 네가 AI라는 사실을 먼저 밝히지 않는다.
- 답변은 1~3문장을 넘기지 않는다.`,
  },
  {
    name: '하루',
    systemPrompt: `너는 '하루'라는 이름의 마을 주민이다.
- 밝고 수다스러운 성격이지만, 가끔 엉뚱한 질문을 던진다.
- 이모티콘이나 웃음 표현(ㅋㅋ, ㅎㅎ)을 종종 섞어 쓴다.
- 다른 사람 말에 관심이 많아서 되묻는 걸 좋아한다.
- 네가 AI라는 사실을 먼저 밝히지 않는다.
- 답변은 1~3문장을 넘기지 않는다.`,
  },
];

// 캐릭터별로 대화 기록을 따로 관리
// (같은 대화를 보지만, 각자 자기 시점에서 role: assistant/user를 구성해야 함)
let sharedLog = []; // { sender: string, text: string } 형태로 전체 로그 저장

// 이 AI가 지금 반응할지 판단하는 아주 단순한 규칙
// 나중에 LLM에게 직접 판단시키는 방식으로 고도화 가능
function shouldRespond(persona, userMessage) {
  const mentioned = userMessage.includes(persona.name);
  const randomChance = Math.random() < 0.6; // 60% 확률로 반응
  return mentioned || randomChance;
}

// 특정 캐릭터 시점으로 sharedLog를 Claude API의 messages 형식으로 변환
function buildMessagesFor(personaName) {
  return sharedLog.map((entry) => ({
    role: entry.sender === personaName ? 'assistant' : 'user',
    // 다른 사람이 한 말은 "누가 말했는지"를 같이 넣어줘야 헷갈리지 않음
    content:
      entry.sender === personaName ? entry.text : `[${entry.sender}] ${entry.text}`,
  }));
}

io.on('connection', (socket) => {
  console.log('유저 접속:', socket.id);

  // 유저가 메시지를 보냈을 때
  socket.on('chat message', async (userMessage) => {
    // 1) 유저 메시지를 모두에게 표시 + 로그에 기록
    io.emit('chat message', { sender: '나', text: userMessage });
    sharedLog.push({ sender: '나', text: userMessage });

    // 2) 각 AI 캐릭터가 순서대로 "반응할지" 판단하며 답장
    //    한 명씩 순차 처리해서 동시에 답이 쏟아지지 않게 함
    for (const persona of AI_PERSONAS) {
      if (!shouldRespond(persona, userMessage)) continue;

      try {
        io.emit('typing', { sender: persona.name });

        const response = await anthropic.messages.create({
          model: 'claude-sonnet-5',
          max_tokens: 200,
          system: persona.systemPrompt,
          messages: buildMessagesFor(persona.name),
        });

        const aiText = response.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n');

        // 응답 속도를 문장 길이에 비례해 지연 (사람처럼 보이게)
        const delay = Math.min(800 + aiText.length * 40, 3500);
        await new Promise((resolve) => setTimeout(resolve, delay));

        io.emit('chat message', { sender: persona.name, text: aiText });
        sharedLog.push({ sender: persona.name, text: aiText });

        // 다음 AI가 판단하기 전에 짧은 텀 (너무 몰아치지 않게)
        await new Promise((resolve) => setTimeout(resolve, 600));
      } catch (err) {
        console.error(`${persona.name} 응답 오류:`, err);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('유저 접속 종료:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});