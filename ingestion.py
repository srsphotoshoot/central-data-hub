import os
import requests
import datetime
from sqlalchemy.orm import Session
from database import RawData, SessionLocal
from dotenv import load_dotenv

load_dotenv()

DECENT_ERP_API_URL = os.getenv("DECENT_ERP_API_URL")
DECENT_ERP_API_KEY = os.getenv("DECENT_ERP_API_KEY")

def fetch_and_store_data(endpoint: str, source: str = "decent_erp", method: str = "GET", payload: dict = None):
    """Fetch data from Decent ERP API and store raw response in database."""
    if not DECENT_ERP_API_URL or not DECENT_ERP_API_KEY:
        print("❌ Error: DECENT_ERP_API_URL or DECENT_ERP_API_KEY missing in .env")
        return None
    
    url = f"{DECENT_ERP_API_URL}/{endpoint.lstrip('/')}"
    headers = {"Authorization": f"Bearer {DECENT_ERP_API_KEY}"}
    
    try:
        if method.upper() == "POST":
            response = requests.post(url, headers=headers, json=payload)
        else:
            response = requests.get(url, headers=headers, params=payload)
            
        response.raise_for_status()
        data = response.json()
        
        # Save to database
        db = SessionLocal()
        raw_entry = RawData(
            source=source,
            endpoint=endpoint,
            method=method.upper(),
            headers=dict(response.request.headers),
            data=data,
            received_at=datetime.datetime.utcnow()
        )
        db.add(raw_entry)
        db.commit()
        db.refresh(raw_entry)
        db.close()
        
        print(f"✅ Successfully fetched and stored {endpoint} ({method})")
        return data
    except Exception as e:
        print(f"❌ Failed to fetch {endpoint}: {str(e)}")
        return None

if __name__ == "__main__":
    # Test call if run directly
    fetch_and_store_data("/api/v1/test_endpoint")
