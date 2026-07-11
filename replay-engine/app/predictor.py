"""Fireworks AI prediction client.

Encapsulates the LLM call logic from scripts/run.py into a reusable
module for the replay-engine API. Builds a match snapshot prompt,
sends it to the fine-tuned Gemma model on Fireworks, and returns
structured predictions.
"""

import json
import os
import logging

import requests

logger = logging.getLogger(__name__)

FIREWORKS_URL = "https://api.fireworks.ai/inference/v1/chat/completions"
FIREWORKS_MODEL = "accounts/jessesukan-96us90f3t/models/goong-ai#accounts/jessesukan-96us90f3t/deployments/som2sqpp"

PERSONA_MAP = {
    "casual": "Casual Fan",
    "analyst": "Analyst",
    "bettor": "Bettor",
}

SYSTEM_INSTRUCTION = (
    "You are the AdaptiveMatch AI inference engine. Analyze the given match snapshot "
    "and return a valid JSON object containing final match predictions and curated stats "
    "tailored to the user's persona. Do not include markdown code blocks, formatting, or conversational filler."
)


def _build_user_prompt(snapshot: dict, persona_label: str) -> str:
    return f"""
Persona: {persona_label}
Current Match Snapshot:
{json.dumps(snapshot, indent=2)}

Predict the final statistics at the end of the 90 minutes and choose exactly 3 relevant stats to highlight for this persona. 
Return your response precisely in this JSON schema:
{{
  "predicted_final_score": {{"home": 0, "away": 0}},
  "predicted_final_possession": {{"home": 50, "away": 50}},
  "predicted_final_corners": {{"home": 0, "away": 0}},
  "predicted_final_yellow_cards": {{"home": 0, "away": 0}},
  "curated_panels": ["list", "of", "3", "stat", "names", "worth", "showing", "now"]
}}
"""


def snapshot_to_prompt_dict(
    match_info: dict,
    snapshot: dict,
    minute: float,
) -> dict:
    """Convert a replay-engine snapshot into the prompt format the
    fine-tuned model expects (same shape as run.py's generate_match_snapshot)."""
    home_team = match_info["home_team"]
    away_team = match_info["away_team"]
    return {
        "current_minute": round(minute),
        "score": {"home": snapshot["score"][0], "away": snapshot["score"][1]},
        "shots": {"home": snapshot["shots"][0], "away": snapshot["shots"][1]},
        "fouls": {"home": snapshot["fouls"][0], "away": snapshot["fouls"][1]},
        "yellow_cards": {"home": snapshot["cards"][0], "away": snapshot["cards"][1]},
        "corners": {"home": snapshot["corners"][0], "away": snapshot["corners"][1]},
        "teams": {"home": home_team, "away": away_team},
    }


def predict(snapshot_dict: dict, persona_id: str) -> dict:
    """Call the Fireworks AI model and return the parsed prediction dict.

    Raises RuntimeError on API or parsing failures.
    """
    api_key = os.environ.get(
        "FIREWORKS_API_KEY", "fw_5oTcj9fqM6U3Wd5pj1jRpH"
    )
    persona_label = PERSONA_MAP.get(persona_id, "Casual Fan")

    payload = {
        "model": FIREWORKS_MODEL,
        "max_tokens": 1000,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_INSTRUCTION},
            {"role": "user", "content": _build_user_prompt(snapshot_dict, persona_label)},
        ],
    }
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }

    logger.info("Calling Fireworks AI for minute %s, persona %s", snapshot_dict.get("current_minute"), persona_label)
    resp = requests.post(FIREWORKS_URL, headers=headers, json=payload, timeout=30)

    if resp.status_code != 200:
        raise RuntimeError(f"Fireworks API error {resp.status_code}: {resp.text[:500]}")

    try:
        raw_content = resp.json()["choices"][0]["message"]["content"]
        predictions = json.loads(raw_content)
    except (json.JSONDecodeError, KeyError, IndexError) as e:
        raise RuntimeError(f"Failed to parse model response: {e}")

    return predictions
