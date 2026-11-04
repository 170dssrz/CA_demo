
const { createPythonGame } = require("./pythonClient");

async function test() {
  try {
    console.log("Python 서버에 게임 생성 요청 중...");

    const game = await createPythonGame();

    console.log("연결 성공!");
    console.log("게임 ID:", game.game_id);
    console.log("게임 상태:", game.status);
    console.log("현재 단계:", game.phase);
    console.log("플레이어:", game.players);
  } catch (error) {
    console.error("연결 실패:", error.message);
  }
}

test();
