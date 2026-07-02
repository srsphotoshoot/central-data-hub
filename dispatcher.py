import requests
import json
from database import APIKey, SessionLocal

def dispatch_processed_data(category: str, data: dict):
    """Notify external projects that new data is available."""
    db = SessionLocal()
    try:
        # Find all active projects that have a callback_url and access to this category
        projects = db.query(APIKey).filter(
            APIKey.is_active == True,
            APIKey.callback_url != None
        ).all()
        
        targets = []
        for project in projects:
            # Check if category is in scope
            if not project.scope or category in project.scope:
                targets.append((project.project_name, project.callback_url))
    finally:
        db.close()
        
    for project_name, callback_url in targets:
        try:
            print(f"📡 Dispatching '{category}' to {project_name} at {callback_url}")
            # In a real system, you'd add a secret signature header here
            response = requests.post(
                callback_url, 
                json={
                    "event": "data_available",
                    "category": category,
                    "data": data
                },
                timeout=5
            )
            response.raise_for_status()
            print(f"✅ Dispatch successful for {project_name}")
        except Exception as e:
            print(f"❌ Dispatch failed for {project_name}: {str(e)}")
