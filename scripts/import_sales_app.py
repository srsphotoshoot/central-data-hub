import json
import os
import sys
import datetime

# Add CDH root to path to import database modules
cdh_path = "/Users/romitaggarwal/Desktop/AI/central data hub"
sys.path.append(cdh_path)

from database import SessionLocal, ProcessedData, init_db

def import_products():
    sales_app_products = "/Users/romitaggarwal/Desktop/AI/sales_app/server/data/products.json"
    
    if not os.path.exists(sales_app_products):
        print(f"❌ Sales App products not found at {sales_app_products}")
        return

    with open(sales_app_products, "r") as f:
        products = json.load(f)

    db = SessionLocal()
    init_db() # Ensure tables exist
    
    count = 0
    for p in products:
        # Check if already exists
        existing = db.query(ProcessedData).filter(
            ProcessedData.category == "products",
            ProcessedData.entity_id == p["uid"]
        ).first()
        
        if not existing:
            new_entry = ProcessedData(
                category="products",
                entity_id=p["uid"],
                content=p,
                updated_at=datetime.datetime.utcnow()
            )
            db.add(new_entry)
            count += 1
    
    db.commit()
    db.close()
    print(f"✅ Imported {count} new products into Central Data Hub.")

if __name__ == "__main__":
    import_products()
