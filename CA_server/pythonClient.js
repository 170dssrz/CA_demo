
const PYTHON_URL =
  process.env.PYTHON_URL || "http://127.0.0.1:8000";

async function createPythonGame(aiCount = 4, mafiaCount = 1) {
  const response = await fetch(`${PYTHON_URL}/games`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ai_count: aiCount,
      mafia_count: mafiaCount
    }),
    signal: AbortSignal.timeout(30000)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}


async function requestPython(path, method = "GET", body = null) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    signal: AbortSignal.timeout(30000)
  };

  if (body !== null) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${PYTHON_URL}${path}`, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}

// 회의 시작
async function startPythonMeeting(gameId, callerId, reason = "emergency") {
  return requestPython(
    `/games/${encodeURIComponent(gameId)}/meeting`,
    "POST",
    { caller_id: callerId, reason }
  );
}

// 투표 시작
async function startPythonVoting(gameId) {
  return requestPython(
    `/games/${encodeURIComponent(gameId)}/voting/start`,
    "POST"
  );
}

// 투표 제출
async function submitPythonVote(gameId, voterId, targetId) {
  return requestPython(
    `/games/${encodeURIComponent(gameId)}/vote`,
    "POST",
    { voter_id: voterId, target_id: targetId }
  );
}

// 투표 집계 및 추방
async function finalizePythonVoting(gameId) {
  return requestPython(
    `/games/${encodeURIComponent(gameId)}/voting/finalize`,
    "POST"
  );
}

// 게임 상태 조회
async function getPythonGameState(gameId) {
  return requestPython(
    `/games/${encodeURIComponent(gameId)}/state`
  );
}

module.exports = {
  createPythonGame,
  startPythonMeeting,
  startPythonVoting,
  submitPythonVote,
  finalizePythonVoting,
  getPythonGameState
};

