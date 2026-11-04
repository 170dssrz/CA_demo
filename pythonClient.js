
const PYTHON_URL =
  process.env.PYTHON_URL || "http://127.0.0.1:8000";

async function createPythonGame() {
  const response = await fetch(`${PYTHON_URL}/games`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ai_count: 4,
      mafia_count: 1
    }),
    signal: AbortSignal.timeout(10000)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}

module.exports = { createPythonGame };
