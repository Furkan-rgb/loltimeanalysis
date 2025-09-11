import requests
import pandas as pd
import time
import os
from dotenv import load_dotenv
from datetime import datetime

# --- CONFIGURATION ---
load_dotenv()
API_KEY = os.getenv("RIOT_API_KEY")
if not API_KEY:
    raise ValueError("RIOT_API_KEY not found in .env file")

HEADERS = {
    "X-Riot-Token": API_KEY
}

# --- HELPER FUNCTIONS ---

def get_puuid(game_name: str, tag_line: str, region: str = "europe") -> str | None:
    """Fetches the PUUID for a given Riot ID."""
    url = f"https://{region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/{game_name}/{tag_line}"
    try:
        response = requests.get(url, headers=HEADERS)
        response.raise_for_status() # Raises an HTTPError for bad responses (4xx or 5xx)
        return response.json()['puuid']
    except requests.exceptions.RequestException as e:
        print(f"Error fetching PUUID: {e}")
        return None

def get_match_ids(puuid: str, count: int, start_index: int, region: str = "europe") -> list | None:
    """Fetches a list of match IDs for a given PUUID, starting from a specific index."""
    url = f"https://{region}.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids?queue=420&start={start_index}&count={count}"
    try:
        response = requests.get(url, headers=HEADERS)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error fetching match IDs: {e}")
        return None

def get_match_details(match_id: str, puuid: str, region: str = "europe") -> dict | None:
    """Fetches details for a single match and extracts relevant player data."""
    url = f"https://{region}.api.riotgames.com/lol/match/v5/matches/{match_id}"
    try:
        response = requests.get(url, headers=HEADERS)
        response.raise_for_status()
        data = response.json()
        
        # Find the specific player's data in the participants list
        player_data = next((p for p in data['info']['participants'] if p['puuid'] == puuid), None)
        
        if player_data:
            # Game timestamp is in milliseconds, convert to a readable format
            game_timestamp = data['info']['gameCreation'] / 1000
            game_datetime = datetime.fromtimestamp(game_timestamp)

            return {
                "match_id": match_id,
                "timestamp": game_datetime,
                "date": game_datetime.strftime('%Y-%m-%d'),
                "time_start": game_datetime.strftime('%H:%M:%S'),
                "day_of_week": game_datetime.strftime('%A'),
                "outcome": "Win" if player_data['win'] else "Loss",
                "champion": player_data['championName'],
                "role": player_data['teamPosition']
            }
        return None
    except requests.exceptions.RequestException as e:
        print(f"Error fetching details for match {match_id}: {e}")
        return None


if __name__ == "__main__":
    GAME_NAME = "Blearhunter"
    TAG_LINE = "8100"
    REGION = "europe"
    TOTAL_GAMES_TO_FETCH = 1000

    print(f"Starting process to fetch the last {TOTAL_GAMES_TO_FETCH} games...")
    
    my_puuid = get_puuid(GAME_NAME, TAG_LINE, REGION)
    if not my_puuid:
        print("Could not retrieve PUUID. Exiting.")
        exit()
    
    print(f"Successfully found PUUID: {my_puuid}")
    
    all_match_ids = []
    start_index = 0
    # Loop to fetch games in chunks of 100 until the desired total is reached
    while len(all_match_ids) < TOTAL_GAMES_TO_FETCH:
        print(f"Fetching games from index {start_index}...")
        
        # We fetch 100 games at a time, which is the max count allowed by the API
        chunk_match_ids = get_match_ids(my_puuid, 100, start_index, REGION)
        
        # If the API returns an empty list, it means there's no more match history
        if not chunk_match_ids:
            print("No more matches found in history. Stopping.")
            break
        
        all_match_ids.extend(chunk_match_ids)
        start_index += 100 # Increment the start index for the next request
        
        # A small delay to be respectful to the API between calls for the match list
        time.sleep(1)

    print(f"Found {len(all_match_ids)} total match IDs. Fetching details for each...")
    
    all_games_data = []
    # Loop through the master list of all fetched match IDs
    for i, match_id in enumerate(all_match_ids):
        # Provide progress feedback to the user
        print(f"Processing match {i+1}/{len(all_match_ids)}...")
        
        details = get_match_details(match_id, my_puuid, REGION)
        if details:
            all_games_data.append(details)
        
        # --- CRITICAL: Respect API Rate Limits ---
        # A 1.2-second sleep is a safe buffer to not exceed the 100 requests/2 mins limit.
        time.sleep(1.2)

    if not all_games_data:
        print("No match data could be processed.")
        exit()

    # Convert the list of dictionaries to a pandas DataFrame
    df = pd.DataFrame(all_games_data)
    
    # Save the DataFrame to a CSV file
    output_filename = "lol_ranked_history.csv"
    df.to_csv(output_filename, index=False)
    
    print(f"\n✅ Success! Data for {len(df)} games has been saved to '{output_filename}'")
    print("\nFirst 5 rows of your new dataset:")
    print(df.head())