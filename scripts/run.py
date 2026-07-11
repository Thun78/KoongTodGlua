import requests
import json

# ==========================================
# 1. CONFIGURATION
# ==========================================
json_file_path = "" 
api_key = ""
TARGET_MINUTE = 65  # The live minute you want to generate a prediction for
VIEWER_PERSONA = "Bettor"  # Options: Casual Fan, Analyst, Bettor

# ==========================================
# 2. CONVERT RAW EVENTS INTO A MINUTE-SNAPSHOT
# ==========================================
def generate_match_snapshot(filepath, target_min):
    try:
        with open(filepath, 'r', encoding='utf-8') as file:
            events = json.load(file)
    except Exception as e:
        print(f"Error loading file: {e}")
        return None

    # Initialize snapshot accumulators
    snapshot = {
        "current_minute": target_min,
        "score": {"home": 0, "away": 0},
        "shots": {"home": 0, "away": 0},
        "fouls": {"home": 0, "away": 0},
        "yellow_cards": {"home": 0, "away": 0},
        "corners": {"home": 0, "away": 0}
    }
    
    # Identify teams (assuming first events define home/away context)
    teams = list(set(ev.get("team", {}).get("name") for ev in events if ev.get("team")))
    if len(teams) < 2:
        return None
    home_team, away_team = teams[0], teams[1]
    snapshot["teams"] = {"home": home_team, "away": away_team}

    # Process all events up to the target minute
    for ev in events:
        minute = ev.get("minute", 0)
        if minute > target_min:
            continue
            
        team_name = ev.get("team", {}).get("name")
        side = "home" if team_name == home_team else "away"
        event_type = ev.get("type", {}).get("name")

        if event_type == "Shot":
            snapshot["shots"][side] += 1
            # Check if shot resulted in a goal
            if ev.get("shot", {}).get("outcome", {}).get("name") == "Goal":
                snapshot["score"][side] += 1
        elif event_type == "Foul Committed":
            snapshot["fouls"][side] += 1
            # Check for yellow cards
            card = ev.get("foul_committed", {}).get("card", {}).get("name")
            if card in ["Yellow Card", "Second Yellow"]:
                snapshot["yellow_cards"][side] += 1
        elif event_type == "Corner Handled" or (ev.get("pass", {}).get("type", {}).get("name") == "Corner"):
            snapshot["corners"][side] += 1

    return snapshot

# Generate the data payload matching your SFT format
match_snapshot = generate_match_snapshot(json_file_path, TARGET_MINUTE)
if not match_snapshot:
    print("Failed to process match snapshot.")
    exit()

# ==========================================
# 3. CONSTRUCT SYSTEM PROMPT FOR STRUCTURED OUTPUT
# ==========================================
url = "https://api.fireworks.ai/inference/v1/chat/completions"

# Instruct the model to return ONLY valid JSON matching a specific layout
system_instruction = (
    "You are the AdaptiveMatch AI inference engine. Analyze the given match snapshot "
    "and return a valid JSON object containing final match predictions and curated stats "
    "tailored to the user's persona. Do not include markdown code blocks, formatting, or conversational filler."
)

user_prompt = f"""
Persona: {VIEWER_PERSONA}
Current Match Snapshot:
{json.dumps(match_snapshot, indent=2)}

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

payload = {
    "model": "accounts/jessesukan-96us90f3t/models/goong-ai#accounts/jessesukan-96us90f3t/deployments/som2sqpp",
    "max_tokens": 1000,
    "temperature": 0.2,  # Lower temperature for deterministic structural output
    "response_format": {"type": "json_object"},  # Forces the Fireworks engine to output pure JSON
    "messages": [
        {"role": "system", "content": system_instruction},
        {"role": "user", "content": user_prompt}
    ]
}

headers = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Authorization": f"Bearer {api_key}"
}

# ==========================================
# 4. EXECUTE AND PARSE SPECIFIC VALUES
# ==========================================
response = requests.post(url, headers=headers, data=json.dumps(payload))

if response.status_code == 200:
    try:
        # Extract response text and parse it into a Python dictionary
        raw_content = response.json()["choices"][0]["message"]["content"]
        predictions = json.loads(raw_content)
        
        # Clean print statements targeting specific keys
        home_t = match_snapshot["teams"]["home"]
        away_t = match_snapshot["teams"]["away"]
        
        print("\n=== LIVE MATCH PREDICTIONS ===")
        print(f"Current State ({TARGET_MINUTE}'): {home_t} {match_snapshot['score']['home']} - {match_snapshot['score']['away']} {away_t}")
        print("---------------------------------")
        
        p_score = predictions["predicted_final_score"]
        print(f"Predicted Final Score: {home_t} {p_score['home']} - {p_score['away']} {away_t}")
        
        p_poss = predictions["predicted_final_possession"]
        print(f"Predicted Final Possession: {home_t} {p_poss['home']}% | {p_poss['away']}% {away_t}")
        
        p_corn = predictions["predicted_final_corners"]
        print(f"Predicted Final Corners: {home_t} {p_corn['home']} | {p_corn['away']} {away_t}")
        
        print("\n=== CURATED VIEW FOR PERSONA:", VIEWER_PERSONA.upper(), "===")
        for stat in predictions["curated_panels"]:
            print(f" -> Display Panel: {stat}")
            
    except (json.JSONDecodeError, KeyError) as e:
        print("Error parsing structured JSON from model response:", e)
        print("Raw output was:", response.json())
else:
    print(f"Error: {response.status_code}\n{response.text}")


"""
What data should you feed the model at runtime?
Since you trained your fine-tuned Gemma 4 variant using historical match
snapshots, you must supply the runtime engine with exactly the same type of structured data context.
Your replay-engine pipeline should continuously feed the model rolling cumulative match aggregates up to minute $M$, 
instead of raw event timelines.A highly optimized strategy for this context looks like this:
Basic Matrix Metrics: Current Minute, Current Score, Total Shots, Shots on Target, Corners, Fouls, and Cards.
Dynamic Momentum Vectors: Pass completion rates over the last 10 minutes (to let the model notice if a team is suddenly pinned in their own half), and total box entries.
Contextual Metadata: Match significance (e.g., knockout tournament vs. league match) and starting pre-match Elo ratings, so the model knows who the pre-game favorite was when interpreting a 0-0 state at minute 70.
To visualize how your frontend panels, persona selector, and live snapshot engine will interact with these predictive updates, you can explore the simulation architecture layout mapped out below:
"""
