import requests
import pyperclip
import json
import time

# --- Configuration ---
# This script assumes the League of Legends client is running and you are in a game.
# Pip install requirements: pip install requests pyperclip

# --- Improved Reusable Prompt ---
# This prompt is designed to force a concise, actionable response with no "bloat".
PROMPT_TEMPLATE = """
Persona: You are a Challenger-level league of legends jungle coach. Your analysis is sharp, predictive, and focused on building sequential advantages. You are a master of jungle tracking, tempo, and adaptive strategy.

Task: I am the jungler, {active_champion_name}. The current game time is {game_time_formatted}. Analyze the provided game state JSON. Your primary goal is to provide a multi-step plan for the next 2 minutes, starting with the highest-probability action for the next 60 seconds.

Analysis Priorities (in order):

1.  **Objective Timers & Control**: Dragon, Herald, Baron.
2.  **Enemy Jungler Location & Pathing**: Where are they likely to be and what will they do next?
3.  **Key Cooldowns**: Enemy summoner spells or ultimates.
4.  **Lane States & Gank Opportunities**: Push/pull, health, wave size.
5.  **Power Spikes**: Your team's and the enemy's key item/level breakpoints.

Output Rules:

-   Optimized for maximum glanceability and rapid comprehension.
-   Lead with the Directive. All commands must be specific and actionable.
-   Use emojis as visual cues for each section.
-   Keep all text extremely concise.

Provide the output in this exact format:

🎯 **DIRECTIVE:** [THE SINGLE, MOST IMPACTFUL COMMAND FOR THE NEXT 60 SECONDS IN ALL CAPS. BE SPECIFIC, E.G., "PATH TOPSIDE AND SWEEP THE RIVER BUSH AT 9:15"]

⚡ **THE WINDOW:** [The key event or game state that makes this the right play NOW. E.g., "Bot lane just reset, enemy has no flash."]

🧠 **RATIONALE:** [The brief "why" behind this play. E.g., "Secures priority for Dragon."]

🔗 **SEQUENCE:** [The immediate follow-up action AFTER the directive succeeds. E.g., "After gank, immediately rotate to start Dragon."]

🔄 **PIVOT PLAY:** [The backup plan if the directive becomes impossible. E.g., "If top lane recalls, invade enemy Krugs and reset."]

⚠️ **RISK & REWARD:** [Risk: Low/Medium/High. Reward: What is gained if successful. E.g., "Risk: Medium (Lee Sin could be near). Reward: Top tower plates and Herald control."]

📊 **ASSESSMENT:**
    Win Con: [Your team's clearest path to victory]
    Enemy JGL:📍 [Predicted location & intention. E.g., "Likely pathing botside for their 2nd blue buff."]
    Tempo: [Ahead / Even / Behind]

Game State Data:
{summarized_game_json}
"""

def get_live_game_data():
    """Fetches all necessary data from the Riot Live Client Data API."""
    try:
        # The API uses a self-signed certificate, so we disable warnings.
        requests.packages.urllib3.disable_warnings(requests.packages.urllib3.exceptions.InsecureRequestWarning)

        player_list = requests.get('https://127.0.0.1:2999/liveclientdata/playerlist', verify=False).json()
        game_stats = requests.get('https://127.0.0.1:2999/liveclientdata/gamestats', verify=False).json()
        active_player = requests.get('https://127.0.0.1:2999/liveclientdata/activeplayer', verify=False).json()
        
        return player_list, game_stats, active_player

    except requests.exceptions.RequestException as e:
        print("Error connecting to the League client API. Is a game running?")
        return None, None, None

def summarize_game_data(player_list, active_summoner_name):
    """
    Creates a clean and highly concise summary of the game state,
    including the keystone rune.
    """
    summary = {
        "myTeam": [],
        "enemyTeam": []
    }
    
    active_player_team = next((p.get('team') for p in player_list if p.get('summonerName') == active_summoner_name), None)
        
    if not active_player_team:
        return None

    for player in player_list:
        # Safely access the keystone rune's display name
        keystone_rune = player.get('runes', {}).get('keystone', {}).get('displayName', 'N/A')

        # Using abbreviated keys for conciseness
        player_summary = {
            "c": player.get('championName'),       # champion
            "p": player.get('position'),           # position
            "r": keystone_rune,                    # keystone rune
            "kda": f"{player['scores']['kills']}/{player['scores']['deaths']}/{player['scores']['assists']}",
            "cs": player['scores']['creepScore'],
            "i": [item['displayName'] for item in player['items']] # items
        }
        
        if player.get('team') == active_player_team:
            summary["myTeam"].append(player_summary)
        else:
            summary["enemyTeam"].append(player_summary)
            
    return summary
def main():
    """Main function to fetch data, format the prompt, and copy it."""
    print("🎯 Attempting to fetch live game data...")
    player_list, game_stats, active_player = get_live_game_data()

    if not all([player_list, game_stats, active_player]):
        print("Could not retrieve game data. Exiting.")
        time.sleep(5)
        return

    print("✅ Successfully fetched game data.")
    
    # --- Data Processing ---
    active_summoner_name = active_player.get('summonerName')
    active_champion_name = 'Unknown'
    for p in player_list:
        if p.get('summonerName') == active_summoner_name:
            active_champion_name = p.get('championName')
            break

    summarized_data = summarize_game_data(player_list, active_summoner_name)
    if not summarized_data:
        print("Could not process player data correctly.")
        return

    summarized_game_json = json.dumps(summarized_data)

    game_time_seconds = game_stats.get('gameTime', 0)
    minutes, seconds = divmod(int(game_time_seconds), 60)
    game_time_formatted = f"{minutes:02d}:{seconds:02d}"

    # --- Prompt Generation ---
    final_prompt = PROMPT_TEMPLATE.format(
        active_champion_name=active_champion_name,
        game_time_formatted=game_time_formatted,
        summarized_game_json=summarized_game_json
    )

    try:
        pyperclip.copy(final_prompt)
        print("\n" + "="*50)
        print("✨ Prompt successfully generated and copied to clipboard!")
        print("Paste it into the AI chat for your next move.")
        print("="*50)
    except pyperclip.PyperclipException:
        print("\n" + "!"*50)
        print("Could not copy to clipboard. Please copy the prompt manually:")
        print("!"*50)
        print(final_prompt)

if __name__ == "__main__":
    main()