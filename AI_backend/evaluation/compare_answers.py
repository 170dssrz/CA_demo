"""Compare Claude answers: no-memory LLM, semantic RAG, ARTEM-inspired retrieval.

Run from AI_backend:
  python -m evaluation.compare_answers             # dry-run: no API cost
  python -m evaluation.compare_answers --run       # 18 Claude API calls

Uses the same 6 labeled questions as evaluation.compare_retrievers.
Outputs CSV under evaluation/results/. This is an exploratory experiment:
structured cues are manually supplied, not automatically extracted from queries.
"""
from __future__ import annotations

import argparse
import csv
import os
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory

from dotenv import load_dotenv
from evaluation.compare_retrievers import GAME, OBSERVER, QUESTIONS, seed
from memory.memory_answer_generator import MemoryAnswerGenerator
from memory.memory_store import MemoryStore
from memory.rag_retriever import RAGRetriever
from memory.spatiotemporal_retriever import SpatiotemporalRetriever


def load_existing_env() -> Path:
    # This file: CA/AI_backend/evaluation/compare_answers.py
    root = Path(__file__).resolve().parents[2]
    env_path = root / "CA_server" / ".env"
    if not env_path.is_file():
        raise FileNotFoundError(f"기존 Node.js .env를 찾지 못했습니다: {env_path}")
    load_dotenv(env_path, override=False)
    return env_path


def run(live: bool, model_override: str | None = None) -> None:
    env_path = load_existing_env()
    model = model_override or os.getenv("CLAUDE_MODEL") or "claude-sonnet-5-5"
    if live and not os.getenv("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY가 설정되지 않았습니다. 키 값은 출력하지 마세요.")
    print(f"ENV file: {env_path}")
    print(f"Model: {model} | Mode: {'LIVE' if live else 'DRY RUN'}")
    print("Structured: manually labeled cues; RAG: natural-language query.")
    print("Baseline: no retrieved memory (not the full game chat context).")

    output_dir = Path(__file__).resolve().parent / "results"
    output_dir.mkdir(exist_ok=True)
    filename = "answers_" + datetime.now().strftime("%Y%m%d_%H%M%S") + ("_live" if live else "_dry") + ".csv"
    output_path = output_dir / filename
    generator = MemoryAnswerGenerator(model=model)
    rows = []

    with TemporaryDirectory() as directory:
        store = MemoryStore(Path(directory) / "comparison.db")
        seed(store)
        rag = RAGRetriever(store)
        structured = SpatiotemporalRetriever(store)
        for q in QUESTIONS:
            k = len(q.expected)
            # Same observer, same underlying memory dataset.
            retrieved = {
                "LLM_no_memory": [],
                "RAG": rag.retrieve(GAME, OBSERVER, q.query, top_k=k),
                "ARTEM_inspired": structured.retrieve(
                    GAME, OBSERVER, mode=q.mode, **q.cues
                )[:k],
            }
            print(f"\n[{q.name}] {q.query} | expected={list(q.expected)}")
            for method, events in retrieved.items():
                ids = [event.event_id for event in events]
                if any(event.observer_id != OBSERVER for event in events):
                    raise AssertionError("다른 AI의 기억이 섞였습니다.")
                if live:
                    try:
                        answer = generator.answer(q.query, events, observer_id=OBSERVER)
                        status = "ok"
                    except Exception as exc:
                        # Do not silently replace failed API responses with fabricated answers.
                        answer = ""
                        status = f"error:{type(exc).__name__}: {str(exc)[:180]}"
                else:
                    answer = ""
                    status = "dry_run"
                rows.append({
                    "question_type": q.name,
                    "question": q.query,
                    "method": method,
                    "model": model,
                    "expected_event_ids": "|".join(q.expected),
                    "retrieved_event_ids": "|".join(ids),
                    "retrieved_count": len(ids),
                    "answer": answer,
                    "status": status,
                    "answer_correct_manual": "",  # Fill after reading actual answer.
                })
                print(f"  {method}: ids={ids} | {status}")
                if live and status == "ok":
                    print(f"    answer: {answer}")

    columns = [
        "question_type", "question", "method", "model", "expected_event_ids",
        "retrieved_event_ids", "retrieved_count", "answer", "status", "answer_correct_manual",
    ]
    with output_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nSaved {len(rows)} rows: {output_path}")
    print("NOTE: Answer accuracy is not auto-scored; fill answer_correct_manual after review.")
    if not live:
        print("No Claude API calls were made. Use --run to generate real answers (18 calls).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true", help="Actually call Claude (18 requests).")
    parser.add_argument("--model", default=None, help="Override CLAUDE_MODEL, if needed.")
    args = parser.parse_args()
    run(live=args.run, model_override=args.model)
