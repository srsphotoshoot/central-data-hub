import os
import sys
from google_auth_oauthlib.flow import InstalledAppFlow

BASE_DIR = "/Users/romitaggarwal/Desktop/AI/central data hub"
CREDENTIALS_FILE = os.path.join(BASE_DIR, "credentials.json")
TOKEN_FILE = os.path.join(BASE_DIR, "token.json")

def main():
    # Full drive access is required to list, download, and delete files after processing
    scopes = ['https://www.googleapis.com/auth/drive']
    if not os.path.exists(CREDENTIALS_FILE):
        print(f"Error: '{CREDENTIALS_FILE}' not found.")
        print("Please place your OAuth client secrets JSON file as 'credentials.json' in: ")
        print(f"  {BASE_DIR}/credentials.json")
        sys.exit(1)
        
    print("Starting Google OAuth authorization flow...")
    try:
        flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, scopes)
        creds = flow.run_local_server(port=0)
        
        # Save the credentials for the next run
        with open(TOKEN_FILE, 'w') as token:
            token.write(creds.to_json())
        print("\n" + "="*50)
        print(f"✅ Success! Authorization token successfully saved to:")
        print(f"  {TOKEN_FILE}")
        print("="*50)
        print("The background 'cdh-drive-sync' service can now run fully headless in the background!")
    except Exception as e:
        print(f"\n❌ Error during authorization: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
