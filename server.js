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
// AI 캐릭터(페르소나) 설정
// 나중에 이 부분을 캐릭터별로 여러 개 만들면 됨
// -----------------------------
const AI_PERSONA = {
  name: '미노',
  systemPrompt: `너는 '미노'라는 이름의 마을 주민이다.
- 말투는 편하고 약간 무뚝뚝하지만 친근하다.
- 문장은 짧게, 가끔은 한두 단어로만 대답한다.
- 완벽하게 정돈된 문장보다는 구어체와 약간의 오타/축약("ㅇㅇ", "그니까" 등)을 섞어 쓴다.
- 너무 친절하거나 설명적으로 굴지 않는다. 사람처럼 감정 기복이 있다.
- 네가 AI라는 사실을 먼저 밝히지 않는다.
- 답변은 1~3문장을 넘기지 않는다.`,
};

// 대화 기록을 메모리에 저장 (프로토타입이라 서버 재시작하면 사라짐)
// 나중에 유저별/방별로 분리하고 DB에 저장하도록 확장 가능
let conversationHistory = [];

io.on('connection', (socket) => {
  console.log('유저 접속:', socket.id);

  // 유저가 메시지를 보냈을 때
  socket.on('chat message', async (userMessage) => {
    // 1) 유저 메시지를 모두에게 표시
    io.emit('chat message', { sender: '나', text: userMessage });

    // 2) 대화 기록에 추가
    conversationHistory.push({ role: 'user', content: userMessage });

    try {
      // 3) AI가 "생각 중"임을 알림 (타이핑 인디케이터)
      io.emit('typing', { sender: AI_PERSONA.name });

      // 4) Claude API 호출
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 200,
        system: AI_PERSONA.systemPrompt,
        messages: conversationHistory,
      });

      const aiText = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      // 5) 사람처럼 보이도록 응답 속도를 문장 길이에 비례해서 지연시킴
      const delay = Math.min(1000 + aiText.length * 40, 4000);
      setTimeout(() => {
        io.emit('chat message', { sender: AI_PERSONA.name, text: aiText });
        conversationHistory.push({ role: 'assistant', content: aiText });
      }, delay);
    } catch (err) {
      console.error('Claude API 호출 오류:', err);
      io.emit('chat message', {
        sender: '시스템',
        text: '(AI 응답 중 오류가 발생했습니다. 콘솔을 확인하세요.)',
      });
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
